import { z } from "zod";

/**
 * What a merchant sees about a plan (Super Admin edits it, signup and Plan and billing render it). Numbers that are
 * limits are never typed into copy: a bullet or comparison row links to a limit key and the renderer prints the value
 * that is actually enforced, so the screen and the quota cannot drift apart.
 */
export const PLAN_LIMIT_KEYS = ["products", "variants", "staff_seats", "storage_mb", "emails_month", "custom_domains", "max_extra_markets"] as const;
export type PlanLimitKey = (typeof PLAN_LIMIT_KEYS)[number];

export const PLAN_LIMIT_LABELS: Record<PlanLimitKey, string> = {
  products: "Products",
  variants: "Variants",
  staff_seats: "Staff accounts",
  storage_mb: "Media storage",
  emails_month: "Emails per month",
  custom_domains: "Custom domains",
  max_extra_markets: "Extra markets",
};

export const PlanLimitKeySchema = z.enum(PLAN_LIMIT_KEYS);

/** One line on a plan card. `{value}` in `t` is replaced by the enforced limit named in `k`. */
export const PlanBullet = z.object({ t: z.string().trim().min(1).max(160), k: PlanLimitKeySchema.optional() });
export type PlanBullet = z.infer<typeof PlanBullet>;

export const PlanCellKind = z.enum(["tick", "none", "text", "soon"]);
export const PlanCell = z.object({ k: PlanCellKind, t: z.string().trim().max(80).optional() });
export type PlanCell = z.infer<typeof PlanCell>;

export type PlanLimitValues = Partial<Record<PlanLimitKey, number>>;

const THOUSANDS = new Intl.NumberFormat("en-US");

/** A limit as customers read it ("5,000", "25 GB", "Home market only"). */
export function formatPlanLimit(key: PlanLimitKey, value: number): string {
  if (key === "storage_mb") return value >= 1024 ? `${THOUSANDS.format(Math.round(value / 1024))} GB` : `${THOUSANDS.format(value)} MB`;
  if (key === "max_extra_markets" && value <= 0) return "Home market only";
  return THOUSANDS.format(value);
}

/** The text of a card bullet with its linked limit filled in. A link to a limit that has no value renders without the line. */
export function renderPlanBullet(bullet: PlanBullet, limits: PlanLimitValues): string | null {
  if (!bullet.k) return bullet.t;
  const value = limits[bullet.k];
  if (value === undefined) return null;
  // 0 extra markets reads as a sentence of its own, never "0 extra markets".
  if (bullet.k === "max_extra_markets" && value <= 0) return "Sell in your home market";
  return bullet.t.replaceAll("{value}", formatPlanLimit(bullet.k, value));
}

/** What a comparison row shows for one plan: a limit row prints the enforced value, any other row its saved cell. */
export function renderCompareCell(
  row: { limitKey: string | null; cells: Record<string, PlanCell> },
  planCode: string,
  limits: PlanLimitValues,
): PlanCell {
  const key = PlanLimitKeySchema.safeParse(row.limitKey);
  if (key.success) {
    const value = limits[key.data];
    return value === undefined ? { k: "none" } : { k: "text", t: formatPlanLimit(key.data, value) };
  }
  return row.cells[planCode] ?? { k: "none" };
}

export const PlanCompareRowView = z.object({
  id: z.string(),
  groupName: z.string(),
  label: z.string(),
  tooltip: z.string().nullable(),
  limitKey: PlanLimitKeySchema.nullable(),
  cells: z.record(z.string(), PlanCell),
  sort: z.number().int(),
  isVisible: z.boolean(),
});
export type PlanCompareRowView = z.infer<typeof PlanCompareRowView>;

export const PlanCompareRowInput = z.object({
  groupName: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(120),
  tooltip: z.string().trim().max(240).nullable().optional(),
  limitKey: PlanLimitKeySchema.nullable().optional(),
  cells: z.record(z.string().max(40), PlanCell),
  isVisible: z.boolean().default(true),
});
export type PlanCompareRowInput = z.infer<typeof PlanCompareRowInput>;

/** A plan as the Super Admin editor reads and writes it. */
export const PlanEditorPlan = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  tagline: z.string().nullable(),
  audience: z.string().nullable(),
  badge: z.string().nullable(),
  cardBullets: z.array(PlanBullet),
  priceMonthlyPaise: z.number(),
  priceYearlyPaise: z.number(),
  priceMonthlyUsdCents: z.number().nullable(),
  priceYearlyUsdCents: z.number().nullable(),
  isPublic: z.boolean(),
  sort: z.number().int(),
  /** The size tier whose quotas this plan enforces ("S", "M" or "L"). */
  tier: z.string(),
  limits: z.record(z.string(), z.number()),
  activeSubscribersCount: z.number(),
});
export type PlanEditorPlan = z.infer<typeof PlanEditorPlan>;

export const PlanEditorView = z.object({
  plans: z.array(PlanEditorPlan),
  compareRows: z.array(PlanCompareRowView),
});
export type PlanEditorView = z.infer<typeof PlanEditorView>;

export const PlanUpdateInput = z.object({
  code: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(60).optional(),
  tagline: z.string().trim().max(120).nullable().optional(),
  audience: z.string().trim().max(120).nullable().optional(),
  badge: z.string().trim().max(30).nullable().optional(),
  cardBullets: z.array(PlanBullet).max(16).optional(),
  priceMonthlyPaise: z.number().int().min(0).max(100_000_000).optional(),
  priceYearlyPaise: z.number().int().min(0).max(1_000_000_000).optional(),
  priceMonthlyUsdCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  priceYearlyUsdCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  isPublic: z.boolean().optional(),
  /** Enforced limits for this plan: written to its size tier, so the change takes effect for every store on the plan. */
  limits: z.partialRecord(PlanLimitKeySchema, z.number().int().min(0).max(1_000_000_000)).optional(),
});
export type PlanUpdateInput = z.infer<typeof PlanUpdateInput>;

/** What signup and Plan and billing show, already rendered: no limit lookup is left for the page to do. */
export const PublicPlanContent = z.object({
  code: z.string(),
  name: z.string(),
  tagline: z.string().nullable(),
  audience: z.string().nullable(),
  badge: z.string().nullable(),
  bullets: z.array(z.string()),
});
export type PublicPlanContent = z.infer<typeof PublicPlanContent>;

export const PublicPlanCompareGroup = z.object({
  groupName: z.string(),
  rows: z.array(
    z.object({
      label: z.string(),
      tooltip: z.string().nullable(),
      cells: z.record(z.string(), PlanCell),
    }),
  ),
});
export type PublicPlanCompareGroup = z.infer<typeof PublicPlanCompareGroup>;
