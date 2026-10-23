import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { STORE_PERMISSIONS, type GoogleIdentityClaims } from "@bs/auth";
import {
  completeGoogleSetupVerification,
  createRuntime,
  deleteAdminCustomer,
  disconnectStoreGoogle,
  getCustomerBySession,
  getStoreGoogleSignin,
  getStorefrontGoogleConfig,
  issueSetupNonce,
  provisionTenant,
  setStoreGoogleClientId,
  signInWithGoogle,
  startStoreGoogleVerification,
  updatePlatformGoogleSettings,
  updateStoreGoogleSignin,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

// docs/GOOGLE-SIGNIN-PLAN.md, Tier B: a store's own Google app for its customers, on its own custom domain.
let env: TestDb;
let rtPlatform: Runtime;
let rtWeb: Runtime;

const SECRET = "test-signing-secret-at-least-32-characters-long";
const CLIENT_A = "111111111111-storeaclientidaaaa.apps.googleusercontent.com";
const CLIENT_B = "222222222222-storebclientidbbbb.apps.googleusercontent.com";

interface Store {
  tenantId: string;
  ownerId: string;
  host: string;
  ctx: TenantContext;
}
let a: Store;
let b: Store;
let noDomain: Store;

function ctxFor(t: { tenantId: string; ownerId: string }, label: string): TenantContext {
  return {
    tenantId: t.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: t.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: `req-gsi-${label}`,
  };
}

async function mkStore(slug: string, withDomain: boolean): Promise<Store> {
  const t = await provisionTenant(rtPlatform, {
    storeName: `Store ${slug}`,
    slug,
    owner: { email: `owner-${slug}@gsi.test`, name: slug },
    planCode: "starter",
    source: "platform_admin",
  });
  const host = `shop-${slug}.example.test`;
  if (withDomain) {
    await rtPlatform._db.db.insert(schema.domains).values({ tenantId: t.tenantId, hostname: host, type: "custom", status: "active", isPrimary: false });
  }
  return { tenantId: t.tenantId, ownerId: t.ownerId, host, ctx: ctxFor(t, slug) };
}

const claims = (nonce: string, over: Partial<GoogleIdentityClaims> = {}): GoogleIdentityClaims => ({
  sub: "g-sub-1",
  email: "shopper@example.test",
  emailVerified: true,
  name: "Shopper One",
  nonce,
  ...over,
});

/** Verifier stub standing in for Google: accepts only tokens minted for the expected Client ID. */
function verifierFor(expectedClientId: string, c: (nonce: string) => GoogleIdentityClaims | null) {
  return async (idToken: string, clientId: string) => {
    if (clientId !== expectedClientId) return null;
    return c(idToken.replace("token-", ""));
  };
}

/** Walks a store through Client ID, test sign-in and enable. */
async function connect(s: Store, clientId: string) {
  await setStoreGoogleClientId(rtWeb, s.ctx, { clientId });
  const nonce = issueSetupNonce(SECRET, s.tenantId, s.host);
  const { url } = await startStoreGoogleVerification(rtWeb, s.ctx, SECRET);
  const ticket = decodeURIComponent(new URL(url).searchParams.get("t")!);
  await completeGoogleSetupVerification(
    rtWeb._db.db,
    { ticket, idToken: `token-${nonce}`, nonce, host: s.host },
    { secret: SECRET, verify: verifierFor(clientId, (n) => claims(n)) },
  );
  await updateStoreGoogleSignin(rtWeb, s.ctx, { enabled: true });
}

async function signIn(s: Store, clientId: string, c: Partial<GoogleIdentityClaims> = {}, host = s.host) {
  const configNonce = (await getStorefrontGoogleConfig(rtWeb._db.db, SECRET, s.tenantId, host)).nonce ?? issueSetupNonce(SECRET, s.tenantId, host);
  return signInWithGoogle(
    rtWeb._db.db,
    s.tenantId,
    { idToken: `token-${configNonce}`, nonce: configNonce, host },
    { secret: SECRET, verify: verifierFor(clientId, (n) => claims(n, c)) },
    { ip: "10.0.0.7" },
  );
}

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const admin = await seedPlatformStaff(rtPlatform._db.db, { email: "gsi-admin@platform.test", role: "platform_admin" });
  await updatePlatformGoogleSettings(rtPlatform, admin.userId, { customerSigninAllowed: true });
  a = await mkStore("gsia", true);
  b = await mkStore("gsib", true);
  noDomain = await mkStore("gsinodom", false);
}, 180_000);

afterAll(async () => {
  await rtWeb?._db.close?.();
  await rtPlatform?._db.close?.();
  await env?.stop?.();
});

