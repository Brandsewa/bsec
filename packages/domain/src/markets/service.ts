/**
 * Markets admin service (ADR-040, docs/MULTIMARKET-PLAN.md). Every mutation checks `markets.manage`, runs in
 * `withTenant`, writes an audit row and invalidates the tenant's storefront cache.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import { LAUNCH_CURRENCIES, normalizeCurrency } from "@bs/contracts/money";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { invalidateCache } from "../cache-invalidation.ts";
import { gatewayCurrencyCheck } from "./gateways.ts";
import {
  ROUNDING_MODES,
  canAddMarket,
  derivePrice,
  isValidPathPrefix,
  marketReadiness,
  slugifyHandle,
  type ReadinessItem,
  type RoundingMode,
  type TaxRuleRow,
} from "./rules.ts";

export interface MarketRecord {
  id: string;
  name: string;
  handle: string;
  isBase: boolean;
  status: "draft" | "active" | "disabled";
  currency: string;
  unitSystem: "metric" | "imperial" | null;
  fxRate: number | null;
  priceAdjustBps: number;
  rounding: RoundingMode;
  taxDisplay: "inclusive" | "exclusive";
  pathPrefix: string | null;
  catalogMode: "all" | "selected";
  locale: string | null;
  taxCollect: boolean;
  taxShippingToo: boolean;
  complianceAckAt: string | null;
  countries: string[];
}

export interface MarketPaymentMethodRecord {
  provider: string;
  enabled: boolean;
  sortOrder: number;
  blocking: string | null;
  warning: string | null;
}

export interface MarketPolicyRecord {
  returnSettings: Record<string, unknown> | null;
  cancellation: Record<string, unknown> | null;
  policyText: string | null;
}

export interface MarketDetail extends MarketRecord {
  paymentMethods: MarketPaymentMethodRecord[];
  taxRules: (TaxRuleRow & { id: string })[];
  policy: MarketPolicyRecord;
  readiness: { ready: boolean; items: ReadinessItem[] };
  extraMarketLimit: number;
}

type MarketRow = typeof schema.markets.$inferSelect;

function fail(kind: "Conflict" | "Bad Request" | "Not Found", message: string): never {
  throw new Error(`${kind}: ${message}`);
}

function toRecord(row: MarketRow, countries: string[]): MarketRecord {
  return {
    id: row.id,
    name: row.name,
    handle: row.handle,
    isBase: row.isBase,
    status: row.status as MarketRecord["status"],
    currency: row.currency,
    unitSystem: (row.unitSystem as MarketRecord["unitSystem"]) ?? null,
    fxRate: row.fxRate === null ? null : Number(row.fxRate),
    priceAdjustBps: row.priceAdjustBps,
    rounding: row.rounding as RoundingMode,
    taxDisplay: row.taxDisplay as MarketRecord["taxDisplay"],
    pathPrefix: row.pathPrefix,
    catalogMode: row.catalogMode as MarketRecord["catalogMode"],
    locale: row.locale,
    taxCollect: row.taxCollect,
    taxShippingToo: row.taxShippingToo,
    complianceAckAt: row.complianceAckAt?.toISOString() ?? null,
    countries: [...countries].sort(),
  };
}

export async function readMarkets(tx: Db, tenantId: string): Promise<MarketRecord[]> {
  const rows = await tx.select().from(schema.markets).where(eq(schema.markets.tenantId, tenantId)).orderBy(asc(schema.markets.createdAt));
  const cs = await tx.select().from(schema.marketCountries).where(eq(schema.marketCountries.tenantId, tenantId));
  return rows
    .map((r) => toRecord(r, cs.filter((c) => c.marketId === r.id).map((c) => c.country)))
    .sort((a, b) => Number(b.isBase) - Number(a.isBase));
}

async function loadMarket(tx: Db, tenantId: string, id: string): Promise<MarketRow> {
  const [row] = await tx
    .select()
    .from(schema.markets)
    .where(and(eq(schema.markets.tenantId, tenantId), eq(schema.markets.id, id)))
    .limit(1);
  if (!row) fail("Not Found", "Market not found");
  return row;
}

async function baseMarketOf(tx: Db, tenantId: string): Promise<MarketRow> {
  const [row] = await tx
    .select()
    .from(schema.markets)
    .where(and(eq(schema.markets.tenantId, tenantId), eq(schema.markets.isBase, true)))
    .limit(1);
  if (!row) fail("Conflict", "This store has no base market yet");
  return row;
}

async function audit(tx: Db, ctx: TenantContext, action: string, targetId: string, diff: Record<string, unknown>): Promise<void> {
  await tx.insert(schema.auditLogs).values({
    tenantId: ctx.tenantId,
    actorType: ctx.actor.type,
    actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
    action,
    targetType: "market",
    targetId,
    diff,
  });
}

/** Extra markets a plan allows on top of the base market (decision 12). Defaults to the Starter limit. */
export async function getExtraMarketLimit(tx: Db, tenantId: string): Promise<number> {
  const res = await tx.execute<{ limits: Record<string, unknown> | string }>(sql`
    SELECT p.limits FROM subscriptions s JOIN plans p ON p.id = s.plan_id
    WHERE s.tenant_id = ${tenantId} AND s.status IN ('active', 'trialing')
    ORDER BY s.created_at DESC LIMIT 1`);
  const raw = res.rows[0]?.limits;
  const limits = typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : raw;
  const v = limits?.["max_extra_markets"];
  return typeof v === "number" ? v : 1;
}

