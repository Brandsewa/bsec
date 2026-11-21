/**
 * Merchant-listing structured data for a product page (docs/SEO-GEO-AEO-PLAN.md Phase 2): the store's return policy, its shipping
 * rates and its published reviews, in the shapes Google reads for Product offers. Everything is built from what the merchant
 * already configured (Settings > Returns, Settings > Shipping, the Reviews inbox); nothing is invented, and a store that has not
 * configured something simply publishes nothing for it. Read-only: no zone is created and no courier is called (AGENTS rule 14).
 */
import { and, eq, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { toMajorUnits } from "@bs/contracts/money";
import type { Runtime } from "../runtime.ts";
import { parseReturnSettings } from "../admin/return-settings.ts";
import { calculateRateFromRule } from "../orders/shipping-rates.ts";
import { pickShippingZone } from "../orders/shipping-rules.ts";
import { getStorefrontReviews } from "../review-services.ts";

type Json = Record<string, unknown>;

export interface StorefrontReturnPolicy {
  acceptReturns: boolean;
  returnWindowDays: number;
  /** ISO country the policy applies to (the store's country). */
  country: string;
}

export interface StorefrontShippingRate {
  name: string;
  method: string;
  rateType: string;
  pricePaise: number;
  thresholdPaise: number | null;
  minSubtotalPaise: number | null;
  maxSubtotalPaise: number | null;
  minWeightGrams: number | null;
  maxWeightGrams: number | null;
  minDays: number | null;
  maxDays: number | null;
}

export interface StorefrontShippingRules {
  /** Whole-country zone the rates serve (the store's default zone). */
  countries: string[];
  rates: StorefrontShippingRate[];
}

export interface StorefrontReviewForSchema {
  author: string;
  rating: number;
  title: string | null;
  body: string;
  createdAt: string;
}

export interface StorefrontOfferExtras {
  returnPolicy?: StorefrontReturnPolicy | undefined;
  shipping?: StorefrontShippingRules | undefined;
  reviews?: StorefrontReviewForSchema[] | undefined;
}

/** The store's return policy as schema.org needs it, or null when the country is unknown (Google requires one). */
export function buildMerchantReturnPolicyJsonLd(policy: StorefrontReturnPolicy | null | undefined): Json | null {
  if (!policy || !/^[A-Z]{2}$/.test(policy.country)) return null;
  const base = { "@type": "MerchantReturnPolicy", applicableCountry: policy.country };
  if (!policy.acceptReturns) return { ...base, returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted" };
  return {
    ...base,
    returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
    merchantReturnDays: policy.returnWindowDays,
  };
}

/**
 * Shipping options for one price and weight, one OfferShippingDetails per method (the cheapest rule that applies), using the same
 * rule engine as checkout so the page never promises a different price. Weight-based rules are left out when the weight is unknown.
 */
export function buildShippingDetailsJsonLd(
  rules: StorefrontShippingRules | null | undefined,
  input: { subtotalPaise: number; weightGrams?: number | null | undefined; currency: string },
): Json[] {
  if (!rules || rules.countries.length === 0 || rules.rates.length === 0) return [];
  const weightKnown = input.weightGrams != null && input.weightGrams > 0;
  const offered = new Map<string, ReturnType<typeof calculateRateFromRule> & { minDays: number | null; maxDays: number | null }>();
  for (const rate of rules.rates) {
    if (rate.rateType === "weight_tier" && !weightKnown) continue;
    const calc = calculateRateFromRule(rate, input.subtotalPaise, input.weightGrams ?? 0, input.currency);
    if (!calc.applicable) continue;
    const prev = offered.get(calc.method);
    if (!prev || calc.amount < prev.amount) offered.set(calc.method, { ...calc, minDays: rate.minDays, maxDays: rate.maxDays });
  }
  return [...offered.values()].map((o) => ({
    "@type": "OfferShippingDetails",
    shippingLabel: o.title,
    shippingRate: { "@type": "MonetaryAmount", value: toMajorUnits(o.amount, input.currency), currency: input.currency },
    shippingDestination: rules.countries.map((c) => ({ "@type": "DefinedRegion", addressCountry: c })),
    ...(o.minDays && o.maxDays
      ? { deliveryTime: { "@type": "ShippingDeliveryTime", transitTime: { "@type": "QuantitativeValue", minValue: o.minDays, maxValue: o.maxDays, unitCode: "DAY" } } }
      : {}),
  }));
}

/** Up to five newest published reviews as schema.org Review objects (the first ones a shopper sees on the page). */
export function buildReviewsJsonLd(reviews: StorefrontReviewForSchema[] | undefined): Json[] {
  return (reviews ?? []).slice(0, 5).map((r) => ({
    "@type": "Review",
    author: { "@type": "Person", name: r.author },
    datePublished: r.createdAt.slice(0, 10),
    reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5, worstRating: 1 },
    ...(r.title ? { name: r.title } : {}),
    reviewBody: r.body,
  }));
}

/** Store country and return settings for the return policy. */
export async function getStorefrontReturnPolicy(rt: Runtime, tenantId: string): Promise<StorefrontReturnPolicy | undefined> {
  return withTenant(rt._db.db, tenantId, async (tx) => {
    const [row] = await tx.select({ returnSettings: schema.storeSettings.returnSettings }).from(schema.storeSettings).where(eq(schema.storeSettings.tenantId, tenantId)).limit(1);
    const [tenant] = await tx.select({ country: schema.tenants.country }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
    const country = (tenant?.country ?? "").toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) return undefined;
    const s = parseReturnSettings(row?.returnSettings);
    return { acceptReturns: s.acceptReturns, returnWindowDays: s.returnWindowDays, country };
  });
}

/**
 * The default shipping zone's rates for a market, read without creating anything. A zone limited to some states is not
 * published (its destination would be wrong), and neither is a market with no zone: we say nothing rather than guess.
 */
export async function getStorefrontShippingRules(rt: Runtime, tenantId: string, market?: { id: string; isBase: boolean } | undefined): Promise<StorefrontShippingRules | undefined> {
  return withTenant(rt._db.db, tenantId, async (tx) => {
    const zones = await tx
      .select()
      .from(schema.shippingZones)
      .where(
        market
          ? and(
              eq(schema.shippingZones.tenantId, tenantId),
              market.isBase ? sql`(${schema.shippingZones.marketId} = ${market.id} OR ${schema.shippingZones.marketId} IS NULL)` : eq(schema.shippingZones.marketId, market.id),
            )
          : eq(schema.shippingZones.tenantId, tenantId),
      )
      .orderBy(sql`${schema.shippingZones.isDefault} DESC, ${schema.shippingZones.createdAt} ASC`);
    const zone = pickShippingZone(zones, undefined);
    if (!zone || (zone.states ?? []).length > 0) return undefined;
    const rows = await tx
      .select()
      .from(schema.shippingRates)
      .where(and(eq(schema.shippingRates.tenantId, tenantId), eq(schema.shippingRates.zoneId, zone.id)))
      .orderBy(schema.shippingRates.createdAt);
    if (rows.length === 0 || zone.countries.length === 0) return undefined;
    return {
      countries: zone.countries.map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)),
      rates: rows.map((r) => ({
        name: r.name,
        method: r.method,
        rateType: r.rateType,
        pricePaise: r.pricePaise,
        thresholdPaise: r.thresholdPaise,
        minSubtotalPaise: r.minSubtotalPaise,
        maxSubtotalPaise: r.maxSubtotalPaise,
        minWeightGrams: r.minWeightGrams,
        maxWeightGrams: r.maxWeightGrams,
        minDays: r.minDays,
        maxDays: r.maxDays,
      })),
    };
  });
}

/** Everything a product page needs for merchant-listing schema, each part optional and failing on its own. */
export async function getStorefrontOfferExtras(
  rt: Runtime,
  tenantId: string,
  opts: { productId: string; market?: { id: string; isBase: boolean } | undefined },
): Promise<StorefrontOfferExtras> {
  const [returnPolicy, shipping, reviews] = await Promise.all([
    getStorefrontReturnPolicy(rt, tenantId).catch(() => undefined),
    getStorefrontShippingRules(rt, tenantId, opts.market).catch(() => undefined),
    getStorefrontReviews(rt, tenantId, { productId: opts.productId, limit: 5 })
      .then((r) => r.items.map((i) => ({ author: i.reviewerName, rating: i.rating, title: i.title, body: i.body, createdAt: i.createdAt })))
      .catch(() => undefined),
  ]);
  return { returnPolicy, shipping, reviews };
}
