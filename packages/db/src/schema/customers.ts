import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantForeignKey, tenantTable } from "../tenant-table.ts";
import { citext } from "./custom-types.ts";
import { variants } from "./catalog.ts";

/**
 * Customers (PLAN §5.6 / M4).
 * Store-scoped customer identity.
 */
export const customers = tenantTable(
  "customers",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    email: citext("email").notNull(),
    phone: text("phone"),
    name: text("name").notNull().default(""),
    emailVerified: boolean("email_verified").notNull().default(false),
    phoneVerified: boolean("phone_verified").notNull().default(false),
    passwordHash: text("password_hash"),
    isGuest: boolean("is_guest").notNull().default(false),
    acceptsMarketing: boolean("accepts_marketing").notNull().default(false),
    marketingConsentAt: timestamp("marketing_consent_at", { withTimezone: true }),
    marketingState: text("marketing_state").notNull().default("not_subscribed"), // subscribed, unsubscribed, not_subscribed, invalid
    marketingSource: text("marketing_source"),
    marketingUpdatedAt: timestamp("marketing_updated_at", { withTimezone: true }),
    tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
    note: text("note"),
    totalSpent: bigint("total_spent", { mode: "number" }).notNull().default(0),
    ordersCount: integer("orders_count").notNull().default(0),
    lastOrderAt: timestamp("last_order_at", { withTimezone: true }),
    status: text("status").notNull().default("active"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("customers_tenant_email_uniq").on(t.tenantId, t.email),
    unique("customers_tenant_phone_uniq").on(t.tenantId, t.phone),
    unique("customers_tenant_id_uniq").on(t.tenantId, t.id),
    index("customers_tenant_status_idx").on(t.tenantId, t.status),
    index("customers_tenant_guest_idx").on(t.tenantId, t.isGuest),
    index("customers_tenant_marketing_state_idx").on(t.tenantId, t.marketingState),
  ],
);

/**
 * Customer Consent Events (PLAN §0c / DPDP Compliance).
 * Immutable append-only audit trail of customer marketing consent transitions.
 */
export const customerConsentEvents = tenantTable(
  "customer_consent_events",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    customerId: uuid("customer_id").notNull(),
    channel: text("channel").notNull().default("email"), // email, sms
    state: text("state").notNull(), // subscribed, unsubscribed, not_subscribed, invalid
    source: text("source").notNull(), // checkout, storefront_form, account_page, admin, import, unsubscribe_link, legacy
    actorType: text("actor_type").notNull().default("customer"), // customer, staff, system
    actorId: text("actor_id"),
    ip: text("ip"),
    at: timestamp("at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("customer_consent_events_tenant_id_uniq").on(t.tenantId, t.id),
    index("customer_consent_events_tenant_cust_at_idx").on(t.tenantId, t.customerId, t.at),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.customerId,
      target: customers,
      name: "customer_consent_events_customer_fk",
      onDelete: "cascade",
    }),
  ],
);

/**
 * Customer Notes (Customers Phase 1, step 1B).
 * Staff-visible timeline of internal notes about a customer; replaces the single
 * `customers.note` column (which is migrated into the first note by migration 0029).
 */
export const customerNotes = tenantTable(
  "customer_notes",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    customerId: uuid("customer_id").notNull(),
    /** Staff author; null for the migrated legacy note or system-written notes. */
    authorId: uuid("author_id"),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("customer_notes_tenant_id_uniq").on(t.tenantId, t.id),
    index("customer_notes_tenant_cust_created_idx").on(t.tenantId, t.customerId, t.createdAt),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.customerId,
      target: customers,
      name: "customer_notes_customer_fk",
      onDelete: "cascade",
    }),
  ],
);

/**
 * Customer Addresses (PLAN §5.6 / M4).
 * Shipping and billing address book per customer.
 */
export const customerAddresses = tenantTable(
  "customer_addresses",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    customerId: uuid("customer_id").notNull(),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    line1: text("line1").notNull(),
    line2: text("line2"),
    landmark: text("landmark"),
    city: text("city").notNull(),
    stateCode: text("state_code").notNull(),
    pincode: text("pincode").notNull(),
    country: text("country").notNull().default("IN"),
    type: text("type").notNull().default("home"), // 'home', 'work', 'other'
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index("customer_addresses_tenant_cust_idx").on(t.tenantId, t.customerId),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.customerId,
      target: customers,
      name: "customer_addresses_customer_fk",
      onDelete: "cascade",
    }),
  ],
);

/**
 * Wishlist Items (PLAN §5.6 / M4).
 * Saved customer wishlist items.
 */
export const wishlistItems = tenantTable(
  "wishlist_items",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    customerId: uuid("customer_id").notNull(),
    productId: uuid("product_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("wishlist_items_tenant_cust_var_uniq").on(t.tenantId, t.customerId, t.variantId),
    index("wishlist_items_tenant_cust_idx").on(t.tenantId, t.customerId),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.customerId,
      target: customers,
      name: "wishlist_items_customer_fk",
      onDelete: "cascade",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.variantId,
      target: variants,
      name: "wishlist_items_variant_fk",
      onDelete: "cascade",
    }),
  ],
);

/**
 * Customer OTPs (PLAN §9 / M4).
 * Store-scoped phone OTP tokens for customer authentication.
 */
export const customerOtps = tenantTable(
  "customer_otps",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    phone: text("phone").notNull(),
    otpHash: text("otp_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index("customer_otps_tenant_phone_idx").on(t.tenantId, t.phone),
  ],
);
