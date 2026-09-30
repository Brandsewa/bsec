import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { hashPassword, verifyPassword } from "@bs/auth";
import {
  acceptPlatformStaffInvitation,
  assertPlatformStaff,
  completePlatformMfaEnrollment,
  createPlatformStaffMember,
  createRuntime,
  deactivatePlatformStaffMember,
  getPlatformLoginStatus,
  invitePlatformStaffMember,
  reactivatePlatformStaffMember,
  updatePlatformStaffRole,
  type Runtime,
} from "../src/index.ts";

let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 3 });
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

const errorOf = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e))?.message ?? null;

describe("assertPlatformStaff: MFA state and session freshness", () => {
  it("accepts a staff member with completed MFA and a session created after enrolment", async () => {
    const s = await seedPlatformStaff(rt._db.db, { email: "ok@staff.test" });
    await expect(assertPlatformStaff(rt, s.userId, { createdAt: s.freshSessionAt })).resolves.toMatchObject({ userId: s.userId, role: "platform_owner" });
  });

  it.each([
    ["none", /MFA \(two-factor authentication not enabled\)/],
    ["unverified", /not verified/],
    ["enrolled_not_completed", /enrolment is not complete/],
  ] as const)("rejects a staff account whose MFA is '%s'", async (mfa, message) => {
    const s = await seedPlatformStaff(rt._db.db, { email: `${mfa}@staff.test`, mfa });
    expect(await errorOf(assertPlatformStaff(rt, s.userId, { createdAt: new Date() }))).toMatch(message);
  });

  it("rejects a session that was created before MFA enrolment completed (password-only session)", async () => {
    const s = await seedPlatformStaff(rt._db.db, { email: "stale@staff.test" });
    expect(await errorOf(assertPlatformStaff(rt, s.userId, { createdAt: s.staleSessionAt }))).toMatch(/predates MFA enrolment/);
    expect(await errorOf(assertPlatformStaff(rt, s.userId, {}))).toMatch(/predates MFA enrolment/);
  });

  it("rejects deactivated staff and people who are not staff at all (e.g. a store owner)", async () => {
    const off = await seedPlatformStaff(rt._db.db, { email: "off@staff.test", active: false });
    expect(await errorOf(assertPlatformStaff(rt, off.userId, { createdAt: off.freshSessionAt }))).toMatch(/not an active platform staff/);
    const [owner] = await rt._db.db.insert(schema.users).values({ email: "store-owner@shop.test", name: "Owner", emailVerified: true, twoFactorEnabled: true }).returning({ id: schema.users.id });
    expect(await errorOf(assertPlatformStaff(rt, owner!.id, { createdAt: new Date() }))).toMatch(/not an active platform staff/);
  });
});

describe("MFA enrolment completion", () => {
  it("stamps completion and kills every existing session (the password-only setup session included)", async () => {
    const s = await seedPlatformStaff(rt._db.db, { email: "enrol@staff.test", mfa: "enrolled_not_completed" });
    await rt._db.db.insert(schema.sessions).values([
      { id: "sess-1", userId: s.userId, token: "tok-1", expiresAt: new Date(Date.now() + 3600_000) },
      { id: "sess-2", userId: s.userId, token: "tok-2", expiresAt: new Date(Date.now() + 3600_000) },
    ]);
    const before = await getPlatformLoginStatus(rt, s.userId, new Date());
    expect(before).toMatchObject({ isPlatformStaff: true, mfaEnrolled: true, mfaComplete: false, sessionValid: false });

    await completePlatformMfaEnrollment(rt, s.userId, { ip: "203.0.113.5" });

    expect(await rt._db.db.select().from(schema.sessions).where(eq(schema.sessions.userId, s.userId))).toHaveLength(0);
    const after = await getPlatformLoginStatus(rt, s.userId, new Date(Date.now() + 1000));
    expect(after).toMatchObject({ mfaComplete: true, sessionValid: true });
    // A session that existed before completion is not valid even if it somehow survived
    expect((await getPlatformLoginStatus(rt, s.userId, new Date(Date.now() - 3600_000))).sessionValid).toBe(false);
    const audit = await rt._db.db.select().from(schema.platformAuditLogs).where(eq(schema.platformAuditLogs.targetId, s.userId));
    expect(audit.map((a) => a.action)).toContain("platform_staff.mfa_enrolled");
    // it cannot be run twice
    expect(await errorOf(completePlatformMfaEnrollment(rt, s.userId))).toMatch(/already complete/);
  });

  it("refuses to complete when no authenticator code was ever verified", async () => {
    const none = await seedPlatformStaff(rt._db.db, { email: "nomfa@staff.test", mfa: "none" });
    expect(await errorOf(completePlatformMfaEnrollment(rt, none.userId))).toMatch(/verify a code/);
    const unv = await seedPlatformStaff(rt._db.db, { email: "unv@staff.test", mfa: "unverified" });
    expect(await errorOf(completePlatformMfaEnrollment(rt, unv.userId))).toMatch(/verify a code/);
  });
});

