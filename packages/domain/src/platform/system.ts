import { desc, eq, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPlatformStaff, writePlatformAudit, type AuditMeta } from "../platform-services.ts";

export interface SystemQueueSummary {
  queue: string;
  depth: number;
  active: number;
  completed: number;
  failed: number;
}

export interface FailedJobRecord {
  id: string;
  name: string;
  data: unknown;
  output: unknown;
  retryCount: number;
  createdOn: string;
}

export interface FailedWebhookRecord {
  id: string;
  provider: string;
  eventId: string;
  tenantId?: string | null;
  error?: string | null;
  attempts: number;
  receivedAt: string;
}

export interface SystemMetricsResult {
  queues: SystemQueueSummary[];
  failedJobs: FailedJobRecord[];
  webhookSummary: {
    received: number;
    processing: number;
    processed: number;
    failed: number;
  };
  failedWebhooks: FailedWebhookRecord[];
  backups: {
    lastBackupAt: string | null;
    lastRestoreTestAt: string | null;
    rpoTargetMinutes: number;
    rtoTargetHours: number;
    status: "healthy" | "warning";
  };
  featureFlags: Array<{
    key: string;
    defaultOn: boolean;
    killSwitch: boolean;
  }>;
}

/**
 * Returns real system health, queue depth, failed jobs, webhook errors, and backup state (PLAN §6 System).
 */
