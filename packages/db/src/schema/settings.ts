import { sql } from "drizzle-orm";
import {
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantTable } from "../tenant-table.ts";
import { citext } from "./custom-types.ts";

/**
 * Store settings: core configuration per store (PLAN §5.4).
 * Tenant table: RLS enabled. One row per tenant.
 */
export const storeSettings = tenantTable(
  "store_settings",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    storeName: text("store_name").notNull(),
    legalName: text("legal_name"),
    supportEmail: citext("support_email"),
    supportPhone: text("support_phone"),
    address: jsonb("address"),
    currency: text("currency").notNull().default("INR"),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    weightUnit: text("weight_unit").notNull().default("kg"),
    orderPrefix: text("order_prefix").notNull().default("#"),
    social: jsonb("social"),
    checkout: jsonb("checkout"),
    notifications: jsonb("notifications"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("store_settings_tenant_id_uniq").on(t.tenantId),
  ],
);
