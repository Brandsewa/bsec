import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { googleAccountLinkGuard, googleSessionGuard, type GoogleIdentityClaims } from "@bs/auth";
import {
  createRuntime,
  getPlatformAuthOverview,
  getPublicGoogleSignin,
  issueGoogleSignupNonce,
  loadPlatformGoogleRuntimeConfig,
  provisionTenant,
  readGoogleSignupTicket,
  setPlatformGoogleClient,
  testPlatformGoogleClient,
  updatePlatformGoogleSettings,
  verifyGoogleForSignup,
  type Runtime,
} from "../src/index.ts";

// docs/GOOGLE-SIGNIN-PLAN.md, Tier A: the platform Google client for staff and store owners.
let env: TestDb;
let rt: Runtime;
let adminId: string;
let supportId: string;

const CLIENT_ID = "123456789012-abcdefghijklmnop.apps.googleusercontent.com";
const SECRET = "GOCSPX-super-secret-value-1234";
const SIGNING_SECRET = "test-signing-secret-at-least-32-characters-long";

const probeOk = async () => ({ error: "invalid_grant" });
const probeBad = async () => ({ error: "invalid_client" });

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  adminId = (await seedPlatformStaff(rt._db.db, { email: "auth-admin@platform.test", role: "platform_admin" })).userId;
  supportId = (await seedPlatformStaff(rt._db.db, { email: "auth-support@platform.test", role: "platform_support" })).userId;
}, 120_000);

afterAll(async () => {
  await rt?._db.close?.();
  await env?.stop?.();
});

describe("platform Google client settings", () => {
  it("starts disabled and not configured", async () => {
    const o = await getPlatformAuthOverview(rt, adminId);
    expect(o.google.enabled).toBe(false);
    expect(o.google.secretConfigured).toBe(false);
    expect(await getPublicGoogleSignin(rt._db.db)).toMatchObject({ enabled: false, clientId: null });
  });

  it("refuses to enable before a client exists or passes the test", async () => {
    await expect(updatePlatformGoogleSettings(rt, adminId, { enabled: true })).rejects.toThrow(/Client ID and Client Secret/);
    await expect(setPlatformGoogleClient(rt, adminId, { clientId: "not-a-client-id", clientSecret: SECRET })).rejects.toThrow(/Client ID/);
    await setPlatformGoogleClient(rt, adminId, { clientId: CLIENT_ID, clientSecret: SECRET });
    await expect(updatePlatformGoogleSettings(rt, adminId, { enabled: true })).rejects.toThrow(/connection test/);
  });

  it("only platform_admin or above can change it", async () => {
    await expect(setPlatformGoogleClient(rt, supportId, { clientId: CLIENT_ID, clientSecret: SECRET })).rejects.toThrow();
    await expect(updatePlatformGoogleSettings(rt, supportId, { oneTapAllowed: false })).rejects.toThrow();
    await expect(testPlatformGoogleClient(rt, supportId)).rejects.toThrow();
  });

  it("records a failed then a passed connection test, then enables", async () => {
    expect(await testPlatformGoogleClient(rt, adminId, undefined, probeBad)).toMatchObject({ ok: false });
    expect((await getPlatformAuthOverview(rt, adminId)).google.lastTestStatus).toBe("failed");
    await expect(updatePlatformGoogleSettings(rt, adminId, { enabled: true })).rejects.toThrow(/connection test/);

    expect(await testPlatformGoogleClient(rt, adminId, undefined, probeOk)).toEqual({ ok: true });
    await updatePlatformGoogleSettings(rt, adminId, { enabled: true });
    const pub = await getPublicGoogleSignin(rt._db.db);
    expect(pub).toMatchObject({ enabled: true, clientId: CLIENT_ID, signupAllowed: true, oneTap: true });
  });

  it("never returns the secret across the API boundary, and decrypts it only for Better Auth", async () => {
    const o = await getPlatformAuthOverview(rt, adminId);
    expect(JSON.stringify(o)).not.toContain(SECRET);
    expect(JSON.stringify(await getPublicGoogleSignin(rt._db.db))).not.toContain(SECRET);
    const [row] = await rt._db.db.select().from(schema.platformGoogleClient);
    expect(row?.secretCiphertext).toBeTruthy();
    expect(row?.secretCiphertext).not.toContain(SECRET);
    expect(await loadPlatformGoogleRuntimeConfig(rt._db.db)).toMatchObject({ clientId: CLIENT_ID, clientSecret: SECRET });
  });

  it("switches sign-in off and clears the test when the client changes", async () => {
    await setPlatformGoogleClient(rt, adminId, { clientId: "999999999999-zzzzzzzzzzzzzzzz.apps.googleusercontent.com" });
    const o = await getPlatformAuthOverview(rt, adminId);
    expect(o.google.enabled).toBe(false);
    expect(o.google.lastTestStatus).toBeNull();
    // leaving the secret blank kept the stored one
    expect(o.google.secretConfigured).toBe(true);
    expect(await loadPlatformGoogleRuntimeConfig(rt._db.db)).toBeNull();
  });

  it("writes a platform audit row for every change, without secret values", async () => {
    const rows = await rt._db.db.select().from(schema.platformAuditLogs);
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining(["auth_provider.google.client_updated", "auth_provider.google.tested", "auth_provider.google.enabled"]),
    );
    expect(JSON.stringify(rows)).not.toContain(SECRET);
  });
});

