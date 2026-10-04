import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantForeignKey, tenantTable } from "../tenant-table.ts";
import { products, variants } from "./catalog.ts";
import { customers } from "./customers.ts";
import { orderItems } from "./orders.ts";

/**
 * Reviews (PLAN §4 Phase E).
 * Tenant table: RLS enabled.
 * Store product reviews with verified purchase linking and rating aggregations.
 */
export const reviews = tenantTable(
  "reviews",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    productId: uuid("product_id").notNull(),
    variantId: uuid("variant_id"),
    customerId: uuid("customer_id"),
    orderItemId: uuid("order_item_id"),
    reviewerName: text("reviewer_name").notNull(),
    rating: integer("rating").notNull(),
    title: text("title"),
    body: text("body").notNull(),
    status: text("status").notNull().default("on_hold"),
    replyText: text("reply_text"),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("reviews_tenant_id_uniq").on(t.tenantId, t.id),
    index("reviews_tenant_product_status_idx").on(t.tenantId, t.productId, t.status, t.createdAt),
    index("reviews_tenant_status_idx").on(t.tenantId, t.status),
    index("reviews_tenant_customer_idx").on(t.tenantId, t.customerId),
    check("reviews_rating_range_chk", sql`${t.rating} >= 1 AND ${t.rating} <= 5`),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.productId,
      target: products,
      name: "reviews_product_fk",
      onDelete: "cascade",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.variantId,
      target: variants,
      name: "reviews_variant_fk",
      onDelete: "set null",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.customerId,
      target: customers,
      name: "reviews_customer_fk",
      onDelete: "set null",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.orderItemId,
      target: orderItems,
      name: "reviews_order_item_fk",
      onDelete: "set null",
    }),
  ],
);