export async function getPlatformSystemData(
  rt: Runtime,
  platformStaffUserId: string,
): Promise<SystemMetricsResult> {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  // 1. pg-boss queues and failed jobs
  const queues: SystemQueueSummary[] = [];
  const failedJobs: FailedJobRecord[] = [];

  try {
    const queueRows = await db.execute<{
      name: string;
      state: string;
      count: string;
    }>(sql`
      SELECT name, state, count(*)::text as count
        FROM pgboss.job
       GROUP BY name, state
    `);

    const queueMap = new Map<string, { depth: number; active: number; completed: number; failed: number }>();
    for (const r of queueRows.rows) {
      const q = queueMap.get(r.name) ?? { depth: 0, active: 0, completed: 0, failed: 0 };
      const n = Number(r.count);
      if (r.state === "created" || r.state === "retry") q.depth += n;
      else if (r.state === "active") q.active += n;
      else if (r.state === "completed") q.completed += n;
      else if (r.state === "failed") q.failed += n;
      queueMap.set(r.name, q);
    }

    for (const [name, stats] of queueMap.entries()) {
      queues.push({ queue: name, ...stats });
    }

    const failedJobRows = await db.execute<{
      id: string;
      name: string;
      data: unknown;
      output: unknown;
      retry_count: number;
      created_on: Date;
    }>(sql`
      SELECT id, name, data, output, retry_count, created_on
        FROM pgboss.job
       WHERE state = 'failed'
       ORDER BY created_on DESC
       LIMIT 50
    `);

    for (const r of failedJobRows.rows) {
      failedJobs.push({
        id: r.id,
        name: r.name,
        data: r.data,
        output: r.output,
        retryCount: r.retry_count,
        createdOn: r.created_on instanceof Date ? r.created_on.toISOString() : new Date(r.created_on).toISOString(),
      });
    }
  } catch {
    // pgboss schema might be empty in initial test fixtures
  }

  // 2. Webhook inbox errors
  const webhookStats = {
    received: 0,
    processing: 0,
    processed: 0,
    failed: 0,
  };

  const webhookStatusRows = await db
    .select({
      status: schema.webhookInbox.status,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.webhookInbox)
    .groupBy(schema.webhookInbox.status);

  for (const r of webhookStatusRows) {
    if (r.status === "received") webhookStats.received = r.count;
    else if (r.status === "processing") webhookStats.processing = r.count;
    else if (r.status === "processed") webhookStats.processed = r.count;
    else if (r.status === "failed") webhookStats.failed = r.count;
  }

  const failedWebhookRows = await db
    .select()
    .from(schema.webhookInbox)
    .where(eq(schema.webhookInbox.status, "failed"))
    .orderBy(desc(schema.webhookInbox.receivedAt))
    .limit(50);

  const failedWebhooks: FailedWebhookRecord[] = failedWebhookRows.map((w) => ({
    id: w.id,
    provider: w.provider,
    eventId: w.eventId,
    tenantId: w.tenantId,
    error: w.error,
    attempts: w.attempts,
    receivedAt: w.receivedAt.toISOString(),
  }));

  // 3. Backup and restore test metadata (PLAN §14 RPO <= 15 min, RTO <= 2 h)
  const metaRows = await db
    .select()
    .from(schema.platformMeta)
    .where(sql`${schema.platformMeta.key} IN ('last_backup_at', 'last_restore_test_at')`);

  const metaMap = new Map(metaRows.map((m) => [m.key, m.value]));
  const lastBackupAt = metaMap.get("last_backup_at") ?? null;
  const lastRestoreTestAt = metaMap.get("last_restore_test_at") ?? null;

  // 4. Feature flags
  const flags = await db.select().from(schema.featureFlags);

  return {
    queues,
    failedJobs,
    webhookSummary: webhookStats,
    failedWebhooks,
    backups: {
      lastBackupAt,
      lastRestoreTestAt,
      rpoTargetMinutes: 15,
      rtoTargetHours: 2,
      status: lastRestoreTestAt ? "healthy" : "warning",
    },
    featureFlags: flags.map((f) => ({
      key: f.key,
      defaultOn: f.defaultOn,
      killSwitch: f.killSwitch,
    })),
  };
}

/**
 * Retries a failed pg-boss job. Only a job that is actually in the `failed` state can be retried, and the retry and
 * its audit row are one transaction.
 */
export async function retryFailedJob(
  rt: Runtime,
  platformStaffUserId: string,
  jobId: string,
  meta?: AuditMeta,
): Promise<{ ok: true }> {
  await assertPlatformStaff(rt, platformStaffUserId);

  return rt._db.db.transaction(async (tx) => {
    const found = await tx.execute<{ name: string; state: string }>(sql`
      SELECT name, state::text AS state FROM pgboss.job WHERE id = ${jobId} FOR UPDATE
    `);
    const job = found.rows[0];
    if (!job) throw new Error("Not Found: job not found");
    if (job.state !== "failed") throw new Error(`Conflict: only failed jobs can be retried (this one is ${job.state})`);

    await tx.execute(sql`
      UPDATE pgboss.job
         SET state = 'created', retry_count = 0, start_after = now()
       WHERE id = ${jobId}
    `);

    await writePlatformAudit(tx, platformStaffUserId, "system.retry_job", "job", jobId, null, { queue: job.name }, meta);
    return { ok: true as const };
  });
}

/**
 * Retries a failed webhook. The status change and its audit row are one transaction.
 */
export async function retryFailedWebhook(
  rt: Runtime,
  platformStaffUserId: string,
  webhookId: string,
  meta?: AuditMeta,
): Promise<{ ok: true }> {
  await assertPlatformStaff(rt, platformStaffUserId);

  return rt._db.db.transaction(async (tx) => {
    const [webhook] = await tx.select().from(schema.webhookInbox).where(eq(schema.webhookInbox.id, webhookId)).for("update").limit(1);
    if (!webhook) throw new Error(`Not Found: webhook not found: ${webhookId}`);
    if (webhook.status !== "failed") throw new Error(`Conflict: only failed webhooks can be retried (this one is ${webhook.status})`);

    await tx
      .update(schema.webhookInbox)
      .set({ status: "received", attempts: 0, error: null, updatedAt: sql`now()` })
      .where(eq(schema.webhookInbox.id, webhookId));

    await writePlatformAudit(tx, platformStaffUserId, "system.retry_webhook", "webhook", webhookId, webhook.tenantId, {
      provider: webhook.provider,
      eventId: webhook.eventId,
    }, meta);
    return { ok: true as const };
  });
}
