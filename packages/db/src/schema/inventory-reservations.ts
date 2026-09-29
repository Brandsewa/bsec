import { sql } from "drizzle-orm";
import {
  index,
  integer,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantForeignKey, tenantTable } from "../tenant-table.ts";
import { locations, variants } from "./catalog.ts";

/**
 * Inventory Reservations (PLAN §5.5, §11.3 / M4).
 * Holds temporary stock allocations during checkout until payment or expiry.
 */
export const inventoryReservations = tenantTable(
  "inventory_reservations",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    variantId: uuid("variant_id").notNull(),
    locationId: uuid("location_id").notNull(),
    orderId: uuid("order_id"),
    cartId: uuid("cart_id"),
    qty: integer("qty").notNull(),
    status: text("status").notNull().default("active"), // 'active', 'committed', 'released', 'expired'
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("inventory_reservations_tenant_id_uniq").on(t.tenantId, t.id),
    index("inv_reservations_tenant_status_expires_idx").on(t.tenantId, t.status, t.expiresAt),
    index("inv_reservations_tenant_order_idx").on(t.tenantId, t.orderId),
    index("inv_reservations_tenant_cart_idx").on(t.tenantId, t.cartId),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.variantId,
      target: variants,
      name: "inv_reservations_variant_fk",
      onDelete: "cascade",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.locationId,
      target: locations,
      name: "inv_reservations_location_fk",
      onDelete: "cascade",
    }),
  ],
);