describe("store owner signup with Google", () => {
  const goodClaims = (nonce: string, over: Partial<GoogleIdentityClaims> = {}): GoogleIdentityClaims => ({
    sub: "google-sub-1",
    email: "founder@example.test",
    emailVerified: true,
    name: "Founder",
    nonce,
    ...over,
  });

  beforeAll(async () => {
    await setPlatformGoogleClient(rt, adminId, { clientId: CLIENT_ID, clientSecret: SECRET });
    await testPlatformGoogleClient(rt, adminId, undefined, probeOk);
    await updatePlatformGoogleSettings(rt, adminId, { enabled: true, staffSignupAllowed: true });
  });

  it("issues a ticket only for a verified email bound to the nonce", async () => {
    const nonce = issueGoogleSignupNonce(SIGNING_SECRET);
    const out = await verifyGoogleForSignup(rt._db.db, SIGNING_SECRET, { idToken: "t", nonce }, async () => goodClaims(nonce));
    expect(out.email).toBe("founder@example.test");
    expect(readGoogleSignupTicket(SIGNING_SECRET, out.ticket)).toMatchObject({ email: "founder@example.test", sub: "google-sub-1" });
  });

  it("rejects an unverified email, a mismatched nonce, a forged nonce and an unverifiable token", async () => {
    const nonce = issueGoogleSignupNonce(SIGNING_SECRET);
    await expect(
      verifyGoogleForSignup(rt._db.db, SIGNING_SECRET, { idToken: "t", nonce }, async () => goodClaims(nonce, { emailVerified: false })),
    ).rejects.toThrow(/not verified/);
    await expect(
      verifyGoogleForSignup(rt._db.db, SIGNING_SECRET, { idToken: "t", nonce }, async () => goodClaims("another-nonce")),
    ).rejects.toThrow(/could not be verified/);
    await expect(
      verifyGoogleForSignup(rt._db.db, SIGNING_SECRET, { idToken: "t", nonce: "1.abc.def" }, async () => goodClaims("1.abc.def")),
    ).rejects.toThrow(/expired/);
    await expect(verifyGoogleForSignup(rt._db.db, SIGNING_SECRET, { idToken: "t", nonce }, async () => null)).rejects.toThrow(
      /could not be verified/,
    );
  });

  it("refuses an expired nonce and a ticket signed with another secret", async () => {
    const old = issueGoogleSignupNonce(SIGNING_SECRET, Date.now() - 11 * 60_000);
    await expect(
      verifyGoogleForSignup(rt._db.db, SIGNING_SECRET, { idToken: "t", nonce: old }, async () => goodClaims(old)),
    ).rejects.toThrow(/expired/);
    const nonce = issueGoogleSignupNonce(SIGNING_SECRET);
    const out = await verifyGoogleForSignup(rt._db.db, SIGNING_SECRET, { idToken: "t", nonce }, async () => goodClaims(nonce));
    expect(readGoogleSignupTicket("a-different-secret-that-is-long-enough!!", out.ticket)).toBeNull();
    expect(readGoogleSignupTicket(SIGNING_SECRET, out.ticket, Date.now() + 16 * 60_000)).toBeNull();
  });

  it("is refused when owner signup with Google is switched off", async () => {
    await updatePlatformGoogleSettings(rt, adminId, { staffSignupAllowed: false });
    const nonce = issueGoogleSignupNonce(SIGNING_SECRET);
    await expect(
      verifyGoogleForSignup(rt._db.db, SIGNING_SECRET, { idToken: "t", nonce }, async () => goodClaims(nonce)),
    ).rejects.toThrow(/not available/);
    await updatePlatformGoogleSettings(rt, adminId, { staffSignupAllowed: true });
  });

  it("provisions a verified owner with a google account link and no password", async () => {
    await provisionTenant(rt, {
      storeName: "Google Store",
      slug: "google-store",
      owner: { email: "google-owner@example.test", name: "G Owner", google: { sub: "google-sub-77" } },
      planCode: "starter",
      source: "platform_admin",
    });
    const [user] = await rt._db.db.select().from(schema.users).where(eq(schema.users.email, "google-owner@example.test"));
    expect(user?.emailVerified).toBe(true);
    const accounts = await rt._db.db.select().from(schema.accounts).where(eq(schema.accounts.userId, user!.id));
    expect(accounts.map((a) => a.providerId)).toEqual(["google"]);
    expect(accounts[0]?.accountId).toBe("google-sub-77");
    expect(accounts[0]?.password ?? null).toBeNull();
  });
});

