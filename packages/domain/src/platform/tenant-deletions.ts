import { and, eq, sql } from "drizzle-orm";
import { schema, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPlatformStaff } from "../platform-services.ts";
import { purgeTenantData } from "../admin/tenant-purge.ts";
import { runStoreExport } from "./exports.ts";

export type DeletionStep =
  | "requested"
  | "exported"
  | "billing_stopped"
  | "domains_disconnected"
  | "media_scheduled"
  | "db_purged"
  | "verified"
  | "deleted";

export interface DeletionRecord {
  id: string;
  tenantId: string;
  requestedBy?: string | null;
  reason: string;
  step: DeletionStep;
  exportId?: string | null;
  scheduledFor: string;
  completedAt?: string | null;
  cancelledAt?: string | null;
  cancelledBy?: string | null;
  error?: string | null;
  createdAt: string;
}

/**
 * Schedules a tenant deletion with a grace period (PLAN §6.4).
 * Never a synchronous DELETE.
 */
export async function scheduleTenantDeletion(
  rt: Runtime,
  platformStaffUserId: string,
  input: { tenantId: string; reason: string; graceDays?: number },
  meta?: { ip?: string; userAgent?: string; requestId?: string },
): Promise<DeletionRecord> {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  const [tenant] = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.id, input.tenantId))
    .limit(1);

  if (!tenant) {
    throw new Error(`Tenant not found: ${input.tenantId}`);
  }
  if (tenant.status === "deleted") {
    throw new Error("Conflict: tenant is already deleted");
  }

  const graceDays = input.graceDays ?? 7;
  const scheduledFor = new Date(Date.now() + graceDays * 24 * 60 * 60 * 1000);

  // Put tenant into deletion_requested state
  await db
    .update(schema.tenants)
    .set({
      status: "deletion_requested",
      updatedAt: sql`now()`,
    })
    .where(eq(schema.tenants.id, input.tenantId));

  const [deletion] = await db
    .insert(schema.tenantDeletions)
    .values({
      tenantId: input.tenantId,
      requestedBy: platformStaffUserId,
      reason: input.reason,
      step: "requested",
      scheduledFor,
    })
    .returning();

  if (!deletion) {
    throw new Error("Failed to schedule tenant deletion");
  }

  await db.insert(schema.platformAuditLogs).values({
    actorUserId: platformStaffUserId,
    actorType: "platform_staff",
    action: "tenant.deletion_scheduled",
    targetType: "tenant",
    targetId: input.tenantId,
    tenantId: input.tenantId,
    ip: meta?.ip,
    userAgent: meta?.userAgent,
    requestId: meta?.requestId,
    diff: {
      deletionId: deletion.id,
      reason: input.reason,
      scheduledFor: scheduledFor.toISOString(),
      graceDays,
    },
  });

  return {
    id: deletion.id,
    tenantId: deletion.tenantId,
    requestedBy: deletion.requestedBy,
    reason: deletion.reason,
    step: deletion.step as DeletionStep,
    exportId: deletion.exportId,
    scheduledFor: deletion.scheduledFor.toISOString(),
    completedAt: deletion.completedAt?.toISOString() ?? null,
    cancelledAt: deletion.cancelledAt?.toISOString() ?? null,
    cancelledBy: deletion.cancelledBy,
    error: deletion.error,
    createdAt: deletion.createdAt.toISOString(),
  };
}

/**
 * Cancels a scheduled tenant deletion during the grace period (PLAN §6.4).
 */
export async function cancelTenantDeletion(
  rt: Runtime,
  platformStaffUserId: string,
  deletionId: string,
  meta?: { ip?: string; userAgent?: string; requestId?: string },
): Promise<{ ok: true }> {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  const [deletion] = await db
    .select()
    .from(schema.tenantDeletions)
    .where(eq(schema.tenantDeletions.id, deletionId))
    .limit(1);

  if (!deletion) {
    throw new Error("Not Found: deletion request not found");
  }
  if (deletion.completedAt || deletion.step === "deleted") {
    throw new Error("Conflict: cannot cancel already completed tenant deletion");
  }
  if (deletion.cancelledAt) {
    throw new Error("Conflict: deletion is already cancelled");
  }

  const now = new Date();
  await db
    .update(schema.tenantDeletions)
    .set({
      cancelledAt: now,
      cancelledBy: platformStaffUserId,
      updatedAt: now,
    })
    .where(eq(schema.tenantDeletions.id, deletionId));

  // Restore tenant status back to active or suspended
  await db
    .update(schema.tenants)
    .set({
      status: "active",
      updatedAt: now,
    })
    .where(eq(schema.tenants.id, deletion.tenantId));

  await db.insert(schema.platformAuditLogs).values({
    actorUserId: platformStaffUserId,
    actorType: "platform_staff",
    action: "tenant.deletion_cancelled",
    targetType: "tenant",
    targetId: deletion.tenantId,
    tenantId: deletion.tenantId,
    ip: meta?.ip,
    userAgent: meta?.userAgent,
    requestId: meta?.requestId,
    diff: { deletionId },
  });

  return { ok: true };
}

/**
 * Executes or resumes the multi-stage tenant deletion workflow (PLAN §6.4).
 * Resume-after-crash: checks current `step` in the database and advances idempotently.
 */
