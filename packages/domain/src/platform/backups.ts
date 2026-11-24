/**
 * Backup monitoring (docs/BACKUP-DR-PLAN.md G4 and G10).
 *
 * What this module does: judges whether backups are healthy (pure rules), records the result of each check, stores the
 * alert policy and the restore drill log, and builds the Super Admin overview.
 * What it deliberately does NOT do: change how backups are taken. Schedule, retention and WAL archiving live in Coolify
 * and Postgres, which this app has no authority over (AGENTS.md rule 9). The overview shows the current values read from
 * the database and compares them with best practice, so a change is made once, reviewed, and then recorded here.
 */
import { desc, eq, gte, sql } from "drizzle-orm";
import { schema, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPlatformStaff, assertRoleAtLeast, writePlatformAudit, type AuditMeta } from "../platform-services.ts";
import { sendPlatformEmail } from "../system/platform-mailer.ts";

export type BackupCheckKind = "dump" | "wal" | "drill";
export type DrillKind = "dump" | "pitr" | "tenant" | "rebuild";

export interface BackupSettings {
  dumpMaxAgeHours: number;
  walMaxLagMinutes: number;
  drillEveryDays: number;
  walArchivingExpected: boolean;
  alertEmails: string[];
  updatedAt: string;
}

export interface DumpObject {
  key: string;
  size: number;
  lastModified: Date;
}

export interface ArchiverStats {
  archivedCount: number;
  failedCount: number;
  lastArchivedAt: Date | null;
  lastFailedAt: Date | null;
}

export interface CheckResult {
  kind: BackupCheckKind;
  ok: boolean;
  detail: Record<string, unknown>;
}

const MIN_SIZE_RATIO = 0.5;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/**
 * Pure rules, easy to test. `dumps` is every dump object listed, any order. A dump that is much smaller than the median of
 * the earlier ones is flagged because an empty or truncated dump still "succeeds" in Coolify.
 */
export function evaluateBackupChecks(input: {
  now: Date;
  settings: Pick<BackupSettings, "dumpMaxAgeHours" | "walMaxLagMinutes" | "drillEveryDays" | "walArchivingExpected">;
  dumps: DumpObject[] | { error: string };
  archiver: ArchiverStats | null;
  newestPassingDrillAt: Date | null;
}): CheckResult[] {
  const { now, settings } = input;
  const out: CheckResult[] = [];

  if ("error" in input.dumps) {
    out.push({ kind: "dump", ok: false, detail: { state: "unreadable", error: input.dumps.error } });
  } else {
    const sorted = [...input.dumps].sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
    const newest = sorted[0];
    if (!newest) {
      out.push({ kind: "dump", ok: false, detail: { state: "none_found" } });
    } else {
      const ageHours = (now.getTime() - newest.lastModified.getTime()) / 3_600_000;
      const earlier = sorted.slice(1, 8).map((d) => d.size);
      const baseline = earlier.length >= 3 ? median(earlier) : null;
      const tooSmall = newest.size <= 0 || (baseline !== null && newest.size < baseline * MIN_SIZE_RATIO);
      const tooOld = ageHours > settings.dumpMaxAgeHours;
      out.push({
        kind: "dump",
        ok: !tooOld && !tooSmall,
        detail: {
          state: tooOld ? "stale" : tooSmall ? "too_small" : "fresh",
          key: newest.key,
          sizeBytes: newest.size,
          ageHours: Math.round(ageHours * 10) / 10,
          baselineBytes: baseline === null ? null : Math.round(baseline),
          lastModified: newest.lastModified.toISOString(),
          count: sorted.length,
        },
      });
    }
  }

  if (!settings.walArchivingExpected) {
    out.push({ kind: "wal", ok: true, detail: { state: "not_expected", archivedCount: input.archiver?.archivedCount ?? 0 } });
  } else if (!input.archiver || !input.archiver.lastArchivedAt) {
    out.push({ kind: "wal", ok: false, detail: { state: "never_archived" } });
  } else {
    const lagMin = (now.getTime() - input.archiver.lastArchivedAt.getTime()) / 60_000;
    const failing = input.archiver.lastFailedAt !== null && input.archiver.lastFailedAt > input.archiver.lastArchivedAt;
    out.push({
      kind: "wal",
      ok: lagMin <= settings.walMaxLagMinutes && !failing,
      detail: {
        state: failing ? "failing" : lagMin > settings.walMaxLagMinutes ? "lagging" : "healthy",
        lagMinutes: Math.round(lagMin * 10) / 10,
        archivedCount: input.archiver.archivedCount,
        failedCount: input.archiver.failedCount,
        lastArchivedAt: input.archiver.lastArchivedAt.toISOString(),
        lastFailedAt: input.archiver.lastFailedAt?.toISOString() ?? null,
      },
    });
  }

  if (!input.newestPassingDrillAt) {
    out.push({ kind: "drill", ok: false, detail: { state: "never_drilled" } });
  } else {
    const ageDays = (now.getTime() - input.newestPassingDrillAt.getTime()) / 86_400_000;
    out.push({
      kind: "drill",
      ok: ageDays <= settings.drillEveryDays,
      detail: { state: ageDays <= settings.drillEveryDays ? "current" : "overdue", ageDays: Math.round(ageDays * 10) / 10, lastPassAt: input.newestPassingDrillAt.toISOString() },
    });
  }
  return out;
}

