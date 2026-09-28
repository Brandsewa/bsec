import { sql } from "drizzle-orm";
import {
  bigint,
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
import { variants } from "./catalog.ts";

/**
 * Carts (PLAN §5.5 / M3).
 * Represents active, abandoned, converted, or expired storefront shopping carts.
 */
export const carts = tenantTable(
  "carts",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    token: text("token").notNull(),
    customerId: uuid("customer_id"),
    email: citext("email"),
    phone: text("phone"),
    currency: text("currency").notNull().default("INR"),
    discountCodes: text("discount_codes").array().notNull().default(sql`ARRAY[]::text[]`),
    shippingAddress: jsonb("shipping_address"),
    shippingRateId: text("shipping_rate_id"),
    notes: text("notes"),
    status: text("status").notNull().default("active"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().default(sql`now()`),
    recoveredAt: timestamp("recovered_at", { withTimezone: true }),
    recoverySentAt: timestamp("recovery_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("carts_tenant_token_uniq").on(t.tenantId, t.token),
    unique("carts_tenant_id_uniq").on(t.tenantId, t.id),
    index("carts_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

/**
 * Cart Items (PLAN §5.5 / M3).
 * Line items within a shopping cart.
 */
export const cartItems = tenantTable(
  "cart_items",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    cartId: uuid("cart_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitPriceSnapshot: bigint("unit_price_snapshot", { mode: "number" }).notNull(),
    properties: jsonb("properties"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("cart_items_tenant_cart_variant_uniq").on(t.tenantId, t.cartId, t.variantId),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.cartId,
      target: carts,
      name: "cart_items_cart_fk",
      onDelete: "cascade",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.variantId,
      target: variants,
      name: "cart_items_variant_fk",
      onDelete: "restrict",
    }),
  ],
);
