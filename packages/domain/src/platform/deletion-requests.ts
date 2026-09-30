import { and, eq, isNull, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPlatformStaff, writePlatformAudit, type AuditMeta } from "../platform-services.ts";
import { assertCanTransitionTenant, type TenantLifecycleState } from "../system/tenant-lifecycle.ts";

export type DeletionStep =
  | "requested"
  | "exported"
  | "billing_stopped"
  | "domains_disconnected"
  | "media_scheduled"
  | "db_purged"
  | "verified"
  | "deleted";

/** Once the workflow has moved past these steps it has side effects that cannot be undone, so cancel is refused. */
const CANCELLABLE_STEPS: readonly DeletionStep[] = ["requested", "exported"];

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

export type DeletionRow = typeof schema.tenantDeletions.$inferSelect;

export function toDeletionRecord(d: DeletionRow): DeletionRecord {
  return {
    id: d.id,
    tenantId: d.tenantId,
    requestedBy: d.requestedBy,
    reason: d.reason,
    step: d.step as DeletionStep,
    exportId: d.exportId,
    scheduledFor: d.scheduledFor.toISOString(),
    completedAt: d.completedAt?.toISOString() ?? null,
    cancelledAt: d.cancelledAt?.toISOString() ?? null,
    cancelledBy: d.cancelledBy,
    error: d.error,
    createdAt: d.createdAt.toISOString(),
  };
}

/**
 * Schedules a tenant deletion with a grace period (PLAN §6.4). Never a synchronous DELETE: the store moves to
 * `deletion_requested` (storefront and admin go away at once), the request is recorded, and the workflow only runs
 * once the grace period is over. The status change, the request row and the audit row are one transaction.
 */
export async function scheduleTenantDeletion(
  rt: Runtime,
  platformStaffUserId: string,
  input: { tenantId: string; confirmSlug: string; reason?: string | undefined; graceDays?: number | undefined },
  meta?: AuditMeta,
): Promise<DeletionRecord> {
  await assertPlatformStaff(rt, platformStaffUserId);
  const graceDays = input.graceDays ?? 7;
  if (!Number.isFinite(graceDays) || graceDays < 0 || graceDays > 90) {
    throw new Error("Bad Request: grace period must be between 0 and 90 days");
  }

  return rt._db.db.transaction(async (tx) => {
    const [tenant] = await tx.select().from(schema.tenants).where(eq(schema.tenants.id, input.tenantId)).for("update").limit(1);
    if (!tenant) throw new Error(`Not Found: tenant not found: ${input.tenantId}`);
    if (input.confirmSlug.trim() !== tenant.slug) {
      throw new Error(`Bad Request: type the store's slug "${tenant.slug}" to confirm the deletion`);
    }
    if (tenant.status === "deletion_requested") throw new Error("Conflict: a deletion is already scheduled for this store");
    assertCanTransitionTenant(tenant.status, "deletion_requested");

    const scheduledFor = new Date(Date.now() + graceDays * 24 * 60 * 60 * 1000);
    await tx
      .update(schema.tenants)
      .set({ status: "deletion_requested", updatedAt: sql`now()` })
      .where(eq(schema.tenants.id, input.tenantId));

    const [deletion] = await tx
      .insert(schema.tenantDeletions)
      .values({
        tenantId: input.tenantId,
        requestedBy: platformStaffUserId,
        reason: input.reason?.trim() || "Operator requested deletion",
        step: "requested",
        scheduledFor,
        // Remembered so a cancel puts the store back exactly where it was (e.g. suspended stays suspended).
        metadata: { previousStatus: tenant.status },
      })
      .returning();
    if (!deletion) throw new Error("Failed to schedule tenant deletion");

    await writePlatformAudit(tx, platformStaffUserId, "tenant.deletion_scheduled", "tenant", input.tenantId, input.tenantId, {
      deletionId: deletion.id,
      previousStatus: tenant.status,
      reason: deletion.reason,
      scheduledFor: scheduledFor.toISOString(),
      graceDays,
    }, meta);

    return toDeletionRecord(deletion);
  });
}

/**
 * Cancels the open deletion of a store during the grace period (PLAN §6.4) and puts the store back in the state it
 * had. Refused once the workflow has started (billing stopped / domains released / data purged).
 */
export async function cancelTenantDeletion(
  rt: Runtime,
  platformStaffUserId: string,
  tenantId: string,
  meta?: AuditMeta,
): Promise<{ ok: true }> {
  await assertPlatformStaff(rt, platformStaffUserId);

  return rt._db.db.transaction(async (tx) => {
    const [tenant] = await tx.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).for("update").limit(1);
    if (!tenant) throw new Error("Not Found: tenant not found");
    const [deletion] = await tx
      .select()
      .from(schema.tenantDeletions)
      .where(and(eq(schema.tenantDeletions.tenantId, tenantId), isNull(schema.tenantDeletions.cancelledAt), isNull(schema.tenantDeletions.completedAt)))
      .for("update")
      .limit(1);
    if (!deletion) throw new Error("Not Found: this store has no open deletion request");
    if (!CANCELLABLE_STEPS.includes(deletion.step as DeletionStep)) {
      throw new Error(`Conflict: the deletion has already started (${deletion.step}) and can no longer be cancelled`);
    }

    const previous = ((deletion.metadata as { previousStatus?: string } | null)?.previousStatus ?? "active") as TenantLifecycleState;
    assertCanTransitionTenant("deletion_requested", previous);

    await tx
      .update(schema.tenantDeletions)
      .set({ cancelledAt: sql`now()`, cancelledBy: platformStaffUserId, updatedAt: sql`now()` })
      .where(eq(schema.tenantDeletions.id, deletion.id));
    await tx.update(schema.tenants).set({ status: previous, updatedAt: sql`now()` }).where(eq(schema.tenants.id, tenantId));

    await writePlatformAudit(tx, platformStaffUserId, "tenant.deletion_cancelled", "tenant", tenantId, tenantId, {
      deletionId: deletion.id,
      restoredStatus: previous,
      atStep: deletion.step,
    }, meta);
    return { ok: true as const };
  });
}
