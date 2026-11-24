/**
 * Integration: real PostgreSQL 18. Backup monitoring writes check rows, alerts once per failure episode, and the
 * Super Admin edits are role-gated and audited (docs/BACKUP-DR-PLAN.md G10).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import type { Transporter } from "nodemailer";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { createDb } from "@bs/db";
import { createRuntime, type Runtime } from "../src/index.ts";
import { updatePlatformEmailSettings } from "../src/platform/email-settings.ts";
import { getBackupOverview, recordRestoreDrill, runBackupChecks, updateBackupSettings, type DumpObject } from "../src/platform/backups.ts";
import { setPlatformEmailTransportFactory } from "../src/system/platform-mailer.ts";

let env: TestDb;
let rt: Runtime;
let admin: { userId: string };
let support: { userId: string };
const mails: Array<Record<string, unknown>> = [];

const NOW = new Date();
const dump = (h: number, size = 1000): DumpObject => ({ key: `data/d-${h}.dmp`, size, lastModified: new Date(NOW.getTime() - h * 3_600_000) });
const fresh = async () => [dump(2), dump(26), dump(50), dump(74), dump(98)];
const stale = async () => [dump(40), dump(64), dump(88), dump(112)];
const dumpMails = () => mails.filter((m) => String(m.subject).includes("Daily database dump"));

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 4 });
  const id = Math.random().toString(36).slice(2, 7);
  await seedPlatformStaff(rt._db.db, { email: `owner-${id}@backup.test`, role: "platform_owner" });
  admin = await seedPlatformStaff(rt._db.db, { email: `admin-${id}@backup.test`, role: "platform_admin" });
  support = await seedPlatformStaff(rt._db.db, { email: `support-${id}@backup.test`, role: "platform_support" });
  await updatePlatformEmailSettings(rt, admin.userId, {
    provider: "zoho_zeptomail",
    host: "smtp.zeptomail.in",
    port: 587,
    secureMode: "starttls",
    username: "emailapikey",
    password: "test_password_1234567890",
    fromEmail: "no-reply@bcom.si",
    fromName: "Brand Sewa",
    replyTo: "support@bcom.si",
    enabled: true,
  });
}, 180_000);

afterAll(async () => {
  setPlatformEmailTransportFactory(null);
  await rt?.close();
  await env?.stop();
});

beforeEach(async () => {
  mails.length = 0;
  setPlatformEmailTransportFactory(
    () => ({ sendMail: async (o: Record<string, unknown>) => (mails.push(o), { messageId: `m${mails.length}` }) }) as unknown as Transporter,
  );
  await rt._db.db.delete(schema.platformBackupChecks);
  await rt._db.db.delete(schema.platformRestoreDrills);
  await updateBackupSettings(rt, admin.userId, { dumpMaxAgeHours: 26, walMaxLagMinutes: 10, drillEveryDays: 35, walArchivingExpected: false, alertEmails: [] });
});

describe("runBackupChecks", () => {
  it("records one row per check: healthy dump, quiet WAL, and an undrilled restore", async () => {
    const run = await runBackupChecks(rt._db.db, { listDumps: fresh, now: NOW });
    expect(run.results.map((r) => `${r.kind}:${r.ok}`).sort()).toEqual(["drill:false", "dump:true", "wal:true"]);
    expect(run.allOk).toBe(false);
    expect(await rt._db.db.select().from(schema.platformBackupChecks)).toHaveLength(3);
  });

  it("is fully healthy once a passing drill is recorded", async () => {
    await recordRestoreDrill(rt, admin.userId, { kind: "dump", result: "pass", drilledAt: new Date(), rtoSeconds: 300, rpoSeconds: 7200 });
    const run = await runBackupChecks(rt._db.db, { listDumps: fresh, now: NOW });
    expect(run.allOk).toBe(true);
  });

  it("treats an unreadable bucket as a failure instead of throwing", async () => {
    const run = await runBackupChecks(rt._db.db, {
      listDumps: async () => {
        throw new Error("AccessDenied");
      },
      now: NOW,
    });
    const check = run.results.find((r) => r.kind === "dump")!;
    expect(check.ok).toBe(false);
    expect(check.detail.state).toBe("unreadable");
  });

  it("emails the recipients once per failure episode, and again after 24 h", async () => {
    await updateBackupSettings(rt, admin.userId, { alertEmails: ["ops@backup.test"] });
    await runBackupChecks(rt._db.db, { listDumps: stale, now: NOW });
    expect(dumpMails()).toHaveLength(1);
    await runBackupChecks(rt._db.db, { listDumps: stale, now: new Date(NOW.getTime() + 30 * 60_000) });
    expect(dumpMails()).toHaveLength(1);
    await runBackupChecks(rt._db.db, { listDumps: stale, now: new Date(NOW.getTime() + 25 * 3_600_000) });
    expect(dumpMails()).toHaveLength(2);
  });

  it("prunes check rows older than 14 days", async () => {
    await rt._db.db.insert(schema.platformBackupChecks).values({ kind: "dump", ok: true, detail: {}, checkedAt: new Date(NOW.getTime() - 20 * 86_400_000) });
    await runBackupChecks(rt._db.db, { listDumps: fresh, now: NOW });
    const rows = await rt._db.db.select().from(schema.platformBackupChecks);
    expect(rows.every((r) => r.checkedAt > new Date(NOW.getTime() - 15 * 86_400_000))).toBe(true);
  });
});

describe("runs as the worker role (app_rw)", () => {
  it("can read the policy and drills and write check rows, but cannot change the policy or forge a drill", async () => {
    const worker = createDb(env.as("app_rw"), { max: 2, applicationName: "backup-worker-test" });
    try {
      await recordRestoreDrill(rt, admin.userId, { kind: "dump", result: "pass", drilledAt: new Date() });
      const run = await runBackupChecks(worker.db, { listDumps: fresh, now: NOW });
      expect(run.allOk).toBe(true);
      await expect(worker.db.update(schema.platformBackupSettings).set({ dumpMaxAgeHours: 168 })).rejects.toMatchObject({ cause: { message: expect.stringMatching(/permission denied/i) } });
      await expect(worker.db.insert(schema.platformRestoreDrills).values({ kind: "dump", result: "pass", drilledAt: new Date() })).rejects.toMatchObject({ cause: { message: expect.stringMatching(/permission denied/i) } });
      await expect(worker.db.update(schema.platformBackupChecks).set({ ok: true })).rejects.toMatchObject({ cause: { message: expect.stringMatching(/permission denied/i) } });
    } finally {
      await worker.close();
    }
  });
});

describe("settings, drills and overview", () => {
  it("lets an admin change the policy and audits it; support cannot", async () => {
    const out = await updateBackupSettings(rt, admin.userId, { dumpMaxAgeHours: 30, alertEmails: [" Ops@Backup.test "] });
    expect(out.dumpMaxAgeHours).toBe(30);
    expect(out.alertEmails).toEqual(["ops@backup.test"]);
    const [audit] = await rt._db.db
      .select()
      .from(schema.platformAuditLogs)
      .where(eq(schema.platformAuditLogs.action, "backup.settings_updated"))
      .orderBy(desc(schema.platformAuditLogs.createdAt))
      .limit(1);
    expect(audit?.actorUserId).toBe(admin.userId);
    await expect(updateBackupSettings(rt, support.userId, { dumpMaxAgeHours: 40 })).rejects.toThrow(/Forbidden/);
  });

  it("rejects out-of-range values and bad addresses", async () => {
    await expect(updateBackupSettings(rt, admin.userId, { dumpMaxAgeHours: 0 })).rejects.toThrow(/Validation/);
    await expect(updateBackupSettings(rt, admin.userId, { drillEveryDays: 400 })).rejects.toThrow(/Validation/);
    await expect(updateBackupSettings(rt, admin.userId, { alertEmails: ["not-an-email"] })).rejects.toThrow(/Validation/);
    await expect(updateBackupSettings(rt, admin.userId, { alertEmails: Array.from({ length: 6 }, (_, i) => `a${i}@x.test`) })).rejects.toThrow(/at most 5/);
  });

  it("records drills with an audit row and rejects future dates and support staff", async () => {
    const { id } = await recordRestoreDrill(rt, admin.userId, { kind: "tenant", result: "pass", drilledAt: new Date(), notes: "  rehearsal  " });
    const [row] = await rt._db.db.select().from(schema.platformRestoreDrills).where(eq(schema.platformRestoreDrills.id, id));
    expect(row?.notes).toBe("rehearsal");
    await expect(recordRestoreDrill(rt, admin.userId, { kind: "dump", result: "pass", drilledAt: new Date(Date.now() + 86_400_000) })).rejects.toThrow(/future/);
    await expect(recordRestoreDrill(rt, support.userId, { kind: "dump", result: "pass", drilledAt: new Date() })).rejects.toThrow(/Forbidden/);
  });

  it("builds an overview with live Postgres settings; monitoring reads never_ran until a check exists", async () => {
    const before = await getBackupOverview(rt, support.userId);
    expect(before.monitoring).toBe("never_ran");
    expect(["on", "off", "always"]).toContain(before.config.find((c) => c.key === "archive_mode")!.current);
    await runBackupChecks(rt._db.db, { listDumps: fresh, now: NOW });
    const after = await getBackupOverview(rt, support.userId);
    expect(after.monitoring).toBe("running");
    expect(after.latest.map((l) => l.kind).sort()).toEqual(["drill", "dump", "wal"]);
  });
});
