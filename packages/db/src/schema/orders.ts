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
import { variants } from "./catalog.ts";

/**
 * Orders (PLAN §5.7 / M4).
 * Single authoritative order entity with per-tenant sequential numbering.
 */
export const orders = tenantTable(
  "orders",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    number: text("number").notNull(),
    customerId: uuid("customer_id"),
    email: citext("email").notNull(),
    phone: text("phone").notNull(),
    currency: text("currency").notNull().default("INR"),
    status: text("status").notNull().default("pending"),
    paymentStatus: text("payment_status").notNull().default("pending"),
    fulfillmentStatus: text("fulfillment_status").notNull().default("unfulfilled"),
    subtotal: bigint("subtotal", { mode: "number" }).notNull(),
    discountTotal: bigint("discount_total", { mode: "number" }).notNull().default(0),
    shippingTotal: bigint("shipping_total", { mode: "number" }).notNull().default(0),
    taxTotal: bigint("tax_total", { mode: "number" }).notNull().default(0),
    grandTotal: bigint("grand_total", { mode: "number" }).notNull(),
    codFee: bigint("cod_fee", { mode: "number" }).notNull().default(0),
    shippingAddress: jsonb("shipping_address").notNull(),
    billingAddress: jsonb("billing_address"),
    placeOfSupplyState: text("place_of_supply_state"),
    source: text("source").notNull().default("web"),
    cartId: uuid("cart_id"),
    idempotencyKey: text("idempotency_key"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull().default(sql`now()`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("orders_tenant_number_uniq").on(t.tenantId, t.number),
    unique("orders_tenant_id_uniq").on(t.tenantId, t.id),
    unique("orders_tenant_idempotency_key_uniq").on(t.tenantId, t.idempotencyKey),
    index("orders_tenant_status_idx").on(t.tenantId, t.status),
    index("orders_tenant_payment_status_idx").on(t.tenantId, t.paymentStatus),
    index("orders_tenant_customer_id_idx").on(t.tenantId, t.customerId),
    index("orders_tenant_placed_at_idx").on(t.tenantId, t.placedAt),
  ],
);

/**
 * Order Items (PLAN §5.7 / M4).
 * Line item snapshot at purchase time.
 */
export const orderItems = tenantTable(
  "order_items",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    orderId: uuid("order_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    productTitle: text("product_title").notNull(),
    variantTitle: text("variant_title"),
    sku: text("sku"),
    hsn: text("hsn"),
    quantity: integer("quantity").notNull(),
    unitPrice: bigint("unit_price", { mode: "number" }).notNull(),
    discountAmount: bigint("discount_amount", { mode: "number" }).notNull().default(0),
    taxRateBps: integer("tax_rate_bps").notNull().default(0),
    cgst: bigint("cgst", { mode: "number" }).notNull().default(0),
    sgst: bigint("sgst", { mode: "number" }).notNull().default(0),
    igst: bigint("igst", { mode: "number" }).notNull().default(0),
    total: bigint("total", { mode: "number" }).notNull(),
    fulfilledQty: integer("fulfilled_qty").notNull().default(0),
    returnedQty: integer("returned_qty").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index("order_items_tenant_order_idx").on(t.tenantId, t.orderId),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.orderId,
      target: orders,
      name: "order_items_order_fk",
      onDelete: "cascade",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.variantId,
      target: variants,
      name: "order_items_variant_fk",
      onDelete: "restrict",
    }),
  ],
);

/**
 * Order Events (PLAN §5.7 / M4).
 * Immutable append-only audit trail and timeline for state transitions.
 */
export const orderEvents = tenantTable(
  "order_events",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    orderId: uuid("order_id").notNull(),
    type: text("type").notNull(),
    message: text("message").notNull(),
    data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
    actorType: text("actor_type").notNull().default("system"),
    actorId: text("actor_id"),
    visibleToCustomer: boolean("visible_to_customer").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index("order_events_tenant_order_idx").on(t.tenantId, t.orderId),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.orderId,
      target: orders,
      name: "order_events_order_fk",
      onDelete: "cascade",
    }),
  ],
);

/**
 * Order Notes (PLAN §5.7 / M4).
 * Internal store admin staff notes on orders.
 */
export const orderNotes = tenantTable(
  "order_notes",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    orderId: uuid("order_id").notNull(),
    authorId: uuid("author_id").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index("order_notes_tenant_order_idx").on(t.tenantId, t.orderId),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.orderId,
      target: orders,
      name: "order_notes_order_fk",
      onDelete: "cascade",
    }),
  ],
);

/**
 * Number Sequences (PLAN §11.2 / M4).
 * Gapless sequence generator per tenant for orders, invoices, credit notes, returns.
 */
export const numberSequences = tenantTable(
  "number_sequences",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    kind: text("kind").notNull(),
    scope: text("scope").notNull().default(""),
    prefix: text("prefix").notNull().default(""),
    nextValue: bigint("next_value", { mode: "number" }).notNull().default(1),
    padding: integer("padding").notNull().default(4),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("number_sequences_tenant_kind_scope_uniq").on(t.tenantId, t.kind, t.scope),
  ],
);

/**
 * Action Tokens (PLAN §5.7 / M4).
 * Secure, single-purpose, signed action links (e.g. COD confirmation, order tracking).
 */
export const actionTokens = tenantTable(
  "action_tokens",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    purpose: text("purpose").notNull(),
    targetId: text("target_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("action_tokens_tenant_token_hash_uniq").on(t.tenantId, t.tokenHash),
    index("action_tokens_tenant_purpose_target_idx").on(t.tenantId, t.purpose, t.targetId),
  ],
);
