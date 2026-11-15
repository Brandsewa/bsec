import { sql } from "drizzle-orm";
import { boolean, date, index, integer, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { tenantForeignKey, tenantTable } from "../tenant-table.ts";
import { orders } from "./orders.ts";

/**
 * First-party storefront traffic events (ADR-047, docs/ANALYTICS-PLAN.md).
 *
 * Cookieless: no identifier is stored on the shopper's device. `visitor_hash` is an HMAC of tenant + IP + user agent keyed by a
 * secret and the UTC day, so it cannot be reversed, cannot be linked across days and never crosses stores. Raw IPs are not stored.
 * Orders, revenue and customers are NOT events: those reports read the orders tables. Rows are pruned after 90 days (worker job,
 * later slice); reports read daily rollups.
 */
export const analyticsEvents = tenantTable(
  "analytics_events",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().default(sql`now()`),
    /** pageview | add_to_cart | begin_checkout. A closed list, enforced by the domain service and a CHECK. */
    eventType: text("event_type").notNull(),
    visitorHash: text("visitor_hash").notNull(),
    /** Path only, no query string or hash, at most 200 characters. */
    path: text("path").notNull(),
    productSlug: text("product_slug"),
    referrerHost: text("referrer_host"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    /** ISO 3166-1 alpha-2 from the edge (Cloudflare), only when the request really came through it. */
    country: text("country"),
    /** desktop | mobile | tablet */
    device: text("device"),
  },
  (t) => [
    index("analytics_events_tenant_time_idx").on(t.tenantId, t.occurredAt),
    index("analytics_events_tenant_type_time_idx").on(t.tenantId, t.eventType, t.occurredAt),
  ],
);

/**
 * Daily traffic rollup (ADR-047). Aggregate counts only, no visitor hash, kept at least 25 months so year-over-year works.
 * One row per store day (in the store timezone), dimension and key. Dimensions: total (key ""), referrer, source (utm_source),
 * country, device, landing (first path of the visit). Rebuilt for today and yesterday every hour by `analytics.maintenance`.
 */
export const analyticsTrafficDaily = tenantTable(
  "analytics_traffic_daily",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    day: date("day").notNull(),
    dimension: text("dimension").notNull(),
    key: text("key").notNull().default(""),
    /** Visits: distinct visitor hashes that day. The hash rotates daily, so a sum over days counts visits, not people. */
    sessions: integer("sessions").notNull().default(0),
    pageviews: integer("pageviews").notNull().default(0),
    /** Visits that viewed a product page, added to cart, reached checkout. */
    productViews: integer("product_views").notNull().default(0),
    carts: integer("carts").notNull().default(0),
    checkouts: integer("checkouts").notNull().default(0),
    /** Visits with exactly one pageview. */
    bounces: integer("bounces").notNull().default(0),
  },
  (t) => [unique("analytics_traffic_daily_uniq").on(t.tenantId, t.day, t.dimension, t.key)],
);

/**
 * What the server-side conversion APIs need about one order (ADR-047, docs/ANALYTICS-PLAN.md slice 5). Written when the order is
 * placed, and only when the visitor accepted the matching cookie category and the store has server-side credentials for it.
 * The request details (IP, user agent, Meta and Google browser ids) are cleared as soon as every platform is settled; the row is
 * deleted 30 days after the order. Customer email and phone are never stored here: they are read from the order and hashed at send time.
 */
export const orderTracking = tenantTable(
  "order_tracking",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    orderId: uuid("order_id").notNull(),
    consentAnalytics: boolean("consent_analytics").notNull().default(false),
    consentMarketing: boolean("consent_marketing").notNull().default(false),
    clientIp: text("client_ip"),
    userAgent: text("user_agent"),
    fbp: text("fbp"),
    fbc: text("fbc"),
    gaClientId: text("ga_client_id"),
    sourceUrl: text("source_url"),
    /** pending | sent | failed | skipped, per platform. `*_detail` says why for failed and skipped; never a credential. */
    metaStatus: text("meta_status").notNull().default("skipped"),
    metaDetail: text("meta_detail"),
    ga4Status: text("ga4_status").notNull().default("skipped"),
    ga4Detail: text("ga4_detail"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("order_tracking_tenant_order_uniq").on(t.tenantId, t.orderId),
    index("order_tracking_tenant_created_idx").on(t.tenantId, t.createdAt),
    tenantForeignKey({ tableTenantId: t.tenantId, column: t.orderId, target: orders, name: "order_tracking_order_fk", onDelete: "cascade" }),
  ],
);
