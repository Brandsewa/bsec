import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { schema, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPlatformStaff, assertRoleAtLeast, roleAtLeast, writePlatformAudit, type AuditMeta } from "../platform-services.ts";

export interface StartSupportSessionInput {
  tenantId: string;
  reason: string;
  ticketRef: string;
  /** Sessions always START read-only. "write" is accepted for compatibility but still needs the second confirmation. */
  scope?: "read_only" | "write" | undefined;
  consent: "owner_approved" | "standing_consent" | "emergency";
  impersonatedUserId?: string | undefined;
}

export type SupportSessionStatus = "pending_owner_approval" | "active" | "denied" | "ended" | "expired";

export interface SupportSessionRecord {
  id: string;
  tenantId: string;
  platformUserId: string;
  impersonatedUserId?: string | null | undefined;
  reason: string;
  ticketRef: string;
  scope: "read_only" | "write";
  consent: "owner_approved" | "standing_consent" | "emergency";
  status: SupportSessionStatus;
  approvedByUserId?: string | null | undefined;
  approvedAt?: string | null | undefined;
  startedAt: string;
  expiresAt: string;
  endedAt?: string | null | undefined;
  endedBy?: string | null | undefined;
  actionsCount: number;
  /** Only present in the response that starts the session: the raw token is never stored and never listed again. */
  token?: string | null | undefined;
  isExtended: boolean;
  writeConfirmedAt?: string | null | undefined;
}

const SESSION_DURATION_MS = 60 * 60 * 1000; // 60 minutes
/** A session that is never approved by the store owner stops being usable this long after it was requested. */
const APPROVAL_WINDOW_MS = 24 * 60 * 60 * 1000;

export function hashSupportToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

type SessionRow = typeof schema.supportSessions.$inferSelect;

export function supportSessionStatus(
  r: Pick<SessionRow, "consent" | "approvedAt" | "deniedAt" | "endedAt" | "expiresAt">,
  now = new Date(),
): SupportSessionStatus {
  if (r.deniedAt) return "denied";
  if (r.endedAt) return "ended";
  if (r.expiresAt.getTime() <= now.getTime()) return "expired";
  if (r.consent === "owner_approved" && !r.approvedAt) return "pending_owner_approval";
  return "active";
}

function toRecord(r: SessionRow, rawToken?: string): SupportSessionRecord {
  return {
    id: r.id,
    tenantId: r.tenantId,
    platformUserId: r.platformUserId,
    impersonatedUserId: r.impersonatedUserId,
    reason: r.reason,
    ticketRef: r.ticketRef,
    scope: r.scope as "read_only" | "write",
    consent: r.consent as SupportSessionRecord["consent"],
    status: supportSessionStatus(r),
    approvedByUserId: r.approvedByUserId,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    startedAt: r.startedAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    endedAt: r.endedAt?.toISOString() ?? null,
    endedBy: r.endedBy,
    actionsCount: r.actionsCount,
    ...(rawToken ? { token: rawToken } : {}),
    isExtended: Boolean(r.extendedAt),
    writeConfirmedAt: r.writeConfirmedAt?.toISOString() ?? null,
  };
}

/**
 * Starts an audited support session (PLAN §6.3). Never signs in as the merchant's own account: it issues a separate
 * token (shown once; only its SHA-256 is stored) that carries the support session id.
 *  - owner_approved: the session cannot be used until the store owner approves it in the store admin.
 *  - standing_consent: allowed only when the owner switched on standing consent for the store.
 *  - emergency: platform_owner only; usable at once and flagged in the audit log.
 * Always starts read-only; write access needs the separate elevate-write confirmation.
 */
