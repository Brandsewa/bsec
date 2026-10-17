import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenantForeignKey, tenantTable } from "../tenant-table.ts";
import { collections, products } from "./catalog.ts";

/**
 * Custom fields (owner request 2026-10-17, ADR-034). A store defines typed fields for products or collections; each
 * product or collection then holds its own values. Values are validated typed JSON (never raw HTML or code, ADR-010)
 * and are available on the storefront through the theme builder's "Custom field" block.
 * Available on the Growth plan and above (plans.features.custom_fields).
 */
export const customFieldDefinitions = tenantTable(
  "custom_field_definitions",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    resourceType: text("resource_type").notNull(),
    /** Stable handle used by the theme builder (lowercase letters, numbers and underscores). Never changes after creation. */
    key: text("key").notNull(),
    name: text("name").notNull(),
    /** text | rich_text | image | dropdown | multi_select | number | boolean. Never changes after creation. */
    type: text("type").notNull(),
    helpText: text("help_text"),
    required: boolean("required").notNull().default(false),
    showOnStorefront: boolean("show_on_storefront").notNull().default(true),
    /** Type settings: { options: [{ value, label }] } for dropdown and multi_select. */
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    position: integer("position").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("custom_field_definitions_tenant_key_uniq").on(t.tenantId, t.resourceType, t.key),
    unique("custom_field_definitions_tenant_id_uniq").on(t.tenantId, t.id),
    check("custom_field_definitions_resource_chk", sql`${t.resourceType} in ('product', 'collection')`),
    check("custom_field_definitions_type_chk", sql`${t.type} in ('text', 'rich_text', 'image', 'dropdown', 'multi_select', 'number', 'boolean')`),
    index("custom_field_definitions_tenant_resource_idx").on(t.tenantId, t.resourceType, t.position),
  ],
);

export const customFieldValues = tenantTable(
  "custom_field_values",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    definitionId: uuid("definition_id").notNull(),
    productId: uuid("product_id"),
    collectionId: uuid("collection_id"),
    /** Typed by the definition: string, string[], number, boolean, or { mediaId } for images. */
    value: jsonb("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    check("custom_field_values_one_owner_chk", sql`num_nonnulls(${t.productId}, ${t.collectionId}) = 1`),
    uniqueIndex("custom_field_values_product_uniq").on(t.tenantId, t.definitionId, t.productId).where(sql`${t.productId} is not null`),
    uniqueIndex("custom_field_values_collection_uniq").on(t.tenantId, t.definitionId, t.collectionId).where(sql`${t.collectionId} is not null`),
    index("custom_field_values_tenant_product_idx").on(t.tenantId, t.productId),
    index("custom_field_values_tenant_collection_idx").on(t.tenantId, t.collectionId),
    tenantForeignKey({ tableTenantId: t.tenantId, column: t.definitionId, target: customFieldDefinitions, name: "custom_field_values_definition_fk", onDelete: "cascade" }),
    tenantForeignKey({ tableTenantId: t.tenantId, column: t.productId, target: products, name: "custom_field_values_product_fk", onDelete: "cascade" }),
    tenantForeignKey({ tableTenantId: t.tenantId, column: t.collectionId, target: collections, name: "custom_field_values_collection_fk", onDelete: "cascade" }),
  ],
);