async function enabledCountryCodes(tx: Db): Promise<Set<string>> {
  const rows = await tx.select({ iso2: schema.platformCountries.iso2 }).from(schema.platformCountries).where(eq(schema.platformCountries.enabled, true));
  return new Set(rows.map((r) => r.iso2));
}

// ---------------------------------------------------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Rebuild the derived prices of the given variants in every non-base market that has a rate. Fixed rows are never touched.
 * Called from every variant write path so a market never shows a stale or missing price.
 */
export async function syncVariantMarketPrices(tx: Db, tenantId: string, variantIds: readonly string[]): Promise<void> {
  if (variantIds.length === 0) return;
  const markets = await tx
    .select()
    .from(schema.markets)
    .where(and(eq(schema.markets.tenantId, tenantId), eq(schema.markets.isBase, false)));
  const priced = markets.filter((m) => m.fxRate !== null);
  if (priced.length === 0) return;
  const base = await baseMarketOf(tx, tenantId);
  const variants = await tx
    .select({ id: schema.variants.id, price: schema.variants.price, compareAtPrice: schema.variants.compareAtPrice })
    .from(schema.variants)
    .where(and(eq(schema.variants.tenantId, tenantId), inArray(schema.variants.id, [...variantIds])));
  for (const m of priced) {
    const values = variants.map((v) => ({
      tenantId,
      marketId: m.id,
      variantId: v.id,
      price: derive(m, base.currency, Number(v.price)),
      compareAtPrice: v.compareAtPrice ? derive(m, base.currency, Number(v.compareAtPrice)) : null,
      source: "derived" as const,
      updatedAt: new Date(),
    }));
    for (let i = 0; i < values.length; i += 500) {
      await tx
        .insert(schema.marketPrices)
        .values(values.slice(i, i + 500))
        .onConflictDoUpdate({
          target: [schema.marketPrices.tenantId, schema.marketPrices.marketId, schema.marketPrices.variantId],
          set: { price: sql`excluded.price`, compareAtPrice: sql`excluded.compare_at_price`, updatedAt: sql`now()` },
          setWhere: sql`${schema.marketPrices.source} = 'derived'`,
        });
    }
  }
}

function derive(m: MarketRow, baseCurrency: string, baseMinor: number): number {
  return derivePrice({
    baseMinor,
    baseCurrency,
    targetCurrency: m.currency,
    fxRate: Number(m.fxRate),
    adjustBps: m.priceAdjustBps,
    rounding: m.rounding as RoundingMode,
  });
}

/** Rebuild every derived price of one market (after a rate, adjustment, rounding or currency change). */
export async function rebuildMarketPrices(tx: Db, tenantId: string, marketId: string): Promise<number> {
  const m = await loadMarket(tx, tenantId, marketId);
  if (m.isBase) return 0;
  if (m.fxRate === null) {
    await tx
      .delete(schema.marketPrices)
      .where(and(eq(schema.marketPrices.tenantId, tenantId), eq(schema.marketPrices.marketId, marketId), eq(schema.marketPrices.source, "derived")));
    return 0;
  }
  const ids = await tx.select({ id: schema.variants.id }).from(schema.variants).where(eq(schema.variants.tenantId, tenantId));
  await syncVariantMarketPrices(tx, tenantId, ids.map((r) => r.id));
  return ids.length;
}

export interface MarketPriceRow {
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  basePrice: number;
  baseCompareAtPrice: number | null;
  marketPrice: number | null;
  marketCompareAtPrice: number | null;
  source: "derived" | "fixed" | "missing";
}