export async function startSupportSession(
  rt: Runtime,
  platformStaffUserId: string,
  input: StartSupportSessionInput,
  meta?: AuditMeta,
): Promise<SupportSessionRecord> {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  if (!input.reason?.trim()) throw new Error("Bad Request: support reason is required");
  if (!input.ticketRef?.trim()) throw new Error("Bad Request: ticket reference is required");
  if (input.consent === "emergency") {
    assertRoleAtLeast(staff.role, "platform_owner", "starting an emergency support session");
  }

  const token = `sup_${randomBytes(32).toString("hex")}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);

  return db.transaction(async (tx) => {
    const [tenant] = await tx
      .select({ id: schema.tenants.id, status: schema.tenants.status })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, input.tenantId))
      .limit(1);
    if (!tenant) throw new Error("Not Found: store not found");
    if (tenant.status === "deleted") throw new Error("Conflict: store has been deleted");

    if (input.consent === "standing_consent") {
      const [settings] = await tx
        .select({ standingConsent: schema.storeSettings.standingConsentForSupport })
        .from(schema.storeSettings)
        .where(eq(schema.storeSettings.tenantId, input.tenantId))
        .limit(1);
      if (!settings?.standingConsent) {
        throw new Error("Forbidden: store has not enabled standing consent for support access");
      }
    }

    // owner_approved sessions wait for the owner. Standing consent and emergency access are usable immediately.
    const approvedAt = input.consent === "owner_approved" ? null : now;

    const [session] = await tx
      .insert(schema.supportSessions)
      .values({
        tenantId: input.tenantId,
        platformUserId: platformStaffUserId,
        impersonatedUserId: input.impersonatedUserId,
        reason: input.reason.trim(),
        ticketRef: input.ticketRef.trim(),
        scope: "read_only",
        consent: input.consent,
        approvedAt,
        startedAt: now,
        // The 60 minutes of an owner-approved session start at approval; until then it lapses after the approval window.
        expiresAt: input.consent === "owner_approved" ? new Date(now.getTime() + APPROVAL_WINDOW_MS) : expiresAt,
        tokenHash: hashSupportToken(token),
        actionsCount: 0,
      })
      .returning();
    if (!session) throw new Error("Failed to create support session");

    await writePlatformAudit(
      tx,
      platformStaffUserId,
      input.consent === "emergency" ? "support_session.emergency_start" : "support_session.start",
      "support_session",
      session.id,
      input.tenantId,
      {
        sessionId: session.id,
        consent: input.consent,
        requestedScope: input.scope ?? "read_only",
        reason: input.reason.trim(),
        ticketRef: input.ticketRef.trim(),
        isEmergency: input.consent === "emergency",
        awaitingOwnerApproval: approvedAt === null,
      },
      meta,
    );
    return toRecord(session, token);
  });
}

async function loadForUpdate(tx: Db, sessionId: string): Promise<SessionRow> {
  const [row] = await tx.select().from(schema.supportSessions).where(eq(schema.supportSessions.id, sessionId)).for("update").limit(1);
  if (!row) throw new Error("Not Found: support session not found");
  return row;
}

/** The staff member who started a session, or an admin/owner, may manage it; other support staff may not. */
function assertMayManage(staff: { userId: string; role: string }, row: SessionRow, action: string) {
  if (row.platformUserId !== staff.userId && !roleAtLeast(staff.role, "platform_admin")) {
    throw new Error(`Forbidden: only the staff member who started this session, or a platform admin, can ${action}`);
  }
}

/** Extends a support session by 60 minutes. Only once, and only while it is active. */
export async function extendSupportSession(
  rt: Runtime,
  platformStaffUserId: string,
  sessionId: string,
  meta?: AuditMeta,
): Promise<SupportSessionRecord> {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  return rt._db.db.transaction(async (tx) => {
    const existing = await loadForUpdate(tx, sessionId);
    assertMayManage(staff, existing, "extend it");
    const status = supportSessionStatus(existing);
    if (status !== "active") throw new Error(`Conflict: only an active support session can be extended (this one is ${status})`);
    if (existing.extendedAt) throw new Error("Conflict: support session can only be extended once (PLAN §6.3)");

    const newExpiresAt = new Date(existing.expiresAt.getTime() + SESSION_DURATION_MS);
    const [updated] = await tx
      .update(schema.supportSessions)
      .set({ expiresAt: newExpiresAt, extendedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(schema.supportSessions.id, sessionId))
      .returning();
    if (!updated) throw new Error("Failed to extend support session");

    await writePlatformAudit(tx, platformStaffUserId, "support_session.extend", "support_session", sessionId, existing.tenantId, {
      oldExpiresAt: existing.expiresAt.toISOString(),
      newExpiresAt: newExpiresAt.toISOString(),
    }, meta);
    return toRecord(updated);
  });
}

/**
 * Second confirmation for write access (PLAN §6.3). Platform admin or owner only; the session must be active.
 */
export async function confirmSupportSessionWriteAccess(
  rt: Runtime,
  platformStaffUserId: string,
  sessionId: string,
  meta?: AuditMeta,
): Promise<SupportSessionRecord> {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "granting write access in a support session");
  return rt._db.db.transaction(async (tx) => {
    const existing = await loadForUpdate(tx, sessionId);
    const status = supportSessionStatus(existing);
    if (status !== "active") throw new Error(`Conflict: write access can only be granted on an active support session (this one is ${status})`);

    const [updated] = await tx
      .update(schema.supportSessions)
      .set({ scope: "write", writeConfirmedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(schema.supportSessions.id, sessionId))
      .returning();
    if (!updated) throw new Error("Failed to update support session scope");

    await writePlatformAudit(tx, platformStaffUserId, "support_session.elevate_write", "support_session", sessionId, existing.tenantId, {
      scope: "write",
      previousScope: existing.scope,
    }, meta);
    return toRecord(updated);
  });
}

/** Ends a support session (its starter, or an admin/owner). */
export async function endSupportSession(
  rt: Runtime,
  platformStaffUserId: string,
  sessionId: string,
  meta?: AuditMeta,
): Promise<{ ok: true }> {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  return rt._db.db.transaction(async (tx) => {
    const existing = await loadForUpdate(tx, sessionId);
    assertMayManage(staff, existing, "end it");
    if (existing.endedAt) throw new Error("Conflict: support session has already ended");

    await tx
      .update(schema.supportSessions)
      .set({ endedAt: sql`now()`, endedBy: platformStaffUserId, updatedAt: sql`now()` })
      .where(eq(schema.supportSessions.id, sessionId));

    await writePlatformAudit(tx, platformStaffUserId, "support_session.end", "support_session", sessionId, existing.tenantId, {
      totalActions: existing.actionsCount,
    }, meta);
    return { ok: true as const };
  });
}

/** Lists support sessions. Tokens are never returned. */
export async function listPlatformSupportSessions(rt: Runtime, tenantId?: string): Promise<SupportSessionRecord[]> {
  const q = rt._db.db.select().from(schema.supportSessions).orderBy(desc(schema.supportSessions.createdAt)).limit(500);
  const rows = tenantId ? await q.where(eq(schema.supportSessions.tenantId, tenantId)) : await q;
  return rows.map((r) => toRecord(r));
}

export interface ValidatedSupportSession {
  valid: true;
  sessionId: string;
  tenantId: string;
  platformUserId: string;
  scope: "read_only" | "write";
  reason: string;
  ticketRef: string;
  consent: "owner_approved" | "standing_consent" | "emergency";
  expiresAt: Date;
}

/**
 * Validates a support token for a store-admin request (runs on the tenant runtime, app_rw).
 * Rejects unknown, denied, unapproved, ended, expired and cross-store tokens. For a valid request it counts the
 * action and writes a platform_audit_logs row, both in ONE transaction: no action goes uncounted or unaudited.
 */
export async function validateSupportSessionToken(
  db: Db,
  token: string,
  expectedTenantId: string,
  request?: { method?: string | undefined; path?: string | undefined },
): Promise<ValidatedSupportSession> {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select({
        id: schema.supportSessions.id,
        tenantId: schema.supportSessions.tenantId,
        platformUserId: schema.supportSessions.platformUserId,
        scope: schema.supportSessions.scope,
        reason: schema.supportSessions.reason,
        ticketRef: schema.supportSessions.ticketRef,
        consent: schema.supportSessions.consent,
        expiresAt: schema.supportSessions.expiresAt,
        approvedAt: schema.supportSessions.approvedAt,
      })
      .from(schema.supportSessions)
      .where(
        and(
          eq(schema.supportSessions.tokenHash, hashSupportToken(token)),
          isNull(schema.supportSessions.endedAt),
          isNull(schema.supportSessions.deniedAt),
          gt(schema.supportSessions.expiresAt, sql`now()`),
        ),
      )
      .limit(1);

    if (!session) throw new Error("Unauthorized: invalid or expired support session token");
    // A support session token can never reach another store.
    if (session.tenantId !== expectedTenantId) throw new Error("Forbidden: support session is not authorized for this store");
    if (session.consent === "owner_approved" && !session.approvedAt) {
      throw new Error("Forbidden: the store owner has not approved this support session yet");
    }

    await tx
      .update(schema.supportSessions)
      .set({ actionsCount: sql`${schema.supportSessions.actionsCount} + 1`, updatedAt: sql`now()` })
      .where(eq(schema.supportSessions.id, session.id));

    await tx.insert(schema.platformAuditLogs).values({
      actorUserId: session.platformUserId,
      actorType: "platform_staff",
      action: "support_session.request",
      targetType: "support_session",
      targetId: session.id,
      tenantId: session.tenantId,
      diff: { method: request?.method ?? null, path: request?.path ?? null, scope: session.scope },
    });

    return {
      valid: true as const,
      sessionId: session.id,
      tenantId: session.tenantId,
      platformUserId: session.platformUserId,
      scope: session.scope as "read_only" | "write",
      reason: session.reason,
      ticketRef: session.ticketRef,
      consent: session.consent as ValidatedSupportSession["consent"],
      expiresAt: session.expiresAt,
    };
  });
}
