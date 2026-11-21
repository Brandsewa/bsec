import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { schema } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPlatformStaff, writePlatformAudit, type AuditMeta, type PlatformRole } from "../platform-services.ts";
import { recordSecurityEvent } from "../account/security.ts";

/** What each platform role may do, in plain words, for the read-only "Role and access" tab. Enforcement stays in the services. */
export const PLATFORM_ROLE_SUMMARY: Record<PlatformRole, { label: string; can: string[]; cannot: string[] }> = {
  platform_owner: {
    label: "Owner",
    can: ["Everything an admin can do", "Change staff roles and reactivate staff", "Change platform settings, billing, plans, promotions and branding", "Reset platform data"],
    cannot: ["Remove the last active owner"],
  },
  platform_admin: {
    label: "Admin",
    can: ["Everything support can do", "Invite and deactivate staff (support staff for admins)", "Manage stores: suspend, restore, change plan, archive", "Edit email, notification and audit settings"],
    cannot: ["Change roles", "Change platform-wide billing and branding settings reserved for owners"],
  },
  platform_support: {
    label: "Support",
    can: ["View stores, plans, signups and the audit log", "Start a time-boxed support session once the store owner approves"],
    cannot: ["Change store or platform settings", "Manage staff"],
  },
};

export interface PlatformAccount {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  jobTitle: string | null;
  role: PlatformRole;
  roleLabel: string;
  can: string[];
  cannot: string[];
  mfa: { enabled: boolean; required: boolean; enrolledAt: string | null };
  createdAt: string;
  /** Support sessions this person has open right now (they act inside a store, and every action is audited). */
  supportSessions: { id: string; storeName: string; scope: string; consent: string; expiresAt: string }[];
}

export async function getPlatformAccount(rt: Runtime, userId: string): Promise<PlatformAccount> {
  const staff = await assertPlatformStaff(rt, userId);
  const db = rt._db.db;
  const [row] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      phone: schema.users.phone,
      jobTitle: schema.users.jobTitle,
      twoFactor: schema.users.twoFactorEnabled,
      createdAt: schema.users.createdAt,
      mfaRequired: schema.platformStaff.mfaRequired,
      mfaVerifiedAt: schema.platformStaff.mfaVerifiedAt,
    })
    .from(schema.users)
    .innerJoin(schema.platformStaff, eq(schema.platformStaff.userId, schema.users.id))
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!row) throw new Error("Forbidden: not a platform staff member");
  const open = await db
    .select({
      id: schema.supportSessions.id,
      scope: schema.supportSessions.scope,
      consent: schema.supportSessions.consent,
      expiresAt: schema.supportSessions.expiresAt,
      storeName: schema.tenants.name,
    })
    .from(schema.supportSessions)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.supportSessions.tenantId))
    .where(and(eq(schema.supportSessions.platformUserId, userId), isNull(schema.supportSessions.endedAt), gt(schema.supportSessions.expiresAt, new Date())))
    .orderBy(desc(schema.supportSessions.startedAt));
  const summary = PLATFORM_ROLE_SUMMARY[staff.role];
  return {
    id: row.id,
    email: String(row.email),
    name: row.name,
    phone: row.phone,
    jobTitle: row.jobTitle,
    role: staff.role,
    roleLabel: summary.label,
    can: summary.can,
    cannot: summary.cannot,
    mfa: { enabled: row.twoFactor ?? false, required: row.mfaRequired, enrolledAt: row.mfaVerifiedAt?.toISOString() ?? null },
    createdAt: row.createdAt.toISOString(),
    supportSessions: open.map((s) => ({ id: s.id, storeName: s.storeName, scope: s.scope, consent: s.consent, expiresAt: s.expiresAt.toISOString() })),
  };
}

export interface PlatformAccountInput {
  name?: string | undefined;
  phone?: string | null | undefined;
  jobTitle?: string | null | undefined;
}

