import { sql } from "drizzle-orm";
import { date, index, integer, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { tenantTable } from "../tenant-table.ts";

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
