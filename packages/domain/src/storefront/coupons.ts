import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";

/** What a shopper may see about a coupon: the code and what it gives, never usage counts or customer rules. */
export interface StorefrontCoupon {
  code: string;
  title: string;
  /** "20% off", "₹100 off", "Free shipping". */
  benefit: string;
  /** "On orders over ₹999", or an empty string. */
  condition: string;
  endsAt: string | null;
}

const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * The coupons a store chose to show (Discount > "Show on the storefront"): active, started, not ended, not used up, with a code.
 * Customer-specific discounts are never listed.
 */
export async function getStorefrontCoupons(rt: Runtime, ctx: TenantContext): Promise<StorefrontCoupon[]> {
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
    return rows.map((d) => ({
      code: d.code as string,
      title: d.title,
      benefit: d.type === "percent" ? `${d.value}% off` : d.type === "fixed" ? `${inr(d.value)} off` : d.type === "free_shipping" ? "Free shipping" : "Special offer",
      condition: d.minSubtotal && d.minSubtotal > 0 ? `On orders over ${inr(d.minSubtotal)}` : "",
      endsAt: d.endsAt ? d.endsAt.toISOString() : null,
    }));
  });
}
