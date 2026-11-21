/**
 * State Pricing app (ADR-044): a variant's price per Indian state. A state without a row follows the variant's own price
 * (the default). The storefront applies these prices through `market_variant_price` (migration 0096) and, for the
 * product page and cart, through `loadStatePriceMap`. Nothing here runs unless the app is active for the store.
 */
import { and, asc, count, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { invalidateCache } from "../cache-invalidation.ts";
import { STATE_PRICING_APP, statePricingSettingsSchema, type StatePricingSettings } from "./registry.ts";
import { readActiveApp } from "./service.ts";
import { isIndianStateCode } from "./regions.ts";

function fail(kind: "Conflict" | "Bad Request" | "Not Found", message: string): never {
  throw new Error(`${kind}: ${message}`);
}

export interface StatePricingScope {
  active: boolean;
  mode: StatePricingSettings["mode"];
}

/** What the storefront needs per request: is the app active for this store, and in which detection mode. */
export async function readStatePricingScope(tx: Db, tenantId: string): Promise<StatePricingScope> {
  const { active, settings } = await readActiveApp(tx, tenantId, STATE_PRICING_APP);
  if (!active) return { active: false, mode: "auto" };
  const parsed = statePricingSettingsSchema.safeParse(settings);
  return { active: true, mode: parsed.success ? parsed.data.mode : "auto" };
}

export async function getStatePricingScope(rt: Runtime, tenantId: string): Promise<StatePricingScope> {
  return withTenant(rt._db.db, tenantId, (tx) => readStatePricingScope(tx, tenantId));
}

export interface StatePriceEntry {
  price: number;
  compareAtPrice: number | null;
}

/** State prices for the given variants in one state. Only called when the app is active and a state is known. */
export async function loadStatePriceMap(
  tx: Db,
  tenantId: string,
  stateCode: string,
  variantIds: readonly string[],
): Promise<Map<string, StatePriceEntry>> {
  const out = new Map<string, StatePriceEntry>();
  if (variantIds.length === 0 || !isIndianStateCode(stateCode)) return out;
  const rows = await tx
    .select({ variantId: schema.statePrices.variantId, price: schema.statePrices.price, compareAtPrice: schema.statePrices.compareAtPrice })
    .from(schema.statePrices)
    .where(
      and(
        eq(schema.statePrices.tenantId, tenantId),
        eq(schema.statePrices.stateCode, stateCode),
        inArray(schema.statePrices.variantId, [...variantIds]),
      ),
    );
  for (const r of rows) {
    out.set(r.variantId, { price: Number(r.price), compareAtPrice: r.compareAtPrice === null ? null : Number(r.compareAtPrice) });
  }
  return out;
}

export interface StateOption {
  code: string;
  name: string;
}

export async function listIndianStates(rt: Runtime): Promise<StateOption[]> {
  const rows = await rt._db.db
    .select({ code: schema.platformInStates.code, name: schema.platformInStates.name })
    .from(schema.platformInStates)
    .orderBy(asc(schema.platformInStates.name));
  return rows;
}

export interface ProductStatePricing {
  productId: string;
  productTitle: string;
  variants: {
    variantId: string;
    title: string;
    sku: string | null;
    basePrice: number;
    prices: Record<string, StatePriceEntry>;
  }[];
}

export async function getProductStatePricing(rt: Runtime, ctx: TenantContext, productId: string): Promise<ProductStatePricing> {
  assertPermission(ctx, "apps.manage");
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [product] = await tx
      .select({ id: schema.products.id, title: schema.products.title })
      .from(schema.products)
      .where(and(eq(schema.products.tenantId, ctx.tenantId), eq(schema.products.id, productId)))
      .limit(1);
    if (!product) fail("Not Found", "Product not found");
    const variants = await tx
      .select({ id: schema.variants.id, title: schema.variants.title, sku: schema.variants.sku, price: schema.variants.price })
      .from(schema.variants)
      .where(and(eq(schema.variants.tenantId, ctx.tenantId), eq(schema.variants.productId, productId)))
      .orderBy(asc(schema.variants.position));
    const rows = variants.length
      ? await tx
          .select()
          .from(schema.statePrices)
          .where(and(eq(schema.statePrices.tenantId, ctx.tenantId), inArray(schema.statePrices.variantId, variants.map((v) => v.id))))
      : [];
    return {
      productId: product.id,
      productTitle: product.title,
      variants: variants.map((v) => ({
        variantId: v.id,
        title: v.title ?? "Default",
        sku: v.sku ?? null,
        basePrice: Number(v.price),
        prices: Object.fromEntries(
          rows
            .filter((r) => r.variantId === v.id)
            .map((r) => [r.stateCode, { price: Number(r.price), compareAtPrice: r.compareAtPrice === null ? null : Number(r.compareAtPrice) }]),
        ),
      })),
    };
  });
}

