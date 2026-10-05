import { and, desc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { ListSettingsActivityArgs, ListSettingsActivityOutput, SettingsActivityItem } from "@bs/contracts";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";

/**
 * Settings activity = audit rows whose action starts with one of these prefixes, grouped into the area shown in
 * Settings. Keep in step with the `action:` strings the settings services write (the first version listed
 * guessed names that nothing writes, so the page was empty). Legacy names stay so old rows still show.
 */
export const SETTINGS_ACTION_AREAS: ReadonlyArray<readonly [prefix: string, area: string]> = [
  ["store_settings.", "Store details"],
  ["settings.notifications_", "Notifications"],
  ["settings.privacy_", "Customer privacy"],
  ["settings.", "Store details"],
  ["order_settings.", "Orders"],
  ["return_settings.", "Returns"],
  ["brand_settings.", "Branding"],
  ["store_status.", "Storefront"],
  ["domain.", "Domains"],
  ["custom_domain.", "Domains"],
  ["checkout_settings.", "Checkout"],
  ["customer_account_settings.", "Customer accounts"],
  ["payment_methods.", "Payments"],
  ["razorpay_credentials.", "Payments"],
  ["shipping", "Shipping"],
  ["taxes.", "Taxes"],
  ["tax_", "Taxes"],
  ["policy.", "Policies"],
  ["privacy_request.", "Customer privacy"],
  ["plan_change.", "Plan & billing"],
  ["staff_membership.", "Users"],
  ["staff_invitation.", "Users"],
  ["membership.", "Users"],
  ["support_consent.", "Support access"],
  ["support_access.", "Support access"],
  ["support_session.", "Support access"],
];

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
  return SETTINGS_ACTION_AREAS.find(([prefix]) => action.startsWith(prefix))?.[1] ?? "General";
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

    // Area filter: the prefixes that map to that area; default: every settings prefix.
    const wanted = input.area
      ? SETTINGS_ACTION_AREAS.filter(([, area]) => area.toLowerCase() === input.area?.toLowerCase())
      : SETTINGS_ACTION_AREAS;
    conditions.push(
      wanted.length > 0
        ? (or(...wanted.map(([prefix]) => like(schema.auditLogs.action, `${prefix}%`))) ?? sql`false`)
        : sql`false`,
    );

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
