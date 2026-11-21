/**
 * Turns a bearer token into an AI session (ADR-050): the connection, the approving user's current store permissions and the
 * store's AI settings. Everything is re-read on every call, so revoking a connection, removing the user, switching AI access
 * off, changing the matrix or a plan downgrade takes effect on the very next call. The store comes only from the connection.
 */
import { and, eq, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { systemRoleDefinedPermissions, systemRoleFinancePermissions } from "@bs/auth";
import type { Runtime } from "../runtime.ts";
import type { StoreStatus, TenantContext } from "../context.ts";
import { isAdminAccessAllowed, isAdminReadOnly } from "../system/tenant-lifecycle.ts";
import { AI_CONSENT_VERSION } from "./consent.ts";
import { aiAccessEntitled, aiFlagEnabled } from "./access.ts";
import { normalizeMatrix, type AiMatrix } from "./matrix.ts";
import { resolveAccessToken } from "./tokens.ts";

export type AgentDenial =
  | "invalid_token"
  | "plan_not_included"
  | "kill_switch"
  | "ai_disabled"
  | "consent_required"
  | "connection_inactive"
  | "user_removed"
  | "store_unavailable";

const MESSAGES: Record<AgentDenial, string> = {
  invalid_token: "The connection is not valid or has expired. Reconnect the app from its settings.",
  plan_not_included: "AI access is available on the Growth plan and above.",
  kill_switch: "AI access is temporarily turned off for your store. Contact support if this continues.",
  ai_disabled: "AI access is turned off for this store. The store owner can turn it on in Settings > AI access.",
  consent_required: "The store owner needs to accept the updated AI access terms in Settings > AI access.",
  connection_inactive: "This connection was disconnected or paused. Reconnect the app from its settings.",
  user_removed: "The person who connected this app no longer has access to the store.",
  store_unavailable: "The store is not available for AI access right now.",
};

/** A refusal with a stable reason and a plain-language message the AI can relay to the merchant. */
export class AgentAccessError extends Error {
  readonly reason: AgentDenial;
  readonly status: number;
  constructor(reason: AgentDenial) {
    super(MESSAGES[reason]);
    this.name = "AgentAccessError";
    this.reason = reason;
    this.status = reason === "invalid_token" ? 401 : 403;
  }
}

export interface AgentSession {
  ctx: TenantContext;
  connection: { id: string; clientName: string; userId: string };
  settings: { matrix: AiMatrix; allowPublishing: boolean };
  timezone: string;
  currency: string;
  storeName: string;
}

export async function authenticateAgent(rt: Runtime, rawToken: string, requestId: string): Promise<AgentSession> {
  const db = rt._db.db;
  const token = await resolveAccessToken(db, rawToken);
  if (!token) throw new AgentAccessError("invalid_token");
  const { tenantId, connectionId } = token;

  if (!(await aiAccessEntitled(db, tenantId))) throw new AgentAccessError("plan_not_included");
  if (!(await aiFlagEnabled(db, tenantId))) throw new AgentAccessError("kill_switch");

  const loaded = await withTenant(db, tenantId, async (tx) => {
    const [conn] = await tx
      .select()
      .from(schema.agentConnections)
      .where(and(eq(schema.agentConnections.tenantId, tenantId), eq(schema.agentConnections.id, connectionId)))
      .limit(1);
    if (!conn) return { kind: "denied" as const, reason: "connection_inactive" as const };
    if (conn.status !== "active" || (conn.pausedUntil && conn.pausedUntil.getTime() > Date.now())) {
      return { kind: "denied" as const, reason: "connection_inactive" as const };
    }
    const [settings] = await tx.select().from(schema.storeAiSettings).where(eq(schema.storeAiSettings.tenantId, tenantId)).limit(1);
    if (!settings?.enabled) return { kind: "denied" as const, reason: "ai_disabled" as const };
    if (settings.consentVersion !== AI_CONSENT_VERSION) return { kind: "denied" as const, reason: "consent_required" as const };

    const [member] = await tx
      .select({ roleName: schema.roles.name, permissions: schema.roles.permissions, tenantStatus: schema.tenants.status })
      .from(schema.memberships)
      .innerJoin(schema.roles, and(eq(schema.roles.id, schema.memberships.roleId), eq(schema.roles.tenantId, schema.memberships.tenantId)))
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
      .where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.userId, conn.userId), eq(schema.memberships.status, "active")))
      .limit(1);
    if (!member) return { kind: "denied" as const, reason: "user_removed" as const };
    if (!isAdminAccessAllowed(member.tenantStatus)) return { kind: "denied" as const, reason: "store_unavailable" as const };

    const [store] = await tx.select({ timezone: schema.storeSettings.timezone, currency: schema.storeSettings.currency, storeName: schema.storeSettings.storeName }).from(schema.storeSettings).where(eq(schema.storeSettings.tenantId, tenantId)).limit(1);

    if (!conn.lastUsedAt || Date.now() - conn.lastUsedAt.getTime() > 60_000) {
      await tx.update(schema.agentConnections).set({ lastUsedAt: sql`now()` }).where(and(eq(schema.agentConnections.tenantId, tenantId), eq(schema.agentConnections.id, conn.id)));
    }
    return { kind: "ok" as const, conn, settings, member, store };
  });

  if (loaded.kind === "denied") throw new AgentAccessError(loaded.reason);
  const { conn, settings, member, store } = loaded;

  let permissions: string[] = [...(member.permissions ?? [])];
  const finance = systemRoleFinancePermissions(member.roleName);
  if (finance.length > 0) permissions = [...new Set([...permissions, ...finance])];
  const defined = systemRoleDefinedPermissions(member.roleName);
  if (defined.length > 0) permissions = [...new Set([...permissions, ...defined])];
  if (isAdminReadOnly(member.tenantStatus)) permissions = permissions.filter((p) => p.endsWith(".read"));

  const storeStatus: StoreStatus = member.tenantStatus === "active" ? "live" : (member.tenantStatus as StoreStatus);
  return {
    ctx: {
      tenantId,
      storeStatus,
      actor: { type: "agent", userId: conn.userId, connectionId: conn.id },
      roles: [member.roleName],
      permissions,
      requestId,
    },
    connection: { id: conn.id, clientName: conn.clientName, userId: conn.userId },
    settings: { matrix: normalizeMatrix(settings.matrix), allowPublishing: settings.allowPublishing },
    timezone: store?.timezone ?? "Asia/Kolkata",
    currency: store?.currency ?? "INR",
    storeName: store?.storeName ?? "Store",
  };
}
