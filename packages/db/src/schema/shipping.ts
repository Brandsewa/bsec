import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantForeignKey, tenantTable } from "../tenant-table.ts";
import { orders, orderItems } from "./orders.ts";
import { locations } from "./catalog.ts";
import { customers } from "./customers.ts";

/**
 * Fulfillments (PLAN §5.7 remainder / M5).
 * Represents a package or shipment dispatched for an order.
 */
export const fulfillments = tenantTable(
  "fulfillments",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    orderId: uuid("order_id").notNull(),
    locationId: uuid("location_id").notNull(),
    status: text("status").notNull().default("pending"),
    carrier: text("carrier"),
    awb: text("awb"),
    trackingUrl: text("tracking_url"),
    shiprocketShipmentId: text("shiprocket_shipment_id"),
    labelKey: text("label_key"),
    weightGrams: integer("weight_grams").default(0),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("fulfillments_tenant_id_uniq").on(t.tenantId, t.id),
    index("fulfillments_tenant_order_idx").on(t.tenantId, t.orderId),
    index("fulfillments_tenant_status_idx").on(t.tenantId, t.status),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.orderId,
      target: orders,
      name: "fulfillments_order_fk",
      onDelete: "cascade",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.locationId,
      target: locations,
      name: "fulfillments_location_fk",
      onDelete: "restrict",
    }),
  ],
);

/**
 * Fulfillment Items (PLAN §5.7 remainder / M5).
 * Quantities of specific order items packed into this fulfillment.
 */
export const fulfillmentItems = tenantTable(
  "fulfillment_items",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    fulfillmentId: uuid("fulfillment_id").notNull(),
    orderItemId: uuid("order_item_id").notNull(),
    quantity: integer("quantity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("fulfillment_items_tenant_id_uniq").on(t.tenantId, t.id),
    index("fulfillment_items_tenant_fulfillment_idx").on(t.tenantId, t.fulfillmentId),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.fulfillmentId,
      target: fulfillments,
      name: "fulfillment_items_fulfillment_fk",
      onDelete: "cascade",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.orderItemId,
      target: orderItems,
      name: "fulfillment_items_order_item_fk",
      onDelete: "cascade",
    }),
  ],
);

/**
 * Tracking Events (PLAN §5.7 remainder / M5).
 * Carrier tracking updates recorded from webhooks.
 */
export const trackingEvents = tenantTable(
  "tracking_events",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    fulfillmentId: uuid("fulfillment_id").notNull(),
    status: text("status").notNull(),
    location: text("location"),
    message: text("message").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    raw: jsonb("raw").default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("tracking_events_tenant_id_uniq").on(t.tenantId, t.id),
    index("tracking_events_tenant_fulfillment_idx").on(t.tenantId, t.fulfillmentId),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.fulfillmentId,
      target: fulfillments,
      name: "tracking_events_fulfillment_fk",
      onDelete: "cascade",
    }),
  ],
);

/**
 * Returns (PLAN §5.7 remainder / M5).
 * Return requests submitted by customers or created by admin.
 */
export const returns = tenantTable(
  "returns",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    orderId: uuid("order_id").notNull(),
    customerId: uuid("customer_id"),
    number: text("number").notNull(),
    status: text("status").notNull().default("requested"),
    reason: text("reason").notNull(),
    resolution: text("resolution").notNull().default("refund"), // refund, replacement, store_credit
    requestedResolution: text("requested_resolution"), // customer's requested resolution
    customerComment: text("customer_comment"),
    exchangeRequest: text("exchange_request"), // text description of requested exchange item
    decisionMessage: text("decision_message"), // message shown to customer on approve/reject
    instructionsSentAt: timestamp("instructions_sent_at", { withTimezone: true }),
    refundMethod: text("refund_method"), // upi, bank_transfer, cash, original_payment_method, other
    refundReference: text("refund_reference"),
    refundAmount: integer("refund_amount"), // in paise
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    exchangeNote: text("exchange_note"),
    exchangeOrderId: uuid("exchange_order_id"),
    photos: uuid("photos").array().notNull().default(sql`ARRAY[]::uuid[]`),
    adminNote: text("admin_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("returns_tenant_number_uniq").on(t.tenantId, t.number),
    unique("returns_tenant_id_uniq").on(t.tenantId, t.id),
    index("returns_tenant_order_idx").on(t.tenantId, t.orderId),
    index("returns_tenant_status_idx").on(t.tenantId, t.status),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.orderId,
      target: orders,
      name: "returns_order_fk",
      onDelete: "cascade",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.customerId,
      target: customers,
      name: "returns_customer_fk",
      onDelete: "set null",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.exchangeOrderId,
      target: orders,
      name: "returns_exchange_order_fk",
      onDelete: "set null",
    }),
  ],
);