async function loadSettings(db: Db): Promise<BackupSettings> {
  const [row] = await db.select().from(schema.platformBackupSettings).where(eq(schema.platformBackupSettings.id, "default")).limit(1);
  // The migration seeds the row; fall back to the table defaults if someone deleted it.
  return {
    dumpMaxAgeHours: row?.dumpMaxAgeHours ?? 26,
    walMaxLagMinutes: row?.walMaxLagMinutes ?? 10,
    drillEveryDays: row?.drillEveryDays ?? 35,
    walArchivingExpected: row?.walArchivingExpected ?? false,
    alertEmails: row?.alertEmails ?? [],
    updatedAt: (row?.updatedAt ?? new Date(0)).toISOString(),
  };
}

/** pg_stat_archiver is readable by every role; it is empty of meaning until archive_mode is on. */
async function readArchiver(db: Db): Promise<ArchiverStats | null> {
  const res = await db.execute<{ archived_count: string; failed_count: string; last_archived_time: Date | null; last_failed_time: Date | null }>(
    sql`SELECT archived_count::text, failed_count::text, last_archived_time, last_failed_time FROM pg_stat_archiver`,
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    archivedCount: Number(r.archived_count),
    failedCount: Number(r.failed_count),
    lastArchivedAt: r.last_archived_time ? new Date(r.last_archived_time) : null,
    lastFailedAt: r.last_failed_time ? new Date(r.last_failed_time) : null,
  };
}

async function newestPassingDrill(db: Db): Promise<Date | null> {
  const [row] = await db
    .select({ at: schema.platformRestoreDrills.drilledAt })
    .from(schema.platformRestoreDrills)
    .where(eq(schema.platformRestoreDrills.result, "pass"))
    .orderBy(desc(schema.platformRestoreDrills.drilledAt))
    .limit(1);
  return row?.at ?? null;
}

const ALERT_REPEAT_MS = 24 * 3_600_000;
const CHECK_RETENTION_DAYS = 14;

export interface BackupCheckRun {
  results: CheckResult[];
  allOk: boolean;
  alertsSent: number;
}

/**
 * Worker entry point. `listDumps` is injected so the R2 client stays out of the domain and tests need no network.
 * Records every result, prunes old rows, and emails the policy recipients when a check turns bad (and again every 24 h
 * while it stays bad). The caller pings the Better Stack heartbeat only when allOk is true: a missing ping is the alert
 * that still works if this job, the database or email is down.
 */
