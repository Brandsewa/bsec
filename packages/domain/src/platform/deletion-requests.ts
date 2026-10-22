import { and, eq, isNull, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPlatformStaff, assertRoleAtLeast, writePlatformAudit, type AuditMeta, type PlatformRole } from "../platform-services.ts";
import { PURGE_RETENTION_DAYS, purgeAvailableFrom } from "./purge-retention.ts";
import { assertCanTransitionTenant, type TenantLifecycleState } from "../system/tenant-lifecycle.ts";

export { PURGE_RETENTION_DAYS, purgeAvailableFrom };

export type DeletionStep =
  | "requested"
  | "exported"
  | "billing_stopped"
  | "domains_disconnected"
  | "media_scheduled"
  | "db_purged"
  | "verified"
  | "deleted";

interface DeletionMetadata {
  previousStatus?: string;
  /** New deletions never purge on their own: the platform owner approves the purge once retention is over. */
  manualPurge?: boolean;
  purgeApprovedAt?: string;
  purgeApprovedBy?: string;
}

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
  /** True for deletions that wait for the platform owner's "purge" instead of running on a timer. */
  manualPurge: boolean;
  purgeApprovedAt: string | null;
  /** When the platform owner may approve the purge. */
  purgeAvailableFrom: string;
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
    manualPurge: Boolean((d.metadata as DeletionMetadata | null)?.manualPurge),
    purgeApprovedAt: (d.metadata as DeletionMetadata | null)?.purgeApprovedAt ?? null,
    purgeAvailableFrom: purgeAvailableFrom(d).toISOString(),
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
  const graceDays = input.graceDays ?? PURGE_RETENTION_DAYS;
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
        metadata: { previousStatus: tenant.status, manualPurge: true } satisfies DeletionMetadata,
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

/**
 * Brings a deleted store back (staff action, platform_admin or higher). The tenant row, slug, owner, invoices, audit
 * trail and the export taken before the purge survive deletion; the store's own rows (products, orders, media,
 * customers...) do not, so the store comes back as an empty shell. It returns `suspended`, never live: the storefront
 * stays offline and the admin read-only until staff check it and reactivate it. Billing was cancelled by the workflow
 * and is not recreated; the platform subdomain is re-attached so the host resolves again. The slug is still held by the
 * tenant row, so nobody can have taken it in the meantime.
 */
export async function restoreDeletedTenant(
  rt: Runtime,
  platformStaffUserId: string,
  input: { tenantId: string; confirmSlug: string; reason?: string | undefined },
  meta?: AuditMeta,
): Promise<{ ok: true; status: "suspended"; exportId: string | null }> {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role as PlatformRole, "platform_admin", "restoring a deleted store");

  return rt._db.db.transaction(async (tx) => {
    const [tenant] = await tx.select().from(schema.tenants).where(eq(schema.tenants.id, input.tenantId)).for("update").limit(1);
    if (!tenant) throw new Error(`Not Found: tenant not found: ${input.tenantId}`);
    if (tenant.status !== "deleted") throw new Error("Conflict: only a deleted store can be restored");
    if (input.confirmSlug.trim() !== tenant.slug) {
      throw new Error(`Bad Request: type the store's slug "${tenant.slug}" to confirm the restore`);
    }
    assertCanTransitionTenant(tenant.status, "suspended");

    const [deletion] = await tx
      .select()
      .from(schema.tenantDeletions)
      .where(and(eq(schema.tenantDeletions.tenantId, input.tenantId), sql`${schema.tenantDeletions.completedAt} IS NOT NULL`))
      .orderBy(sql`${schema.tenantDeletions.completedAt} DESC`)
      .limit(1);

    const reason = input.reason?.trim() || "Restored after deletion";
    await tx
      .update(schema.tenants)
      .set({ status: "suspended", suspendedReason: `${reason}: review the store, then reactivate it`, archivedAt: null, updatedAt: sql`now()` })
      .where(eq(schema.tenants.id, input.tenantId));

    // Domains were marked removed (or purged) by the workflow; re-attach the platform subdomain.
    const platformDomain = process.env.PLATFORM_DOMAIN?.trim() || "bcom.si";
    const hostname = `${tenant.slug}.${platformDomain}`;
    await tx.delete(schema.domains).where(and(eq(schema.domains.tenantId, input.tenantId), eq(schema.domains.hostname, hostname)));
    await tx.insert(schema.domains).values({ tenantId: input.tenantId, hostname, type: "subdomain", status: "active", isPrimary: true, sslStatus: "active" });

    await writePlatformAudit(tx, platformStaffUserId, "tenant.restored_from_deleted", "tenant", input.tenantId, input.tenantId, {
      fromStatus: "deleted",
      toStatus: "suspended",
      reason,
      deletionId: deletion?.id ?? null,
      exportId: deletion?.exportId ?? null,
      // The workflow removes the store's rows, so none of them come back with the restore.
      dataRestored: false,
    }, meta);

    return { ok: true as const, status: "suspended" as const, exportId: deletion?.exportId ?? null };
  });
}

