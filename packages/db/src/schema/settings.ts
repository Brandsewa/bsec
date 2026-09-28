import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantForeignKey, tenantTable } from "../tenant-table.ts";
import { citext } from "./custom-types.ts";
import { media } from "./catalog.ts";

/**
 * Store settings: core configuration per store (PLAN §5.4).
 * Tenant table: RLS enabled. One row per tenant.
 */
export const storeSettings = tenantTable(
  "store_settings",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    storeName: text("store_name").notNull(),
    legalName: text("legal_name"),
    supportEmail: citext("support_email"),
    supportPhone: text("support_phone"),
    address: jsonb("address"),
    currency: text("currency").notNull().default("INR"),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    weightUnit: text("weight_unit").notNull().default("kg"),
    orderPrefix: text("order_prefix").notNull().default("#"),
    social: jsonb("social"),
    checkout: jsonb("checkout"),
    notifications: jsonb("notifications"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("store_settings_tenant_id_uniq").on(t.tenantId),
  ],
);

/**
 * Store status (PLAN §5.4 / M3).
 * Controls store operational mode: live, coming_soon, maintenance, password.
 */
export const storeStatus = tenantTable(
  "store_status",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    mode: text("mode").notNull().default("coming_soon"),
    headline: text("headline"),
    messageJson: jsonb("message_json"),
    launchAt: timestamp("launch_at", { withTimezone: true }),
    showCountdown: boolean("show_countdown").notNull().default(false),
    collectEmails: boolean("collect_emails").notNull().default(true),
    backgroundMediaId: uuid("background_media_id"),
    passwordHash: text("password_hash"),
    retryAfterMinutes: integer("retry_after_minutes").notNull().default(60),
    bypassTokenHash: text("bypass_token_hash"),
    changedBy: uuid("changed_by"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("store_status_tenant_id_uniq").on(t.tenantId),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.backgroundMediaId,
      target: media,
      name: "store_status_background_media_fk",
      onDelete: "set null",
    }),
  ],
);

/**
 * SEO settings (PLAN §5.4 / M3).
 * Storefront-wide SEO and structured data configuration.
 */
export const seoSettings = tenantTable(
  "seo_settings",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    indexingEnabled: boolean("indexing_enabled").notNull().default(true),
    titleTemplate: text("title_template").notNull().default("%s | {{store_name}}"),
    defaultMetaDescription: text("default_meta_description"),
    defaultOgImageMediaId: uuid("default_og_image_media_id"),
    twitterHandle: text("twitter_handle"),
    organizationSchema: jsonb("organization_schema"),
    localBusiness: jsonb("local_business"),
    robotsExtra: text("robots_extra"),
    aiCrawlers: jsonb("ai_crawlers"),
    breadcrumbsEnabled: boolean("breadcrumbs_enabled").notNull().default(true),
    faqSchemaEnabled: boolean("faq_schema_enabled").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("seo_settings_tenant_id_uniq").on(t.tenantId),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.defaultOgImageMediaId,
      target: media,
      name: "seo_settings_default_og_image_media_fk",
      onDelete: "set null",
    }),
  ],
);
