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
    phone: text("phone").notNull(),
    name: text("name").notNull().default(""),
    emailVerified: boolean("email_verified").notNull().default(false),
    phoneVerified: boolean("phone_verified").notNull().default(false),
    passwordHash: text("password_hash"),
    acceptsMarketing: boolean("accepts_marketing").notNull().default(false),
    marketingConsentAt: timestamp("marketing_consent_at", { withTimezone: true }),
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