/**
 * Return Items (PLAN §5.7 remainder / M5).
 * Specific order items and quantities included in a return.
 */
export const returnItems = tenantTable(
  "return_items",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    returnId: uuid("return_id").notNull(),
    orderItemId: uuid("order_item_id").notNull(),
    quantity: integer("quantity").notNull(),
    restock: boolean("restock").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("return_items_tenant_id_uniq").on(t.tenantId, t.id),
    index("return_items_tenant_return_idx").on(t.tenantId, t.returnId),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.returnId,
      target: returns,
      name: "return_items_return_fk",
      onDelete: "cascade",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.orderItemId,
      target: orderItems,
      name: "return_items_order_item_fk",
      onDelete: "cascade",
    }),
  ],
);

/**
 * Invoices (PLAN §5.7 remainder, §15 / M5).
 * GST Tax invoices and Credit notes numbered sequentially per Financial Year.
 */
export const invoices = tenantTable(
  "invoices",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    orderId: uuid("order_id").notNull(),
    number: text("number").notNull(),
    fy: text("fy").notNull(),
    type: text("type").notNull().default("invoice"), // invoice, credit_note
    returnId: uuid("return_id"),
    parentInvoiceId: uuid("parent_invoice_id"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().default(sql`now()`),
    sellerGstin: text("seller_gstin"),
    buyerGstin: text("buyer_gstin"),
    placeOfSupplyState: text("place_of_supply_state"),
    totals: jsonb("totals").notNull(), // taxableAmount, cgst, sgst, igst, totalTax, grandTotal
    pdfKey: text("pdf_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("invoices_tenant_type_fy_number_uniq").on(t.tenantId, t.type, t.fy, t.number),
    unique("invoices_tenant_id_uniq").on(t.tenantId, t.id),
    uniqueIndex("invoices_tenant_return_credit_note_uniq")
      .on(t.tenantId, t.returnId)
      .where(sql`"type" = 'credit_note'`),
    index("invoices_tenant_order_idx").on(t.tenantId, t.orderId),
    index("invoices_tenant_fy_idx").on(t.tenantId, t.fy),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.orderId,
      target: orders,
      name: "invoices_order_fk",
      onDelete: "cascade",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.returnId,
      target: returns,
      name: "invoices_return_fk",
      onDelete: "set null",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.parentInvoiceId,
      target: { tenantId: t.tenantId, id: t.id },
      name: "invoices_parent_invoice_fk",
      onDelete: "set null",
    }),
  ],
);

/**
 * Shipping Zones (PLAN §5.4 / M7).
 * Geographic groupings for shipping rates per tenant.
 */
export const shippingZones = tenantTable(
  "shipping_zones",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    name: text("name").notNull(),
    countries: text("countries").array().notNull().default(sql`ARRAY['IN']::text[]`),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("shipping_zones_tenant_id_uniq").on(t.tenantId, t.id),
    index("shipping_zones_tenant_default_idx").on(t.tenantId, t.isDefault),
  ],
);

/**
 * Shipping Rates (PLAN §5.4 / M7).
 * Configurable shipping rates per zone.
 */
export const shippingRates = tenantTable(
  "shipping_rates",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    zoneId: uuid("zone_id").notNull(),
    name: text("name").notNull(),
    method: text("method").notNull().default("standard"), // 'standard' | 'express'
    rateType: text("rate_type").notNull().default("flat"), // 'flat' | 'free_above_threshold'
    pricePaise: integer("price_paise").notNull().default(0),
    thresholdPaise: integer("threshold_paise"),
    minDays: integer("min_days").default(2),
    maxDays: integer("max_days").default(5),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("shipping_rates_tenant_id_uniq").on(t.tenantId, t.id),
    index("shipping_rates_tenant_zone_idx").on(t.tenantId, t.zoneId),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.zoneId,
      target: shippingZones,
      name: "shipping_rates_zone_fk",
      onDelete: "cascade",
    }),
  ],
);