describe("platform roles", () => {
  it("only an owner can change roles or reactivate; an admin cannot", async () => {
    const owner = await seedPlatformStaff(rt._db.db, { email: "owner-r@staff.test", role: "platform_owner" });
    const admin = await seedPlatformStaff(rt._db.db, { email: "admin-r@staff.test", role: "platform_admin" });
    const support = await seedPlatformStaff(rt._db.db, { email: "support-r@staff.test", role: "platform_support" });
    expect(await errorOf(updatePlatformStaffRole(rt, admin.userId, support.userId, "platform_admin"))).toMatch(/platform_owner/);
    await expect(updatePlatformStaffRole(rt, owner.userId, support.userId, "platform_admin")).resolves.toMatchObject({ newRole: "platform_admin" });
    expect(await errorOf(reactivatePlatformStaffMember(rt, admin.userId, support.userId))).toMatch(/platform_owner/);
  });

  it("support staff cannot invite or deactivate; an admin can only deactivate support staff", async () => {
    const owner = await seedPlatformStaff(rt._db.db, { email: "owner-d@staff.test", role: "platform_owner" });
    const admin = await seedPlatformStaff(rt._db.db, { email: "admin-d@staff.test", role: "platform_admin" });
    const support = await seedPlatformStaff(rt._db.db, { email: "support-d@staff.test", role: "platform_support" });
    const support2 = await seedPlatformStaff(rt._db.db, { email: "support2-d@staff.test", role: "platform_support" });

    expect(await errorOf(invitePlatformStaffMember(rt, support.userId, { email: "x@staff.test", role: "platform_support" }))).toMatch(/platform_admin/);
    expect(await errorOf(deactivatePlatformStaffMember(rt, support.userId, support2.userId))).toMatch(/platform_admin/);
    expect(await errorOf(deactivatePlatformStaffMember(rt, admin.userId, owner.userId))).toMatch(/only a platform_owner/);
    expect(await errorOf(deactivatePlatformStaffMember(rt, admin.userId, admin.userId))).toMatch(/your own account/);
    await expect(deactivatePlatformStaffMember(rt, admin.userId, support2.userId)).resolves.toMatchObject({ isActive: false });
  });

  it("protects the last active owner from demotion and deactivation, and deactivation kills sessions", async () => {
    // Make sure there is exactly one active owner.
    await rt._db.db.update(schema.platformStaff).set({ isActive: false });
    const solo = await seedPlatformStaff(rt._db.db, { email: "solo-owner@staff.test", role: "platform_owner" });
    const other = await seedPlatformStaff(rt._db.db, { email: "second-owner@staff.test", role: "platform_owner" });
    await rt._db.db.update(schema.platformStaff).set({ isActive: false }).where(eq(schema.platformStaff.userId, other.userId));

    expect(await errorOf(updatePlatformStaffRole(rt, solo.userId, solo.userId, "platform_admin"))).toMatch(/last active platform owner/);
    const admin = await seedPlatformStaff(rt._db.db, { email: "admin-lo@staff.test", role: "platform_admin" });
    expect(await errorOf(deactivatePlatformStaffMember(rt, admin.userId, solo.userId))).toMatch(/only a platform_owner|last active/);

    await rt._db.db.update(schema.platformStaff).set({ isActive: true }).where(eq(schema.platformStaff.userId, other.userId));
    await rt._db.db.insert(schema.sessions).values({ id: "sess-kill", userId: admin.userId, token: "tok-kill", expiresAt: new Date(Date.now() + 3600_000) });
    await deactivatePlatformStaffMember(rt, solo.userId, admin.userId);
    expect(await rt._db.db.select().from(schema.sessions).where(eq(schema.sessions.userId, admin.userId))).toHaveLength(0);
  });
});

