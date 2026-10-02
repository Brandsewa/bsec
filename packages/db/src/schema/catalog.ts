import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantForeignKey, tenantTable } from "../tenant-table.ts";
import { citext } from "./custom-types.ts";

export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/**
 * Media library (PLAN §5.5).
 */
export const media = tenantTable(
  "media",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    storageKey: text("storage_key").notNull(),
    cfImageId: text("cf_image_id"),
    mime: text("mime").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    width: integer("width"),
    height: integer("height"),
    alt: text("alt"),
    folder: text("folder").notNull().default("products"),
    uploadedBy: uuid("uploaded_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("media_tenant_id_uniq").on(t.tenantId, t.id),
    index("media_tenant_created_idx").on(t.tenantId, t.createdAt),
  ],
);

/**
 * Brands (PLAN §5.5).
 */
export const brands = tenantTable(
  "brands",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    name: text("name").notNull(),
    slug: citext("slug").notNull(),
    logoMediaId: uuid("logo_media_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("brands_tenant_slug_uniq").on(t.tenantId, t.slug),
    unique("brands_tenant_id_uniq").on(t.tenantId, t.id),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.logoMediaId,
      target: media,
      name: "brands_logo_media_fk",
      onDelete: "set null",
    }),
  ],
);

/**
 * Inventory locations (PLAN §5.4).
 */
export const locations = tenantTable(
  "locations",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    name: text("name").notNull(),
    address: jsonb("address"),
    pincode: text("pincode"),
    isDefault: boolean("is_default").notNull().default(false),
    shiprocketPickupName: text("shiprocket_pickup_name"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("locations_tenant_id_uniq").on(t.tenantId, t.id),
    index("locations_tenant_idx").on(t.tenantId),
  ],
);

/**
 * Categories tree (PLAN §5.5).
 */
export const categories = tenantTable(
  "categories",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    slug: citext("slug").notNull(),
    description: text("description"),
    imageMediaId: uuid("image_media_id"),
    position: integer("position").notNull().default(0),
    path: text("path").notNull().default("/"),
    seo: jsonb("seo"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("categories_tenant_slug_uniq").on(t.tenantId, t.slug),
    unique("categories_tenant_id_uniq").on(t.tenantId, t.id),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.parentId,
      target: { tenantId: t.tenantId, id: t.id },
      name: "categories_parent_fk",
      onDelete: "set null",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.imageMediaId,
      target: media,
      name: "categories_image_media_fk",
      onDelete: "set null",
    }),
  ],
);

/**
 * Products (PLAN §5.5).
 */
export const products = tenantTable(
  "products",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    title: text("title").notNull(),
    slug: citext("slug").notNull(),
    status: text("status").notNull().default("draft"),
    descriptionJson: jsonb("description_json"),
    shortDescription: text("short_description"),
    brandId: uuid("brand_id"),
    productType: text("product_type"),
    tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
    seo: jsonb("seo"),
    taxClassId: uuid("tax_class_id"),
    hsn: text("hsn"),
    requiresShipping: boolean("requires_shipping").notNull().default(true),
    isFeatured: boolean("is_featured").notNull().default(false),
    priceOnRequest: boolean("price_on_request").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('english', coalesce("title", '') || ' ' || coalesce("short_description", ''))`,
    ),
    ratingAvg: numeric("rating_avg", { precision: 3, scale: 2 }).notNull().default("0.00"),
    ratingCount: integer("rating_count").notNull().default(0),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("products_tenant_slug_uniq").on(t.tenantId, t.slug),
    unique("products_tenant_id_uniq").on(t.tenantId, t.id),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.brandId,
      target: brands,
      name: "products_brand_fk",
      onDelete: "set null",
    }),
    index("products_tenant_status_idx").on(t.tenantId, t.status),
    index("products_search_vector_gin_idx").using("gin", t.searchVector),
    index("products_title_trgm_idx").using("gin", sql`"title" gin_trgm_ops`),
  ],
);

/**
 * Product Options (PLAN §5.5).
 */
export const productOptions = tenantTable(
  "product_options",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    productId: uuid("product_id").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    values: text("values").array().notNull().default(sql`ARRAY[]::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.productId,
      target: products,
      name: "product_options_product_fk",
      onDelete: "cascade",
    }),
    index("product_options_tenant_product_idx").on(t.tenantId, t.productId),
  ],
);

/**
 * Product Variants (PLAN §5.5).
 */
