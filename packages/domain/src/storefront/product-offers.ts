import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { formatMoney } from "@bs/contracts/money";
import { parseDiscountEligibility, parseDiscountRules, type DiscountAppliesTo } from "@bs/contracts/discount-rules";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";
import { collectionIdsByProduct } from "../discounts/scope.ts";

/** An automatic buy-x-get-y offer worth telling the shopper about on a product page. */
export interface StorefrontProductOffer {
  id: string;
  /** What the merchant called it. */
  name: string;
  /** "Buy 2 Get 1 Free", "Spend ₹2,000, get Dalle free". */
  headline: string;
  /** The free items are added to the cart by themselves. */
  autoAdd: boolean;
}

const scopeIncludes = (scope: DiscountAppliesTo, productId: string, collections: string[]): boolean =>
  scope.type === "all" || (scope.type === "products" ? scope.productIds.includes(productId) : scope.collectionIds.some((c) => collections.includes(c)));

/**
 * The automatic buy-x-get-y offers a shopper can earn on this product (it is one of the items to buy), worded for the product
 * page. Only offers that apply by themselves (no code, for everyone), are active now and not used up. Public data: never a
 * usage count or an audience rule.
 */
export async function getStorefrontProductOffers(rt: Runtime, ctx: TenantContext, productId: string, currency = "INR"): Promise<StorefrontProductOffer[]> {
  const now = new Date();
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.discounts)
      .where(
        and(
          eq(schema.discounts.tenantId, ctx.tenantId),
          eq(schema.discounts.type, "buy_x_get_y"),
          eq(schema.discounts.status, "active"),
          isNull(schema.discounts.code),
          eq(schema.discounts.usesCodeList, false),
          or(isNull(schema.discounts.startsAt), lte(schema.discounts.startsAt, now)),
          or(isNull(schema.discounts.endsAt), gt(schema.discounts.endsAt, now)),
          or(isNull(schema.discounts.usageLimit), sql`${schema.discounts.usedCount} < ${schema.discounts.usageLimit}`),
        ),
      )
      .orderBy(schema.discounts.createdAt)
      .limit(20);
    const offers = rows.flatMap((d) => {
      const b = parseDiscountRules(d.rules).bxgy;
      return b && parseDiscountEligibility(d.customerEligibility)?.type === "all" ? [{ d, b }] : [];
    });
    if (offers.length === 0) return [];

    const wanted = offers.flatMap(({ b }) => (b.buy.appliesTo.type === "collections" ? b.buy.appliesTo.collectionIds : []));
    const inCollections = (await collectionIdsByProduct(tx, ctx.tenantId, [productId], [...new Set(wanted)])).get(productId) ?? [];

    // The gift's name, for "spend X, get <gift> free".
    const giftIds = offers.flatMap(({ b }) => (b.buy.trigger === "amount" && b.get.appliesTo.type === "products" ? b.get.appliesTo.productIds.slice(0, 1) : []));
    const titles = new Map<string, string>();
    if (giftIds.length > 0) {
      const found = await tx.select({ id: schema.products.id, title: schema.products.title }).from(schema.products).where(and(eq(schema.products.tenantId, ctx.tenantId), inArray(schema.products.id, giftIds)));
      for (const p of found) titles.set(p.id, p.title);
    }

    return offers
      .filter(({ b }) => scopeIncludes(b.buy.appliesTo, productId, inCollections))
      .map(({ d, b }) => {
        const what = b.get.effect === "free" ? "Free" : b.get.effect === "percent" ? `at ${b.get.value ?? 0}% off` : `at ${formatMoney(b.get.value ?? 0, currency)}`;
        const gift = b.get.appliesTo.type === "products" ? titles.get(b.get.appliesTo.productIds[0] ?? "") : undefined;
        const headline =
          b.buy.trigger === "amount"
            ? `Spend ${formatMoney(b.buy.value, currency)}, get ${gift ?? `${b.get.quantity} item${b.get.quantity === 1 ? "" : "s"}`} ${b.get.effect === "free" ? "free" : what}`
            : `Buy ${b.buy.value} Get ${b.get.quantity} ${what}`;
        return { id: d.id, name: d.title, headline, autoAdd: b.get.effect === "free" && (b.autoAdd ?? true) };
      });
  });
}