export async function listMarketPricing(
  rt: Runtime,
  ctx: TenantContext,
  input: { marketId: string; search?: string | undefined; limit?: number | undefined; offset?: number | undefined },
): Promise<{ rows: MarketPriceRow[]; total: number }> {
  assertPermission(ctx, "markets.manage");
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const term = input.search?.trim() ? `%${input.search.trim().replace(/[%_]/g, "")}%` : null;
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    await loadMarket(tx, ctx.tenantId, input.marketId);
    const where = term
      ? sql`(p.title ilike ${term} or v.title ilike ${term} or v.sku ilike ${term})`
      : sql`true`;
    const totalRes = await tx.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM variants v JOIN products p ON p.tenant_id = v.tenant_id AND p.id = v.product_id
      WHERE v.tenant_id = ${ctx.tenantId} AND ${where}`);
    const res = await tx.execute<{
      variant_id: string; product_id: string; product_title: string; variant_title: string; sku: string;
      price: string; compare_at_price: string | null; mp_price: string | null; mp_compare: string | null; source: string | null;
    }>(sql`
      SELECT v.id AS variant_id, p.id AS product_id, p.title AS product_title, v.title AS variant_title, v.sku,
             v.price::text, v.compare_at_price::text, mp.price::text AS mp_price, mp.compare_at_price::text AS mp_compare, mp.source
      FROM variants v
      JOIN products p ON p.tenant_id = v.tenant_id AND p.id = v.product_id
      LEFT JOIN market_prices mp ON mp.tenant_id = v.tenant_id AND mp.variant_id = v.id AND mp.market_id = ${input.marketId}
      WHERE v.tenant_id = ${ctx.tenantId} AND ${where}
      ORDER BY p.title, v.title
      LIMIT ${limit} OFFSET ${offset}`);
    return {
      total: Number(totalRes.rows[0]?.n ?? 0),
      rows: res.rows.map((r) => ({
        variantId: r.variant_id,
        productId: r.product_id,
        productTitle: r.product_title,
        variantTitle: r.variant_title,
        sku: r.sku,
        basePrice: Number(r.price),
        baseCompareAtPrice: r.compare_at_price === null ? null : Number(r.compare_at_price),
        marketPrice: r.mp_price === null ? null : Number(r.mp_price),
        marketCompareAtPrice: r.mp_compare === null ? null : Number(r.mp_compare),
        source: (r.source as "derived" | "fixed" | null) ?? "missing",
      })),
    };
  });
}

/** Merchant overrides: set a fixed price per variant, or clear it (price null) to fall back to the derived one. */
export async function setFixedMarketPrices(
  rt: Runtime,
  ctx: TenantContext,
  input: { marketId: string; items: { variantId: string; price: number | null; compareAtPrice?: number | null | undefined }[] },
): Promise<{ updated: number }> {
  assertPermission(ctx, "markets.manage");
  if (input.items.length === 0 || input.items.length > 500) fail("Bad Request", "Send between 1 and 500 prices at a time");
  for (const it of input.items) {
    if (it.price !== null && (!Number.isInteger(it.price) || it.price < 0)) fail("Bad Request", "Prices must be whole minor units, zero or more");
    if (it.compareAtPrice != null && (!Number.isInteger(it.compareAtPrice) || it.compareAtPrice < 0)) fail("Bad Request", "Compare-at prices must be whole minor units");
  }
  const result = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const m = await loadMarket(tx, ctx.tenantId, input.marketId);
    if (m.isBase) fail("Bad Request", "The base market uses each variant's own price");
    const found = await tx
      .select({ id: schema.variants.id })
      .from(schema.variants)
      .where(and(eq(schema.variants.tenantId, ctx.tenantId), inArray(schema.variants.id, input.items.map((i) => i.variantId))));
    const known = new Set(found.map((f) => f.id));
    if (input.items.some((i) => !known.has(i.variantId))) fail("Not Found", "A variant in the list does not exist");
    const clear = input.items.filter((i) => i.price === null).map((i) => i.variantId);
    const set = input.items.filter((i) => i.price !== null);
    if (set.length > 0) {
      await tx
        .insert(schema.marketPrices)
        .values(set.map((i) => ({ tenantId: ctx.tenantId, marketId: m.id, variantId: i.variantId, price: i.price!, compareAtPrice: i.compareAtPrice ?? null, source: "fixed" as const })))
        .onConflictDoUpdate({
          target: [schema.marketPrices.tenantId, schema.marketPrices.marketId, schema.marketPrices.variantId],
          set: { price: sql`excluded.price`, compareAtPrice: sql`excluded.compare_at_price`, source: sql`'fixed'`, updatedAt: sql`now()` },
        });
    }
    if (clear.length > 0) {
      await tx
        .delete(schema.marketPrices)
        .where(and(eq(schema.marketPrices.tenantId, ctx.tenantId), eq(schema.marketPrices.marketId, m.id), inArray(schema.marketPrices.variantId, clear), eq(schema.marketPrices.source, "fixed")));
      await syncVariantMarketPrices(tx, ctx.tenantId, clear);
    }
    await audit(tx, ctx, "markets.prices_update", m.id, { fixed: set.length, cleared: clear.length });
    return { updated: input.items.length };
  });
  await invalidateCache(rt, ctx, { type: "markets_changed" });
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------------------------------------------------

export async function listMarkets(rt: Runtime, ctx: TenantContext): Promise<{ markets: MarketRecord[]; extraMarketLimit: number }> {
  assertPermission(ctx, "markets.manage");
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => ({
    markets: await readMarkets(tx, ctx.tenantId),
    extraMarketLimit: await getExtraMarketLimit(tx, ctx.tenantId),
  }));
}

export async function getMarketDetail(rt: Runtime, ctx: TenantContext, marketId: string): Promise<MarketDetail> {
  assertPermission(ctx, "markets.manage");
  return withTenant(rt._db.db, ctx.tenantId, (tx) => readMarketDetail(tx, ctx.tenantId, marketId));
}

export async function readMarketDetail(tx: Db, tenantId: string, marketId: string): Promise<MarketDetail> {
  const m = await loadMarket(tx, tenantId, marketId);
  const base = await baseMarketOf(tx, tenantId);
  const countries = (await tx.select().from(schema.marketCountries).where(and(eq(schema.marketCountries.tenantId, tenantId), eq(schema.marketCountries.marketId, marketId)))).map((c) => c.country);
  const record = toRecord(m, countries);
  const methods = await tx
    .select()
    .from(schema.marketPaymentMethods)
    .where(and(eq(schema.marketPaymentMethods.tenantId, tenantId), eq(schema.marketPaymentMethods.marketId, marketId)))
    .orderBy(asc(schema.marketPaymentMethods.sortOrder));
  const baseCountry = (await tx.select({ c: schema.marketCountries.country }).from(schema.marketCountries).where(and(eq(schema.marketCountries.tenantId, tenantId), eq(schema.marketCountries.marketId, base.id))))[0]?.c ?? "IN";
  const taxRules = await tx
    .select()
    .from(schema.marketTaxRules)
    .where(and(eq(schema.marketTaxRules.tenantId, tenantId), eq(schema.marketTaxRules.marketId, marketId)))
    .orderBy(asc(schema.marketTaxRules.sortOrder));
  const [policy] = await tx
    .select()
    .from(schema.marketPolicies)
    .where(and(eq(schema.marketPolicies.tenantId, tenantId), eq(schema.marketPolicies.marketId, marketId)))
    .limit(1);
  const rateCount = await tx.execute<{ n: string }>(sql`
    SELECT count(*)::text AS n FROM shipping_rates r JOIN shipping_zones z ON z.tenant_id = r.tenant_id AND z.id = r.zone_id
    WHERE r.tenant_id = ${tenantId} AND z.market_id = ${marketId}`);
  const policyFilled = !!(policy && ((policy.policyText ?? "").trim().length > 0 || policy.returnSettings || policy.cancellation));
  const readiness = marketReadiness({
    isBase: m.isBase,
    currency: m.currency,
    baseCurrency: base.currency,
    fxRate: record.fxRate,
    countryCount: countries.length,
    paymentMethodCount: methods.filter((x) => x.enabled).length,
    shippingRateCount: Number(rateCount.rows[0]?.n ?? 0),
    policyFilled,
    taxChoiceAcknowledged: m.complianceAckAt !== null,
  });
  return {
    ...record,
    paymentMethods: methods.map((x) => ({
      provider: x.provider,
      enabled: x.enabled,
      sortOrder: x.sortOrder,
      ...gatewayCurrencyCheck({ provider: x.provider, currency: m.currency, merchantCountry: baseCountry }),
    })),
    taxRules: taxRules.map((r) => ({ id: r.id, country: r.country, region: r.region, taxName: r.taxName, rateBps: r.rateBps })),
    policy: {
      returnSettings: (policy?.returnSettings as Record<string, unknown> | null) ?? null,
      cancellation: (policy?.cancellation as Record<string, unknown> | null) ?? null,
      policyText: policy?.policyText ?? null,
    },
    readiness,
    extraMarketLimit: await getExtraMarketLimit(tx, tenantId),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------------------------------------------------

export interface CreateMarketInput {
  name: string;
  currency: string;
  countries: string[];
  pathPrefix?: string | null | undefined;
  fxRate?: number | null | undefined;
  priceAdjustBps?: number | undefined;
  rounding?: RoundingMode | undefined;
  taxDisplay?: "inclusive" | "exclusive" | undefined;
  unitSystem?: "metric" | "imperial" | null | undefined;
}

function checkCurrency(raw: string): string {
  const c = normalizeCurrency(raw);
  if (!(LAUNCH_CURRENCIES as readonly string[]).includes(c)) fail("Bad Request", `Currency ${c} is not supported yet. Supported: ${LAUNCH_CURRENCIES.join(", ")}`);
  return c;
}

async function assertCountriesFree(tx: Db, tenantId: string, countries: string[], exceptMarketId?: string): Promise<void> {
  const taken = await tx
    .select({ country: schema.marketCountries.country, marketId: schema.marketCountries.marketId, name: schema.markets.name })
    .from(schema.marketCountries)
    .innerJoin(schema.markets, and(eq(schema.markets.tenantId, schema.marketCountries.tenantId), eq(schema.markets.id, schema.marketCountries.marketId)))
    .where(and(eq(schema.marketCountries.tenantId, tenantId), inArray(schema.marketCountries.country, countries)));
  const clash = taken.find((t) => t.marketId !== exceptMarketId);
  if (clash) fail("Conflict", `${clash.country} is already in the market "${clash.name}". A country can be in only one market.`);
}

export async function createMarket(rt: Runtime, ctx: TenantContext, input: CreateMarketInput): Promise<MarketDetail> {
  assertPermission(ctx, "markets.manage");
  const name = input.name.trim();
  if (!name) fail("Bad Request", "Give the market a name");
  const currency = checkCurrency(input.currency);
  const countries = [...new Set(input.countries.map((c) => c.trim().toUpperCase()))];
  if (countries.length === 0) fail("Bad Request", "Add at least one country");
  if (input.fxRate != null && !(input.fxRate > 0)) fail("Bad Request", "The exchange rate must be above zero");
  if (input.pathPrefix != null && input.pathPrefix !== "" && !isValidPathPrefix(input.pathPrefix)) {
    fail("Bad Request", "The URL prefix must look like /us (letters, numbers, dashes) and cannot clash with a store page");
  }
  if (input.rounding && !ROUNDING_MODES.includes(input.rounding)) fail("Bad Request", "Unknown rounding rule");

  const created = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const enabled = await enabledCountryCodes(tx);
    const bad = countries.find((c) => !enabled.has(c));
    if (bad) fail("Bad Request", `${bad} is not available yet`);
    const existing = await readMarkets(tx, ctx.tenantId);
    const base = existing.find((m) => m.isBase);
    if (!base) fail("Conflict", "This store has no base market yet");
    const limit = await getExtraMarketLimit(tx, ctx.tenantId);
    if (!canAddMarket(existing.filter((m) => !m.isBase).length, limit)) {
      fail("Conflict", `Your plan allows ${limit} extra market${limit === 1 ? "" : "s"} besides your base market. Upgrade to add more.`);
    }
    await assertCountriesFree(tx, ctx.tenantId, countries);
    const prefix = input.pathPrefix || `/${slugifyHandle(countries.length === 1 ? countries[0]!.toLowerCase() : name).slice(0, 20)}`;
    if (!isValidPathPrefix(prefix)) fail("Bad Request", "The URL prefix clashes with a store page; choose another");
    if (existing.some((m) => m.pathPrefix === prefix)) fail("Conflict", `The URL prefix ${prefix} is already used by another market`);
    let handle = slugifyHandle(name);
    for (let n = 2; existing.some((m) => m.handle === handle); n++) handle = `${slugifyHandle(name)}-${n}`;
    const needsRate = currency !== base.currency;
    const [row] = await tx
      .insert(schema.markets)
      .values({
        tenantId: ctx.tenantId,
        name,
        handle,
        isBase: false,
        status: "draft",
        currency,
        unitSystem: input.unitSystem ?? null,
        fxRate: needsRate && input.fxRate ? String(input.fxRate) : null,
        priceAdjustBps: input.priceAdjustBps ?? 0,
        rounding: input.rounding ?? "none",
        taxDisplay: input.taxDisplay ?? "exclusive",
        pathPrefix: prefix,
      })
      .returning();
    await tx.insert(schema.marketCountries).values(countries.map((country) => ({ tenantId: ctx.tenantId, marketId: row!.id, country })));
    if (needsRate && input.fxRate) {
      await tx.insert(schema.marketFxHistory).values({ tenantId: ctx.tenantId, marketId: row!.id, rate: String(input.fxRate), setBy: ctx.actor.type === "staff" ? ctx.actor.userId : null });
      await rebuildMarketPrices(tx, ctx.tenantId, row!.id);
    } else if (!needsRate) {
      await rebuildSameCurrencyPrices(tx, ctx.tenantId, row!.id);
    }
    await audit(tx, ctx, "markets.create", row!.id, { name, currency, countries, pathPrefix: prefix });
    return row!.id;
  });
  await invalidateCache(rt, ctx, { type: "markets_changed" });
  return getMarketDetail(rt, ctx, created);
}

/** A market in the store's own currency: derived price = base price (rate 1), so give it rate 1 and let the pipeline run. */
async function rebuildSameCurrencyPrices(tx: Db, tenantId: string, marketId: string): Promise<void> {
  await tx.update(schema.markets).set({ fxRate: "1" }).where(and(eq(schema.markets.tenantId, tenantId), eq(schema.markets.id, marketId)));
  await rebuildMarketPrices(tx, tenantId, marketId);
}

export interface UpdateMarketInput {
  name?: string | undefined;
  currency?: string | undefined;
  fxRate?: number | null | undefined;
  priceAdjustBps?: number | undefined;
  rounding?: RoundingMode | undefined;
  taxDisplay?: "inclusive" | "exclusive" | undefined;
  unitSystem?: "metric" | "imperial" | null | undefined;
  pathPrefix?: string | null | undefined;
  catalogMode?: "all" | "selected" | undefined;
  locale?: string | null | undefined;
  taxCollect?: boolean | undefined;
  taxShippingToo?: boolean | undefined;
}

export async function updateMarket(rt: Runtime, ctx: TenantContext, marketId: string, patch: UpdateMarketInput): Promise<MarketDetail> {
  assertPermission(ctx, "markets.manage");
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const m = await loadMarket(tx, ctx.tenantId, marketId);
    const base = await baseMarketOf(tx, ctx.tenantId);
    const set: Partial<typeof schema.markets.$inferInsert> = { updatedAt: new Date() };
    const diff: Record<string, unknown> = {};
    let reprice = false;

    if (patch.name !== undefined) {
      if (!patch.name.trim()) fail("Bad Request", "Give the market a name");
      set.name = patch.name.trim();
      diff.name = patch.name.trim();
    }
    if (patch.taxDisplay !== undefined) { set.taxDisplay = patch.taxDisplay; diff.taxDisplay = patch.taxDisplay; }
    if (patch.unitSystem !== undefined) { set.unitSystem = patch.unitSystem; diff.unitSystem = patch.unitSystem; }
    if (patch.locale !== undefined) { set.locale = patch.locale; diff.locale = patch.locale; }
    if (patch.catalogMode !== undefined) { set.catalogMode = patch.catalogMode; diff.catalogMode = patch.catalogMode; }
    if (patch.taxCollect !== undefined) { set.taxCollect = patch.taxCollect; diff.taxCollect = patch.taxCollect; }
    if (patch.taxShippingToo !== undefined) { set.taxShippingToo = patch.taxShippingToo; diff.taxShippingToo = patch.taxShippingToo; }

    if (m.isBase) {
      if (patch.currency !== undefined || patch.fxRate !== undefined || patch.priceAdjustBps !== undefined || patch.rounding !== undefined || patch.pathPrefix !== undefined) {
        fail("Bad Request", "The base market keeps your store currency and prices. Change those in Store settings.");
      }
    } else {
      if (patch.currency !== undefined) {
        const c = checkCurrency(patch.currency);
        if (c !== m.currency) { set.currency = c; diff.currency = c; reprice = true; }
      }
      if (patch.priceAdjustBps !== undefined) {
        if (!Number.isInteger(patch.priceAdjustBps) || patch.priceAdjustBps < -9000 || patch.priceAdjustBps > 100000) fail("Bad Request", "Adjustment must be between -90% and +1000%");
        set.priceAdjustBps = patch.priceAdjustBps; diff.priceAdjustBps = patch.priceAdjustBps; reprice = true;
      }
      if (patch.rounding !== undefined) {
        if (!ROUNDING_MODES.includes(patch.rounding)) fail("Bad Request", "Unknown rounding rule");
        set.rounding = patch.rounding; diff.rounding = patch.rounding; reprice = true;
      }
      if (patch.pathPrefix !== undefined) {
        if (patch.pathPrefix === null || !isValidPathPrefix(patch.pathPrefix)) fail("Bad Request", "The URL prefix must look like /us and cannot clash with a store page");
        const others = await readMarkets(tx, ctx.tenantId);
        if (others.some((o) => o.id !== m.id && o.pathPrefix === patch.pathPrefix)) fail("Conflict", `The URL prefix ${patch.pathPrefix} is already used by another market`);
        set.pathPrefix = patch.pathPrefix; diff.pathPrefix = patch.pathPrefix;
      }
      const effectiveCurrency = (set.currency as string | undefined) ?? m.currency;
      if (patch.fxRate !== undefined) {
        if (patch.fxRate !== null && !(patch.fxRate > 0)) fail("Bad Request", "The exchange rate must be above zero");
        set.fxRate = patch.fxRate === null ? null : String(patch.fxRate);
        diff.fxRate = patch.fxRate;
        reprice = true;
        if (patch.fxRate !== null) {
          await tx.insert(schema.marketFxHistory).values({ tenantId: ctx.tenantId, marketId: m.id, rate: String(patch.fxRate), setBy: ctx.actor.type === "staff" ? ctx.actor.userId : null });
        }
      }
      if (effectiveCurrency === base.currency && patch.fxRate === undefined) {
        set.fxRate = "1";
      }
      if (m.status === "active" && effectiveCurrency !== base.currency && (patch.fxRate === null || (patch.fxRate === undefined && m.fxRate === null))) {
        fail("Conflict", "An active market needs an exchange rate. Disable the market first.");
      }
    }
    if (Object.keys(diff).length === 0) return;
    await tx.update(schema.markets).set(set).where(and(eq(schema.markets.tenantId, ctx.tenantId), eq(schema.markets.id, marketId)));
    if (reprice) await rebuildMarketPrices(tx, ctx.tenantId, marketId);
    await audit(tx, ctx, "markets.update", marketId, diff);
  });
  await invalidateCache(rt, ctx, { type: "markets_changed" });
  return getMarketDetail(rt, ctx, marketId);
}

export async function setMarketCountries(rt: Runtime, ctx: TenantContext, marketId: string, countriesIn: string[]): Promise<MarketDetail> {
  assertPermission(ctx, "markets.manage");
  const countries = [...new Set(countriesIn.map((c) => c.trim().toUpperCase()))];
  if (countries.length === 0) fail("Bad Request", "A market needs at least one country");
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    await loadMarket(tx, ctx.tenantId, marketId);
    const enabled = await enabledCountryCodes(tx);
    const bad = countries.find((c) => !enabled.has(c));
    if (bad) fail("Bad Request", `${bad} is not available yet`);
    await assertCountriesFree(tx, ctx.tenantId, countries, marketId);
    await tx.delete(schema.marketCountries).where(and(eq(schema.marketCountries.tenantId, ctx.tenantId), eq(schema.marketCountries.marketId, marketId)));
    await tx.insert(schema.marketCountries).values(countries.map((country) => ({ tenantId: ctx.tenantId, marketId, country })));
    await audit(tx, ctx, "markets.countries_update", marketId, { countries });
  });
  await invalidateCache(rt, ctx, { type: "markets_changed" });
  return getMarketDetail(rt, ctx, marketId);
}

export async function setMarketStatus(rt: Runtime, ctx: TenantContext, marketId: string, status: "active" | "disabled"): Promise<MarketDetail> {
  assertPermission(ctx, "markets.manage");
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const m = await loadMarket(tx, ctx.tenantId, marketId);
    if (m.isBase && status === "disabled") fail("Bad Request", "The base market cannot be disabled");
    if (status === "active" && !m.isBase) {
      const detail = await readMarketDetail(tx, ctx.tenantId, marketId);
      const blocking = detail.paymentMethods.find((p) => p.enabled && p.blocking);
      if (blocking) fail("Conflict", blocking.blocking!);
      if (!detail.readiness.ready) {
        fail("Conflict", `This market is not ready: ${detail.readiness.items.filter((i) => !i.ok).map((i) => i.message).join("; ")}`);
      }
    }
    await tx.update(schema.markets).set({ status, updatedAt: new Date() }).where(and(eq(schema.markets.tenantId, ctx.tenantId), eq(schema.markets.id, marketId)));
    await audit(tx, ctx, status === "active" ? "markets.activate" : "markets.disable", marketId, { status });
  });
  await invalidateCache(rt, ctx, { type: "markets_changed" });
  return getMarketDetail(rt, ctx, marketId);
}

export async function deleteMarket(rt: Runtime, ctx: TenantContext, marketId: string): Promise<{ deleted: true }> {
  assertPermission(ctx, "markets.manage");
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const m = await loadMarket(tx, ctx.tenantId, marketId);
    if (m.isBase) fail("Bad Request", "The base market cannot be deleted");
    const orders = await tx.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM orders WHERE tenant_id = ${ctx.tenantId} AND market_id = ${marketId}`);
    if (Number(orders.rows[0]?.n ?? 0) > 0) fail("Conflict", "This market has orders, so it can be disabled but not deleted");
    await tx.update(schema.shippingZones).set({ marketId: null }).where(and(eq(schema.shippingZones.tenantId, ctx.tenantId), eq(schema.shippingZones.marketId, marketId)));
    await tx.update(schema.carts).set({ marketId: null }).where(and(eq(schema.carts.tenantId, ctx.tenantId), eq(schema.carts.marketId, marketId)));
    await tx.delete(schema.markets).where(and(eq(schema.markets.tenantId, ctx.tenantId), eq(schema.markets.id, marketId)));
    await audit(tx, ctx, "markets.delete", marketId, { name: m.name });
  });
  await invalidateCache(rt, ctx, { type: "markets_changed" });
  return { deleted: true };
}

