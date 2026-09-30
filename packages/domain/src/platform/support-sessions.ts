import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPlatformStaff } from "../platform-services.ts";

export interface StartSupportSessionInput {
  tenantId: string;
  reason: string;
  ticketRef: string;
  scope?: "read_only" | "write" | undefined;
  consent: "owner_approved" | "standing_consent" | "emergency";
  impersonatedUserId?: string | undefined;
}

export interface SupportSessionRecord {
  id: string;
  tenantId: string;
  platformUserId: string;
  impersonatedUserId?: string | null | undefined;
  reason: string;
  ticketRef: string;
  scope: "read_only" | "write";
  consent: "owner_approved" | "standing_consent" | "emergency";
  approvedByUserId?: string | null | undefined;
  startedAt: string;
  expiresAt: string;
  endedAt?: string | null | undefined;
  endedBy?: string | null | undefined;
  actionsCount: number;
  token?: string | null | undefined;
  isExtended: boolean;
  writeConfirmedAt?: string | null | undefined;
}

const SESSION_DURATION_MS = 60 * 60 * 1000; // 60 minutes

/**
 * Starts an audited support impersonation session (PLAN §6.3).
 * Never signs in as merchant's real account; generates a separate short-lived token.
 */
export async function startSupportSession(
  rt: Runtime,
  platformStaffUserId: string,
  input: StartSupportSessionInput,
  meta?: { ip?: string; userAgent?: string; requestId?: string },
): Promise<SupportSessionRecord> {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  if (!input.reason?.trim()) {
    throw new Error("Bad Request: support reason is required");
  }
  if (!input.ticketRef?.trim()) {
    throw new Error("Bad Request: ticket reference is required");
  }

  // 1. Verify consent mode
  if (input.consent === "standing_consent") {
    const [settings] = await db
      .select({
        standingConsent: schema.storeSettings.standingConsentForSupport,
      })
      .from(schema.storeSettings)
      .where(eq(schema.storeSettings.tenantId, input.tenantId))
      .limit(1);

    if (!settings?.standingConsent) {
      throw new Error("Forbidden: store has not enabled standing consent for support access");
    }
  } else if (input.consent === "emergency") {
    // Only platform_owner can initiate emergency sessions
    if (staff.role !== "platform_owner") {
      throw new Error("Forbidden: only platform_owner can initiate an emergency support session");
    }
  }

  const token = `sup_${randomBytes(32).toString("hex")}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
  const scope = input.scope ?? "read_only";

  const [session] = await db
    .insert(schema.supportSessions)
    .values({
      tenantId: input.tenantId,
      platformUserId: platformStaffUserId,
      impersonatedUserId: input.impersonatedUserId,
      reason: input.reason.trim(),
      ticketRef: input.ticketRef.trim(),
      scope,
      consent: input.consent,
      startedAt: now,
      expiresAt,
      token,
      actionsCount: 0,
      writeConfirmedAt: scope === "write" ? now : null,
    })
    .returning();

  if (!session) {
    throw new Error("Failed to create support session");
  }

  // Record audit log
  await db.insert(schema.platformAuditLogs).values({
    actorUserId: platformStaffUserId,
    actorType: "platform_staff",
    action: input.consent === "emergency" ? "support_session.emergency_start" : "support_session.start",
    targetType: "tenant",
    targetId: input.tenantId,
    tenantId: input.tenantId,
    ip: meta?.ip,
    userAgent: meta?.userAgent,
    requestId: meta?.requestId,
    diff: {
      sessionId: session.id,
      scope,
      consent: input.consent,
      reason: input.reason,
      ticketRef: input.ticketRef,
      isEmergency: input.consent === "emergency",
    },
  });

  return {
    id: session.id,
    tenantId: session.tenantId,
    platformUserId: session.platformUserId,
    impersonatedUserId: session.impersonatedUserId,
    reason: session.reason,
    ticketRef: session.ticketRef,
    scope: session.scope as "read_only" | "write",
    consent: session.consent as "owner_approved" | "standing_consent" | "emergency",
    approvedByUserId: session.approvedByUserId,
    startedAt: session.startedAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    endedBy: session.endedBy,
    actionsCount: session.actionsCount,
    token: session.token ?? undefined,
    isExtended: Boolean(session.extendedAt),
    writeConfirmedAt: session.writeConfirmedAt?.toISOString() ?? null,
  };
}

/**
 * Extends a support session by 60 minutes. Can only be extended once.
 */
export async function extendSupportSession(
  rt: Runtime,
  platformStaffUserId: string,
  sessionId: string,
  meta?: { ip?: string; userAgent?: string; requestId?: string },
): Promise<SupportSessionRecord> {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  const [existing] = await db
    .select()
    .from(schema.supportSessions)
    .where(eq(schema.supportSessions.id, sessionId))
    .limit(1);

  if (!existing) {
    throw new Error("Not Found: support session not found");
  }
  if (existing.endedAt) {
    throw new Error("Conflict: support session has already ended");
  }
  if (existing.extendedAt) {
    throw new Error("Conflict: support session can only be extended once (PLAN §6.3)");
  }
  if (existing.expiresAt.getTime() < Date.now()) {
    throw new Error("Conflict: expired support session cannot be extended");
  }

  const newExpiresAt = new Date(existing.expiresAt.getTime() + SESSION_DURATION_MS);
  const now = new Date();

  const [updated] = await db
    .update(schema.supportSessions)
    .set({
      expiresAt: newExpiresAt,
      extendedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.supportSessions.id, sessionId))
    .returning();

  if (!updated) {
    throw new Error("Failed to extend support session");
  }

  await db.insert(schema.platformAuditLogs).values({
    actorUserId: platformStaffUserId,
    actorType: "platform_staff",
    action: "support_session.extend",
    targetType: "support_session",
    targetId: sessionId,
    tenantId: existing.tenantId,
    ip: meta?.ip,
    userAgent: meta?.userAgent,
    requestId: meta?.requestId,
    diff: {
      oldExpiresAt: existing.expiresAt.toISOString(),
      newExpiresAt: newExpiresAt.toISOString(),
    },
  });

  return {
    id: updated.id,
    tenantId: updated.tenantId,
    platformUserId: updated.platformUserId,
    impersonatedUserId: updated.impersonatedUserId,
    reason: updated.reason,
    ticketRef: updated.ticketRef,
    scope: updated.scope as "read_only" | "write",
    consent: updated.consent as "owner_approved" | "standing_consent" | "emergency",
    approvedByUserId: updated.approvedByUserId,
    startedAt: updated.startedAt.toISOString(),
    expiresAt: updated.expiresAt.toISOString(),
    endedAt: updated.endedAt?.toISOString() ?? null,
    endedBy: updated.endedBy,
    actionsCount: updated.actionsCount,
    token: updated.token ?? undefined,
    isExtended: true,
    writeConfirmedAt: updated.writeConfirmedAt?.toISOString() ?? null,
  };
}

/**
 * Confirms elevated write access for a support session with required second confirmation.
 */
export async function confirmSupportSessionWriteAccess(
  rt: Runtime,
  platformStaffUserId: string,
  sessionId: string,
  meta?: { ip?: string; userAgent?: string; requestId?: string },
): Promise<SupportSessionRecord> {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  const [existing] = await db
    .select()
    .from(schema.supportSessions)
    .where(eq(schema.supportSessions.id, sessionId))
    .limit(1);

  if (!existing) {
    throw new Error("Not Found: support session not found");
  }
  if (existing.endedAt) {
    throw new Error("Conflict: support session has ended");
  }

  const now = new Date();
  const [updated] = await db
    .update(schema.supportSessions)
    .set({
      scope: "write",
      writeConfirmedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.supportSessions.id, sessionId))
    .returning();

  if (!updated) {
    throw new Error("Failed to update support session scope");
  }

  await db.insert(schema.platformAuditLogs).values({
    actorUserId: platformStaffUserId,
    actorType: "platform_staff",
    action: "support_session.elevate_write",
    targetType: "support_session",
    targetId: sessionId,
    tenantId: existing.tenantId,
    ip: meta?.ip,
    userAgent: meta?.userAgent,
    requestId: meta?.requestId,
    diff: { scope: "write" },
  });

  return {
    id: updated.id,
    tenantId: updated.tenantId,
    platformUserId: updated.platformUserId,
    impersonatedUserId: updated.impersonatedUserId,
    reason: updated.reason,
    ticketRef: updated.ticketRef,
    scope: "write",
    consent: updated.consent as "owner_approved" | "standing_consent" | "emergency",
    approvedByUserId: updated.approvedByUserId,
    startedAt: updated.startedAt.toISOString(),
    expiresAt: updated.expiresAt.toISOString(),
    endedAt: updated.endedAt?.toISOString() ?? null,
    endedBy: updated.endedBy,
    actionsCount: updated.actionsCount,
    token: updated.token ?? undefined,
    isExtended: Boolean(updated.extendedAt),
    writeConfirmedAt: updated.writeConfirmedAt?.toISOString() ?? null,
  };
}

/**
 * Ends an active support session.
 */
export async function endSupportSession(
  rt: Runtime,
  platformStaffUserId: string,
  sessionId: string,
  meta?: { ip?: string; userAgent?: string; requestId?: string },
): Promise<{ ok: true }> {
  const db = rt._db.db;
  const [existing] = await db
    .select()
    .from(schema.supportSessions)
    .where(eq(schema.supportSessions.id, sessionId))
    .limit(1);

  if (!existing) {
    throw new Error("Not Found: support session not found");
  }

  const now = new Date();
  await db
    .update(schema.supportSessions)
    .set({
      endedAt: now,
      endedBy: platformStaffUserId,
      updatedAt: now,
    })
    .where(eq(schema.supportSessions.id, sessionId));

  await db.insert(schema.platformAuditLogs).values({
    actorUserId: platformStaffUserId,
    actorType: "platform_staff",
    action: "support_session.end",
    targetType: "support_session",
    targetId: sessionId,
    tenantId: existing.tenantId,
    ip: meta?.ip,
    userAgent: meta?.userAgent,
    requestId: meta?.requestId,
    diff: { totalActions: existing.actionsCount },
  });

  return { ok: true };
}

/**
 * Validates a support token for Store Admin requests.
 * Rejects expired, ended, or cross-tenant tokens. Increments action counter.
 */
export async function validateSupportSessionToken(
  db: Db,
  token: string,
  expectedTenantId: string,
): Promise<{
  valid: boolean;
  sessionId: string;
  tenantId: string;
  platformUserId: string;
  scope: "read_only" | "write";
  reason: string;
  ticketRef: string;
  expiresAt: Date;
}> {
  const [session] = await db
    .select()
    .from(schema.supportSessions)
    .where(
      and(
        eq(schema.supportSessions.token, token),
        isNull(schema.supportSessions.endedAt),
        gt(schema.supportSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!session) {
    throw new Error("Unauthorized: invalid or expired support session token");
  }

  // Cross-tenant check: a support session token cannot reach another store!
  if (session.tenantId !== expectedTenantId) {
    throw new Error("Forbidden: support session is not authorized for this store");
  }

  // Increment action count
  await db
    .update(schema.supportSessions)
    .set({
      actionsCount: sql`${schema.supportSessions.actionsCount} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(schema.supportSessions.id, session.id));

  return {
    valid: true,
    sessionId: session.id,
    tenantId: session.tenantId,
    platformUserId: session.platformUserId,
    scope: session.scope as "read_only" | "write",
    reason: session.reason,
    ticketRef: session.ticketRef,
    expiresAt: session.expiresAt,
  };
}

/**
 * Lists all support sessions across the platform.
 */
export async function listPlatformSupportSessions(
  rt: Runtime,
  tenantId?: string,
): Promise<SupportSessionRecord[]> {
  const db = rt._db.db;
  const query = db
    .select()
    .from(schema.supportSessions)
    .orderBy(sql`${schema.supportSessions.createdAt} DESC`);

  const rows = tenantId
    ? await query.where(eq(schema.supportSessions.tenantId, tenantId))
    : await query;

  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenantId,
    platformUserId: r.platformUserId,
    impersonatedUserId: r.impersonatedUserId,
    reason: r.reason,
    ticketRef: r.ticketRef,
    scope: r.scope as "read_only" | "write",
    consent: r.consent as "owner_approved" | "standing_consent" | "emergency",
    approvedByUserId: r.approvedByUserId,
    startedAt: r.startedAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    endedAt: r.endedAt?.toISOString() ?? null,
    endedBy: r.endedBy,
    actionsCount: r.actionsCount,
    token: r.token ?? undefined,
    isExtended: Boolean(r.extendedAt),
    writeConfirmedAt: r.writeConfirmedAt?.toISOString() ?? null,
  }));
}