export interface SetStatePriceInput {
  variantId: string;
  /** price null removes the state's override (the state follows the default price again). Amounts are minor units (paise). */
  prices: { state: string; price: number | null; compareAtPrice?: number | null | undefined }[];
}

export async function setVariantStatePrices(rt: Runtime, ctx: TenantContext, input: SetStatePriceInput): Promise<{ saved: number; removed: number }> {
  assertPermission(ctx, "apps.manage");
  if (input.prices.length > 40) fail("Bad Request", "Too many states in one request");
  const seen = new Set<string>();
  for (const p of input.prices) {
    if (!isIndianStateCode(p.state)) fail("Bad Request", `Unknown state ${p.state}`);
    if (seen.has(p.state)) fail("Bad Request", `State ${p.state} appears twice`);
    seen.add(p.state);
    if (p.price !== null && (!Number.isSafeInteger(p.price) || p.price <= 0)) fail("Bad Request", "Price must be a positive whole amount in paise");
    if (p.compareAtPrice != null && (!Number.isSafeInteger(p.compareAtPrice) || p.compareAtPrice <= 0)) fail("Bad Request", "Compare-at price must be a positive whole amount in paise");
  }
  const result = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [inst] = await tx
      .select({ id: schema.tenantApps.id })
      .from(schema.tenantApps)
      .where(and(eq(schema.tenantApps.tenantId, ctx.tenantId), eq(schema.tenantApps.appKey, STATE_PRICING_APP)))
      .limit(1);
    if (!inst) fail("Conflict", "Install the State Pricing app first");
    const [variant] = await tx
      .select({ id: schema.variants.id })
      .from(schema.variants)
      .where(and(eq(schema.variants.tenantId, ctx.tenantId), eq(schema.variants.id, input.variantId)))
      .limit(1);
    if (!variant) fail("Not Found", "Variant not found");

    let saved = 0;
    let removed = 0;
    for (const p of input.prices) {
      if (p.price === null) {
        await tx
          .delete(schema.statePrices)
          .where(and(eq(schema.statePrices.tenantId, ctx.tenantId), eq(schema.statePrices.variantId, input.variantId), eq(schema.statePrices.stateCode, p.state)));
        removed += 1;
      } else {
        await tx
          .insert(schema.statePrices)
          .values({
            tenantId: ctx.tenantId,
            variantId: input.variantId,
            stateCode: p.state,
            price: BigInt(p.price),
            compareAtPrice: p.compareAtPrice == null ? null : BigInt(p.compareAtPrice),
          })
          .onConflictDoUpdate({
            target: [schema.statePrices.tenantId, schema.statePrices.variantId, schema.statePrices.stateCode],
            set: { price: BigInt(p.price), compareAtPrice: p.compareAtPrice == null ? null : BigInt(p.compareAtPrice), updatedAt: sql`now()` },
          });
        saved += 1;
      }
    }
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "state_prices.set",
      targetType: "variant",
      targetId: input.variantId,
      diff: { prices: input.prices },
    });
    return { saved, removed };
  });
  await invalidateCache(rt, ctx, { type: "markets_changed" });
  return result;
}