export const variants = tenantTable(
  "variants",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    productId: uuid("product_id").notNull(),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    title: text("title").notNull(),
    optionValues: jsonb("option_values"),
    price: bigint("price", { mode: "bigint" }).notNull(),
    compareAtPrice: bigint("compare_at_price", { mode: "bigint" }),
    costPrice: bigint("cost_price", { mode: "bigint" }),
    weightGrams: integer("weight_grams"),
    dimensions: jsonb("dimensions"),
    trackInventory: boolean("track_inventory").notNull().default(true),
    allowBackorder: boolean("allow_backorder").notNull().default(false),
    preorderEnabled: boolean("preorder_enabled").notNull().default(false),
    preorderShipsOn: date("preorder_ships_on"),
    preorderMessage: text("preorder_message"),
    position: integer("position").notNull().default(0),
    imageMediaId: uuid("image_media_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("variants_tenant_sku_uniq").on(t.tenantId, t.sku),
    unique("variants_tenant_id_uniq").on(t.tenantId, t.id),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.productId,
      target: products,
      name: "variants_product_fk",
      onDelete: "cascade",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.imageMediaId,
      target: media,
      name: "variants_image_media_fk",
      onDelete: "set null",
    }),
    index("variants_tenant_product_idx").on(t.tenantId, t.productId),
  ],
);

/**
 * Product Media relationship (PLAN §5.5).
 */
export const productMedia = tenantTable(
  "product_media",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    productId: uuid("product_id").notNull(),
    mediaId: uuid("media_id").notNull(),
    variantId: uuid("variant_id"),
    position: integer("position").notNull().default(0),
    alt: text("alt"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.productId,
      target: products,
      name: "product_media_product_fk",
      onDelete: "cascade",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.mediaId,
      target: media,
      name: "product_media_media_fk",
      onDelete: "cascade",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.variantId,
      target: variants,
      name: "product_media_variant_fk",
      onDelete: "set null",
    }),
    index("product_media_tenant_product_idx").on(t.tenantId, t.productId),
  ],
);

/**
 * Product Categories cross table (PLAN §5.5).
 */
export const productCategories = tenantTable(
  "product_categories",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    productId: uuid("product_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("product_categories_tenant_prod_cat_uniq").on(t.tenantId, t.productId, t.categoryId),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.productId,
      target: products,
      name: "product_categories_product_fk",
      onDelete: "cascade",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.categoryId,
      target: categories,
      name: "product_categories_category_fk",
      onDelete: "cascade",
    }),
  ],
);

/**
 * Collections (PLAN §5.5).
 */
export const collections = tenantTable(
  "collections",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    title: text("title").notNull(),
    slug: citext("slug").notNull(),
    type: text("type").notNull().default("manual"),
    rules: jsonb("rules"),
    match: text("match").notNull().default("all"),
    sortOrder: text("sort_order").notNull().default("manual"),
    imageMediaId: uuid("image_media_id"),
    seo: jsonb("seo"),
    published: boolean("published").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("collections_tenant_slug_uniq").on(t.tenantId, t.slug),
    unique("collections_tenant_id_uniq").on(t.tenantId, t.id),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.imageMediaId,
      target: media,
      name: "collections_image_media_fk",
      onDelete: "set null",
    }),
  ],
);

/**
 * Collection Products (PLAN §5.5).
 */
export const collectionProducts = tenantTable(
  "collection_products",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    collectionId: uuid("collection_id").notNull(),
    productId: uuid("product_id").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("collection_products_tenant_col_prod_uniq").on(t.tenantId, t.collectionId, t.productId),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.collectionId,
      target: collections,
      name: "collection_products_collection_fk",
      onDelete: "cascade",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.productId,
      target: products,
      name: "collection_products_product_fk",
      onDelete: "cascade",
    }),
  ],
);

/**
 * Inventory Levels (PLAN §5.5).
 */
export const inventoryLevels = tenantTable(
  "inventory_levels",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    variantId: uuid("variant_id").notNull(),
    locationId: uuid("location_id").notNull(),
    onHand: integer("on_hand").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    available: integer("available").generatedAlwaysAs(sql`"on_hand" - "reserved"`),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("inventory_levels_tenant_var_loc_uniq").on(t.tenantId, t.variantId, t.locationId),
    check("inventory_levels_reserved_lte_on_hand", sql`"reserved" <= "on_hand"`),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.variantId,
      target: variants,
      name: "inventory_levels_variant_fk",
      onDelete: "cascade",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.locationId,
      target: locations,
      name: "inventory_levels_location_fk",
      onDelete: "cascade",
    }),
  ],
);

/**
 * Inventory movements ledger (PLAN §5.5).
 */
export const inventoryMovements = tenantTable(
  "inventory_movements",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    variantId: uuid("variant_id").notNull(),
    locationId: uuid("location_id").notNull(),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    note: text("note"),
    actorId: uuid("actor_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.variantId,
      target: variants,
      name: "inventory_movements_variant_fk",
      onDelete: "cascade",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.locationId,
      target: locations,
      name: "inventory_movements_location_fk",
      onDelete: "cascade",
    }),
    index("inventory_movements_tenant_variant_idx").on(t.tenantId, t.variantId),
  ],
);
