import { sql } from "drizzle-orm";
import {
  index,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantTable } from "../tenant-table.ts";
import { citext } from "./custom-types.ts";

/**
 * Newsletter Subscribers (PLAN §5.5 / M3).
 * Captures email subscriptions from storefront coming soon, footer, or checkout.
 */
export const newsletterSubscribers = tenantTable(
  "newsletter_subscribers",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    email: citext("email").notNull(),
    status: text("status").notNull().default("subscribed"),
    source: text("source").notNull().default("storefront"),
    consentAt: timestamp("consent_at", { withTimezone: true }).notNull().default(sql`now()`),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  },
  (t) => [
    unique("newsletter_subscribers_tenant_email_uniq").on(t.tenantId, t.email),
    index("newsletter_subscribers_tenant_status_idx").on(t.tenantId, t.status),
  ],
);
