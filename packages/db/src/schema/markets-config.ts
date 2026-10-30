import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, numeric, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { tenantForeignKey, tenantTable } from "../tenant-table.ts";
import { products, variants } from "./catalog.ts";
import { markets } from "./markets.ts";

/**
 * Prices of a variant in a non-base market (ADR-040). Derived rows are rebuilt from the base price with the market's
 * rate, adjustment and rounding (packages/domain/src/markets/pricing.ts); fixed rows are merchant overrides and are
 * never overwritten. The base market has no rows: its prices are the variant's own.
 */
export const marketPrices = tenantTable(
  "market_prices",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    marketId: uuid("market_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    price: bigint("price", { mode: "number" }).notNull(),
    compareAtPrice: bigint("compare_at_price", { mode: "number" }),
    source: text("source").notNull().default("derived"), // 'derived' | 'fixed'
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("market_prices_tenant_market_variant_uniq").on(t.tenantId, t.marketId, t.variantId),
    index("market_prices_tenant_variant_idx").on(t.tenantId, t.variantId),
    check("market_prices_source_chk", sql`${t.source} in ('derived', 'fixed')`),
    check("market_prices_price_chk", sql`${t.price} >= 0`),
    tenantForeignKey({ tableTenantId: t.tenantId, column: t.marketId, target: markets, name: "market_prices_market_fk", onDelete: "cascade" }),
    tenantForeignKey({ tableTenantId: t.tenantId, column: t.variantId, target: variants, name: "market_prices_variant_fk", onDelete: "cascade" }),
  ],
);

/** Audit of manual exchange-rate changes (decision 3). Orders snapshot the rate they used. */
export const marketFxHistory = tenantTable(
  "market_fx_history",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    marketId: uuid("market_id").notNull(),
    rate: numeric("rate", { precision: 18, scale: 8 }).notNull(),
    setBy: uuid("set_by"),
    setAt: timestamp("set_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index("market_fx_history_tenant_market_idx").on(t.tenantId, t.marketId, t.setAt),
    tenantForeignKey({ tableTenantId: t.tenantId, column: t.marketId, target: markets, name: "market_fx_history_market_fk", onDelete: "cascade" }),
  ],
);

/** Catalog for a market: with catalog_mode 'selected' a published row opts a product in; with 'all' an unpublished row hides it. */
export const marketProducts = tenantTable(
  "market_products",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    marketId: uuid("market_id").notNull(),
    productId: uuid("product_id").notNull(),
    published: boolean("published").notNull().default(true),
  },
  (t) => [
    unique("market_products_tenant_market_product_uniq").on(t.tenantId, t.marketId, t.productId),
    tenantForeignKey({ tableTenantId: t.tenantId, column: t.marketId, target: markets, name: "market_products_market_fk", onDelete: "cascade" }),
    tenantForeignKey({ tableTenantId: t.tenantId, column: t.productId, target: products, name: "market_products_product_fk", onDelete: "cascade" }),
  ],
);

/** Which of the store's connected gateways this market offers (credentials stay in tenant_secrets). */
export const marketPaymentMethods = tenantTable(
  "market_payment_methods",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    marketId: uuid("market_id").notNull(),
    provider: text("provider").notNull(), // 'cod' | 'razorpay' | 'stripe' | 'paypal' | 'cashfree'
    enabled: boolean("enabled").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    unique("market_payment_methods_tenant_market_provider_uniq").on(t.tenantId, t.marketId, t.provider),
    tenantForeignKey({ tableTenantId: t.tenantId, column: t.marketId, target: markets, name: "market_payment_methods_market_fk", onDelete: "cascade" }),
  ],
);

/** Returns and cancellation: only the differences from the store policy, merged over it. Merchant-owned text (ADR-040 section 4). */
export const marketPolicies = tenantTable(
  "market_policies",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    marketId: uuid("market_id").notNull(),
    returnSettings: jsonb("return_settings"),
    cancellation: jsonb("cancellation"),
    policyText: text("policy_text"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("market_policies_tenant_market_uniq").on(t.tenantId, t.marketId),
    tenantForeignKey({ tableTenantId: t.tenantId, column: t.marketId, target: markets, name: "market_policies_market_fk", onDelete: "cascade" }),
  ],
);

/** Merchant-entered tax rows. Every row whose country and region match the shipping address is added. We pre-fill nothing. */
export const marketTaxRules = tenantTable(
  "market_tax_rules",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    marketId: uuid("market_id").notNull(),
    country: text("country").notNull(),
    region: text("region").notNull().default("*"), // state/province code, or '*' for the whole country
    taxName: text("tax_name").notNull(),
    rateBps: integer("rate_bps").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("market_tax_rules_tenant_market_idx").on(t.tenantId, t.marketId),
    check("market_tax_rules_rate_chk", sql`${t.rateBps} >= 0 and ${t.rateBps} <= 10000`),
    tenantForeignKey({ tableTenantId: t.tenantId, column: t.marketId, target: markets, name: "market_tax_rules_market_fk", onDelete: "cascade" }),
  ],
);
