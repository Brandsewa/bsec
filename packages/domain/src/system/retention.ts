import { sql } from "drizzle-orm";
import type { Db } from "@bs/db";

/**
 * 180-day retention prune job for email_log (Slice 7A / PLAN §5.10).
 * Deletes log entries older than retentionDays (default: 180 days).
 */
export async function pruneEmailLogs(
  db: Db,
  retentionDays: number = 180,
  tenantId?: string | undefined,
): Promise<{ deletedCount: number }> {
  const days = Math.max(1, Math.floor(retentionDays));
  const cutoff = new Date(Date.now() - days * 86_400_000);

  const runner = async (d: Db) => {
    const result = await d.execute(
      sql`DELETE FROM email_log WHERE created_at < ${cutoff} RETURNING id`,
    ) as unknown as { rowCount?: number; rows?: unknown[] };
    const count = typeof result?.rowCount === "number" ? result.rowCount : (result?.rows?.length ?? 0);
    return { deletedCount: count };
  };

  if (tenantId) {
    const { withTenant } = await import("@bs/db");
    return await withTenant(db, tenantId, runner);
  }
  return await runner(db);
}

/**
 * 3-year retention purge job for privacy_requests (Slice 7C).
 * Deletes completed or rejected privacy requests older than retentionDays (default: 3 years = 1095 days).
 * Open, pending_verification or in_progress requests are never purged.
 */
export async function prunePrivacyRequests(
  db: Db,
  retentionDays: number = 1095,
  tenantId?: string | undefined,
): Promise<{ deletedCount: number }> {
  const days = Math.max(1, Math.floor(retentionDays));
  const cutoff = new Date(Date.now() - days * 86_400_000);

  const runner = async (d: Db) => {
    const result = await d.execute(
      sql`DELETE FROM privacy_requests WHERE status IN ('completed', 'rejected') AND created_at < ${cutoff} RETURNING id`,
    ) as unknown as { rowCount?: number; rows?: unknown[] };
    const count = typeof result?.rowCount === "number" ? result.rowCount : (result?.rows?.length ?? 0);
    return { deletedCount: count };
  };

  if (tenantId) {
    const { withTenant } = await import("@bs/db");
    return await withTenant(db, tenantId, runner);
  }
  return await runner(db);
}

/**
 * Webhook requests whose signature did not verify are kept for a short while so a store with a mistyped secret can be
 * diagnosed, then deleted (audit A4-02): anyone can send them, so they must not pile up. Verified events are kept as before.
 */
export async function pruneInvalidWebhookInbox(db: Db, retentionHours: number = 24): Promise<{ deletedCount: number }> {
  const hours = Math.max(1, Math.floor(retentionHours));
  const cutoff = new Date(Date.now() - hours * 3_600_000);
  const result = (await db.execute(
    sql`DELETE FROM webhook_inbox WHERE signature_valid = false AND created_at < ${cutoff} RETURNING id`,
  )) as unknown as { rowCount?: number; rows?: unknown[] };
  return { deletedCount: typeof result?.rowCount === "number" ? result.rowCount : (result?.rows?.length ?? 0) };
}
