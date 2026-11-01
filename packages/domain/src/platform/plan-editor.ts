import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { schema, type Db } from "@bs/db";
import { PLAN_LIMIT_KEYS, type PlanCell, type PlanCompareRowInput, type PlanEditorView, type PlanLimitKey, type PlanUpdateInput } from "@bs/contracts";
import type { Runtime } from "../runtime.ts";
import { writePlatformAudit, type AuditMeta } from "../platform-services.ts";
import { TIER_FOR_PLAN, tierForPlan } from "../saas/plan-tiers.ts";
import { updatePlatformQuotaLimits } from "./quotas.ts";

/** Limits that live in the size-tier table (enforced per tier). `max_extra_markets` is read from the plan row instead. */
const TIER_LIMIT_KEYS = PLAN_LIMIT_KEYS.filter((k) => k !== "max_extra_markets");

function planJson(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** The limits that are actually enforced for every plan, keyed by plan code. */
export async function loadEnforcedPlanLimits(
  db: Db,
  plans: Array<{ code: string; limits: unknown }>,
): Promise<Map<string, Record<string, number>>> {
  const tiers = [...new Set(plans.map((p) => tierForPlan(p.code)))];
  const rows = tiers.length
    ? await db
        .select({ tierCode: schema.quotaTierLimits.tierCode, quotaKey: schema.quotaTierLimits.quotaKey, value: schema.quotaTierLimits.value })
        .from(schema.quotaTierLimits)
        .where(and(inArray(schema.quotaTierLimits.tierCode, tiers), inArray(schema.quotaTierLimits.quotaKey, [...TIER_LIMIT_KEYS])))
    : [];
  const byTier = new Map<string, Record<string, number>>();
  for (const r of rows) byTier.set(r.tierCode, { ...(byTier.get(r.tierCode) ?? {}), [r.quotaKey]: r.value });
  const out = new Map<string, Record<string, number>>();
  for (const p of plans) {
    const limits = { ...(byTier.get(tierForPlan(p.code)) ?? {}) };
    const extra = planJson(p.limits).max_extra_markets;
    if (typeof extra === "number") limits.max_extra_markets = extra;
    out.set(p.code, limits);
  }
  return out;
}

export async function getPlanEditor(rt: Runtime): Promise<PlanEditorView> {
  const plans = await rt._db.db.select().from(schema.plans).orderBy(asc(schema.plans.sort));
  const counts = await rt._db.db
    .select({ planId: schema.subscriptions.planId, count: sql<number>`count(*)::int` })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.status, "active"))
    .groupBy(schema.subscriptions.planId);
  const countMap = new Map(counts.map((c) => [c.planId, c.count]));
  const limits = await loadEnforcedPlanLimits(rt._db.db, plans);
  const rows = await rt._db.db.select().from(schema.planCompareRows).orderBy(asc(schema.planCompareRows.sort), asc(schema.planCompareRows.createdAt));

  return {
    plans: plans.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      tagline: p.tagline,
      audience: p.audience,
      badge: p.badge,
      cardBullets: (Array.isArray(p.cardBullets) ? p.cardBullets : []) as PlanEditorView["plans"][number]["cardBullets"],
      priceMonthlyPaise: Number(p.priceMonthlyPaise),
      priceYearlyPaise: Number(p.priceYearlyPaise),
      priceMonthlyUsdCents: p.priceMonthlyUsdCents !== null ? Number(p.priceMonthlyUsdCents) : null,
      priceYearlyUsdCents: p.priceYearlyUsdCents !== null ? Number(p.priceYearlyUsdCents) : null,
      isPublic: p.isPublic,
      sort: p.sort,
      tier: tierForPlan(p.code),
      limits: limits.get(p.code) ?? {},
      activeSubscribersCount: countMap.get(p.id) ?? 0,
    })),
    compareRows: rows.map((r) => ({
      id: r.id,
      groupName: r.groupName,
      label: r.label,
      tooltip: r.tooltip,
      limitKey: (PLAN_LIMIT_KEYS as readonly string[]).includes(r.limitKey ?? "") ? (r.limitKey as PlanLimitKey) : null,
      cells: planJson(r.cells) as Record<string, PlanCell>,
      sort: r.sort,
      isVisible: r.isVisible,
    })),
  };
}

/**
 * Edits a plan: prices, customer-facing copy and enforced limits. Limits are written to the plan's size tier, which is what
 * quota enforcement reads, and mirrored into `plans.limits`; existing stores keep what they already have (an extra market
 * already added is never removed by lowering the limit). Returns whether a price changed, so the editor can prompt for a
 * gateway plan sync (gateway plans cannot be edited).
 */
