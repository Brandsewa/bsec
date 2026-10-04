import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@bs/db";
import { seedPlatformStaff, type SeededStaff } from "@bs/db/test-fixtures";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  assertPlatformStaff,
  createRuntime,
  getPlatformLoginStatus,
  getPlatformSettings,
  isStaffMfaRequired,
  updatePlatformSettings,
  type Runtime,
} from "../src/index.ts";

let env: TestDb;
let rt: Runtime;
let owner: SeededStaff;
let support: SeededStaff;
let enrolled: SeededStaff;
let plain: SeededStaff;
let seq = 0;
const savedAppEnv = process.env.APP_ENV;

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 2 });
  const n = ++seq;
  owner = await seedPlatformStaff(rt._db.db, { email: `owner-${n}@platform.test`, role: "platform_owner" });
  support = await seedPlatformStaff(rt._db.db, { email: `support-${n}@platform.test`, role: "platform_support" });
  enrolled = await seedPlatformStaff(rt._db.db, { email: `enrolled-${n}@platform.test`, role: "platform_admin", mfa: "complete" });
  plain = await seedPlatformStaff(rt._db.db, { email: `plain-${n}@platform.test`, role: "platform_support", mfa: "none" });
}, 240_000);

afterAll(async () => {
  process.env.APP_ENV = savedAppEnv;
  await rt?.close();
  await env?.stop();
});

describe("platform settings: the staff MFA toggle", () => {
  it("defaults to required outside local and to optional in APP_ENV=local when no row exists", async () => {
    await rt._db.db.delete(schema.platformSettings).where(eq(schema.platformSettings.id, "default"));

    delete process.env.APP_ENV;
    expect(await isStaffMfaRequired(rt._db.db)).toBe(true);
    await expect(assertPlatformStaff(rt, plain.userId)).rejects.toThrow(/verified MFA/);

    process.env.APP_ENV = "local";
    expect(await isStaffMfaRequired(rt._db.db)).toBe(false);
    await assertPlatformStaff(rt, plain.userId); // password-only staff pass while it is optional
  });

  it("an explicit row written by the toggle wins over the environment default", async () => {
    process.env.APP_ENV = "local"; // local default would be optional, but the row says required
    const saved = await updatePlatformSettings(rt, owner.userId, { requireStaffMfa: true });
    expect(saved).toEqual({ ok: true, requireStaffMfa: true });
    expect(await isStaffMfaRequired(rt._db.db)).toBe(true);
    await expect(assertPlatformStaff(rt, plain.userId)).rejects.toThrow(/verified MFA/);

    const view = await getPlatformSettings(rt, owner.userId);
    expect(view).toMatchObject({ requireStaffMfa: true, explicit: true, updatedByEmail: expect.stringContaining("@platform.test") });
    await rt._db.db.delete(schema.platformSettings).where(eq(schema.platformSettings.id, "default"));
  });

  it("only a platform owner can change it", async () => {
    await expect(updatePlatformSettings(rt, support.userId, { requireStaffMfa: false })).rejects.toThrow(/platform_owner/);
  });

  it("disabling flips every active staff user's authenticator flag off and audits the change", async () => {
    expect((await rt._db.db.select({ e: schema.users.twoFactorEnabled }).from(schema.users).where(eq(schema.users.id, enrolled.userId)))[0]?.e).toBe(true);
    const auditsBefore = (await rt._db.db.select({ id: schema.platformAuditLogs.id }).from(schema.platformAuditLogs).where(eq(schema.platformAuditLogs.action, "platform_settings.update"))).length;

    await updatePlatformSettings(rt, owner.userId, { requireStaffMfa: false }, { ip: "127.0.0.1" });

    const [enrolledFlag] = await rt._db.db.select({ e: schema.users.twoFactorEnabled }).from(schema.users).where(eq(schema.users.id, enrolled.userId));
    const [plainFlag] = await rt._db.db.select({ e: schema.users.twoFactorEnabled }).from(schema.users).where(eq(schema.users.id, plain.userId));
    expect(enrolledFlag?.e).toBe(false); // challenged no more; the verified secret stays for re-enabling
    expect(plainFlag?.e).toBe(false);

    const view = await getPlatformSettings(rt, owner.userId);
    expect(view).toMatchObject({ requireStaffMfa: false, explicit: true });
    const audit = await rt._db.db.select().from(schema.platformAuditLogs).where(eq(schema.platformAuditLogs.action, "platform_settings.update"));
    expect(audit).toHaveLength(auditsBefore + 1);
    expect(audit.at(-1)?.actorUserId).toBe(owner.userId);
  });

  it("re-enabling re-arms only verified authenticators and refuses password-era sessions", async () => {
    await updatePlatformSettings(rt, owner.userId, { requireStaffMfa: true });

    const [enrolledFlag] = await rt._db.db.select({ e: schema.users.twoFactorEnabled }).from(schema.users).where(eq(schema.users.id, enrolled.userId));
    const [plainFlag] = await rt._db.db.select({ e: schema.users.twoFactorEnabled }).from(schema.users).where(eq(schema.users.id, plain.userId));
    expect(enrolledFlag?.e).toBe(true);
    expect(plainFlag?.e).toBe(false); // no authenticator: enrols at next sign-in instead

    delete process.env.APP_ENV;
    const status = await getPlatformLoginStatus(rt, plain.userId, new Date());
    expect(status).toMatchObject({ mfaRequired: true, mfaEnrolled: false, mfaComplete: false, sessionValid: false });

    const enrolledStatus = await getPlatformLoginStatus(rt, enrolled.userId, new Date());
    expect(enrolledStatus).toMatchObject({ mfaRequired: true, mfaEnrolled: true, mfaComplete: true, sessionValid: true });
  });
});