export async function setMarketPaymentMethods(
  rt: Runtime,
  ctx: TenantContext,
  marketId: string,
  methods: { provider: string; enabled: boolean }[],
): Promise<MarketDetail> {
  assertPermission(ctx, "markets.manage");
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const m = await loadMarket(tx, ctx.tenantId, marketId);
    const connected = await tx.select({ provider: schema.paymentMethods.provider }).from(schema.paymentMethods).where(eq(schema.paymentMethods.tenantId, ctx.tenantId));
    const have = new Set(connected.map((c) => c.provider));
    const base = await baseMarketOf(tx, ctx.tenantId);
    const baseCountry = (await tx.select({ c: schema.marketCountries.country }).from(schema.marketCountries).where(and(eq(schema.marketCountries.tenantId, ctx.tenantId), eq(schema.marketCountries.marketId, base.id))))[0]?.c ?? "IN";
    const seen = new Set<string>();
    for (const x of methods) {
      if (seen.has(x.provider)) fail("Bad Request", `${x.provider} is listed twice`);
      seen.add(x.provider);
      if (!have.has(x.provider)) fail("Bad Request", `Connect ${x.provider} under Payments first`);
      const check = gatewayCurrencyCheck({ provider: x.provider, currency: m.currency, merchantCountry: baseCountry });
      if (x.enabled && check.blocking) fail("Bad Request", check.blocking);
    }
    await tx.delete(schema.marketPaymentMethods).where(and(eq(schema.marketPaymentMethods.tenantId, ctx.tenantId), eq(schema.marketPaymentMethods.marketId, marketId)));
    if (methods.length > 0) {
      await tx.insert(schema.marketPaymentMethods).values(methods.map((x, i) => ({ tenantId: ctx.tenantId, marketId, provider: x.provider, enabled: x.enabled, sortOrder: i })));
    }
    await audit(tx, ctx, "markets.payment_methods_update", marketId, { methods });
  });
  return getMarketDetail(rt, ctx, marketId);
}