export interface StatePricingGridVariant {
  variantId: string;
  title: string;
  sku: string | null;
  basePrice: number;
  prices: Record<string, StatePriceEntry>;
}

export interface StatePricingGridRow {
  productId: string;
  productTitle: string;
  variants: StatePricingGridVariant[];
}

export interface StatePricingGrid {
  rows: StatePricingGridRow[];
  /** Products matching the search (not variants), for pagination. */
  total: number;
  /** Every state this store has at least one price for, so the grid can show those columns by default. */
  usedStates: string[];
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * One page of products with their variants and state prices, for the bulk editor. Search matches a product title or any
 * variant SKU. Paginated by product, so a product's variants always arrive together.
 */
export async function listStatePricingGrid(
  rt: Runtime,
  ctx: TenantContext,
  input: { search?: string | undefined; limit: number; offset: number },
): Promise<StatePricingGrid> {
  assertPermission(ctx, "apps.manage");
  const limit = Math.min(Math.max(input.limit, 1), 100);
  const term = input.search?.trim();
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const base = and(eq(schema.products.tenantId, ctx.tenantId), isNull(schema.products.deletedAt));
    const like = term ? `%${escapeLike(term)}%` : "";
    const where = term
      ? and(
          base,
          or(
            ilike(schema.products.title, like),
            sql`exists (select 1 from variants v where v.tenant_id = ${schema.products.tenantId} and v.product_id = ${schema.products.id} and v.sku ilike ${like})`,
          ),
        )
      : base;
    const [totalRow] = await tx.select({ n: count() }).from(schema.products).where(where);
    const products = await tx
      .select({ id: schema.products.id, title: schema.products.title })
      .from(schema.products)
      .where(where)
      .orderBy(asc(schema.products.title), asc(schema.products.id))
      .limit(limit)
      .offset(Math.max(input.offset, 0));
    const productIds = products.map((p) => p.id);
    const variants = productIds.length
      ? await tx
          .select({ id: schema.variants.id, productId: schema.variants.productId, title: schema.variants.title, sku: schema.variants.sku, price: schema.variants.price })
          .from(schema.variants)
          .where(and(eq(schema.variants.tenantId, ctx.tenantId), inArray(schema.variants.productId, productIds)))
          .orderBy(asc(schema.variants.position), asc(schema.variants.id))
      : [];
    const priced = variants.length
      ? await tx
          .select()
          .from(schema.statePrices)
          .where(and(eq(schema.statePrices.tenantId, ctx.tenantId), inArray(schema.statePrices.variantId, variants.map((v) => v.id))))
      : [];
    const used = await tx
      .selectDistinct({ code: schema.statePrices.stateCode })
      .from(schema.statePrices)
      .where(eq(schema.statePrices.tenantId, ctx.tenantId))
      .orderBy(asc(schema.statePrices.stateCode));
    return {
      total: totalRow?.n ?? 0,
      usedStates: used.map((u) => u.code),
      rows: products.map((p) => ({
        productId: p.id,
        productTitle: p.title,
        variants: variants
          .filter((v) => v.productId === p.id)
          .map((v) => ({
            variantId: v.id,
            title: v.title ?? "Default",
            sku: v.sku ?? null,
            basePrice: Number(v.price),
            prices: Object.fromEntries(
              priced
                .filter((r) => r.variantId === v.id)
                .map((r) => [r.stateCode, { price: Number(r.price), compareAtPrice: r.compareAtPrice === null ? null : Number(r.compareAtPrice) }]),
            ),
          })),
      })),
    };
  });
}

export interface BulkStatePriceItem {
  variantId: string;
  state: string;
  /** null removes the state's price (the state follows the default again). Minor units. */
  price: number | null;
}