async function customerByEmail(s: Store, email: string) {
  return withTenant(rtWeb._db.db, s.tenantId, async (tx) => {
    const [c] = await tx.select().from(schema.customers).where(and(eq(schema.customers.tenantId, s.tenantId), eq(schema.customers.email, email)));
    return c;
  });
}

describe("setup is gated on a live custom domain", () => {
  it("rejects a store that only has the platform subdomain", async () => {
    await expect(setStoreGoogleClientId(rtWeb, noDomain.ctx, { clientId: CLIENT_A })).rejects.toThrow(/own domain/);
    await expect(startStoreGoogleVerification(rtWeb, noDomain.ctx, SECRET)).rejects.toThrow(/own domain/);
    const view = await getStoreGoogleSignin(rtWeb, noDomain.ctx);
    expect(view).toMatchObject({ platformAllowed: true, hasVerifiedDomain: false, origins: [] });
  });

  it("lists only live custom domains as the origins to register, never the platform subdomain", async () => {
    const view = await getStoreGoogleSignin(rtWeb, a.ctx);
    expect(view.origins).toEqual([`https://${a.host}`]);
    expect(view.origins.join(" ")).not.toContain("bcom.si");
  });

  it("rejects a malformed Client ID and requires a passing test before enabling", async () => {
    await expect(setStoreGoogleClientId(rtWeb, a.ctx, { clientId: "nope" })).rejects.toThrow(/Client ID/);
    await setStoreGoogleClientId(rtWeb, a.ctx, { clientId: CLIENT_A });
    await expect(updateStoreGoogleSignin(rtWeb, a.ctx, { enabled: true })).rejects.toThrow(/test sign-in/);
  });
});

describe("setup test sign-in", () => {
  it("refuses a wrong host, an expired ticket, a mismatched nonce and a token for another Client ID", async () => {
    await setStoreGoogleClientId(rtWeb, a.ctx, { clientId: CLIENT_A });
    const { url } = await startStoreGoogleVerification(rtWeb, a.ctx, SECRET);
    expect(url.startsWith(`https://${a.host}/account/google-verify?t=`)).toBe(true);
    const ticket = decodeURIComponent(new URL(url).searchParams.get("t")!);
    const nonce = issueSetupNonce(SECRET, a.tenantId, a.host);
    const deps = { secret: SECRET, verify: verifierFor(CLIENT_A, (n) => claims(n)) };
    const ok = { ticket, idToken: `token-${nonce}`, nonce, host: a.host };

    await expect(completeGoogleSetupVerification(rtWeb._db.db, { ...ok, host: "a.bcom.si" }, deps)).rejects.toThrow(/custom domain/);
    await expect(completeGoogleSetupVerification(rtWeb._db.db, { ...ok, host: b.host }, deps)).rejects.toThrow(/custom domain/);
    await expect(completeGoogleSetupVerification(rtWeb._db.db, ok, { ...deps, now: Date.now() + 11 * 60_000 })).rejects.toThrow(/expired/);
    await expect(
      completeGoogleSetupVerification(rtWeb._db.db, { ...ok, idToken: "token-other-nonce" }, { ...deps, verify: verifierFor(CLIENT_A, () => claims("different")) }),
    ).rejects.toThrow(/could not be verified/);
    await expect(
      completeGoogleSetupVerification(rtWeb._db.db, ok, { ...deps, verify: verifierFor(CLIENT_B, (n) => claims(n)) }),
    ).rejects.toThrow(/could not be verified/);
    // nothing was marked verified by any failed attempt
    expect((await getStoreGoogleSignin(rtWeb, a.ctx)).verified).toBe(false);
  });

  it("marks the setup verified on success and then allows enabling", async () => {
    await connect(a, CLIENT_A);
    const view = await getStoreGoogleSignin(rtWeb, a.ctx);
    expect(view).toMatchObject({ verified: true, enabled: true, verifiedHost: a.host, clientId: CLIENT_A });
    const audit = await withTenant(rtWeb._db.db, a.tenantId, (tx) =>
      tx.select({ action: schema.auditLogs.action }).from(schema.auditLogs).where(eq(schema.auditLogs.tenantId, a.tenantId)),
    );
    expect(audit.map((r) => r.action)).toEqual(expect.arrayContaining(["social_auth.google.client_id_set", "social_auth.google.verified", "social_auth.google.enabled"]));
  });

  it("voids the test and switches off when the Client ID changes", async () => {
    await setStoreGoogleClientId(rtWeb, a.ctx, { clientId: CLIENT_B });
    expect(await getStoreGoogleSignin(rtWeb, a.ctx)).toMatchObject({ verified: false, enabled: false, needsVerification: true });
    await connect(a, CLIENT_A);
  });

  it("voids the test when the verified custom domain is no longer live", async () => {
    await rtPlatform._db.db.execute(sql`UPDATE domains SET status = 'removed' WHERE hostname = ${a.host}`);
    const cfg = await getStorefrontGoogleConfig(rtWeb._db.db, SECRET, a.tenantId, a.host);
    expect(cfg.enabled).toBe(false);
    expect(await getStoreGoogleSignin(rtWeb, a.ctx)).toMatchObject({ verified: false, hasVerifiedDomain: false });
    await rtPlatform._db.db.execute(sql`UPDATE domains SET status = 'active' WHERE hostname = ${a.host}`);
  });
});