export async function runBackupChecks(db: Db, deps: { listDumps: () => Promise<DumpObject[]>; now?: Date }): Promise<BackupCheckRun> {
  const now = deps.now ?? new Date();
  const settings = await loadSettings(db);
  let dumps: DumpObject[] | { error: string };
  try {
    dumps = await deps.listDumps();
  } catch (err) {
    dumps = { error: err instanceof Error ? err.message.slice(0, 200) : "unreadable" };
  }
  const results = evaluateBackupChecks({ now, settings, dumps, archiver: await readArchiver(db), newestPassingDrillAt: await newestPassingDrill(db) });

  let alertsSent = 0;
  for (const r of results) {
    const [prev] = await db
      .select({ ok: schema.platformBackupChecks.ok, detail: schema.platformBackupChecks.detail, checkedAt: schema.platformBackupChecks.checkedAt })
      .from(schema.platformBackupChecks)
      .where(eq(schema.platformBackupChecks.kind, r.kind))
      .orderBy(desc(schema.platformBackupChecks.checkedAt))
      .limit(1);
    const prevAlertedAt = (prev?.detail as { alertedAt?: unknown } | undefined)?.alertedAt;
    const lastAlertedAt = typeof prevAlertedAt === "string" ? new Date(prevAlertedAt) : null;
    const shouldAlert = !r.ok && (prev?.ok !== false || !lastAlertedAt || now.getTime() - lastAlertedAt.getTime() >= ALERT_REPEAT_MS);
    let alertedAt = !r.ok && !shouldAlert ? lastAlertedAt : null;
    if (shouldAlert && settings.alertEmails.length > 0) {
      const sent = await Promise.all(settings.alertEmails.map((to) => sendBackupAlert(db, to, r)));
      alertsSent += sent.filter(Boolean).length;
      if (sent.some(Boolean)) alertedAt = now;
    }
    await db.insert(schema.platformBackupChecks).values({ kind: r.kind, ok: r.ok, detail: { ...r.detail, ...(alertedAt ? { alertedAt: alertedAt.toISOString() } : {}) }, checkedAt: now });
  }
  await db.delete(schema.platformBackupChecks).where(sql`${schema.platformBackupChecks.checkedAt} < ${new Date(now.getTime() - CHECK_RETENTION_DAYS * 86_400_000)}`);
  return { results, allOk: results.every((r) => r.ok), alertsSent };
}

const KIND_LABEL: Record<BackupCheckKind, string> = { dump: "Daily database dump", wal: "WAL archiving", drill: "Restore drill" };

