import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantForeignKey, tenantTable } from "../tenant-table.ts";
import { citext } from "./custom-types.ts";
import { orders } from "./orders.ts";
import { customers } from "./customers.ts";

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

/**
 * Discounts (PLAN §5.8 / M5).
 * Promotional discounts: percent, fixed amount, free shipping, or buy X get Y.
 * Null code indicates an automatic discount applied unconditionally at checkout.
 */
export const discounts = tenantTable(
  "discounts",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    code: citext("code"),
    title: text("title").notNull(),
    type: text("type").notNull(), // percent, fixed, free_shipping, buy_x_get_y
    value: integer("value").notNull(), // percent points (e.g. 20 for 20%) or paise (e.g. 5000 for ₹50)
    appliesTo: jsonb("applies_to").notNull().default(sql`'{"type":"all"}'::jsonb`),
    minSubtotal: bigint("min_subtotal", { mode: "number" }).default(0),
    minQty: integer("min_qty").default(0),
    customerEligibility: jsonb("customer_eligibility").notNull().default(sql`'{"type":"all"}'::jsonb`),
    usageLimit: integer("usage_limit"),
    perCustomerLimit: integer("per_customer_limit"),
    usedCount: integer("used_count").notNull().default(0),
    combinable: boolean("combinable").notNull().default(false),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    status: text("status").notNull().default("active"), // active, scheduled, expired, disabled
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("discounts_tenant_code_uniq").on(t.tenantId, t.code),
    unique("discounts_tenant_id_uniq").on(t.tenantId, t.id),
    index("discounts_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

/**
 * Discount Redemptions (PLAN §5.8 / M5).
 * Immutable record of discount applications to orders.
 */
export const discountRedemptions = tenantTable(
  "discount_redemptions",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    discountId: uuid("discount_id").notNull(),
    orderId: uuid("order_id").notNull(),
    customerId: uuid("customer_id"),
    amount: bigint("amount", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("discount_redemptions_tenant_id_uniq").on(t.tenantId, t.id),
    index("discount_redemptions_tenant_discount_idx").on(t.tenantId, t.discountId),
    index("discount_redemptions_tenant_order_idx").on(t.tenantId, t.orderId),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.discountId,
      target: discounts,
      name: "discount_redemptions_discount_fk",
      onDelete: "restrict",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.orderId,
      target: orders,
      name: "discount_redemptions_order_fk",
      onDelete: "cascade",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.customerId,
      target: customers,
      name: "discount_redemptions_customer_fk",
      onDelete: "set null",
    }),
  ],
);