describe("google session guard (no way around two-factor)", () => {
  it("ignores sign-ins that did not come through Google", async () => {
    const guard = googleSessionGuard(rt._db.db, { requirePlatformStaff: true });
    await expect(guard({ userId: "00000000-0000-0000-0000-000000000000" }, { path: "/sign-in/email" })).resolves.toBeUndefined();
  });

  it("refuses a Google sign-in for a user with two-factor enabled", async () => {
    const [u] = await rt._db.db
      .insert(schema.users)
      .values({ email: "mfa-user@platform.test", name: "MFA", emailVerified: true, twoFactorEnabled: true })
      .returning({ id: schema.users.id });
    await expect(googleSessionGuard(rt._db.db, { requirePlatformStaff: false })({ userId: u!.id }, { path: "/callback/:id" })).rejects.toThrow(
      /second factor/,
    );
  });

  it("refuses Google for Super Admin unless the user is active platform staff", async () => {
    const [u] = await rt._db.db
      .insert(schema.users)
      .values({ email: "not-staff@platform.test", name: "Nope", emailVerified: true })
      .returning({ id: schema.users.id });
    const guard = googleSessionGuard(rt._db.db, { requirePlatformStaff: true });
    await expect(guard({ userId: u!.id }, { path: "/callback/:id" })).rejects.toThrow(/not available/);
    await expect(guard({ userId: u!.id }, { path: "/one-tap/callback" })).rejects.toThrow(/not available/);
  });

  it("lets an active platform staff member without two-factor through", async () => {
    // seedPlatformStaff enrols two-factor, so switch it off for this one account.
    await rt._db.db.update(schema.users).set({ twoFactorEnabled: false }).where(eq(schema.users.id, supportId));
    const guard = googleSessionGuard(rt._db.db, { requirePlatformStaff: true });
    await expect(guard({ userId: supportId }, { path: "/callback/:id" })).resolves.toBeUndefined();
  });
});

describe("linking Google to an owner who signed up with email and password", () => {
  async function mkOwner(email: string, emailVerified: boolean) {
    const [u] = await rt._db.db.insert(schema.users).values({ email, name: "Owner", emailVerified }).returning({ id: schema.users.id });
    const userId = u!.id;
    await rt._db.db.insert(schema.accounts).values({ id: crypto.randomUUID(), userId, accountId: userId, providerId: "credential", password: "hash" });
    await rt._db.db.insert(schema.sessions).values({ id: crypto.randomUUID(), userId, token: `tok-${userId}`, expiresAt: new Date(Date.now() + 3_600_000) });
    return userId;
  }
  const rows = async (userId: string) => ({
    credential: await rt._db.db.select().from(schema.accounts).where(eq(schema.accounts.userId, userId)),
    sessions: await rt._db.db.select().from(schema.sessions).where(eq(schema.sessions.userId, userId)),
    user: (await rt._db.db.select().from(schema.users).where(eq(schema.users.id, userId)))[0],
  });

  it("verifies the email and removes the password login and sessions of an unverified account (pre-registration takeover)", async () => {
    const id = await mkOwner("unverified-owner@example.test", false);
    await googleAccountLinkGuard(rt._db.db)({ userId: id, providerId: "google" }, { path: "/callback/:id" });
    const r = await rows(id);
    expect(r.user?.emailVerified).toBe(true);
    expect(r.credential).toHaveLength(0);
    expect(r.sessions).toHaveLength(0);
  });

  it("leaves an account whose email was already verified untouched", async () => {
    const id = await mkOwner("verified-owner@example.test", true);
    await googleAccountLinkGuard(rt._db.db)({ userId: id, providerId: "google" }, { path: "/callback/:id" });
    const r = await rows(id);
    expect(r.credential).toHaveLength(1);
    expect(r.sessions).toHaveLength(1);
  });

  it("does nothing for other providers or sign-ins that did not come through Google", async () => {
    const id = await mkOwner("other-owner@example.test", false);
    const guard = googleAccountLinkGuard(rt._db.db);
    await guard({ userId: id, providerId: "credential" }, { path: "/callback/:id" });
    await guard({ userId: id, providerId: "google" }, { path: "/sign-in/email" });
    const r = await rows(id);
    expect(r.user?.emailVerified).toBe(false);
    expect(r.credential).toHaveLength(1);
  });
});