/** Own profile only. The email is the sign-in and the role is set by an owner under Staff, so neither is editable here. Audited in the same transaction. */
export async function updatePlatformAccount(rt: Runtime, userId: string, input: PlatformAccountInput, meta?: AuditMeta): Promise<PlatformAccount> {
  await assertPlatformStaff(rt, userId);
  const patch: Partial<typeof schema.users.$inferInsert> = { updatedAt: new Date() };
  const changed: string[] = [];
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error("Bad Request: name is required");
    patch.name = name.slice(0, 120);
    changed.push("name");
  }
  if (input.phone !== undefined) {
    const phone = input.phone?.trim() || null;
    if (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) throw new Error("Bad Request: enter a valid phone number");
    patch.phone = phone;
    changed.push("phone");
  }
  if (input.jobTitle !== undefined) {
    patch.jobTitle = input.jobTitle?.trim().slice(0, 80) || null;
    changed.push("jobTitle");
  }
  await rt._db.db.transaction(async (tx) => {
    await tx.update(schema.users).set(patch).where(eq(schema.users.id, userId));
    await writePlatformAudit(tx, userId, "platform_account.update_profile", "user", userId, null, { fields: changed }, meta);
  });
  return getPlatformAccount(rt, userId);
}

/** Sign one other device out. Audited in the same transaction; the current session is never touched here. */
export async function revokePlatformSession(rt: Runtime, userId: string, sessionId: string, currentSessionId: string | undefined, meta?: AuditMeta): Promise<{ revoked: boolean }> {
  await assertPlatformStaff(rt, userId);
  if (sessionId === currentSessionId) throw new Error("Conflict: use Sign out to end the session you are using");
  const revoked = await rt._db.db.transaction(async (tx) => {
    const deleted = await tx
      .delete(schema.sessions)
      .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, userId)))
      .returning({ id: schema.sessions.id });
    await writePlatformAudit(tx, userId, "platform_account.revoke_session", "session", sessionId, null, { revoked: deleted.length > 0 }, meta);
    return deleted.length > 0;
  });
  if (revoked) await recordSecurityEvent(rt._db.db, { userId, type: "session_revoked", ip: meta?.ip, userAgent: meta?.userAgent });
  return { revoked };
}

/** Sign out every other device. Audited in the same transaction. */
export async function revokeOtherPlatformSessions(rt: Runtime, userId: string, currentSessionId: string | undefined, meta?: AuditMeta): Promise<{ count: number }> {
  await assertPlatformStaff(rt, userId);
  if (!currentSessionId) throw new Error("Conflict: no current session");
  const count = await rt._db.db.transaction(async (tx) => {
    const deleted = await tx
      .delete(schema.sessions)
      .where(and(eq(schema.sessions.userId, userId), ne(schema.sessions.id, currentSessionId)))
      .returning({ id: schema.sessions.id });
    await writePlatformAudit(tx, userId, "platform_account.revoke_other_sessions", "user", userId, null, { count: deleted.length }, meta);
    return deleted.length;
  });
  if (count) await recordSecurityEvent(rt._db.db, { userId, type: "other_sessions_revoked", ip: meta?.ip, userAgent: meta?.userAgent, meta: { count } });
  return { count };
}

/** Audit row plus security event for a change Better Auth itself performed (password changed, backup codes made). Never throws. */
export async function recordPlatformAccountChange(
  rt: Runtime,
  userId: string,
  kind: "password_changed" | "backup_codes_regenerated" | "mfa_enabled",
  meta?: AuditMeta,
): Promise<void> {
  try {
    await rt._db.db.transaction(async (tx) => {
      await writePlatformAudit(tx, userId, `platform_account.${kind}`, "user", userId, null, null, meta);
    });
  } catch {
    /* the change already happened; the audit gap is logged by the caller */
  }
  await recordSecurityEvent(rt._db.db, { userId, type: kind, ip: meta?.ip, userAgent: meta?.userAgent });
}

export interface PlatformActivityRow {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  tenantId: string | null;
  at: string;
}

/** The caller's own recent privileged actions, newest first. */
export async function listMyPlatformActivity(rt: Runtime, userId: string, limit = 40): Promise<PlatformActivityRow[]> {
  await assertPlatformStaff(rt, userId);
  const rows = await rt._db.db
    .select()
    .from(schema.platformAuditLogs)
    .where(eq(schema.platformAuditLogs.actorUserId, userId))
    .orderBy(desc(schema.platformAuditLogs.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows.map((r) => ({ id: r.id, action: r.action, targetType: r.targetType, targetId: r.targetId, tenantId: r.tenantId, at: r.createdAt.toISOString() }));
}
