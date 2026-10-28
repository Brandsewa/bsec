/**
 * Storefront-side market reads (ADR-040): which markets a shopper can pick, a market's prices and catalog, and the
 * snapshot checkout works from. No permission checks here: these run for anonymous shoppers, always inside `withTenant`.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, type Db } from "@bs/db";
import { marketIdForCountry, type RoundingMode, type TaxRuleRow } from "./rules.ts";

export interface StorefrontMarket {
  id: string;
  name: string;
  handle: string;
  isBase: boolean;
  currency: string;
  locale: string | null;
  pathPrefix: string | null;
  unitSystem: "metric" | "imperial" | null;
  taxDisplay: "inclusive" | "exclusive";
  catalogMode: "all" | "selected";
  countries: string[];
}

/** The markets a shopper can see and switch to: the base market and every active market. */
export async function loadStorefrontMarkets(tx: Db, tenantId: string): Promise<StorefrontMarket[]> {
  const rows = await tx
    .select()
    .from(schema.markets)
    .where(and(eq(schema.markets.tenantId, tenantId), eq(schema.markets.status, "active")));
  if (rows.length === 0) return [];
  const cs = await tx.select().from(schema.marketCountries).where(eq(schema.marketCountries.tenantId, tenantId));
  return rows
    .map((m) => ({
      id: m.id,
      name: m.name,
      handle: m.handle,
      isBase: m.isBase,
      currency: m.currency,
      locale: m.locale,
      pathPrefix: m.pathPrefix,
      unitSystem: (m.unitSystem as StorefrontMarket["unitSystem"]) ?? null,
      taxDisplay: m.taxDisplay as StorefrontMarket["taxDisplay"],
      catalogMode: m.catalogMode as StorefrontMarket["catalogMode"],
      countries: cs.filter((c) => c.marketId === m.id).map((c) => c.country).sort(),
    }))
    .sort((a, b) => Number(b.isBase) - Number(a.isBase));
}

export interface MarketPick {
  /** The market to render and price in. */
  market: StorefrontMarket;
  /** A different market that fits the visitor's country better, offered as a banner (never applied silently). */
  suggestion: StorefrontMarket | null;
  source: "path" | "cookie" | "base";
}

/**
 * Chooses the market for a request (plan section 5): a URL prefix wins, then the shopper's saved choice, then the base
 * market. The visitor's country only ever produces a suggestion, so geography can never change a price by itself.
 */
export function pickMarket(
  markets: readonly StorefrontMarket[],
  input: { pathPrefix?: string | null | undefined; cookieHandle?: string | null | undefined; country?: string | null | undefined },
): MarketPick | null {
  const base = markets.find((m) => m.isBase);
  if (!base) return null;
  const byPrefix = input.pathPrefix ? markets.find((m) => m.pathPrefix === input.pathPrefix) : undefined;
  const byCookie = input.cookieHandle ? markets.find((m) => m.handle === input.cookieHandle) : undefined;
  const chosen = byPrefix ?? byCookie ?? base;
  const source: MarketPick["source"] = byPrefix ? "path" : byCookie ? "cookie" : "base";

  let suggestion: StorefrontMarket | null = null;
  if (!byPrefix && !byCookie && input.country) {
    const targetId = marketIdForCountry(
      markets.flatMap((m) => m.countries.map((country) => ({ marketId: m.id, country }))),
      input.country,
      base.id,
    );
    if (targetId !== chosen.id) suggestion = markets.find((m) => m.id === targetId) ?? null;
  }
  return { market: chosen, suggestion, source };
}

/** Prices of the given variants in a non-base market. Empty for the base market or null: those use the variant's own price. */
export async function loadMarketPriceMap(
  tx: Db,
  tenantId: string,
  marketId: string | null | undefined,
  variantIds: readonly string[],
): Promise<Map<string, { price: number; compareAtPrice: number | null }>> {
  const out = new Map<string, { price: number; compareAtPrice: number | null }>();
  if (!marketId || variantIds.length === 0) return out;
  const isBase = await tx
    .select({ isBase: schema.markets.isBase })
    .from(schema.markets)
    .where(and(eq(schema.markets.tenantId, tenantId), eq(schema.markets.id, marketId)))
    .limit(1);
  if (!isBase[0] || isBase[0].isBase) return out;
  const rows = await tx
    .select()
    .from(schema.marketPrices)
    .where(and(eq(schema.marketPrices.tenantId, tenantId), eq(schema.marketPrices.marketId, marketId), inArray(schema.marketPrices.variantId, [...variantIds])));
  for (const r of rows) out.set(r.variantId, { price: Number(r.price), compareAtPrice: r.compareAtPrice === null ? null : Number(r.compareAtPrice) });
  return out;
}

/** True when the market is not the base market (so prices must come from market_prices and the catalog may be filtered). */
export async function isNonBaseMarket(tx: Db, tenantId: string, marketId: string | null | undefined): Promise<boolean> {
  if (!marketId) return false;
  const [row] = await tx
    .select({ isBase: schema.markets.isBase })
    .from(schema.markets)
    .where(and(eq(schema.markets.tenantId, tenantId), eq(schema.markets.id, marketId)))
    .limit(1);
  return !!row && !row.isBase;
}

/** Product ids hidden in a market (catalog_mode 'all' with an unpublished row, or 'selected' without a published row). */
export function hiddenProductSql(tenantId: string, marketId: string | null | undefined, productIdColumn: unknown) {
  if (!marketId) return sql`false`;
  return sql`(
    (select m.catalog_mode from markets m where m.tenant_id = ${tenantId} and m.id = ${marketId}::uuid) = 'selected'
      and not exists (select 1 from market_products mp where mp.tenant_id = ${tenantId} and mp.market_id = ${marketId}::uuid and mp.product_id = ${productIdColumn} and mp.published)
    or exists (select 1 from market_products mp where mp.tenant_id = ${tenantId} and mp.market_id = ${marketId}::uuid and mp.product_id = ${productIdColumn} and not mp.published)
  )`;
}

