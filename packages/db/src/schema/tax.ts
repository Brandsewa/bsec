import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantTable } from "../tenant-table.ts";

/**
 * Tax Classes (PLAN §15 / Settings Rebuild Phase 6 / Slice 6A).
 * Source of truth for product GST rates and default HSN codes.
 */
export const taxClasses = tenantTable(
  "tax_classes",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    name: text("name").notNull(),
    rateBps: integer("rate_bps").notNull(),
    defaultHsn: text("default_hsn"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("tax_classes_tenant_name_uniq").on(t.tenantId, t.name),
    unique("tax_classes_tenant_id_uniq").on(t.tenantId, t.id),
    uniqueIndex("tax_classes_one_default").on(t.tenantId).where(sql`"is_default"`),
    check("tax_classes_name_chk", sql`char_length("name") BETWEEN 1 AND 60`),
    check(
      "tax_classes_rate_bps_chk",
      sql`"rate_bps" IN (0, 250, 300, 500, 1200, 1800, 2800)`,
    ),
    check(
      "tax_classes_default_hsn_chk",
      sql`"default_hsn" IS NULL OR "default_hsn" ~ '^[0-9]{4}([0-9]{2}([0-9]{2})?)?$'`,
    ),
  ],
);