/** Many state prices in one transaction (the bulk editor and the CSV import). All or nothing; one audit row. */
export async function setStatePricesBulk(rt: Runtime, ctx: TenantContext, items: BulkStatePriceItem[]): Promise<{ saved: number; removed: number }> {
  assertPermission(ctx, "apps.manage");
  if (items.length === 0) return { saved: 0, removed: 0 };
  if (items.length > 1000) fail("Bad Request", "Too many changes in one request");
  const seen = new Set<string>();
  for (const it of items) {
    if (!isIndianStateCode(it.state)) fail("Bad Request", `Unknown state ${it.state}`);
    const key = `${it.variantId}:${it.state}`;
    if (seen.has(key)) fail("Bad Request", "The same variant and state appears twice");
    seen.add(key);
    if (it.price !== null && (!Number.isSafeInteger(it.price) || it.price <= 0)) fail("Bad Request", "Prices must be positive whole amounts in paise");
  }
  const result = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [inst] = await tx
      .select({ id: schema.tenantApps.id })
      .from(schema.tenantApps)
      .where(and(eq(schema.tenantApps.tenantId, ctx.tenantId), eq(schema.tenantApps.appKey, STATE_PRICING_APP)))
      .limit(1);
    if (!inst) fail("Conflict", "Install the State Pricing app first");
    const ids = [...new Set(items.map((i) => i.variantId))];
    const found = await tx
      .select({ id: schema.variants.id })
      .from(schema.variants)
      .where(and(eq(schema.variants.tenantId, ctx.tenantId), inArray(schema.variants.id, ids)));
    if (found.length !== ids.length) fail("Not Found", "A variant in the request was not found");
    let saved = 0;
    let removed = 0;
    for (const it of items) {
      if (it.price === null) {
        await tx
          .delete(schema.statePrices)
          .where(and(eq(schema.statePrices.tenantId, ctx.tenantId), eq(schema.statePrices.variantId, it.variantId), eq(schema.statePrices.stateCode, it.state)));
        removed += 1;
      } else {
        await tx
          .insert(schema.statePrices)
          .values({ tenantId: ctx.tenantId, variantId: it.variantId, stateCode: it.state, price: BigInt(it.price) })
          .onConflictDoUpdate({
            target: [schema.statePrices.tenantId, schema.statePrices.variantId, schema.statePrices.stateCode],
            set: { price: BigInt(it.price), updatedAt: sql`now()` },
          });
        saved += 1;
      }
    }
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "state_prices.bulk",
      targetType: "app",
      targetId: STATE_PRICING_APP,
      diff: { saved, removed, variants: ids.length },
    });
    return { saved, removed };
  });
  await invalidateCache(rt, ctx, { type: "markets_changed" });
  return result;
}

export interface SkuMatch {
  sku: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  basePrice: number;
}

/** Variants for a list of SKUs (CSV import matching). A SKU that is not found is simply absent from the result. */
export async function lookupVariantsBySku(rt: Runtime, ctx: TenantContext, skus: string[]): Promise<SkuMatch[]> {
  assertPermission(ctx, "apps.manage");
  const unique = [...new Set(skus.map((s) => s.trim()).filter(Boolean))].slice(0, 2000);
  if (unique.length === 0) return [];
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({ id: schema.variants.id, sku: schema.variants.sku, title: schema.variants.title, price: schema.variants.price, productTitle: schema.products.title })
      .from(schema.variants)
      .innerJoin(schema.products, and(eq(schema.products.tenantId, schema.variants.tenantId), eq(schema.products.id, schema.variants.productId)))
      .where(and(eq(schema.variants.tenantId, ctx.tenantId), inArray(schema.variants.sku, unique), isNull(schema.products.deletedAt)));
    return rows.map((r) => ({ sku: r.sku ?? "", variantId: r.id, productTitle: r.productTitle, variantTitle: r.title ?? "Default", basePrice: Number(r.price) }));
  });
}