export async function isProductVisibleInMarket(tx: Db, tenantId: string, marketId: string | null | undefined, productId: string): Promise<boolean> {
  if (!marketId) return true;
  const res = await tx.execute<{ hidden: boolean }>(sql`
    SELECT ((SELECT m.catalog_mode FROM markets m WHERE m.tenant_id = ${tenantId} AND m.id = ${marketId}::uuid) = 'selected'
              AND NOT EXISTS (SELECT 1 FROM market_products mp WHERE mp.tenant_id = ${tenantId} AND mp.market_id = ${marketId}::uuid AND mp.product_id = ${productId}::uuid AND mp.published)
            OR EXISTS (SELECT 1 FROM market_products mp WHERE mp.tenant_id = ${tenantId} AND mp.market_id = ${marketId}::uuid AND mp.product_id = ${productId}::uuid AND NOT mp.published)) AS hidden`);
  return res.rows[0]?.hidden !== true;
}

export interface CheckoutMarket {
  /** null only for a store that has no markets yet (legacy): it behaves as an India store in INR, exactly as before markets. */
  id: string | null;
  legacy: boolean;
  /** The merchant's own country (the tenant's country), used to judge which gateways can be offered. */
  merchantCountry: string;
  handle: string;
  name: string;
  isBase: boolean;
  currency: string;
  baseCurrency: string;
  fxRate: number | null;
  adjustBps: number;
  rounding: RoundingMode;
  countries: string[];
  taxCollect: boolean;
  taxShippingToo: boolean;
  pricesIncludeTax: boolean;
  taxRules: TaxRuleRow[];
  /** null = no per-market list (base market only): every active store payment method applies. */
  paymentProviders: string[] | null;
  policy: { text: string | null; returnSettings: unknown; cancellation: unknown } | null;
}

/** Everything checkout needs to know about the cart's market, read once. A missing marketId means the base market. */
export async function loadCheckoutMarket(tx: Db, tenantId: string, marketId: string | null | undefined): Promise<CheckoutMarket> {
  const all = await tx.select().from(schema.markets).where(eq(schema.markets.tenantId, tenantId));
  const base = all.find((m) => m.isBase);
  const [tenantRow] = await tx.select({ country: schema.tenants.country, currency: schema.tenants.currency }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  const merchantCountry = (tenantRow?.country ?? "IN").toUpperCase();
  if (!base) {
    const currency = (tenantRow?.currency ?? "INR").toUpperCase();
    return {
      id: null,
      legacy: true,
      merchantCountry,
      handle: merchantCountry.toLowerCase(),
      name: merchantCountry,
      isBase: true,
      currency,
      baseCurrency: currency,
      fxRate: null,
      adjustBps: 0,
      rounding: "none",
      countries: [],
      taxCollect: false,
      taxShippingToo: false,
      pricesIncludeTax: true,
      taxRules: [],
      paymentProviders: null,
      policy: null,
    };
  }
  const row = marketId ? all.find((m) => m.id === marketId) : base;
  if (!row) throw new Error("Bad Request: This region is no longer available. Please refresh the page.");
  if (!row.isBase && row.status !== "active") throw new Error("Bad Request: This region is no longer available. Please refresh the page.");

  const countries = (await tx.select().from(schema.marketCountries).where(and(eq(schema.marketCountries.tenantId, tenantId), eq(schema.marketCountries.marketId, row.id)))).map((c) => c.country);
  const rules = await tx
    .select()
    .from(schema.marketTaxRules)
    .where(and(eq(schema.marketTaxRules.tenantId, tenantId), eq(schema.marketTaxRules.marketId, row.id)))
    .orderBy(schema.marketTaxRules.sortOrder);
  const methods = await tx
    .select()
    .from(schema.marketPaymentMethods)
    .where(and(eq(schema.marketPaymentMethods.tenantId, tenantId), eq(schema.marketPaymentMethods.marketId, row.id)));
  const [policy] = await tx
    .select()
    .from(schema.marketPolicies)
    .where(and(eq(schema.marketPolicies.tenantId, tenantId), eq(schema.marketPolicies.marketId, row.id)))
    .limit(1);
  return {
    id: row.id,
    legacy: false,
    merchantCountry,
    handle: row.handle,
    name: row.name,
    isBase: row.isBase,
    currency: row.currency,
    baseCurrency: base.currency,
    fxRate: row.fxRate === null ? null : Number(row.fxRate),
    adjustBps: row.priceAdjustBps,
    rounding: row.rounding as RoundingMode,
    countries,
    taxCollect: row.taxCollect,
    taxShippingToo: row.taxShippingToo,
    pricesIncludeTax: row.taxDisplay === "inclusive",
    taxRules: rules.map((r) => ({ country: r.country, region: r.region, taxName: r.taxName, rateBps: r.rateBps })),
    paymentProviders: methods.length === 0 && row.isBase ? null : methods.filter((m) => m.enabled).map((m) => m.provider),
    policy: policy ? { text: policy.policyText, returnSettings: policy.returnSettings, cancellation: policy.cancellation } : null,
  };
}

/** The charged amount's equivalent in the store base currency at the rate used (the margin is not undone). */
export function toBaseCurrencyAmount(amountMinor: number, fxRate: number | null, targetExp: number, baseExp: number): number {
  if (!fxRate || fxRate <= 0) return amountMinor;
  return Math.round((amountMinor / 10 ** targetExp / fxRate) * 10 ** baseExp);
}
