import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import {
  createRuntime,
  getPlatformAccount,
  listMyPlatformActivity,
  listSecurityEvents,
  recordPlatformAccountChange,
  revokeOtherPlatformSessions,
  revokePlatformSession,
  updatePlatformAccount,
  type Runtime,
} from "../src/index.ts";

let env: TestDb;
let rt: Runtime;

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await env?.stop();
});

async function session(userId: string) {
  const id = randomUUID();
  await rt._db.db.insert(schema.sessions).values({ id, userId, token: `t-${id}`, expiresAt: new Date(Date.now() + 3_600_000), userAgent: "Mozilla/5.0 (Windows NT 10.0) Firefox/121.0" });
  return id;
}

const audit = (userId: string, action: string) =>
  rt._db.db.select().from(schema.platformAuditLogs).where(and(eq(schema.platformAuditLogs.actorUserId, userId), eq(schema.platformAuditLogs.action, action)));

describe("platform account", () => {
  it("shows my role summary and MFA state, and no support session by default", async () => {
    const s = await seedPlatformStaff(rt._db.db, { email: "acct-a@staff.test", role: "platform_admin" });
    const a = await getPlatformAccount(rt, s.userId);
    expect(a.role).toBe("platform_admin");
    expect(a.roleLabel).toBe("Admin");
    expect(a.can.length).toBeGreaterThan(0);
    expect(a.mfa.enabled).toBe(true);
    expect(a.supportSessions).toEqual([]);
  });

  it("updates only name, phone and job title, writes an audit row, and refuses a non-staff user", async () => {
    const s = await seedPlatformStaff(rt._db.db, { email: "acct-b@staff.test", role: "platform_support" });
    const out = await updatePlatformAccount(rt, s.userId, { name: " Sam  ", jobTitle: "Support engineer", phone: "+91 98765 43210" });
    expect(out).toMatchObject({ name: "Sam", jobTitle: "Support engineer", phone: "+91 98765 43210", role: "platform_support" });
    expect(out.email).toBe("acct-b@staff.test");
    expect((await audit(s.userId, "platform_account.update_profile")).length).toBe(1);
    await expect(updatePlatformAccount(rt, s.userId, { name: "  " })).rejects.toThrow(/name is required/i);
    await expect(updatePlatformAccount(rt, s.userId, { phone: "x" })).rejects.toThrow(/phone/i);
    const [plain] = await rt._db.db.insert(schema.users).values({ email: `plain-${randomUUID()}@x.test`, name: "Plain" }).returning();
    await expect(updatePlatformAccount(rt, plain!.id, { name: "Nope" })).rejects.toThrow();
  });

  it("revokes another device and all others, never the current one, never another staff member's, and audits each", async () => {
    const s = await seedPlatformStaff(rt._db.db, { email: "acct-c@staff.test" });
    const other = await seedPlatformStaff(rt._db.db, { email: "acct-d@staff.test" });
    const cur = await session(s.userId);
    const dev = await session(s.userId);
    const dev2 = await session(s.userId);
    const theirs = await session(other.userId);
    await expect(revokePlatformSession(rt, s.userId, cur, cur)).rejects.toThrow(/sign out/i);
    expect(await revokePlatformSession(rt, s.userId, theirs, cur)).toEqual({ revoked: false });
    expect(await revokePlatformSession(rt, s.userId, dev, cur)).toEqual({ revoked: true });
    expect(await revokeOtherPlatformSessions(rt, s.userId, cur)).toEqual({ count: 1 });
    const left = await rt._db.db.select().from(schema.sessions).where(eq(schema.sessions.userId, s.userId));
    expect(left.some((r) => r.id === cur)).toBe(true);
    expect(left.some((r) => r.id === dev2)).toBe(false);
    expect((await rt._db.db.select().from(schema.sessions).where(eq(schema.sessions.id, theirs))).length).toBe(1);
    expect((await audit(s.userId, "platform_account.revoke_session")).length).toBe(2);
    expect((await audit(s.userId, "platform_account.revoke_other_sessions")).length).toBe(1);
    await expect(revokeOtherPlatformSessions(rt, s.userId, undefined)).rejects.toThrow();
  });

  it("records password and backup-code changes as audit rows and security events", async () => {
    const s = await seedPlatformStaff(rt._db.db, { email: "acct-e@staff.test" });
    await recordPlatformAccountChange(rt, s.userId, "password_changed", { ip: "198.51.100.4", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120 Safari/537" });
    await recordPlatformAccountChange(rt, s.userId, "backup_codes_regenerated");
    expect((await audit(s.userId, "platform_account.password_changed")).length).toBe(1);
    const events = await listSecurityEvents(rt, s.userId);
    expect(events.map((e) => e.type).sort()).toEqual(["backup_codes_regenerated", "password_changed"]);
  });

  it("lists only my own recent actions", async () => {
    const s = await seedPlatformStaff(rt._db.db, { email: "acct-f@staff.test" });
    const other = await seedPlatformStaff(rt._db.db, { email: "acct-g@staff.test" });
    await updatePlatformAccount(rt, s.userId, { jobTitle: "A" });
    await updatePlatformAccount(rt, other.userId, { jobTitle: "B" });
    const mine = await listMyPlatformActivity(rt, s.userId);
    expect(mine.length).toBe(1);
    expect(mine[0]?.action).toBe("platform_account.update_profile");
  });
});