describe("customer sign-in with Google", () => {
  it("is offered only on the store's own live custom domain", async () => {
    const onCustom = await getStorefrontGoogleConfig(rtWeb._db.db, SECRET, a.tenantId, a.host);
    expect(onCustom).toMatchObject({ enabled: true, clientId: CLIENT_A, oneTap: true });
    expect(onCustom.nonce).toBeTruthy();
    expect((await getStorefrontGoogleConfig(rtWeb._db.db, SECRET, a.tenantId, "gsia.bcom.si")).enabled).toBe(false);
    expect((await getStorefrontGoogleConfig(rtWeb._db.db, SECRET, a.tenantId, b.host)).enabled).toBe(false);
    expect((await getStorefrontGoogleConfig(rtWeb._db.db, SECRET, b.tenantId, b.host)).enabled).toBe(false);
  });

  it("creates a verified customer with no password and no phone, and a working session", async () => {
    const res = await signIn(a, CLIENT_A);
    expect(res.customer.email).toBe("shopper@example.test");
    const c = await customerByEmail(a, "shopper@example.test");
    expect(c).toMatchObject({ emailVerified: true, isGuest: false, passwordHash: null, phone: null });
    const idRows = await withTenant(rtWeb._db.db, a.tenantId, (tx) => tx.select().from(schema.customerIdentities));
    expect(idRows).toHaveLength(1);
    expect(idRows[0]).toMatchObject({ provider: "google", subject: "g-sub-1" });
    expect((await getCustomerBySession(rtWeb._db.db, a.tenantId, res.token))?.id).toBe(c!.id);
    // a session minted on one store is rejected on another
    expect(await getCustomerBySession(rtWeb._db.db, b.tenantId, res.token)).toBeNull();
  });

  it("signs the same Google account back in to the same customer, even if its email changed", async () => {
    const before = await customerByEmail(a, "shopper@example.test");
    const res = await signIn(a, CLIENT_A, { email: "renamed@example.test" });
    expect(res.customer.id).toBe(before!.id);
    expect(await customerByEmail(a, "renamed@example.test")).toBeUndefined();
  });

  it("links an existing guest customer with the same verified email and adopts it", async () => {
    const [guest] = await withTenant(rtWeb._db.db, a.tenantId, (tx) =>
      tx.insert(schema.customers).values({ tenantId: a.tenantId, email: "guest@example.test", name: "Guest", isGuest: true, emailVerified: false }).returning(),
    );
    const res = await signIn(a, CLIENT_A, { sub: "g-sub-guest", email: "guest@example.test" });
    expect(res.customer.id).toBe(guest!.id);
    expect(await customerByEmail(a, "guest@example.test")).toMatchObject({ emailVerified: true, isGuest: false });
  });

  it("clears a password set on an unverified account before linking, and revokes its sessions", async () => {
    const [victim] = await withTenant(rtWeb._db.db, a.tenantId, (tx) =>
      tx.insert(schema.customers).values({ tenantId: a.tenantId, email: "victim@example.test", name: "Victim", passwordHash: "attacker-set-hash", emailVerified: false }).returning(),
    );
    const { createCustomerSession } = await import("../src/customers/session.ts");
    const old = await withTenant(rtWeb._db.db, a.tenantId, (tx) => createCustomerSession(tx, a.tenantId, victim!.id, {}));
    expect(await getCustomerBySession(rtWeb._db.db, a.tenantId, old.token)).not.toBeNull();

    await signIn(a, CLIENT_A, { sub: "g-sub-victim", email: "victim@example.test" });
    const after = await customerByEmail(a, "victim@example.test");
    expect(after).toMatchObject({ passwordHash: null, emailVerified: true });
    expect(await getCustomerBySession(rtWeb._db.db, a.tenantId, old.token)).toBeNull();
  });

  it("keeps an existing verified password account's password when linking", async () => {
    await withTenant(rtWeb._db.db, a.tenantId, (tx) =>
      tx.insert(schema.customers).values({ tenantId: a.tenantId, email: "pw@example.test", name: "Pw", passwordHash: "real-hash", emailVerified: true }),
    );
    await signIn(a, CLIENT_A, { sub: "g-sub-pw", email: "pw@example.test" });
    expect((await customerByEmail(a, "pw@example.test"))?.passwordHash).toBe("real-hash");
  });

  it("rejects an unverified Google email, a token for another Client ID, a foreign-host nonce and a replay", async () => {
    await expect(signIn(a, CLIENT_A, { emailVerified: false, sub: "g-unv", email: "unv@example.test" })).rejects.toThrow(/not verified/);
    await expect(signIn(a, CLIENT_B)).rejects.toThrow(/could not be verified/);

    const nonce = (await getStorefrontGoogleConfig(rtWeb._db.db, SECRET, a.tenantId, a.host)).nonce!;
    const deps = { secret: SECRET, verify: verifierFor(CLIENT_A, (n) => claims(n, { sub: "g-replay", email: "replay@example.test" })) };
    const input = { idToken: `token-${nonce}`, nonce, host: a.host };
    await signInWithGoogle(rtWeb._db.db, a.tenantId, input, deps, { ip: "10.0.0.8" });
    await expect(signInWithGoogle(rtWeb._db.db, a.tenantId, input, deps, { ip: "10.0.0.8" })).rejects.toThrow(/already used/);

    // a nonce issued for another store's host does not work here
    const foreign = issueSetupNonce(SECRET, b.tenantId, b.host);
    await expect(
      signInWithGoogle(rtWeb._db.db, a.tenantId, { idToken: `token-${foreign}`, nonce: foreign, host: a.host }, deps, { ip: "10.0.0.9" }),
    ).rejects.toThrow(/expired/);
  });

  it("will not sign in a blocked customer", async () => {
    await signIn(a, CLIENT_A, { sub: "g-blocked", email: "blocked@example.test" });
    await withTenant(rtWeb._db.db, a.tenantId, (tx) =>
      tx.update(schema.customers).set({ status: "blocked" }).where(and(eq(schema.customers.tenantId, a.tenantId), eq(schema.customers.email, "blocked@example.test"))),
    );
    await expect(signIn(a, CLIENT_A, { sub: "g-blocked", email: "blocked@example.test" })).rejects.toThrow(/not available/);
  });

  it("keeps the same Google account in two stores as two independent customers", async () => {
    await connect(b, CLIENT_B);
    const inB = await signIn(b, CLIENT_B, { sub: "g-sub-1" });
    const inA = await customerByEmail(a, "shopper@example.test");
    expect(inB.customer.id).not.toBe(inA!.id);
    // store B cannot see store A's identities, and A's customer count is untouched
    const idsB = await withTenant(rtWeb._db.db, b.tenantId, (tx) => tx.select().from(schema.customerIdentities));
    expect(idsB).toHaveLength(1);
  });

  it("is unavailable once Super Admin switches the customer option off", async () => {
    const admin = await seedPlatformStaff(rtPlatform._db.db, { email: "gsi-admin2@platform.test", role: "platform_admin" });
    await updatePlatformGoogleSettings(rtPlatform, admin.userId, { customerSigninAllowed: false });
    expect((await getStorefrontGoogleConfig(rtWeb._db.db, SECRET, a.tenantId, a.host)).enabled).toBe(false);
    await expect(signIn(a, CLIENT_A, { sub: "g-off", email: "off@example.test" })).rejects.toThrow(/not available/);
    await updatePlatformGoogleSettings(rtPlatform, admin.userId, { customerSigninAllowed: true });
  });

  it("removes linked Google sign-ins when the customer is erased", async () => {
    const c = await customerByEmail(a, "shopper@example.test");
    // give the customer an order so the erase takes the anonymise path
    await rtPlatform._db.db.execute(sql`SELECT 1`);
    const res = await deleteAdminCustomer(rtWeb, a.ctx, { id: c!.id });
    expect(["deleted", "anonymised"]).toContain(res.mode);
    const left = await withTenant(rtWeb._db.db, a.tenantId, (tx) =>
      tx.select().from(schema.customerIdentities).where(eq(schema.customerIdentities.customerId, c!.id)),
    );
    expect(left).toHaveLength(0);
  });

  it("disconnecting removes the setup and stops sign-in", async () => {
    await disconnectStoreGoogle(rtWeb, a.ctx);
    expect(await getStoreGoogleSignin(rtWeb, a.ctx)).toMatchObject({ clientId: null, enabled: false, verified: false });
    expect((await getStorefrontGoogleConfig(rtWeb._db.db, SECRET, a.tenantId, a.host)).enabled).toBe(false);
  });
});
