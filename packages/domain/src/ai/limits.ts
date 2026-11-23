/**
 * Usage limits for AI access (ADR-050 decision 8, docs/MCP-PLAN.md section 7). Values live in `quota_definitions` (Growth is tier M,
 * Pro is tier L), so Super Admin can tune them without a deploy. Counters are the existing fixed-window counters
 * (`checkRateLimit`). When a limit is hit the AI gets a plain sentence with the wait time; the HTTP layer adds `Retry-After`.
 * Reads fail open if the counter store is down; writes fail closed (ADR-013).
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import { checkRateLimit, type QuotaKey } from "../system/rate-limit.ts";
import { tierForPlan } from "../saas/plan-tiers.ts";
import type { AgentSession } from "./session.ts";

export type AgentCallKind = "read" | "write" | "report";

export class AgentRateLimitError extends Error {
  readonly retryAfter: number;
  constructor(message: string, retryAfter: number) {
    super(message);
    this.name = "AgentRateLimitError";
    this.retryAfter = retryAfter;
  }
}

export function humanWait(seconds: number): string {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} minutes`;
  const hours = Math.round(seconds / 3600);
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

/** The store-local date (yyyy-mm-dd) and the seconds left until local midnight, so daily limits reset at the store's midnight. */
export function localDay(timezone: string, now = new Date()): { date: string; secondsLeft: number } {
  const format = (tz: string) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(now)
        .map((p) => [p.type, p.value]),
    ) as Record<string, string>;
  let parts: Record<string, string>;
  try {
    parts = format(timezone);
  } catch {
    parts = format("Asia/Kolkata"); // an unknown time zone falls back to India time
  }
  const elapsed = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, secondsLeft: Math.max(60, 86400 - elapsed) };
}

/**
 * The limit for one AI quota key. A store only reaches a limit after the plan check passed, so the limit must never come out as
 * zero just because the store's size tier row is missing or still says XS or S (those tiers carry 0 for AI access, because they are
 * not entitled). Order: an explicit Super Admin override for the store (a deliberate 0 still means "paused") > the store's tier when
 * it is M or L > the tier its plan maps to (Growth is M, Pro is L) > M.
 */
export async function resolveAiQuota(db: Db, tenantId: string, key: QuotaKey): Promise<number> {
  const override = await db.execute<{ value: number }>(sql`SELECT value FROM tenant_quota_overrides WHERE tenant_id = ${tenantId} AND quota_key = ${key} LIMIT 1`);
  if (override.rows[0]) return Number(override.rows[0].value);

  const tierRow = await db.execute<{ tier: string }>(sql`SELECT tier FROM tenant_size_tiers WHERE tenant_id = ${tenantId} LIMIT 1`);
  let tier = tierRow.rows[0]?.tier?.toUpperCase() ?? "";
  if (tier !== "M" && tier !== "L") {
    const plan = await db.execute<{ code: string }>(sql`
      SELECT p.code FROM subscriptions s JOIN plans p ON p.id = s.plan_id
       WHERE s.tenant_id = ${tenantId} AND s.status IN ('active', 'trialing', 'past_due')
       ORDER BY s.created_at DESC LIMIT 1`);
    tier = tierForPlan(plan.rows[0]?.code);
    if (tier !== "M" && tier !== "L") tier = "M";
  }
  const def = await db.execute<{ tier_m: number; tier_l: number }>(sql`SELECT tier_m, tier_l FROM quota_definitions WHERE key = ${key} LIMIT 1`);
  const row = def.rows[0];
  if (!row) return 0;
  return Number(tier === "L" ? row.tier_l : row.tier_m);
}

/** A limit of zero is not "too many requests": it means Super Admin paused AI access for the store. Said plainly, with a long wait. */
const PAUSED_MESSAGE = "AI access is paused for this store by Brand Sewa. Contact support to turn it back on.";

async function hit(db: Db, key: string, quota: number, windowSeconds: number): Promise<{ allowed: boolean; retryAfter: number; paused?: true }> {
  if (quota <= 0) return { allowed: false, retryAfter: 3600, paused: true };
  const r = await checkRateLimit(db, { key, limit: quota, windowSeconds });
  return { allowed: r.allowed, retryAfter: r.retryAfter };
}

/**
 * Counts one call against every limit that applies and throws AgentRateLimitError when one is exceeded.
 * Order: connection and store per minute, then the kind-specific minute limits, then the daily limits.
 */