export async function setMarketPolicy(rt: Runtime, ctx: TenantContext, marketId: string, policy: MarketPolicyRecord): Promise<MarketDetail> {
  assertPermission(ctx, "markets.manage");
  if (policy.policyText && policy.policyText.length > 20_000) fail("Bad Request", "The policy text is too long");
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    await loadMarket(tx, ctx.tenantId, marketId);
    await tx
      .insert(schema.marketPolicies)
      .values({ tenantId: ctx.tenantId, marketId, returnSettings: policy.returnSettings, cancellation: policy.cancellation, policyText: policy.policyText })
      .onConflictDoUpdate({
        target: [schema.marketPolicies.tenantId, schema.marketPolicies.marketId],
        set: { returnSettings: policy.returnSettings, cancellation: policy.cancellation, policyText: policy.policyText, updatedAt: new Date() },
      });
    await audit(tx, ctx, "markets.policy_update", marketId, { hasText: !!policy.policyText });
  });
  await invalidateCache(rt, ctx, { type: "markets_changed" });
  return getMarketDetail(rt, ctx, marketId);
}

export async function setMarketTaxRules(
  rt: Runtime,
  ctx: TenantContext,
  marketId: string,
  rules: { country: string; region: string; taxName: string; rateBps: number }[],
): Promise<MarketDetail> {
  assertPermission(ctx, "markets.manage");
  if (rules.length > 200) fail("Bad Request", "Too many tax rows");
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const detail = await readMarketDetail(tx, ctx.tenantId, marketId);
    for (const r of rules) {
      if (!r.taxName.trim()) fail("Bad Request", "Every tax row needs a name");
      if (!Number.isInteger(r.rateBps) || r.rateBps < 0 || r.rateBps > 10_000) fail("Bad Request", "A tax rate must be between 0% and 100%");
      if (!detail.countries.includes(r.country.toUpperCase())) fail("Bad Request", `${r.country} is not one of this market's countries`);
    }
    await tx.delete(schema.marketTaxRules).where(and(eq(schema.marketTaxRules.tenantId, ctx.tenantId), eq(schema.marketTaxRules.marketId, marketId)));
    if (rules.length > 0) {
      await tx.insert(schema.marketTaxRules).values(
        rules.map((r, i) => ({ tenantId: ctx.tenantId, marketId, country: r.country.toUpperCase(), region: r.region.trim() === "" ? "*" : r.region.trim().toUpperCase(), taxName: r.taxName.trim(), rateBps: r.rateBps, sortOrder: i })),
      );
    }
    await audit(tx, ctx, "markets.tax_rules_update", marketId, { rows: rules.length });
  });
  await invalidateCache(rt, ctx, { type: "markets_changed" });
  return getMarketDetail(rt, ctx, marketId);
}

