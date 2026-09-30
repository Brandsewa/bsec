import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { supportSessionStatus, type SupportSessionStatus } from "../platform/support-sessions.ts";

/** How long a support session lasts once the owner approves it. */
const APPROVED_SESSION_MS = 60 * 60 * 1000;

export interface StoreSupportSession {
  id: string;
  staffName: string;
  staffEmail: string;
  reason: string;
  ticketRef: string;
  consent: "owner_approved" | "standing_consent" | "emergency";
  scope: "read_only" | "write";
  status: SupportSessionStatus;
  requestedAt: string;
  expiresAt: string;
  actionsCount: number;
}

/** Only the store's owner controls who may look into the store: owner role AND a real staff session (never support). */
function assertStoreOwner(ctx: TenantContext): string {
  assertPermission(ctx, "settings.write");
  if (ctx.actor.type !== "staff" || !ctx.roles.includes("store_owner")) {
    throw new Error("Forbidden: only the store owner can manage support access");
  }
  return ctx.actor.userId;
}

/** The platform team's access requests and history for this store (newest first). */
export async function listStoreSupportSessions(rt: Runtime, ctx: TenantContext): Promise<StoreSupportSession[]> {
  assertStoreOwner(ctx);
  const rows = await rt._db.db
    .select({
      id: schema.supportSessions.id,
      reason: schema.supportSessions.reason,
      ticketRef: schema.supportSessions.ticketRef,
      consent: schema.supportSessions.consent,
      scope: schema.supportSessions.scope,
      approvedAt: schema.supportSessions.approvedAt,
      deniedAt: schema.supportSessions.deniedAt,
      endedAt: schema.supportSessions.endedAt,
      startedAt: schema.supportSessions.startedAt,
      expiresAt: schema.supportSessions.expiresAt,
      actionsCount: schema.supportSessions.actionsCount,
      staffName: schema.users.name,
      staffEmail: schema.users.email,
    })
    .from(schema.supportSessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.supportSessions.platformUserId))
    .where(eq(schema.supportSessions.tenantId, ctx.tenantId))
    .orderBy(desc(schema.supportSessions.startedAt))
    .limit(50);

  return rows.map((r) => ({
    id: r.id,
    staffName: r.staffName ?? r.staffEmail,
    staffEmail: r.staffEmail,
    reason: r.reason,
    ticketRef: r.ticketRef,
    consent: r.consent as StoreSupportSession["consent"],
    scope: r.scope as StoreSupportSession["scope"],
    status: supportSessionStatus({ consent: r.consent, approvedAt: r.approvedAt, deniedAt: r.deniedAt, endedAt: r.endedAt, expiresAt: r.expiresAt }),
    requestedAt: r.startedAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    actionsCount: r.actionsCount,
  }));
}

/** The owner approves a pending request: the 60 minutes start now. Audited in the same transaction. */
export async function approveStoreSupportSession(rt: Runtime, ctx: TenantContext, sessionId: string): Promise<{ ok: true }> {
  const ownerId = assertStoreOwner(ctx);
  return rt._db.db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.supportSessions)
      .set({
        approvedAt: sql`now()`,
        approvedByUserId: ownerId,
        expiresAt: new Date(Date.now() + APPROVED_SESSION_MS),
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(schema.supportSessions.id, sessionId),
          eq(schema.supportSessions.tenantId, ctx.tenantId),
          eq(schema.supportSessions.consent, "owner_approved"),
          isNull(schema.supportSessions.approvedAt),
          isNull(schema.supportSessions.deniedAt),
          isNull(schema.supportSessions.endedAt),
          sql`${schema.supportSessions.expiresAt} > now()`,
        ),
      )
      .returning({ id: schema.supportSessions.id });
    if (updated.length === 0) throw new Error("Not Found: no pending support request with that id");

    await tx.insert(schema.platformAuditLogs).values({
      actorUserId: ownerId,
      actorType: "store_owner",
      action: "support_session.approved",
      targetType: "support_session",
      targetId: sessionId,
      tenantId: ctx.tenantId,
      diff: { approvedBy: ownerId },
    });
    return { ok: true as const };
  });
}

/** The owner denies a pending request. Audited in the same transaction. */
export async function denyStoreSupportSession(rt: Runtime, ctx: TenantContext, sessionId: string): Promise<{ ok: true }> {
  const ownerId = assertStoreOwner(ctx);
  return rt._db.db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.supportSessions)
      .set({ deniedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(schema.supportSessions.id, sessionId),
          eq(schema.supportSessions.tenantId, ctx.tenantId),
          eq(schema.supportSessions.consent, "owner_approved"),
          isNull(schema.supportSessions.approvedAt),
          isNull(schema.supportSessions.deniedAt),
          isNull(schema.supportSessions.endedAt),
        ),
      )
      .returning({ id: schema.supportSessions.id });
    if (updated.length === 0) throw new Error("Not Found: no pending support request with that id");

    await tx.insert(schema.platformAuditLogs).values({
      actorUserId: ownerId,
      actorType: "store_owner",
      action: "support_session.denied",
      targetType: "support_session",
      targetId: sessionId,
      tenantId: ctx.tenantId,
      diff: { deniedBy: ownerId },
    });
    return { ok: true as const };
  });
}

export async function getStandingSupportConsent(rt: Runtime, ctx: TenantContext): Promise<{ enabled: boolean }> {
  assertStoreOwner(ctx);
  const [row] = await withTenant(rt._db.db, ctx.tenantId, (tx) =>
    tx
      .select({ enabled: schema.storeSettings.standingConsentForSupport })
      .from(schema.storeSettings)
      .where(eq(schema.storeSettings.tenantId, ctx.tenantId))
      .limit(1),
  );
  return { enabled: row?.enabled ?? false };
}

/** Standing consent lets the platform team open read-only sessions without asking each time. Owner only. */
export async function setStandingSupportConsent(rt: Runtime, ctx: TenantContext, enabled: boolean): Promise<{ enabled: boolean }> {
  const ownerId = assertStoreOwner(ctx);
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const updated = await tx
      .update(schema.storeSettings)
      .set({ standingConsentForSupport: enabled, updatedAt: sql`now()` })
      .where(eq(schema.storeSettings.tenantId, ctx.tenantId))
      .returning({ tenantId: schema.storeSettings.tenantId });
    if (updated.length === 0) throw new Error("Not Found: store settings not found");

    await tx.insert(schema.platformAuditLogs).values({
      actorUserId: ownerId,
      actorType: "store_owner",
      action: "support_access.standing_consent_changed",
      targetType: "tenant",
      targetId: ctx.tenantId,
      tenantId: ctx.tenantId,
      diff: { enabled },
    });
    return { enabled };
  });
}