async function sendBackupAlert(db: Db, to: string, r: CheckResult): Promise<boolean> {
  const state = String(r.detail.state ?? "failed");
  const subject = `[bsec] Backup alert: ${KIND_LABEL[r.kind]} (${state})`;
  const text = `${KIND_LABEL[r.kind]} needs attention (${state}).\n\nDetails: ${JSON.stringify(r.detail)}\n\nOpen Super Admin > Operations > Backups for the full status and the restore runbook.`;
  const html = `<p><strong>${KIND_LABEL[r.kind]}</strong> needs attention (${state}).</p><p>Details: <code>${JSON.stringify(r.detail).replace(/</g, "&lt;")}</code></p><p>Open Super Admin &gt; Operations &gt; Backups for the full status and the restore runbook.</p>`;
  try {
    const res = await sendPlatformEmail(db, { to, subject, text, html, template: "backup_alert" }, { bypassRateLimit: true });
    return res.status === "sent";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Super Admin overview and edits
// ---------------------------------------------------------------------------------------------------------------------

export interface BackupConfigRow {
  key: string;
  label: string;
  current: string;
  recommended: string;
  status: "ok" | "warn" | "todo";
  note: string;
}

export interface BackupOverview {
  settings: BackupSettings;
  /** Newest result per kind. */
  latest: Array<{ kind: BackupCheckKind; ok: boolean; detail: Record<string, unknown>; checkedAt: string }>;
  /** Last 48 results, newest first, for the history strip. */
  history: Array<{ kind: BackupCheckKind; ok: boolean; checkedAt: string }>;
  drills: Array<{ id: string; kind: DrillKind; result: "pass" | "fail"; drilledAt: string; rtoSeconds: number | null; rpoSeconds: number | null; notes: string | null }>;
  config: BackupConfigRow[];
  /** Whether the worker has ever recorded a check (false until the BACKUP_R2_* env is set on the worker). */
  monitoring: "running" | "never_ran";
}

async function pgSetting(rt: Runtime, name: string): Promise<string> {
  const res = await rt._db.db.execute<{ setting: string }>(sql`SELECT setting FROM pg_settings WHERE name = ${name}`);
  return res.rows[0]?.setting ?? "unknown";
}

/** Best-practice comparison, read-only. Values come from the live database and the policy row. */
async function buildConfigRows(rt: Runtime, settings: BackupSettings): Promise<BackupConfigRow[]> {
  const [archiveMode, archiveTimeout, walLevel, archiveCommand] = await Promise.all([
    pgSetting(rt, "archive_mode"),
    pgSetting(rt, "archive_timeout"),
    pgSetting(rt, "wal_level"),
    pgSetting(rt, "archive_command"),
  ]);
  const archiving = archiveMode === "on" || archiveMode === "always";
  const usesPgBackRest = archiveCommand.includes("pgbackrest");
  const timeout = Number(archiveTimeout);
  return [
    { key: "archive_mode", label: "WAL archiving", current: archiveMode, recommended: "on", status: archiving ? "ok" : "todo", note: "Continuous archiving is what gives point-in-time recovery. Needs a restart to change." },
    { key: "archive_command", label: "Archive command", current: usesPgBackRest ? "pgbackrest archive-push" : archiveCommand === "(disabled)" || archiveCommand === "" ? "not set" : "custom", recommended: "pgbackrest archive-push", status: usesPgBackRest ? "ok" : "todo", note: "Ships each WAL segment to the encrypted R2 repository." },
    { key: "archive_timeout", label: "Archive timeout", current: `${archiveTimeout}s`, recommended: "60s to 300s", status: timeout >= 60 && timeout <= 300 ? "ok" : timeout === 0 ? "todo" : "warn", note: "Forces a segment on quiet systems. 60s is about 1 minute of exposure; longer saves R2 operations. Reloadable without restart." },
    { key: "wal_level", label: "WAL level", current: walLevel, recommended: "replica", status: walLevel === "replica" || walLevel === "logical" ? "ok" : "warn", note: "Must be replica or higher for archiving and standby servers." },
    { key: "dump_max_age", label: "Daily dump alert after", current: `${settings.dumpMaxAgeHours} h`, recommended: "26 h", status: settings.dumpMaxAgeHours <= 30 ? "ok" : "warn", note: "Daily schedule plus margin. Changed here (alerts only)." },
    { key: "wal_expected", label: "WAL alerts enabled", current: settings.walArchivingExpected ? "yes" : "no", recommended: "yes once archiving is live", status: archiving && !settings.walArchivingExpected ? "warn" : "ok", note: "Turn on after the pgBackRest cutover so a quiet archiver raises an alert." },
    { key: "drill_cadence", label: "Restore drill every", current: `${settings.drillEveryDays} days`, recommended: "30 to 35 days", status: settings.drillEveryDays <= 35 ? "ok" : "warn", note: "A backup counts only after a restore has been proven." },
    { key: "alert_emails", label: "Alert recipients", current: settings.alertEmails.length ? `${settings.alertEmails.length} address(es)` : "none", recommended: "at least one", status: settings.alertEmails.length ? "ok" : "todo", note: "Backup alerts also rely on the Better Stack heartbeat, which does not depend on email." },
  ];
}

export async function getBackupOverview(rt: Runtime, staffUserId: string): Promise<BackupOverview> {
  await assertPlatformStaff(rt, staffUserId);
  const db = rt._db.db;
  const settings = await loadSettings(db);
  const recent = await db
    .select()
    .from(schema.platformBackupChecks)
    .where(gte(schema.platformBackupChecks.checkedAt, new Date(Date.now() - CHECK_RETENTION_DAYS * 86_400_000)))
    .orderBy(desc(schema.platformBackupChecks.checkedAt))
    .limit(300);
  const seen = new Set<string>();
  const latest = recent
    .filter((r) => (seen.has(r.kind) ? false : (seen.add(r.kind), true)))
    .map((r) => ({ kind: r.kind as BackupCheckKind, ok: r.ok, detail: r.detail as Record<string, unknown>, checkedAt: r.checkedAt.toISOString() }));
  const drills = await db.select().from(schema.platformRestoreDrills).orderBy(desc(schema.platformRestoreDrills.drilledAt)).limit(20);
  return {
    settings,
    latest,
    history: recent.slice(0, 48).map((r) => ({ kind: r.kind as BackupCheckKind, ok: r.ok, checkedAt: r.checkedAt.toISOString() })),
    drills: drills.map((d) => ({ id: d.id, kind: d.kind as DrillKind, result: d.result as "pass" | "fail", drilledAt: d.drilledAt.toISOString(), rtoSeconds: d.rtoSeconds, rpoSeconds: d.rpoSeconds, notes: d.notes })),
    config: await buildConfigRows(rt, settings),
    monitoring: recent.length > 0 ? "running" : "never_ran",
  };
}

export interface UpdateBackupSettingsInput {
  dumpMaxAgeHours?: number | undefined;
  walMaxLagMinutes?: number | undefined;
  drillEveryDays?: number | undefined;
  walArchivingExpected?: boolean | undefined;
  alertEmails?: string[] | undefined;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function updateBackupSettings(rt: Runtime, staffUserId: string, input: UpdateBackupSettingsInput, meta?: AuditMeta): Promise<BackupSettings> {
  const staff = await assertPlatformStaff(rt, staffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "changing backup alert settings");
  const range = (v: number | undefined, lo: number, hi: number, name: string) => {
    if (v !== undefined && (!Number.isInteger(v) || v < lo || v > hi)) throw new Error(`Validation: ${name} must be a whole number from ${lo} to ${hi}`);
  };
  range(input.dumpMaxAgeHours, 1, 168, "Dump alert age (hours)");
  range(input.walMaxLagMinutes, 1, 1440, "WAL lag (minutes)");
  range(input.drillEveryDays, 7, 120, "Drill cadence (days)");
  const emails = input.alertEmails?.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (emails) {
    if (emails.length > 5) throw new Error("Validation: at most 5 alert addresses");
    if (emails.some((e) => !EMAIL_RE.test(e))) throw new Error("Validation: one of the alert addresses is not a valid email");
  }
  const before = await loadSettings(rt._db.db);
  await rt._db.db.transaction(async (tx) => {
    await tx
      .insert(schema.platformBackupSettings)
      .values({ id: "default", updatedBy: staffUserId })
      .onConflictDoNothing();
    await tx
      .update(schema.platformBackupSettings)
      .set({
        ...(input.dumpMaxAgeHours !== undefined ? { dumpMaxAgeHours: input.dumpMaxAgeHours } : {}),
        ...(input.walMaxLagMinutes !== undefined ? { walMaxLagMinutes: input.walMaxLagMinutes } : {}),
        ...(input.drillEveryDays !== undefined ? { drillEveryDays: input.drillEveryDays } : {}),
        ...(input.walArchivingExpected !== undefined ? { walArchivingExpected: input.walArchivingExpected } : {}),
        ...(emails ? { alertEmails: emails } : {}),
        updatedBy: staffUserId,
        updatedAt: new Date(),
      })
      .where(eq(schema.platformBackupSettings.id, "default"));
    const after = { ...before, ...Object.fromEntries(Object.entries({ ...input, alertEmails: emails }).filter(([, v]) => v !== undefined)) };
    await writePlatformAudit(tx, staffUserId, "backup.settings_updated", "platform_backup_settings", "default", null, { before: { ...before, alertEmails: before.alertEmails.length }, after: { ...after, alertEmails: (after.alertEmails as string[]).length } }, meta);
  });
  return loadSettings(rt._db.db);
}

export interface RecordRestoreDrillInput {
  kind: DrillKind;
  result: "pass" | "fail";
  drilledAt: Date;
  rtoSeconds?: number | undefined;
  rpoSeconds?: number | undefined;
  notes?: string | undefined;
}

export async function recordRestoreDrill(rt: Runtime, staffUserId: string, input: RecordRestoreDrillInput, meta?: AuditMeta): Promise<{ id: string }> {
  const staff = await assertPlatformStaff(rt, staffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "recording a restore drill");
  if (input.drilledAt.getTime() > Date.now() + 5 * 60_000) throw new Error("Validation: the drill date cannot be in the future");
  for (const [v, name] of [[input.rtoSeconds, "RTO"], [input.rpoSeconds, "RPO"]] as const) {
    if (v !== undefined && (!Number.isInteger(v) || v < 0 || v > 30 * 86_400)) throw new Error(`Validation: ${name} must be a whole number of seconds`);
  }
  return rt._db.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.platformRestoreDrills)
      .values({ kind: input.kind, result: input.result, drilledAt: input.drilledAt, rtoSeconds: input.rtoSeconds ?? null, rpoSeconds: input.rpoSeconds ?? null, notes: input.notes?.trim().slice(0, 2000) || null, recordedBy: staffUserId })
      .returning({ id: schema.platformRestoreDrills.id });
    if (!row) throw new Error("Failed to record the drill");
    await writePlatformAudit(tx, staffUserId, "backup.drill_recorded", "platform_restore_drill", row.id, null, { kind: input.kind, result: input.result, rtoSeconds: input.rtoSeconds ?? null, rpoSeconds: input.rpoSeconds ?? null }, meta);
    return { id: row.id };
  });
}
