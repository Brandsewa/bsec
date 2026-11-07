import { z } from "zod";

/**
 * What a discount applies to (ADR-045). `all` is the whole order; the other two scope it to the products in the cart that
 * match. Stored in `discounts.applies_to`; a row written before this existed holds `{"type":"all"}`.
 */
export const DiscountAppliesTo = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all") }),
  z.object({ type: z.literal("products"), productIds: z.array(z.string().uuid()).min(1).max(500) }),
  z.object({ type: z.literal("collections"), collectionIds: z.array(z.string().uuid()).min(1).max(100) }),
]);
export type DiscountAppliesTo = z.infer<typeof DiscountAppliesTo>;

/**
 * The extras a discount can carry, versioned so the shape can grow without a migration (ADR-045). Every field is
 * optional; `{}` is a plain discount. Amounts are minor units.
 */
export const DiscountRules = z.object({
  /** "20% off, up to ₹500": the most a percent discount can take off. */
  maxDiscount: z.number().int().min(1).optional(),
  /** Leave out items that already show a compare-at (sale) price. */
  excludeOnSale: z.boolean().optional(),
  /** For a fixed amount on products: take it off once for the whole order instead of once per item. */
  oncePerOrder: z.boolean().optional(),
});
export type DiscountRules = z.infer<typeof DiscountRules>;

/** Reads a stored value defensively: anything that does not parse is treated as "no extras" / "the whole order". */
export function parseDiscountRules(raw: unknown): DiscountRules {
  const r = DiscountRules.safeParse(raw ?? {});
  return r.success ? r.data : {};
}

/** null means the stored value is not a scope this version understands: the engine refuses it rather than discounting the whole order. */
export function parseDiscountAppliesTo(raw: unknown): DiscountAppliesTo | null {
  const r = DiscountAppliesTo.safeParse(raw ?? { type: "all" });
  return r.success ? r.data : null;
}
