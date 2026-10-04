import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { ListSettingsActivityArgs, ListSettingsActivityOutput, SettingsActivityItem } from "@bs/contracts";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";

/** Actions recognized as settings activity across the platform (Phase 2, ADR-020). */
export const SETTINGS_ACTIVITY_ACTIONS: Record<string, string> = {
  "store_settings.update": "Store details",
  "order_settings.update": "Orders",
  "return_settings.update": "Returns",
  "store_status.update": "Storefront",
  "brand_settings.update": "Branding",
  "brand_settings.publish": "Branding",
  "shipping_settings.update": "Shipping",
  "shipping_zone.update": "Shipping",
  "shipping_rates.update": "Shipping",
  "tax_settings.update": "Taxes",
  "razorpay_credentials.saved": "Payments",
  "custom_domain.add": "Domains",
  "custom_domain.verify": "Domains",
  "custom_domain.primary": "Domains",
  "custom_domain.remove": "Domains",
  "staff_membership.role_change": "Users",
  "staff_membership.remove": "Users",
  "staff_invitation.create": "Users",
  "staff_invitation.revoke": "Users",
  "support_consent.update": "Support access",
};

const SECRET_PATTERNS = [
  /key/i,
  /secret/i,
  /token/i,
  /password/i,
  /hash/i,
  /auth/i,
  /credential/i,
  /signature/i,
];

function isSecretKey(key: string): boolean {
  return SECRET_PATTERNS.some((p) => p.test(key));
}

/** Defensively sanitize diff values to ensure no secrets or ciphertext leak (AGENTS.md rule 7). */
export function sanitizeDiffValue(val: unknown, keyName = ""): unknown {
  if (val === null || val === undefined) return val;
  if (isSecretKey(keyName)) {
    return "[REDACTED]";
  }
  if (typeof val === "object") {
    if (Array.isArray(val)) {
      return val.map((item) => sanitizeDiffValue(item, keyName));
    }
    const cleanObj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (isSecretKey(k)) {
        cleanObj[k] = "[REDACTED]";
      } else {
        cleanObj[k] = sanitizeDiffValue(v, k);
      }
    }
    return cleanObj;
  }
  return val;
}

export function sanitizeDiff(diff: unknown): Record<string, { before: unknown; after: unknown }> | null {
  if (!diff || typeof diff !== "object" || Array.isArray(diff)) return null;
  const result: Record<string, { before: unknown; after: unknown }> = {};
  for (const [key, entry] of Object.entries(diff as Record<string, unknown>)) {
    if (isSecretKey(key)) {
      result[key] = { before: "[REDACTED]", after: "[REDACTED]" };
      continue;
    }
    if (entry && typeof entry === "object" && ("before" in entry || "after" in entry)) {
      const e = entry as { before?: unknown; after?: unknown };
      result[key] = {
        before: sanitizeDiffValue(e.before, key),
        after: sanitizeDiffValue(e.after, key),
      };
    } else {
      result[key] = {
        before: null,
        after: sanitizeDiffValue(entry, key),
      };
    }
  }
  return result;
}

export function mapActionToArea(action: string): string {
  if (SETTINGS_ACTIVITY_ACTIONS[action]) return SETTINGS_ACTIVITY_ACTIONS[action];
  if (action.startsWith("store_settings.") || action.startsWith("settings.")) return "Store details";
  if (action.startsWith("order_settings.")) return "Orders";
  if (action.startsWith("return_settings.")) return "Returns";
  if (action.startsWith("shipping_")) return "Shipping";
  if (action.startsWith("brand_settings.")) return "Branding";
  if (action.startsWith("custom_domain.")) return "Domains";
  if (action.startsWith("staff_") || action.startsWith("membership.")) return "Users";
  if (action.startsWith("tax_")) return "Taxes";
  if (action.startsWith("payment_") || action.startsWith("razorpay_")) return "Payments";
  return "General";
}

/** Lists tenant-scoped settings activity log entries (Phase 2, ADR-020). */
export async function listSettingsActivity(
  rt: Runtime,
  ctx: TenantContext,
  input: ListSettingsActivityArgs = {},
): Promise<ListSettingsActivityOutput> {
  assertPermission(ctx, "audit.read");

  const limit = input.limit ?? 50;
  const offset = input.offset ?? 0;

  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const conditions = [
      eq(schema.auditLogs.tenantId, ctx.tenantId),
    ];

    // Filter by area: map area string to known actions, or filter by prefix
    if (input.area) {
      const matchedActions = Object.entries(SETTINGS_ACTIVITY_ACTIONS)
        .filter(([, area]) => area.toLowerCase() === input.area?.toLowerCase())
        .map(([action]) => action);

      if (matchedActions.length > 0) {
        conditions.push(inArray(schema.auditLogs.action, matchedActions));
      } else {
        // Fallback: area name matching action prefix
        conditions.push(sql`${schema.auditLogs.action} ILIKE ${`%${input.area}%`}`);
      }
    } else {
      // By default restrict to settings-relevant mutation actions or target types
      const knownActionKeys = Object.keys(SETTINGS_ACTIVITY_ACTIONS);
      conditions.push(
        sql`(${inArray(schema.auditLogs.action, knownActionKeys)} OR ${schema.auditLogs.targetType} IN ('store_settings', 'order_settings', 'return_settings', 'brand_settings', 'shipping_zones', 'shipping_rates', 'custom_domains', 'staff_invitations', 'memberships'))`,
      );
    }

    if (input.actorId) {
      conditions.push(eq(schema.auditLogs.actorId, input.actorId));
    }

    if (input.dateFrom) {
      conditions.push(gte(schema.auditLogs.createdAt, new Date(input.dateFrom)));
    }

    if (input.dateTo) {
      conditions.push(lte(schema.auditLogs.createdAt, new Date(input.dateTo)));
    }

    const whereClause = and(...conditions);

    const [countRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.auditLogs)
      .where(whereClause);

    const total = countRow?.count ?? 0;

    // Join with users table to provide actor email when available
    const rows = await tx
      .select({
        id: schema.auditLogs.id,
        action: schema.auditLogs.action,
        actorType: schema.auditLogs.actorType,
        actorId: schema.auditLogs.actorId,
        actorEmail: schema.users.email,
        targetType: schema.auditLogs.targetType,
        targetId: schema.auditLogs.targetId,
        diff: schema.auditLogs.diff,
        createdAt: schema.auditLogs.createdAt,
      })
      .from(schema.auditLogs)
      .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.actorId))
      .where(whereClause)
      .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
      .limit(limit)
      .offset(offset);

    const items: SettingsActivityItem[] = rows.map((r) => ({
      id: r.id,
      action: r.action,
      area: mapActionToArea(r.action),
      actorType: r.actorType,
      actorId: r.actorId,
      actorEmail: r.actorEmail ?? null,
      targetType: r.targetType,
      targetId: r.targetId,
      diff: sanitizeDiff(r.diff),
      createdAt: r.createdAt.toISOString(),
    }));

    return { items, total };
  });
}
