import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { formatMoney } from "@bs/contracts/money";
import { parseDiscountAppliesTo, parseDiscountRules } from "@bs/contracts/discount-rules";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";
import { collectionIdsByProduct } from "../discounts/scope.ts";

/** What a shopper may see about a coupon: the code and what it gives, never usage counts or customer rules. */
export interface StorefrontCoupon {
  /** Empty for an offer that applies by itself (no code to type). */
  code: string;
  title: string;
  /** "20% off", "₹100 off", "Free shipping". */
  benefit: string;
  /** "On orders over ₹999", or an empty string. */
  condition: string;
  endsAt: string | null;
  /** The offer applies by itself, so the card says so instead of showing a code. */
  automatic?: boolean | undefined;
  /** For the product it was fetched for: it is made for this product (or the whole store), so it is listed first. */
  appliesHere?: boolean | undefined;
}

/**
 * The coupons a store chose to show (Discount > "Show on the storefront"): active, started, not ended, not used up, with a code.
 * Customer-specific discounts are never listed. With a product, a coupon limited to other products or collections is left out.
 */
export async function getStorefrontCoupons(rt: Runtime, ctx: TenantContext, currency = "INR", productId?: string): Promise<StorefrontCoupon[]> {
  const now = new Date();
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.discounts)
      .where(
        and(
          eq(schema.discounts.tenantId, ctx.tenantId),
          eq(schema.discounts.status, "active"),
          eq(schema.discounts.showOnStorefront, true),
          sql`${schema.discounts.code} IS NOT NULL`,
          or(isNull(schema.discounts.startsAt), lte(schema.discounts.startsAt, now)),
          or(isNull(schema.discounts.endsAt), gt(schema.discounts.endsAt, now)),
          or(isNull(schema.discounts.usageLimit), sql`${schema.discounts.usedCount} < ${schema.discounts.usageLimit}`),
          sql`${schema.discounts.customerEligibility}->>'type' = 'all'`,
        ),
      )
      .orderBy(asc(schema.discounts.createdAt))
      .limit(50);
    // A coupon limited to chosen products or collections is shown only on the products it applies to.
    const wanted = rows.flatMap((d) => {
      const scope = parseDiscountAppliesTo(d.appliesTo);
      return scope?.type === "collections" ? scope.collectionIds : [];
    });
    const inCollections = productId ? (await collectionIdsByProduct(tx, ctx.tenantId, [productId], [...new Set(wanted)])).get(productId) ?? [] : [];
    // Every coupon is listed; the ones made for this product (or for everything) come first, the rest follow in the full list.
    const isHere = (d: (typeof rows)[number]) => {
      const scope = parseDiscountAppliesTo(d.appliesTo);
      if (!scope) return null; // a scope this version does not understand is never advertised
      if (scope.type === "all" || !productId) return true;
      return scope.type === "products" ? scope.productIds.includes(productId) : scope.collectionIds.some((c) => inCollections.includes(c));
    };
    const shown = rows.flatMap((d) => {
      const here = isHere(d);
      return here === null ? [] : [{ d, here }];
    });
    shown.sort((x, y) => Number(y.here) - Number(x.here));
    return shown.map(({ d, here }) => {
      const scope = parseDiscountAppliesTo(d.appliesTo);
      const cap = parseDiscountRules(d.rules).maxDiscount;
      const conditions = [
        d.minSubtotal && d.minSubtotal > 0 ? `On orders over ${formatMoney(d.minSubtotal, currency)}` : "",
        scope && scope.type !== "all" && !productId ? "On selected items" : "",
      ].filter(Boolean);
      return {
        code: d.code as string,
        title: d.title,
        benefit:
          d.type === "percent"
            ? `${d.value}% off${cap ? ` (up to ${formatMoney(cap, currency)})` : ""}`
            : d.type === "fixed"
              ? `${formatMoney(d.value, currency)} off`
              : d.type === "free_shipping"
                ? "Free shipping"
                : "Special offer",
        condition: conditions.join(". "),
        endsAt: d.endsAt ? d.endsAt.toISOString() : null,
        appliesHere: here,
      };
    });
  });
}
