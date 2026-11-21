import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { tenantForeignKey, tenantTable } from "../tenant-table.ts";
import { variants } from "./catalog.ts";

/**
 * Apps framework (ADR-043, docs/STATE-PRICING-PLAN.md). The catalog of first-party apps is platform data (no tenant
 * column, no RLS): Super Admin writes it through app_platform, store runtimes read it. Apps are our own code, never
 * merchant code (rule 8).
 */
export const platformApps = pgTable("platform_apps", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  icon: text("icon").notNull().default("puzzle"),
  category: text("category").notNull().default("general"),
  /** 'public' = every store sees it in the Apps page; 'private' = only stores in allowed_tenant_ids. */
  visibility: text("visibility").notNull().default("private"),
  allowedTenantIds: uuid("allowed_tenant_ids").array().notNull().default(sql`'{}'::uuid[]`),
  /** Global kill switch: off hides the app and makes it inert on every store, whatever their install state. */
  enabled: boolean("enabled").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/** A store's install of an app plus its settings (validated by the app's own schema in the domain layer). */
export const tenantApps = tenantTable(
  "tenant_apps",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    appKey: text("app_key").notNull().references(() => platformApps.key, { onDelete: "restrict" }),
    status: text("status").notNull().default("installed"), // 'installed' | 'disabled'
    settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
    settingsVersion: integer("settings_version").notNull().default(1),
    /** Super Admin turned this app off for this store; the store cannot turn it back on. */
    platformSuspended: boolean("platform_suspended").notNull().default(false),
    /** Shown in the admin sidebar under Apps. */
    pinned: boolean("pinned").notNull().default(false),
    installedBy: uuid("installed_by"),
    installedAt: timestamp("installed_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("tenant_apps_tenant_app_uniq").on(t.tenantId, t.appKey),
    check("tenant_apps_status_chk", sql`${t.status} in ('installed', 'disabled')`),
  ],
);

/** India's 28 states and 8 union territories, keyed by ISO 3166-2:IN code (what Cloudflare and MaxMind return). */
export const platformInStates = pgTable("platform_in_states", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("state"), // 'state' | 'ut'
  sort: integer("sort").notNull().default(0),
});

/** India Post pincode directory: pincode -> state, for the State Pricing app's manual mode. Platform data. */
export const platformInPincodes = pgTable("platform_in_pincodes", {
  pincode: text("pincode").primaryKey(),
  stateCode: text("state_code").notNull().references(() => platformInStates.code, { onDelete: "restrict" }),
});

/** State Pricing app: a variant's price in one state. States without a row follow the variant's own price. */
export const statePrices = tenantTable(
  "state_prices",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    variantId: uuid("variant_id").notNull(),
    stateCode: text("state_code").notNull().references(() => platformInStates.code, { onDelete: "restrict" }),
    price: bigint("price", { mode: "bigint" }).notNull(),
    compareAtPrice: bigint("compare_at_price", { mode: "bigint" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("state_prices_tenant_variant_state_uniq").on(t.tenantId, t.variantId, t.stateCode),
    index("state_prices_tenant_state_idx").on(t.tenantId, t.stateCode),
    check("state_prices_price_chk", sql`${t.price} > 0`),
    tenantForeignKey({ tableTenantId: t.tenantId, column: t.variantId, target: variants, name: "state_prices_variant_fk", onDelete: "cascade" }),
  ],
);