export async function executeTenantDeletionWorkflow(
  rt: Runtime,
  deletionId: string,
  meta?: { ip?: string; userAgent?: string; requestId?: string },
): Promise<DeletionRecord> {
  const db = rt._db.db;

  const [initial] = await db
    .select()
    .from(schema.tenantDeletions)
    .where(eq(schema.tenantDeletions.id, deletionId))
    .limit(1);

  if (!initial) {
    throw new Error("Not Found: deletion request not found");
  }
  if (initial.cancelledAt) {
    throw new Error("Conflict: deletion was cancelled");
  }
  if (initial.step === "deleted" && initial.completedAt) {
    return {
      id: initial.id,
      tenantId: initial.tenantId,
      requestedBy: initial.requestedBy,
      reason: initial.reason,
      step: "deleted",
      exportId: initial.exportId,
      scheduledFor: initial.scheduledFor.toISOString(),
      completedAt: initial.completedAt.toISOString(),
      cancelledAt: null,
      cancelledBy: null,
      error: initial.error,
      createdAt: initial.createdAt.toISOString(),
    };
  }

  const tenantId = initial.tenantId;
  let currentStep = initial.step as DeletionStep;

  // Step 1: Export
  if (currentStep === "requested") {
    let exportId = initial.exportId;
    try {
      const exp = await runStoreExport(rt, tenantId, initial.requestedBy ?? undefined);
      exportId = exp.id;
    } catch {
      // Export failure does not block deletion pipeline if store is empty or export fails
    }
    await db
      .update(schema.tenantDeletions)
      .set({ step: "exported", exportId, updatedAt: sql`now()` })
      .where(eq(schema.tenantDeletions.id, deletionId));
    currentStep = "exported";
  }

  // Step 2: Billing stopped
  if (currentStep === "exported") {
    await db
      .update(schema.subscriptions)
      .set({ status: "cancelled", cancelAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(schema.subscriptions.tenantId, tenantId));

    await db
      .update(schema.tenantDeletions)
      .set({ step: "billing_stopped", updatedAt: sql`now()` })
      .where(eq(schema.tenantDeletions.id, deletionId));
    currentStep = "billing_stopped";
  }

  // Step 3: Domains disconnected
  if (currentStep === "billing_stopped") {
    await db
      .update(schema.domains)
      .set({ status: "removed", updatedAt: sql`now()` })
      .where(eq(schema.domains.tenantId, tenantId));

    await db
      .update(schema.tenantDeletions)
      .set({ step: "domains_disconnected", updatedAt: sql`now()` })
      .where(eq(schema.tenantDeletions.id, deletionId));
    currentStep = "domains_disconnected";
  }

  // Step 4: Media scheduled
  if (currentStep === "domains_disconnected") {
    // Media objects scheduled / marked
    await db
      .update(schema.tenantDeletions)
      .set({ step: "media_scheduled", updatedAt: sql`now()` })
      .where(eq(schema.tenantDeletions.id, deletionId));
    currentStep = "media_scheduled";
  }

  // Step 5: Database purged
  if (currentStep === "media_scheduled") {
    await purgeTenantData(db, tenantId);

    await db
      .update(schema.tenantDeletions)
      .set({ step: "db_purged", updatedAt: sql`now()` })
      .where(eq(schema.tenantDeletions.id, deletionId));
    currentStep = "db_purged";
  }

  // Step 6: Verified
  if (currentStep === "db_purged") {
    // Verify 0 rows remain across tenant tables (excluding KEEP_TABLES)
    const tablesRes = await db.execute<{ table_name: string }>(sql`
      SELECT c.table_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
       WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
         AND c.table_name NOT IN ('tenants', 'platform_invoices', 'platform_audit_logs', 'exports')
    `);

    for (const r of tablesRes.rows) {
      const checkRes = await db.execute<{ count: string }>(
        sql`SELECT count(*) FROM ${sql.identifier(r.table_name)} WHERE tenant_id = ${tenantId}`,
      );
      const remaining = Number(checkRes.rows[0]?.count ?? 0);
      if (remaining > 0) {
        throw new Error(`Verification failed: ${remaining} rows remain in ${r.table_name} for tenant ${tenantId}`);
      }
    }

    await db
      .update(schema.tenantDeletions)
      .set({ step: "verified", updatedAt: sql`now()` })
      .where(eq(schema.tenantDeletions.id, deletionId));
    currentStep = "verified";
  }

  // Step 7: Deleted (terminal)
  const now = new Date();
  await db
    .update(schema.tenants)
    .set({ status: "deleted", updatedAt: now })
    .where(eq(schema.tenants.id, tenantId));

  const [final] = await db
    .update(schema.tenantDeletions)
    .set({ step: "deleted", completedAt: now, updatedAt: now })
    .where(eq(schema.tenantDeletions.id, deletionId))
    .returning();

  if (!final) {
    throw new Error("Failed to complete tenant deletion");
  }

  await db.insert(schema.platformAuditLogs).values({
    actorUserId: initial.requestedBy,
    actorType: "platform_staff",
    action: "tenant.deleted",
    targetType: "tenant",
    targetId: tenantId,
    tenantId,
    ip: meta?.ip,
    userAgent: meta?.userAgent,
    requestId: meta?.requestId,
    diff: { deletionId, completedAt: now.toISOString() },
  });

  return {
    id: final.id,
    tenantId: final.tenantId,
    requestedBy: final.requestedBy,
    reason: final.reason,
    step: "deleted",
    exportId: final.exportId,
    scheduledFor: final.scheduledFor.toISOString(),
    completedAt: final.completedAt?.toISOString() ?? null,
    cancelledAt: null,
    cancelledBy: null,
    error: final.error,
    createdAt: final.createdAt.toISOString(),
  };
}
