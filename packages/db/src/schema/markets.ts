import { sql } from "drizzle-orm";
import { boolean, check, index, integer, numeric, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenantForeignKey, tenantTable } from "../tenant-table.ts";

/**
 * Markets (ADR-040, docs/MULTIMARKET-PLAN.md section 4).
 * A market is a set of countries sharing one currency and one set of selling rules. Every store has exactly one base
 * market (is_base). A country belongs to at most one market per store. Later phases add price, catalog, gateway,
 * policy and tax tables that point at this one.
 */
export const markets = tenantTable(
  "markets",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    name: text("name").notNull(),
    /** URL-safe, unique per store. */
    handle: text("handle").notNull(),
    isBase: boolean("is_base").notNull().default(false),
    status: text("status").notNull().default("active"), // 'draft' | 'active' | 'disabled'
    currency: text("currency").notNull().default("INR"),
    /** null = follow store_settings.unit_system. */
    unitSystem: text("unit_system"),
    /** Base currency -> this market's currency. Merchant-entered only (decision 3). null on the base market. */
    fxRate: numeric("fx_rate", { precision: 18, scale: 8 }),
    priceAdjustBps: integer("price_adjust_bps").notNull().default(0),
    rounding: text("rounding").notNull().default("none"), // 'none' | 'nearest_whole' | 'charm_99' | 'charm_95'
    taxDisplay: text("tax_display").notNull().default("inclusive"), // 'inclusive' | 'exclusive'
    /** URL prefix for a non-base market, e.g. "/us". null for the base market. */
    pathPrefix: text("path_prefix"),
    catalogMode: text("catalog_mode").notNull().default("all"), // 'all' | 'selected'
    locale: text("locale"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("markets_tenant_id_uniq").on(t.tenantId, t.id),
    unique("markets_tenant_handle_uniq").on(t.tenantId, t.handle),
    uniqueIndex("markets_tenant_base_uniq").on(t.tenantId).where(sql`is_base`),
    check("markets_status_chk", sql`${t.status} in ('draft', 'active', 'disabled')`),
    check("markets_unit_system_chk", sql`${t.unitSystem} is null or ${t.unitSystem} in ('metric', 'imperial')`),
    check("markets_tax_display_chk", sql`${t.taxDisplay} in ('inclusive', 'exclusive')`),
    check("markets_catalog_mode_chk", sql`${t.catalogMode} in ('all', 'selected')`),
    check("markets_rounding_chk", sql`${t.rounding} in ('none', 'nearest_whole', 'charm_99', 'charm_95')`),
    check("markets_base_no_prefix_chk", sql`not ${t.isBase} or ${t.pathPrefix} is null`),
  ],
);

/** Which countries a market covers. unique (tenant_id, country): a country is in at most one market. */
export const marketCountries = tenantTable(
  "market_countries",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    marketId: uuid("market_id").notNull(),
    country: text("country").notNull(), // ISO 3166-1 alpha-2
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("market_countries_tenant_country_uniq").on(t.tenantId, t.country),
    index("market_countries_tenant_market_idx").on(t.tenantId, t.marketId),
    check("market_countries_country_chk", sql`${t.country} ~ '^[A-Z]{2}$'`),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.marketId,
      target: markets,
      name: "market_countries_market_fk",
      onDelete: "cascade",
    }),
  ],
);

/**
 * Countries a store may sell to (platform data, no tenant column, no RLS). Adding a country later is a row here, not a
 * deploy. Writable only by app_platform; app_rw reads it.
 */
export const platformCountries = pgTable("platform_countries", {
  iso2: text("iso2").primaryKey(),
  name: text("name").notNull(),
  defaultCurrency: text("default_currency").notNull(),
  defaultLocale: text("default_locale").notNull(),
  defaultTimezone: text("default_timezone").notNull(),
  defaultUnitSystem: text("default_unit_system").notNull().default("metric"),
  /** Which address form and tax-ID fields apply: 'in' | 'us' | 'ca' | 'generic'. */
  addressSchema: text("address_schema").notNull().default("generic"),
  enabled: boolean("enabled").notNull().default(false),
  sort: integer("sort").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});