/** The merchant confirms they own the tax rates and policies of this market (ADR-040 section 4). Audited with who and when. */
export async function acknowledgeMarketCompliance(rt: Runtime, ctx: TenantContext, marketId: string): Promise<MarketDetail> {
  assertPermission(ctx, "markets.manage");
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    await loadMarket(tx, ctx.tenantId, marketId);
    await tx
      .update(schema.markets)
      .set({ complianceAckAt: new Date(), complianceAckBy: ctx.actor.type === "staff" ? ctx.actor.userId : null, updatedAt: new Date() })
      .where(and(eq(schema.markets.tenantId, ctx.tenantId), eq(schema.markets.id, marketId)));
    await audit(tx, ctx, "markets.compliance_ack", marketId, { acknowledged: true });
  });
  return getMarketDetail(rt, ctx, marketId);
}

export async function setMarketProductVisibility(
  rt: Runtime,
  ctx: TenantContext,
  marketId: string,
  items: { productId: string; published: boolean }[],
): Promise<{ updated: number }> {
  assertPermission(ctx, "markets.manage");
  if (items.length === 0 || items.length > 500) fail("Bad Request", "Send between 1 and 500 products at a time");
  const out = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    await loadMarket(tx, ctx.tenantId, marketId);
    const found = await tx.select({ id: schema.products.id }).from(schema.products).where(and(eq(schema.products.tenantId, ctx.tenantId), inArray(schema.products.id, items.map((i) => i.productId))));
    const known = new Set(found.map((f) => f.id));
    if (items.some((i) => !known.has(i.productId))) fail("Not Found", "A product in the list does not exist");
    await tx
      .insert(schema.marketProducts)
      .values(items.map((i) => ({ tenantId: ctx.tenantId, marketId, productId: i.productId, published: i.published })))
      .onConflictDoUpdate({ target: [schema.marketProducts.tenantId, schema.marketProducts.marketId, schema.marketProducts.productId], set: { published: sql`excluded.published` } });
    await audit(tx, ctx, "markets.catalog_update", marketId, { products: items.length });
    return { updated: items.length };
  });
  await invalidateCache(rt, ctx, { type: "markets_changed" });
  return out;
}
