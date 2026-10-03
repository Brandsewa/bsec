import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantForeignKey, tenantTable } from "../tenant-table.ts";
import { citext } from "./custom-types.ts";
import { products, variants } from "./catalog.ts";
import { orders } from "./orders.ts";
import { customers } from "./customers.ts";

/**
 * Quote Requests (PLAN §5.7 / ORDERS-QUOTES-PLAN).
 * Inbound quote requests for custom/B2B/price-on-request items.
 * A request is a lead, not an order (no stock reservation, no revenue impact).
 */
export const quoteRequests = tenantTable(
  "quote_requests",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    number: text("number").notNull(),
    productId: uuid("product_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    productTitle: text("product_title").notNull(),
    variantTitle: text("variant_title").notNull(),
    quantity: integer("quantity").notNull().default(1),
    name: text("name").notNull(),
    email: citext("email").notNull(),
    phone: text("phone").notNull(),
    company: text("company"),
    message: text("message"),
    status: text("status").notNull().default("new"), // 'new' | 'quoted' | 'accepted' | 'lost' | 'expired'
    adminNote: text("admin_note"),
    quotedTotal: bigint("quoted_total", { mode: "number" }),
    quoteNote: text("quote_note"),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    quotedAt: timestamp("quoted_at", { withTimezone: true }),
    orderId: uuid("order_id"),
    customerId: uuid("customer_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("quote_requests_tenant_number_uniq").on(t.tenantId, t.number),
    unique("quote_requests_tenant_id_uniq").on(t.tenantId, t.id),
    index("quote_requests_tenant_status_created_idx").on(t.tenantId, t.status, t.createdAt),
    index("quote_requests_tenant_email_idx").on(t.tenantId, t.email),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.productId,
      target: products,
      name: "quote_requests_product_fk",
      onDelete: "restrict",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.variantId,
      target: variants,
      name: "quote_requests_variant_fk",
      onDelete: "restrict",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.orderId,
      target: orders,
      name: "quote_requests_order_fk",
      onDelete: "set null",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.customerId,
      target: customers,
      name: "quote_requests_customer_fk",
      onDelete: "set null",
    }),
  ],
);