/**
 * The platform owner approves the permanent purge of a deleted store (owner decision 2026-10-17). Only possible once the
 * retention period (30 days after the deletion was requested) is over, only for the platform owner, and only with the
 * store's slug typed as confirmation. Approval does not purge inline: it releases the deletion to the background sweep,
 * which exports, stops billing, releases domains, removes media and every row, then marks the store deleted. The
 * tenant row, invoices and audit trail stay (PLAN §6.4).
 */
export async function approveTenantPurge(
  rt: Runtime,
  platformStaffUserId: string,
  input: { tenantId: string; confirmSlug: string },
  meta?: AuditMeta,
  now: Date = new Date(),
): Promise<{ ok: true; alreadyApproved: boolean }> {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role as PlatformRole, "platform_owner", "purging a store permanently");

  return rt._db.db.transaction(async (tx) => {
    const [tenant] = await tx.select().from(schema.tenants).where(eq(schema.tenants.id, input.tenantId)).for("update").limit(1);
    if (!tenant) throw new Error(`Not Found: tenant not found: ${input.tenantId}`);
    if (input.confirmSlug.trim() !== tenant.slug) {
      throw new Error(`Bad Request: type the store's slug "${tenant.slug}" to confirm the purge`);
    }
    if (tenant.status !== "deletion_requested") throw new Error("Conflict: only a store that is scheduled for deletion can be purged");

    const [deletion] = await tx
      .select()
      .from(schema.tenantDeletions)
      .where(and(eq(schema.tenantDeletions.tenantId, input.tenantId), isNull(schema.tenantDeletions.cancelledAt), isNull(schema.tenantDeletions.completedAt)))
      .for("update")
      .limit(1);
    if (!deletion) throw new Error("Not Found: this store has no open deletion request");

    const meta0 = (deletion.metadata as DeletionMetadata | null) ?? {};
    if (meta0.purgeApprovedAt) return { ok: true as const, alreadyApproved: true };

    const from = purgeAvailableFrom(deletion);
    if (from.getTime() > now.getTime()) {
      throw new Error(`Conflict: the data is kept until ${from.toISOString().slice(0, 10)}. The permanent purge becomes available then`);
    }

    await tx
      .update(schema.tenantDeletions)
      .set({ metadata: { ...meta0, manualPurge: true, purgeApprovedAt: now.toISOString(), purgeApprovedBy: platformStaffUserId }, updatedAt: sql`now()` })
      .where(eq(schema.tenantDeletions.id, deletion.id));

    await writePlatformAudit(tx, platformStaffUserId, "tenant.purge_approved", "tenant", input.tenantId, input.tenantId, {
      deletionId: deletion.id,
      retentionEnded: from.toISOString(),
    }, meta);
    return { ok: true as const, alreadyApproved: false };
  });
}
