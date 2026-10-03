import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { toDeletionRecord, type DeletionRecord, type DeletionStep } from "./deletion-requests.ts";
import {
  stepDisconnectDomains,
  stepExport,
  stepFinish,
  stepPurgeData,
  stepScheduleMedia,
  stepStopBilling,
  stepVerifyPurge,
  type DeletionDeps,
} from "./deletion-steps.ts";

export type { DeletionDeps } from "./deletion-steps.ts";

/**
 * Executes or resumes the multi-stage deletion workflow (PLAN §6.4): requested -> exported -> billing_stopped ->
 * domains_disconnected -> media_scheduled -> db_purged -> verified -> deleted.
 * - Runs only once the grace period is over and while the deletion is not cancelled.
 * - Every step commits together with its audit row, so a crash between steps resumes exactly where it stopped.
 * - The progress row, the export and the audit trail are never purged.
 * - A failed step records its error and stops; the next sweep retries the same step. Nothing is skipped: a failed
 *   export blocks deletion.
 */
export async function executeTenantDeletionWorkflow(rt: Runtime, deletionId: string, deps: DeletionDeps = {}): Promise<DeletionRecord> {
  const db = rt._db.db;
  const now = deps.now ?? new Date();

  const load = async () => {
    const [row] = await db.select().from(schema.tenantDeletions).where(eq(schema.tenantDeletions.id, deletionId)).limit(1);
    if (!row) throw new Error("Not Found: deletion request not found");
    return row;
  };

  let d = await load();
  if (d.cancelledAt) throw new Error("Conflict: deletion was cancelled");
  if (d.step === "deleted" && d.completedAt) return toDeletionRecord(d);
  if (d.scheduledFor.getTime() > now.getTime()) {
    throw new Error(`Conflict: the grace period is not over yet (scheduled for ${d.scheduledFor.toISOString()})`);
  }

  try {
    while (d.step !== "deleted") {
      switch (d.step as DeletionStep) {
        case "requested":
          await stepExport(rt, d, deps);
          break;
        case "exported":
          await stepStopBilling(rt, d, deps);
          break;
        case "billing_stopped":
          await stepDisconnectDomains(rt, d, deps);
          break;
        case "domains_disconnected":
          await stepScheduleMedia(rt, d, deps);
          break;
        case "media_scheduled":
          await stepPurgeData(rt, d);
          break;
        case "db_purged":
          await stepVerifyPurge(rt, d);
          break;
        case "verified":
          await stepFinish(rt, d);
          break;
        default:
          throw new Error(`Unknown deletion step: ${d.step}`);
      }
      d = await load();
      if (d.cancelledAt) throw new Error("Conflict: deletion was cancelled");
    }
    return toDeletionRecord(d);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(schema.tenantDeletions)
      .set({ error: message.slice(0, 1000), updatedAt: sql`now()` })
      .where(eq(schema.tenantDeletions.id, deletionId));
    throw err;
  }
}

const SWEEP_LOCK_KEY = 0x62_73_64_6c; // "bsdl"

/**
 * Runs every deletion whose grace period is over (resuming interrupted ones). Called on a timer by the platform
 * service. A transaction-scoped Postgres advisory lock (held on one connection for the whole sweep) makes concurrent
 * instances take turns. Returns how many deletions completed and how many failed this round.
 */
export async function runDueTenantDeletions(
  rt: Runtime,
  opts: { deps?: DeletionDeps | undefined; onError?: ((deletionId: string, err: unknown) => void) | undefined; limit?: number | undefined } = {},
): Promise<{ completed: number; failed: number }> {
  const db = rt._db.db;
  const lock = await db.execute<{ locked: boolean }>(sql`SELECT pg_try_advisory_lock(${SWEEP_LOCK_KEY}) AS locked`);
  if (!lock.rows[0]?.locked) return { completed: 0, failed: 0 };

  try {
    const due = await db
      .select({ id: schema.tenantDeletions.id })
      .from(schema.tenantDeletions)
      .where(
        and(
          isNull(schema.tenantDeletions.cancelledAt),
          isNull(schema.tenantDeletions.completedAt),
          lte(schema.tenantDeletions.scheduledFor, opts.deps?.now ?? new Date()),
        ),
      )
      .orderBy(asc(schema.tenantDeletions.scheduledFor))
      .limit(opts.limit ?? 5);

    let completed = 0;
    let failed = 0;
    for (const row of due) {
      try {
        await executeTenantDeletionWorkflow(rt, row.id, opts.deps);
        completed++;
      } catch (err) {
        failed++;
        opts.onError?.(row.id, err);
      }
    }
    return { completed, failed };
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${SWEEP_LOCK_KEY})`).catch(() => undefined);
  }
}