export async function updatePlan(
  rt: Runtime,
  platformStaffUserId: string | undefined,
  input: PlanUpdateInput,
  meta?: AuditMeta,
): Promise<{ ok: true; priceChanged: boolean }> {
  const [plan] = await rt._db.db.select().from(schema.plans).where(eq(schema.plans.code, input.code)).limit(1);
  if (!plan) throw new Error("Not Found: plan not found");

  if (input.limits) {
    // A plan with no size tier of its own would write to the shared default tier and change every other plan's limits.
    if (!(plan.code in TIER_FOR_PLAN)) throw new Error("Bad Request: this plan has no size tier of its own, so its limits cannot be edited here.");
    const tierUpdates = Object.entries(input.limits)
      .filter(([k]) => k !== "max_extra_markets")
      .map(([quotaKey, value]) => ({ tierCode: tierForPlan(plan.code), quotaKey, value: value as number }));
    if (tierUpdates.length) await updatePlatformQuotaLimits(rt, platformStaffUserId, { updates: tierUpdates }, meta);
  }

  const priceChanged =
    (input.priceMonthlyPaise !== undefined && input.priceMonthlyPaise !== Number(plan.priceMonthlyPaise)) ||
    (input.priceYearlyPaise !== undefined && input.priceYearlyPaise !== Number(plan.priceYearlyPaise)) ||
    (input.priceMonthlyUsdCents !== undefined && input.priceMonthlyUsdCents !== (plan.priceMonthlyUsdCents === null ? null : Number(plan.priceMonthlyUsdCents))) ||
    (input.priceYearlyUsdCents !== undefined && input.priceYearlyUsdCents !== (plan.priceYearlyUsdCents === null ? null : Number(plan.priceYearlyUsdCents)));

  await rt._db.db.transaction(async (tx) => {
    const set: Partial<typeof schema.plans.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) set.name = input.name;
    if (input.tagline !== undefined) set.tagline = input.tagline || null;
    if (input.audience !== undefined) set.audience = input.audience || null;
    if (input.badge !== undefined) set.badge = input.badge || null;
    if (input.cardBullets !== undefined) set.cardBullets = input.cardBullets;
    if (input.priceMonthlyPaise !== undefined) set.priceMonthlyPaise = input.priceMonthlyPaise;
    if (input.priceYearlyPaise !== undefined) set.priceYearlyPaise = input.priceYearlyPaise;
    if (input.priceMonthlyUsdCents !== undefined) set.priceMonthlyUsdCents = input.priceMonthlyUsdCents;
    if (input.priceYearlyUsdCents !== undefined) set.priceYearlyUsdCents = input.priceYearlyUsdCents;
    if (input.isPublic !== undefined) set.isPublic = input.isPublic;
    if (input.limits) set.limits = { ...planJson(plan.limits), ...input.limits };
    await tx.update(schema.plans).set(set).where(eq(schema.plans.id, plan.id));

    // Prices and limits are what a plan is worth, so the change is audited with before and after values.
    await writePlatformAudit(
      tx,
      platformStaffUserId,
      "plan.update",
      "plan",
      plan.id,
      null,
      {
        code: plan.code,
        changed: Object.keys(input).filter((k) => k !== "code"),
        before: {
          priceMonthlyPaise: Number(plan.priceMonthlyPaise),
          priceYearlyPaise: Number(plan.priceYearlyPaise),
          priceMonthlyUsdCents: plan.priceMonthlyUsdCents,
          priceYearlyUsdCents: plan.priceYearlyUsdCents,
          limits: planJson(plan.limits),
        },
        after: input,
      },
      meta,
    );
  });
  return { ok: true, priceChanged };
}

/** Replaces the whole compare table with the rows the editor sends, in the order sent. */
export async function savePlanCompareRows(
  rt: Runtime,
  platformStaffUserId: string | undefined,
  rows: PlanCompareRowInput[],
  meta?: AuditMeta,
): Promise<{ ok: true; count: number }> {
  await rt._db.db.transaction(async (tx) => {
    await tx.delete(schema.planCompareRows);
    if (rows.length) {
      await tx.insert(schema.planCompareRows).values(
        rows.map((r, i) => ({
          groupName: r.groupName,
          label: r.label,
          tooltip: r.tooltip || null,
          limitKey: r.limitKey ?? null,
          cells: r.cells,
          sort: (i + 1) * 10,
          isVisible: r.isVisible,
        })),
      );
    }
    await writePlatformAudit(tx, platformStaffUserId, "plan.compare_table.update", "plan_compare_rows", "all", null, { rows: rows.length }, meta);
  });
  return { ok: true, count: rows.length };
}
