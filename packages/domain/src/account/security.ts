import { and, desc, eq, ne } from "drizzle-orm";
import { schema, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { deviceLabel, displayIp } from "./device.ts";

/** Everything that can appear in the Security activity list. Keep in step with the labels in the admin UI. */
export const SECURITY_EVENT_TYPES = [
  "sign_in",
  "password_changed",
  "password_reset",
  "mfa_enabled",
  "mfa_disabled",
  "backup_codes_regenerated",
  "session_revoked",
  "other_sessions_revoked",
] as const;
export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

export interface SecurityEventInput {
  userId: string;
  type: SecurityEventType;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
  meta?: Record<string, unknown> | undefined;
}

/** Append one security event. Never throws: a failed audit write must not break the sign-in or change it describes. */
export async function recordSecurityEvent(db: Db, input: SecurityEventInput): Promise<void> {
  try {
    await db.insert(schema.securityEvents).values({
      userId: input.userId,
      type: input.type,
      ip: input.ip ?? null,
      userAgent: input.userAgent ? input.userAgent.slice(0, 400) : null,
      meta: input.meta ?? null,
    });
  } catch {
    /* intentionally swallowed, see above */
  }
}

export interface SecurityEventRecord {
  id: string;
  type: string;
  ip: string | null;
  device: string;
  at: string;
}

export async function listSecurityEvents(rt: Runtime, userId: string, limit = 30): Promise<SecurityEventRecord[]> {
  const rows = await rt._db.db
    .select()
    .from(schema.securityEvents)
    .where(eq(schema.securityEvents.userId, userId))
    .orderBy(desc(schema.securityEvents.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows.map((r) => ({ id: r.id, type: r.type, ip: displayIp(r.ip), device: deviceLabel(r.userAgent), at: r.createdAt.toISOString() }));
}

export interface SessionRecord {
  id: string;
  device: string;
  ip: string | null;
  signedInAt: string;
  /** Better Auth refreshes this at most once a day, so it means "active on or after". */
  lastActiveAt: string;
  current: boolean;
}

/** Live (unexpired) sessions of this user. Tokens are never returned; revoking goes by id. */
export async function listSessions(rt: Runtime, userId: string, currentSessionId: string | undefined): Promise<SessionRecord[]> {
  const rows = await rt._db.db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.userId, userId))
    .orderBy(desc(schema.sessions.updatedAt));
  const now = Date.now();
  return rows
    .filter((r) => r.expiresAt.getTime() > now)
    .map((r) => ({
      id: r.id,
      device: deviceLabel(r.userAgent),
      ip: displayIp(r.ipAddress),
      signedInAt: r.createdAt.toISOString(),
      lastActiveAt: r.updatedAt.toISOString(),
      current: r.id === currentSessionId,
    }));
}

interface RequestInfo {
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
}

/** Sign one device out. Only the caller's own sessions can be touched; the current one ends with Sign out. */
export async function revokeSession(
  rt: Runtime,
  userId: string,
  sessionId: string,
  currentSessionId: string | undefined,
  req?: RequestInfo,
): Promise<{ revoked: boolean }> {
  if (sessionId === currentSessionId) throw new Error("Use Sign out to end the session you are using");
  const deleted = await rt._db.db
    .delete(schema.sessions)
    .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, userId)))
    .returning({ id: schema.sessions.id });
  if (deleted.length) await recordSecurityEvent(rt._db.db, { userId, type: "session_revoked", ip: req?.ip, userAgent: req?.userAgent });
  return { revoked: deleted.length > 0 };
}

/** Sign out every other device, keeping the current session. */
export async function revokeOtherSessions(
  rt: Runtime,
  userId: string,
  currentSessionId: string | undefined,
  req?: RequestInfo,
): Promise<{ count: number }> {
  if (!currentSessionId) throw new Error("No current session");
  const deleted = await rt._db.db
    .delete(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), ne(schema.sessions.id, currentSessionId)))
    .returning({ id: schema.sessions.id });
  if (deleted.length) await recordSecurityEvent(rt._db.db, { userId, type: "other_sessions_revoked", ip: req?.ip, userAgent: req?.userAgent, meta: { count: deleted.length } });
  return { count: deleted.length };
}
