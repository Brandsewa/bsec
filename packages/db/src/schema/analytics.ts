import { sql } from "drizzle-orm";
import { index, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantTable } from "../tenant-table.ts";

/**
 * First-party storefront traffic events (ADR-046, docs/ANALYTICS-PLAN.md).
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