export async function enforceAgentLimits(db: Db, session: AgentSession, kind: AgentCallKind): Promise<void> {
  const { tenantId } = session.ctx;
  const connId = session.connection.id;
  const day = localDay(session.timezone);
  try {
    const q = (key: QuotaKey) => resolveAiQuota(db, tenantId, key);
    const checks: Array<{ key: string; quota: QuotaKey; window: number; message: (wait: number) => string }> = [
      { key: `ai:c:${connId}:m`, quota: "ai_calls_min_conn", window: 60, message: (w) => `This AI app is sending requests too fast. Try again in ${humanWait(w)}.` },
      { key: `ai:s:${tenantId}:m`, quota: "ai_calls_min_store", window: 60, message: (w) => `AI access limit reached for this store. It resets in ${humanWait(w)}.` },
    ];
    if (kind === "write") checks.push({ key: `ai:w:${tenantId}:m`, quota: "ai_writes_min_store", window: 60, message: (w) => `Too many AI changes in a short time. It resets in ${humanWait(w)}.` });
    if (kind === "report") checks.push({ key: `ai:r:${tenantId}:m`, quota: "ai_reports_min_store", window: 60, message: (w) => `Too many reports requested in a short time. It resets in ${humanWait(w)}.` });
    checks.push({ key: `ai:s:${tenantId}:d:${day.date}`, quota: "ai_calls_day_store", window: day.secondsLeft, message: (w) => `The daily AI access limit for this store is used up. It resets in ${humanWait(w)}.` });
    if (kind === "write") checks.push({ key: `ai:w:${tenantId}:d:${day.date}`, quota: "ai_writes_day_store", window: day.secondsLeft, message: (w) => `The daily limit of AI changes for this store is used up. It resets in ${humanWait(w)}.` });

    for (const c of checks) {
      const r = await hit(db, c.key, await q(c.quota), c.window);
      if (r.paused) throw new AgentRateLimitError(PAUSED_MESSAGE, r.retryAfter);
      if (!r.allowed) throw new AgentRateLimitError(c.message(r.retryAfter), r.retryAfter);
    }
  } catch (err) {
    if (err instanceof AgentRateLimitError) throw err;
    if (kind === "write") throw new Error("Service Unavailable: AI access is busy, try again in a moment.", { cause: err });
    // Reads fail open: a counter glitch must not take AI reads down.
  }
}

/** After 20 refused calls in a minute the connection is paused for 10 minutes (abuse protection). */
export async function noteDeniedCall(db: Db, session: AgentSession): Promise<void> {
  try {
    const r = await checkRateLimit(db, { key: `ai:deny:${session.connection.id}`, limit: 20, windowSeconds: 60 });
    if (r.allowed) return;
    await withTenant(db, session.ctx.tenantId, async (tx) => {
      await tx
        .update(schema.agentConnections)
        .set({ pausedUntil: sql`now() + interval '10 minutes'` })
        .where(and(eq(schema.agentConnections.tenantId, session.ctx.tenantId), eq(schema.agentConnections.id, session.connection.id)));
    });
  } catch {
    // never let abuse bookkeeping break a request
  }
}

export interface AiUsage {
  callsToday: number;
  writesToday: number;
  callLimit: number;
  writeLimit: number;
  resetsInSeconds: number;
}

export async function readAiUsage(db: Db, tenantId: string, timezone: string): Promise<AiUsage> {
  const day = localDay(timezone);
  const [callLimit, writeLimit] = await Promise.all([resolveAiQuota(db, tenantId, "ai_calls_day_store"), resolveAiQuota(db, tenantId, "ai_writes_day_store")]);
  const counts = await withTenant(db, tenantId, async (tx) => {
    const since = sql`(${day.date}::date::timestamp AT TIME ZONE ${timezone})`;
    const [row] = await tx
      .select({
        calls: sql<number>`count(*) FILTER (WHERE ${schema.agentCallLog.status} <> 'rate_limited')::int`,
        writes: sql<number>`count(*) FILTER (WHERE ${schema.agentCallLog.status} = 'ok' AND ${schema.agentCallLog.tool} = ANY(${sql.raw(`ARRAY[${WRITE_TOOL_NAMES.map((n) => `'${n}'`).join(",")}]::text[]`)}))::int`,
      })
      .from(schema.agentCallLog)
      .where(and(eq(schema.agentCallLog.tenantId, tenantId), gte(schema.agentCallLog.createdAt, since)));
    return row ?? { calls: 0, writes: 0 };
  });
  return { callsToday: counts.calls, writesToday: counts.writes, callLimit, writeLimit, resetsInSeconds: day.secondsLeft };
}

/** Tool names that count as writes in the usage meter. Kept next to the limits so the two cannot drift; the capability layer asserts it. */
export const WRITE_TOOL_NAMES = [
  "create_product",
  "update_product",
  "update_variant",
  "add_variant",
  "delete_variant",
  "set_product_options",
  "set_product_collections",
  "set_product_custom_fields",
  "add_product_image",
  "update_product_image",
  "reorder_product_images",
  "remove_product_image",
  "set_inventory",
  "publish_product",
  "unpublish_product",
  "archive_product",
  "create_collection",
  "update_collection",
  "set_collection_products",
  "delete_collection",
  "create_category",
  "update_category",
  "delete_category",
  "create_blog_post",
  "update_blog_post",
  "publish_blog_post",
  "unpublish_blog_post",
  "duplicate_blog_post",
  "delete_blog_post",
  "create_blog_category",
  "update_blog_category",
  "delete_blog_category",
  "create_page",
  "update_page",
  "set_page_block_props",
  "add_page_block",
  "move_page_block",
  "remove_page_block",
  "set_page_block_hidden",
  "publish_page",
  "unpublish_page",
  "delete_page",
  "create_menu",
  "update_menu",
  "delete_menu",
  "create_redirect",
  "update_redirect",
  "delete_redirect",
] as const;