describe("staff invitations", () => {
  it("stores only a hash, lets an admin invite support/admin but only an owner invite an owner, and is single-use", async () => {
    const owner = await seedPlatformStaff(rt._db.db, { email: "owner-i@staff.test", role: "platform_owner" });
    const admin = await seedPlatformStaff(rt._db.db, { email: "admin-i@staff.test", role: "platform_admin" });

    expect(await errorOf(invitePlatformStaffMember(rt, admin.userId, { email: "boss@staff.test", role: "platform_owner" }))).toMatch(/platform_owner/);

    const invite = await invitePlatformStaffMember(rt, owner.userId, { email: "New.Person@staff.test", role: "platform_support" });
    expect(invite.inviteUrl).toContain(`/accept-invitation?token=${invite.token}`);
    const [row] = await rt._db.db.select().from(schema.platformStaffInvitations).where(eq(schema.platformStaffInvitations.id, invite.id));
    expect(row!.tokenHash).toBe(createHash("sha256").update(invite.token).digest("hex"));
    expect(row!.tokenHash).not.toBe(invite.token);
    expect(row!.email).toBe("new.person@staff.test");

    // the store runtime can neither read nor write invitations
    await expect(rtWeb._db.db.select().from(schema.platformStaffInvitations)).rejects.toThrow();

    const accepted = await acceptPlatformStaffInvitation(rt, { token: invite.token, password: "A-very-long-password-1", name: "New Person" });
    expect(accepted).toMatchObject({ ok: true, email: "new.person@staff.test", role: "platform_support" });
    // MFA is required before the new account can do anything
    const [user] = await rt._db.db.select().from(schema.users).where(eq(schema.users.email, "new.person@staff.test"));
    expect(await errorOf(assertPlatformStaff(rt, user!.id, { createdAt: new Date() }))).toMatch(/MFA/);

    expect(await errorOf(acceptPlatformStaffInvitation(rt, { token: invite.token, password: "A-very-long-password-1" }))).toMatch(/invalid, expired, or has already been used/);
    expect(await errorOf(acceptPlatformStaffInvitation(rt, { token: "x".repeat(64), password: "A-very-long-password-1" }))).toMatch(/invalid, expired/);
  });

  it("an existing account must prove its current password: an invitation never replaces it", async () => {
    const owner = await seedPlatformStaff(rt._db.db, { email: "owner-e@staff.test", role: "platform_owner" });
    const [u] = await rt._db.db.insert(schema.users).values({ email: "shopkeeper@shop.test", name: "Shopkeeper", emailVerified: true }).returning({ id: schema.users.id });
    const original = "shopkeepers-own-password-1";
    await rt._db.db.insert(schema.accounts).values({ id: crypto.randomUUID(), userId: u!.id, accountId: u!.id, providerId: "credential", password: await hashPassword(original) });

    const invite = await invitePlatformStaffMember(rt, owner.userId, { email: "shopkeeper@shop.test", role: "platform_support" });
    expect(await errorOf(acceptPlatformStaffInvitation(rt, { token: invite.token, password: "attacker-chosen-password-1" }))).toMatch(/Incorrect password/);
    // the failed attempt did not burn the invitation and did not change the password
    const [acct] = await rt._db.db.select().from(schema.accounts).where(eq(schema.accounts.userId, u!.id));
    expect(await verifyPassword({ hash: acct!.password!, password: original })).toBe(true);
    await expect(acceptPlatformStaffInvitation(rt, { token: invite.token, password: original })).resolves.toMatchObject({ ok: true });
    const [acct2] = await rt._db.db.select().from(schema.accounts).where(eq(schema.accounts.userId, u!.id));
    expect(await verifyPassword({ hash: acct2!.password!, password: original })).toBe(true);
  });

  it("only one of several concurrent acceptances wins", async () => {
    const owner = await seedPlatformStaff(rt._db.db, { email: "owner-c@staff.test", role: "platform_owner" });
    const invite = await invitePlatformStaffMember(rt, owner.userId, { email: "race@staff.test", role: "platform_support" });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => acceptPlatformStaffInvitation(rt, { token: invite.token, password: "A-very-long-password-1" })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("operator bootstrap (create-staff)", () => {
  it("never resets the password of an existing account, and can reset MFA for a lost authenticator", async () => {
    const [u] = await rt._db.db.insert(schema.users).values({ email: "both@shop.test", name: "Both", emailVerified: true }).returning({ id: schema.users.id });
    const original = "my-existing-store-password-1";
    await rt._db.db.insert(schema.accounts).values({ id: crypto.randomUUID(), userId: u!.id, accountId: u!.id, providerId: "credential", password: await hashPassword(original) });

    const res = await createPlatformStaffMember(rt._db.db, { email: "both@shop.test", name: "Both", password: "some-other-password-123", role: "platform_admin" });
    expect(res).toMatchObject({ createdUser: false, passwordUnchanged: true });
    const [acct] = await rt._db.db.select().from(schema.accounts).where(eq(schema.accounts.userId, u!.id));
    expect(await verifyPassword({ hash: acct!.password!, password: original })).toBe(true);
    expect(await verifyPassword({ hash: acct!.password!, password: "some-other-password-123" })).toBe(false);

    // lost authenticator: reset removes the enrolment and every session
    const s = await seedPlatformStaff(rt._db.db, { email: "lost-phone@staff.test" });
    await rt._db.db.insert(schema.sessions).values({ id: "sess-lost", userId: s.userId, token: "tok-lost", expiresAt: new Date(Date.now() + 3600_000) });
    await createPlatformStaffMember(rt._db.db, { email: "lost-phone@staff.test", name: "x", password: "irrelevant-password-1", resetMfa: true });
    expect(await rt._db.db.select().from(schema.twoFactors).where(eq(schema.twoFactors.userId, s.userId))).toHaveLength(0);
    expect(await rt._db.db.select().from(schema.sessions).where(eq(schema.sessions.userId, s.userId))).toHaveLength(0);
    expect(await errorOf(assertPlatformStaff(rt, s.userId, { createdAt: new Date() }))).toMatch(/MFA/);
  });
});
