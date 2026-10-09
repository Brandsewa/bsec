import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { DIRECT_PRODUCT_STATUSES, LISTED_PRODUCT_STATUSES } from "./product-status.ts";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";
import { isFeatureEnabled } from "../features.ts";
import { publicMediaUrl } from "../media/storage.ts";

export interface CollectionRule {
  field: "tag" | "product_type" | "brand" | "category" | "price" | "in_stock" | "title" | string;
  operator: "equals" | "not_equals" | "contains" | "not_contains" | "greater_than" | "less_than" | "is_set" | "is_not_set" | string;
  value: unknown;
}

export function parseCollectionRules(rules: unknown): CollectionRule[] {
  if (!rules) return [];
  if (Array.isArray(rules)) {
    return rules.filter((r): r is CollectionRule => typeof r === "object" && r !== null && "field" in r && "operator" in r);
  }
  if (typeof rules === "object" && rules !== null && "rules" in rules && Array.isArray((rules as { rules: unknown[] }).rules)) {
    return ((rules as { rules: unknown[] }).rules).filter((r): r is CollectionRule => typeof r === "object" && r !== null && "field" in r && "operator" in r);
  }
  return [];
}

export function buildSingleRuleCondition(rule: CollectionRule, productsTable: typeof schema.products): SQL | undefined {
  const val = rule.value;
  const strVal = String(val ?? "").trim();
  const escaped = strVal.replace(/[%_\\]/g, "\\$&");

  switch (rule.field) {
    case "tag": {
      if (rule.operator === "equals" || rule.operator === "contains") {
        return sql`${strVal} = ANY(${productsTable.tags})`;
      }
      if (rule.operator === "not_equals" || rule.operator === "not_contains") {
        return sql`NOT (${strVal} = ANY(${productsTable.tags}))`;
      }
      return undefined;
    }
    case "product_type": {
      if (rule.operator === "equals") return eq(productsTable.productType, strVal);
      if (rule.operator === "not_equals") return sql`${productsTable.productType} IS DISTINCT FROM ${strVal}`;
      if (rule.operator === "contains") return ilike(productsTable.productType, `%${escaped}%`);
      if (rule.operator === "not_contains") return sql`NOT (${productsTable.productType} ILIKE ${`%${escaped}%`})`;
      return undefined;
    }
    case "brand": {
      if (rule.operator === "equals") return eq(productsTable.brandId, strVal);
      if (rule.operator === "not_equals") return sql`${productsTable.brandId} IS DISTINCT FROM ${strVal}`;
      return undefined;
    }
    case "category": {
      if (rule.operator === "equals") {
        return sql`EXISTS (SELECT 1 FROM product_categories pc WHERE pc.tenant_id = ${productsTable.tenantId} AND pc.product_id = ${productsTable.id} AND pc.category_id = ${strVal}::uuid)`;
      }
      if (rule.operator === "not_equals") {
        return sql`NOT EXISTS (SELECT 1 FROM product_categories pc WHERE pc.tenant_id = ${productsTable.tenantId} AND pc.product_id = ${productsTable.id} AND pc.category_id = ${strVal}::uuid)`;
      }
      return undefined;
    }
    case "title": {
      if (rule.operator === "equals") return eq(productsTable.title, strVal);
      if (rule.operator === "not_equals") return sql`${productsTable.title} != ${strVal}`;
      if (rule.operator === "contains") return ilike(productsTable.title, `%${escaped}%`);
      if (rule.operator === "not_contains") return sql`NOT (${productsTable.title} ILIKE ${`%${escaped}%`})`;
      return undefined;
    }
    case "price": {
      const num = typeof val === "number" ? val : Number(val) || 0;
      if (rule.operator === "greater_than") {
        return sql`EXISTS (SELECT 1 FROM variants v WHERE v.tenant_id = ${productsTable.tenantId} AND v.product_id = ${productsTable.id} AND v.price >= ${num})`;
      }
      if (rule.operator === "less_than") {
        return sql`EXISTS (SELECT 1 FROM variants v WHERE v.tenant_id = ${productsTable.tenantId} AND v.product_id = ${productsTable.id} AND v.price <= ${num})`;
      }
      if (rule.operator === "equals") {
        return sql`EXISTS (SELECT 1 FROM variants v WHERE v.tenant_id = ${productsTable.tenantId} AND v.product_id = ${productsTable.id} AND v.price = ${num})`;
      }
      return undefined;
    }
    case "in_stock": {
      if (val === true || strVal === "true") {
        return sql`EXISTS (SELECT 1 FROM variants v JOIN inventory_levels il ON il.tenant_id = v.tenant_id AND il.variant_id = v.id WHERE v.tenant_id = ${productsTable.tenantId} AND v.product_id = ${productsTable.id} AND (il.on_hand - il.reserved) > 0)`;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

export interface StorefrontBrand {
  id: string;
  name: string;
  slug: string;
  logoMediaId: string | null;
}

export interface StorefrontMedia {
  id: string;
  productId: string;
  mediaId: string;
  position: number;
  alt: string | null;
  url?: string | undefined;
}

export interface StorefrontOption {
  id: string;
  productId: string;
  name: string;
  position: number;
  values: string[];
}

export interface StorefrontVariant {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  title: string;
  optionValues: Record<string, string> | null;
  price: number;
  compareAtPrice?: number | undefined;
  costPrice?: number | undefined;
  weightGrams?: number | undefined;
  dimensions?: Record<string, unknown> | null;
  trackInventory: boolean;
  allowBackorder: boolean;
  preorderEnabled?: boolean | undefined;
  preorderShipsOn?: string | null | undefined;
  preorderMessage?: string | null | undefined;
  position: number;
  imageMediaId: string | null;
  stockStatus: "in_stock" | "low_stock" | "out_of_stock";
  availableQuantity?: number | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface StorefrontProductDetail {
  id: string;
  title: string;
  slug: string;
  status: string;
  descriptionJson: unknown;
  shortDescription: string | null;
  brandId: string | null;
  brand: StorefrontBrand | null;
  productType: string | null;
  tags: string[];
  seo: unknown;
  requiresShipping: boolean;
  isFeatured: boolean;
  priceOnRequest: boolean;
  ratingAvg: string;
  ratingCount: number;
  createdAt: string;
  updatedAt: string;
  options: StorefrontOption[];
  variants: StorefrontVariant[];
  media: StorefrontMedia[];
}

export interface StorefrontProductSummary {
  id: string;
  title: string;
  slug: string;
  shortDescription: string | null;
  priceMin: number;
  priceMax: number;
  compareAtPriceMin?: number | undefined;
  compareAtPriceMax?: number | undefined;
  isFeatured: boolean;
  priceOnRequest?: boolean | undefined;
  ratingAvg: string;
  ratingCount: number;
  primaryImage?: {
    mediaId: string;
    alt: string | null;
    url?: string | undefined;
  } | undefined;
  brand?: StorefrontBrand | null | undefined;
}

export interface StorefrontFacetValue {
  value: string;
  label: string;
  count: number;
  selected: boolean;
}

export interface StorefrontFacet {
  id: string;
  kind: "availability" | "price" | "brand" | "category" | "collection" | "tag" | "option";
  label: string;
  display: "checkbox" | "range" | "swatch";
  optionName?: string | undefined;
  collapsed?: boolean | undefined;
  values?: StorefrontFacetValue[] | undefined;
  range?: {
    min: number;
    max: number;
    currentMin?: number | undefined;
    currentMax?: number | undefined;
  } | undefined;
}

export interface StorefrontFacetedResult {
  menuHandle: string;
  facets: StorefrontFacet[];
  activeFilterCount: number;
}

export interface StorefrontCollectionDetail {
  collection: {
    id: string;
    title: string;
    slug: string;
    type: string;
    rules: unknown;
    sortOrder: string;
    imageMediaId: string | null;
    seo: unknown;
    published: boolean;
    indexable: boolean;
    createdAt: string;
    updatedAt: string;
  };
  products: {
    items: StorefrontProductSummary[];
    total: number;
    page: number;
    limit: number;
  };
  filterData?: StorefrontFacetedResult | undefined;
}

export interface StorefrontCategoryDetail {
  category: {
    id: string;
    parentId: string | null;
    name: string;
    slug: string;
    description: string | null;
    position: number;
    imageMediaId: string | null;
    seo: unknown;
    createdAt: string;
    updatedAt: string;
  };
  products: {
    items: StorefrontProductSummary[];
    total: number;
    page: number;
    limit: number;
  };
  filterData?: StorefrontFacetedResult | undefined;
}

export interface CatalogListingOptions {
  page?: number | undefined;
  limit?: number | undefined;
  sort?: "price_asc" | "price_desc" | "newest" | "title" | undefined;
  inStockOnly?: boolean | undefined;
  filterMenuHandle?: string | undefined;
  filters?: Record<string, string | string[] | undefined> | undefined;
}

/**
 * Retrieves a single published product by slug with joined brand, media, options, and variants.
 */
export async function getStorefrontProduct(
  rt: Runtime,
  ctx: TenantContext,
  slug: string,
): Promise<StorefrontProductDetail | null> {
  const db = rt._db.db;

  const catalogEnabled = await isFeatureEnabled(db, ctx.tenantId, "catalog");
  if (!catalogEnabled) {
    return null;
  }

  return withTenant(db, ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        product: schema.products,
        brand: schema.brands,
      })
      .from(schema.products)
      .leftJoin(
        schema.brands,
        and(
          eq(schema.brands.tenantId, schema.products.tenantId),
          eq(schema.brands.id, schema.products.brandId),
        ),
      )
      .where(
        and(
          eq(schema.products.slug, slug),
          inArray(schema.products.status, [...DIRECT_PRODUCT_STATUSES]),
          isNull(schema.products.deletedAt),
        ),
      )
      .limit(1);

    const first = rows[0];
    if (!first || !first.product) {
      return null;
    }

    const p = first.product;
    const brandRow = first.brand;

    const [mediaRows, optionRows, variantRows] = await Promise.all([
      tx
        .select()
        .from(schema.productMedia)
        .where(eq(schema.productMedia.productId, p.id))
        .orderBy(schema.productMedia.position),
      tx
        .select()
        .from(schema.productOptions)
        .where(eq(schema.productOptions.productId, p.id))
        .orderBy(schema.productOptions.position),
      tx
        .select()
        .from(schema.variants)
        .where(eq(schema.variants.productId, p.id))
        .orderBy(schema.variants.position),
    ]);

    // Query inventory levels to compute stock status for each variant
    const variantIds = variantRows.map((v) => v.id);
    const inventoryByVariant: Record<string, { available: number; lowStock: boolean }> = {};

    if (variantIds.length > 0) {
      const invRows = await tx
        .select({
          variantId: schema.inventoryLevels.variantId,
          onHand: schema.inventoryLevels.onHand,
          reserved: schema.inventoryLevels.reserved,
          lowStockThreshold: schema.inventoryLevels.lowStockThreshold,
        })
        .from(schema.inventoryLevels)
        .where(inArray(schema.inventoryLevels.variantId, variantIds));

      for (const inv of invRows) {
        const avail = (inv.onHand ?? 0) - (inv.reserved ?? 0);
        const existing = inventoryByVariant[inv.variantId] ?? { available: 0, lowStock: false };
        existing.available += avail;
        if (avail <= (inv.lowStockThreshold ?? 0)) {
          existing.lowStock = true;
        }
        inventoryByVariant[inv.variantId] = existing;
      }
    }

    const variants: StorefrontVariant[] = variantRows.map((v) => {
      const inv = inventoryByVariant[v.id];
      let stockStatus: "in_stock" | "low_stock" | "out_of_stock" = "in_stock";

      if (!v.trackInventory) {
        stockStatus = "in_stock";
      } else if (v.allowBackorder || v.preorderEnabled) {
        stockStatus = "in_stock";
      } else if (!inv || inv.available <= 0) {
        stockStatus = "out_of_stock";
      } else if (inv.lowStock) {
        stockStatus = "low_stock";
      }

      return {
        id: v.id,
        productId: v.productId,
        sku: v.sku,
        barcode: v.barcode,
        title: v.title,
        optionValues: v.optionValues as Record<string, string> | null,
        price: Number(v.price),
        compareAtPrice: v.compareAtPrice ? Number(v.compareAtPrice) : undefined,
        costPrice: v.costPrice ? Number(v.costPrice) : undefined,
        weightGrams: v.weightGrams ?? undefined,
        dimensions: v.dimensions as Record<string, unknown> | null,
        trackInventory: v.trackInventory,
        allowBackorder: v.allowBackorder,
        preorderEnabled: v.preorderEnabled,
        preorderShipsOn: v.preorderShipsOn ? (typeof v.preorderShipsOn === "string" ? v.preorderShipsOn : (v.preorderShipsOn as Date).toISOString().slice(0, 10)) : null,
        preorderMessage: v.preorderMessage,
        position: v.position,
        imageMediaId: v.imageMediaId,
        stockStatus,
        availableQuantity: inv?.available,
        createdAt: v.createdAt ? (typeof v.createdAt === "string" ? v.createdAt : v.createdAt.toISOString()) : new Date().toISOString(),
        updatedAt: v.updatedAt ? (typeof v.updatedAt === "string" ? v.updatedAt : v.updatedAt.toISOString()) : new Date().toISOString(),
      };
    });

    const options: StorefrontOption[] = optionRows.map((o) => ({
      id: o.id,
      productId: o.productId,
      name: o.name,
      position: o.position,
      values: o.values,
    }));

    const keysByMedia = await mediaStorageKeys(tx, mediaRows.map((m) => m.mediaId));
    const media: StorefrontMedia[] = mediaRows.map((m) => ({
      id: m.id,
      productId: m.productId,
      mediaId: m.mediaId,
      position: m.position,
      alt: m.alt,
      url: publicMediaUrl(keysByMedia.get(m.mediaId)),
    }));

    return {
      id: p.id,
      title: p.title,
      slug: p.slug,
      status: p.status,
      descriptionJson: p.descriptionJson,
      shortDescription: p.shortDescription,
      brandId: p.brandId,
      brand: brandRow
        ? {
            id: brandRow.id,
            name: brandRow.name,
            slug: brandRow.slug,
            logoMediaId: brandRow.logoMediaId,
          }
        : null,
      productType: p.productType,
      tags: p.tags,
      seo: p.seo,
      requiresShipping: p.requiresShipping,
      isFeatured: p.isFeatured,
      priceOnRequest: Boolean(p.priceOnRequest),
      ratingAvg: p.ratingAvg,
      ratingCount: p.ratingCount,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      options,
      variants,
      media,
    };
  });
}

/**
 * Retrieves a collection and its published products with sorting and pagination.
 */
export async function getStorefrontCollection(
  rt: Runtime,
  ctx: TenantContext,
  slug: string,
  opts?: CatalogListingOptions,
): Promise<StorefrontCollectionDetail | null> {
  const db = rt._db.db;

  const catalogEnabled = await isFeatureEnabled(db, ctx.tenantId, "catalog");
  if (!catalogEnabled) {
    return null;
  }

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [col] = await tx
      .select()
      .from(schema.collections)
      .where(and(eq(schema.collections.slug, slug), eq(schema.collections.published, true)))
      .limit(1);

    if (!col) {
      return null;
    }

    const page = Math.max(1, opts?.page ?? 1);
    const limit = Math.max(1, Math.min(100, opts?.limit ?? 24));
    const offset = (page - 1) * limit;

    // Look up filter menu if handle provided
    let filterMenu: typeof schema.menus.$inferSelect | undefined;
    if (opts?.filterMenuHandle) {
      const [found] = await tx
        .select()
        .from(schema.menus)
        .where(
          and(
            eq(schema.menus.tenantId, ctx.tenantId),
            eq(schema.menus.handle, opts.filterMenuHandle),
            eq(schema.menus.kind, "filter"),
          ),
        )
        .limit(1);
      filterMenu = found;
    }

    const rawItems = Array.isArray(filterMenu?.items) ? (filterMenu.items as Array<Record<string, unknown>>) : [];
    const facetDefs = rawItems
      .filter((it): it is typeof it & { type: "filter"; filter: { kind: string; label: string; display: string; optionName?: string; collapsed?: boolean } } =>
        Boolean(it && typeof it === "object" && it.type === "filter" && it.filter && typeof it.filter === "object"),
      )
      .slice(0, 10);

    const validOptionNames = facetDefs
      .filter((f) => f.filter.kind === "option" && typeof f.filter.optionName === "string" && f.filter.optionName.trim().length > 0)
      .map((f) => f.filter.optionName?.trim() ?? "")
      .filter(Boolean);

    // Parse filter inputs with bounded limits
    const rawFilters = opts?.filters ?? {};
    const parsedInStock = opts?.inStockOnly || rawFilters["in_stock"] === "1" || rawFilters["in_stock"] === "true" || rawFilters["inStockOnly"] === "true";

    let priceMin: number | undefined;
    let priceMax: number | undefined;
    const rawPrice = rawFilters["price"];
    if (typeof rawPrice === "string" && rawPrice.includes("-")) {
      const [minStr, maxStr] = rawPrice.split("-");
      const minNum = minStr && minStr.trim() !== "" ? Number(minStr) : undefined;
      const maxNum = maxStr && maxStr.trim() !== "" ? Number(maxStr) : undefined;
      if (minNum !== undefined && !Number.isNaN(minNum)) {
        priceMin = Math.max(0, Math.min(1_000_000_000, Math.round(minNum)));
      }
      if (maxNum !== undefined && !Number.isNaN(maxNum)) {
        priceMax = Math.max(0, Math.min(1_000_000_000, Math.round(maxNum)));
      }
    }

    const parseListParam = (val: unknown): string[] => {
      if (!val) return [];
      const parts = Array.isArray(val) ? val.map(String) : String(val).split(",");
      return parts.map((s) => s.trim()).filter((s) => s.length > 0).slice(0, 20);
    };

    const brandSlugs = parseListParam(rawFilters["brand"]);
    const categorySlugs = parseListParam(rawFilters["category"]);
    const collectionSlugs = parseListParam(rawFilters["collection"]);
    const tags = parseListParam(rawFilters["tag"]);

    const optionsFilters: Record<string, string[]> = {};
    for (const optName of validOptionNames) {
      const val = rawFilters[optName.toLowerCase()] ?? rawFilters[optName];
      const parsedVals = parseListParam(val);
      if (parsedVals.length > 0) {
        optionsFilters[optName] = parsedVals;
      }
    }

    // Build parameterized filter conditions
    const filterConditions: SQL[] = [];
    if (parsedInStock) {
      filterConditions.push(
        sql`exists (select 1 from variants v join inventory_levels il on il.tenant_id = v.tenant_id and il.variant_id = v.id where v.tenant_id = ${schema.products.tenantId} and v.product_id = ${schema.products.id} and (il.on_hand - il.reserved) > 0)`
      );
    }
    if (priceMin !== undefined && priceMax !== undefined) {
      filterConditions.push(
        sql`exists (select 1 from variants v where v.tenant_id = ${schema.products.tenantId} and v.product_id = ${schema.products.id} and v.price >= ${priceMin} and v.price <= ${priceMax})`
      );
    } else if (priceMin !== undefined) {
      filterConditions.push(
        sql`exists (select 1 from variants v where v.tenant_id = ${schema.products.tenantId} and v.product_id = ${schema.products.id} and v.price >= ${priceMin})`
      );
    } else if (priceMax !== undefined) {
      filterConditions.push(
        sql`exists (select 1 from variants v where v.tenant_id = ${schema.products.tenantId} and v.product_id = ${schema.products.id} and v.price <= ${priceMax})`
      );
    }
    if (brandSlugs.length > 0) {
      filterConditions.push(
        sql`exists (select 1 from ${schema.brands} where ${schema.brands.tenantId} = ${schema.products.tenantId} and ${schema.brands.id} = ${schema.products.brandId} and ${inArray(schema.brands.slug, brandSlugs)})`
      );
    }
    if (categorySlugs.length > 0) {
      filterConditions.push(
        sql`exists (select 1 from ${schema.productCategories} join ${schema.categories} on ${schema.categories.tenantId} = ${schema.productCategories.tenantId} and ${schema.categories.id} = ${schema.productCategories.categoryId} where ${schema.productCategories.tenantId} = ${schema.products.tenantId} and ${schema.productCategories.productId} = ${schema.products.id} and ${inArray(schema.categories.slug, categorySlugs)})`
      );
    }
    if (collectionSlugs.length > 0) {
      filterConditions.push(
        sql`exists (select 1 from ${schema.collectionProducts} join ${schema.collections} on ${schema.collections.tenantId} = ${schema.collectionProducts.tenantId} and ${schema.collections.id} = ${schema.collectionProducts.collectionId} where ${schema.collectionProducts.tenantId} = ${schema.products.tenantId} and ${schema.collectionProducts.productId} = ${schema.products.id} and ${inArray(schema.collections.slug, collectionSlugs)})`
      );
    }
    if (tags.length > 0) {
      const tagCond = or(...tags.map((t) => sql`${t} = ANY(${schema.products.tags})`));
      if (tagCond) filterConditions.push(tagCond);
    }
    for (const [optName, optVals] of Object.entries(optionsFilters)) {
      if (optVals.length > 0) {
        filterConditions.push(
          sql`exists (select 1 from variants v where v.tenant_id = ${schema.products.tenantId} and v.product_id = ${schema.products.id} and ${or(...optVals.map((val) => sql`v.option_values ->> ${optName} = ${val}`))})`
        );
      }
    }

    const minPriceSql = sql`(select min(v.price) from variants v where v.tenant_id = ${schema.products.tenantId} and v.product_id = ${schema.products.id})`;

    const effectiveSort = opts?.sort ?? col.sortOrder;
    let orderClause = asc(schema.products.createdAt);
    if (effectiveSort === "price_asc") {
      orderClause = asc(minPriceSql);
    } else if (effectiveSort === "price_desc") {
      orderClause = desc(minPriceSql);
    } else if (effectiveSort === "newest" || effectiveSort === "created_desc") {
      orderClause = desc(schema.products.createdAt);
    } else if (effectiveSort === "oldest" || effectiveSort === "created_asc") {
      orderClause = asc(schema.products.createdAt);
    } else if (effectiveSort === "title" || effectiveSort === "title_asc") {
      orderClause = asc(schema.products.title);
    } else if (effectiveSort === "title_desc") {
      orderClause = desc(schema.products.title);
    }

    let prodRows: Array<{ product: typeof schema.products.$inferSelect }>;
    let total: number;

    const isAutomated = col.type === "automated" && col.rules;
    const parsedRules = isAutomated ? parseCollectionRules(col.rules) : [];
    const ruleConditions = parsedRules.map((rule) => buildSingleRuleCondition(rule, schema.products));
    const combinedRules = isAutomated
      ? (col.match === "any" ? (ruleConditions.length > 0 ? or(...ruleConditions) : undefined) : (ruleConditions.length > 0 ? and(...ruleConditions) : undefined))
      : undefined;

    const autoBaseWhere = and(
      eq(schema.products.tenantId, ctx.tenantId),
      inArray(schema.products.status, [...LISTED_PRODUCT_STATUSES]),
      isNull(schema.products.deletedAt),
      combinedRules,
    );

    const manualBaseWhere = and(
      eq(schema.collectionProducts.collectionId, col.id),
      inArray(schema.products.status, [...LISTED_PRODUCT_STATUSES]),
      isNull(schema.products.deletedAt),
    );

    if (isAutomated) {
      const autoWhere = and(autoBaseWhere, ...filterConditions);

      prodRows = await tx
        .select({ product: schema.products })
        .from(schema.products)
        .where(autoWhere)
        .orderBy(orderClause)
        .limit(limit)
        .offset(offset);

      const countRows = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.products)
        .where(autoWhere);

      total = Number(countRows[0]?.count ?? prodRows.length);
    } else {
      const baseWhere = and(manualBaseWhere, ...filterConditions);

      const manualOrderClause = (effectiveSort === "manual")
        ? asc(schema.collectionProducts.position)
        : orderClause;

      prodRows = await tx
        .select({
          product: schema.products,
        })
        .from(schema.collectionProducts)
        .innerJoin(
          schema.products,
          and(
            eq(schema.products.tenantId, schema.collectionProducts.tenantId),
            eq(schema.products.id, schema.collectionProducts.productId),
          ),
        )
        .where(baseWhere)
        .orderBy(manualOrderClause)
        .limit(limit)
        .offset(offset);

      const countRows = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.collectionProducts)
        .innerJoin(
          schema.products,
          and(
            eq(schema.products.tenantId, schema.collectionProducts.tenantId),
            eq(schema.products.id, schema.collectionProducts.productId),
          ),
        )
        .where(baseWhere);

      total = Number(countRows[0]?.count ?? prodRows.length);
    }

    const productList = prodRows.map((r) => r.product);
    const productIds = productList.map((p) => p.id);
    const summaryItems = await buildProductSummaries(tx, productIds, productList);

    // Compute facet metadata and counts if filterMenu provided
    let filterData: StorefrontFacetedResult | undefined = undefined;
    if (filterMenu && facetDefs.length > 0) {
      const facets: StorefrontFacet[] = [];

      for (const f of facetDefs) {
        const k = f.filter.kind as StorefrontFacet["kind"];
        const display = f.filter.display as StorefrontFacet["display"];

        if (k === "availability") {
          const availCheckSql = sql`exists (select 1 from variants v join inventory_levels il on il.tenant_id = v.tenant_id and il.variant_id = v.id where v.tenant_id = ${schema.products.tenantId} and v.product_id = ${schema.products.id} and (il.on_hand - il.reserved) > 0)`;
          let inStockCount: number;

          if (isAutomated) {
            const [availRow] = await tx
              .select({
                inStockCount: sql<number>`count(case when ${availCheckSql} then 1 end)::int`,
              })
              .from(schema.products)
              .where(autoBaseWhere);
            inStockCount = Number(availRow?.inStockCount ?? 0);
          } else {
            const [availRow] = await tx
              .select({
                inStockCount: sql<number>`count(case when ${availCheckSql} then 1 end)::int`,
              })
              .from(schema.collectionProducts)
              .innerJoin(
                schema.products,
                and(
                  eq(schema.products.tenantId, schema.collectionProducts.tenantId),
                  eq(schema.products.id, schema.collectionProducts.productId),
                ),
              )
              .where(manualBaseWhere);
            inStockCount = Number(availRow?.inStockCount ?? 0);
          }

          facets.push({
            id: "availability",
            kind: "availability",
            label: f.filter.label,
            display,
            collapsed: f.filter.collapsed,
            values: [
              {
                value: "1",
                label: "In stock",
                count: inStockCount,
                selected: Boolean(parsedInStock),
              },
            ],
          });
        } else if (k === "price") {
          let minPrice: number;
          let maxPrice: number;

          if (isAutomated) {
            const [priceRow] = await tx
              .select({
                minPrice: sql<number>`coalesce(min(${schema.variants.price}), 0)::int`,
                maxPrice: sql<number>`coalesce(max(${schema.variants.price}), 0)::int`,
              })
              .from(schema.variants)
              .innerJoin(
                schema.products,
                and(
                  eq(schema.products.tenantId, schema.variants.tenantId),
                  eq(schema.products.id, schema.variants.productId),
                  autoBaseWhere,
                ),
              );
            minPrice = Number(priceRow?.minPrice ?? 0);
            maxPrice = Number(priceRow?.maxPrice ?? 0);
          } else {
            const [priceRow] = await tx
              .select({
                minPrice: sql<number>`coalesce(min(${schema.variants.price}), 0)::int`,
                maxPrice: sql<number>`coalesce(max(${schema.variants.price}), 0)::int`,
              })
              .from(schema.variants)
              .innerJoin(
                schema.collectionProducts,
                and(
                  eq(schema.collectionProducts.tenantId, schema.variants.tenantId),
                  eq(schema.collectionProducts.productId, schema.variants.productId),
                  eq(schema.collectionProducts.collectionId, col.id),
                ),
              )
              .innerJoin(
                schema.products,
                and(
                  eq(schema.products.tenantId, schema.collectionProducts.tenantId),
                  eq(schema.products.id, schema.collectionProducts.productId),
                  inArray(schema.products.status, [...LISTED_PRODUCT_STATUSES]),
                  isNull(schema.products.deletedAt),
                ),
              );
            minPrice = Number(priceRow?.minPrice ?? 0);
            maxPrice = Number(priceRow?.maxPrice ?? 0);
          }

          facets.push({
            id: "price",
            kind: "price",
            label: f.filter.label,
            display,
            collapsed: f.filter.collapsed,
            range: {
              min: minPrice,
              max: maxPrice,
              currentMin: priceMin,
              currentMax: priceMax,
            },
          });
        } else if (k === "brand") {
          let brandRows: Array<{ name: string; slug: string; count: number }>;
          if (isAutomated) {
            brandRows = await tx
              .select({
                name: schema.brands.name,
                slug: schema.brands.slug,
                count: sql<number>`count(distinct ${schema.products.id})::int`,
              })
              .from(schema.brands)
              .innerJoin(
                schema.products,
                and(
                  eq(schema.products.tenantId, schema.brands.tenantId),
                  eq(schema.products.brandId, schema.brands.id),
                  autoBaseWhere,
                ),
              )
              .where(eq(schema.brands.tenantId, ctx.tenantId))
              .groupBy(schema.brands.id, schema.brands.name, schema.brands.slug)
              .orderBy(desc(sql`count(distinct ${schema.products.id})`))
              .limit(20);
          } else {
            brandRows = await tx
              .select({
                name: schema.brands.name,
                slug: schema.brands.slug,
                count: sql<number>`count(distinct ${schema.products.id})::int`,
              })
              .from(schema.brands)
              .innerJoin(
                schema.products,
                and(
                  eq(schema.products.tenantId, schema.brands.tenantId),
                  eq(schema.products.brandId, schema.brands.id),
                  inArray(schema.products.status, [...LISTED_PRODUCT_STATUSES]),
                  isNull(schema.products.deletedAt),
                ),
              )
              .innerJoin(
                schema.collectionProducts,
                and(
                  eq(schema.collectionProducts.tenantId, schema.products.tenantId),
                  eq(schema.collectionProducts.productId, schema.products.id),
                  eq(schema.collectionProducts.collectionId, col.id),
                ),
              )
              .where(eq(schema.brands.tenantId, ctx.tenantId))
              .groupBy(schema.brands.id, schema.brands.name, schema.brands.slug)
              .orderBy(desc(sql`count(distinct ${schema.products.id})`))
              .limit(20);
          }

          facets.push({
            id: "brand",
            kind: "brand",
            label: f.filter.label,
            display,
            collapsed: f.filter.collapsed,
            values: brandRows.map((b) => ({
              value: b.slug,
              label: b.name,
              count: Number(b.count),
              selected: brandSlugs.includes(b.slug),
            })),
          });
        } else if (k === "category") {
          let catRows: Array<{ name: string; slug: string; count: number }>;
          if (isAutomated) {
            catRows = await tx
              .select({
                name: schema.categories.name,
                slug: schema.categories.slug,
                count: sql<number>`count(distinct ${schema.products.id})::int`,
              })
              .from(schema.categories)
              .innerJoin(
                schema.productCategories,
                and(
                  eq(schema.productCategories.tenantId, schema.categories.tenantId),
                  eq(schema.productCategories.categoryId, schema.categories.id),
                ),
              )
              .innerJoin(
                schema.products,
                and(
                  eq(schema.products.tenantId, schema.productCategories.tenantId),
                  eq(schema.products.id, schema.productCategories.productId),
                  autoBaseWhere,
                ),
              )
              .where(eq(schema.categories.tenantId, ctx.tenantId))
              .groupBy(schema.categories.id, schema.categories.name, schema.categories.slug)
              .orderBy(desc(sql`count(distinct ${schema.products.id})`))
              .limit(20);
          } else {
            catRows = await tx
              .select({
                name: schema.categories.name,
                slug: schema.categories.slug,
                count: sql<number>`count(distinct ${schema.products.id})::int`,
              })
              .from(schema.categories)
              .innerJoin(
                schema.productCategories,
                and(
                  eq(schema.productCategories.tenantId, schema.categories.tenantId),
                  eq(schema.productCategories.categoryId, schema.categories.id),
                ),
              )
              .innerJoin(
                schema.products,
                and(
                  eq(schema.products.tenantId, schema.productCategories.tenantId),
                  eq(schema.products.id, schema.productCategories.productId),
                  inArray(schema.products.status, [...LISTED_PRODUCT_STATUSES]),
                  isNull(schema.products.deletedAt),
                ),
              )
              .innerJoin(
                schema.collectionProducts,
                and(
                  eq(schema.collectionProducts.tenantId, schema.products.tenantId),
                  eq(schema.collectionProducts.productId, schema.products.id),
                  eq(schema.collectionProducts.collectionId, col.id),
                ),
              )
              .where(eq(schema.categories.tenantId, ctx.tenantId))
              .groupBy(schema.categories.id, schema.categories.name, schema.categories.slug)
              .orderBy(desc(sql`count(distinct ${schema.products.id})`))
              .limit(20);
          }

          facets.push({
            id: "category",
            kind: "category",
            label: f.filter.label,
            display,
            collapsed: f.filter.collapsed,
            values: catRows.map((c) => ({
              value: c.slug,
              label: c.name,
              count: Number(c.count),
              selected: categorySlugs.includes(c.slug),
            })),
          });
        } else if (k === "tag") {
          let tagRows: Array<{ tag: string; count: number }>;
          if (isAutomated) {
            tagRows = await tx
              .select({
                tag: sql<string>`unnest(${schema.products.tags})`,
                count: sql<number>`count(distinct ${schema.products.id})::int`,
              })
              .from(schema.products)
              .where(
                and(
                  autoBaseWhere,
                  sql`array_length(${schema.products.tags}, 1) > 0`,
                ),
              )
              .groupBy(sql`1`)
              .orderBy(desc(sql`count(distinct ${schema.products.id})`))
              .limit(20);
          } else {
            tagRows = await tx
              .select({
                tag: sql<string>`unnest(${schema.products.tags})`,
                count: sql<number>`count(distinct ${schema.products.id})::int`,
              })
              .from(schema.products)
              .innerJoin(
                schema.collectionProducts,
                and(
                  eq(schema.collectionProducts.tenantId, schema.products.tenantId),
                  eq(schema.collectionProducts.productId, schema.products.id),
                  eq(schema.collectionProducts.collectionId, col.id),
                ),
              )
              .where(
                and(
                  eq(schema.products.tenantId, ctx.tenantId),
                  inArray(schema.products.status, [...LISTED_PRODUCT_STATUSES]),
                  isNull(schema.products.deletedAt),
                  sql`array_length(${schema.products.tags}, 1) > 0`,
                ),
              )
              .groupBy(sql`1`)
              .orderBy(desc(sql`count(distinct ${schema.products.id})`))
              .limit(20);
          }

          facets.push({
            id: "tag",
            kind: "tag",
            label: f.filter.label,
            display,
            collapsed: f.filter.collapsed,
            values: tagRows.map((t) => ({
              value: t.tag,
              label: t.tag,
              count: Number(t.count),
              selected: tags.includes(t.tag),
            })),
          });
        } else if (k === "option" && f.filter.optionName) {
          const optName = f.filter.optionName.trim();
          let optRows: Array<{ val: string; count: number }>;

          if (isAutomated) {
            optRows = await tx
              .select({
                val: sql<string>`${schema.variants.optionValues}->>${optName}`,
                count: sql<number>`count(distinct ${schema.products.id})::int`,
              })
              .from(schema.variants)
              .innerJoin(
                schema.products,
                and(
                  eq(schema.products.tenantId, schema.variants.tenantId),
                  eq(schema.products.id, schema.variants.productId),
                  autoBaseWhere,
                ),
              )
              .where(
                and(
                  eq(schema.variants.tenantId, ctx.tenantId),
                  sql`${schema.variants.optionValues}->>${optName} IS NOT NULL`,
                ),
              )
              .groupBy(sql`1`)
              .orderBy(desc(sql`count(distinct ${schema.products.id})`))
              .limit(20);
          } else {
            optRows = await tx
              .select({
                val: sql<string>`${schema.variants.optionValues}->>${optName}`,
                count: sql<number>`count(distinct ${schema.products.id})::int`,
              })
              .from(schema.variants)
              .innerJoin(
                schema.products,
                and(
                  eq(schema.products.tenantId, schema.variants.tenantId),
                  eq(schema.products.id, schema.variants.productId),
                  inArray(schema.products.status, [...LISTED_PRODUCT_STATUSES]),
                  isNull(schema.products.deletedAt),
                ),
              )
              .innerJoin(
                schema.collectionProducts,
                and(
                  eq(schema.collectionProducts.tenantId, schema.products.tenantId),
                  eq(schema.collectionProducts.productId, schema.products.id),
                  eq(schema.collectionProducts.collectionId, col.id),
                ),
              )
              .where(
                and(
                  eq(schema.variants.tenantId, ctx.tenantId),
                  sql`${schema.variants.optionValues}->>${optName} IS NOT NULL`,
                ),
              )
              .groupBy(sql`1`)
              .orderBy(desc(sql`count(distinct ${schema.products.id})`))
              .limit(20);
          }

          facets.push({
            id: optName.toLowerCase(),
            kind: "option",
            label: f.filter.label,
            display,
            optionName: optName,
            collapsed: f.filter.collapsed,
            values: optRows.map((o) => ({
              value: o.val,
              label: o.val,
              count: Number(o.count),
              selected: optionsFilters[optName]?.includes(o.val) ?? false,
            })),
          });
        }
      }

      const activeFilterCount =
        (parsedInStock ? 1 : 0) +
        (priceMin !== undefined || priceMax !== undefined ? 1 : 0) +
        brandSlugs.length +
        categorySlugs.length +
        collectionSlugs.length +
        tags.length +
        Object.values(optionsFilters).reduce((acc, v) => acc + v.length, 0);

      filterData = {
        menuHandle: filterMenu.handle,
        facets,
        activeFilterCount,
      };
    }

    return {
      collection: {
        id: col.id,
        title: col.title,
        slug: col.slug,
        type: col.type,
        rules: col.rules,
        sortOrder: col.sortOrder,
        imageMediaId: col.imageMediaId,
        seo: col.seo,
        published: col.published,
        indexable: col.indexable,
        createdAt: col.createdAt.toISOString(),
        updatedAt: col.updatedAt.toISOString(),
      },
      products: {
        items: summaryItems,
        total,
        page,
        limit,
      },
      filterData,
    };
  });
}

/**
 * Retrieves a category and its published products with sorting and pagination.
 */
export async function getStorefrontCategory(
  rt: Runtime,
  ctx: TenantContext,
  slug: string,
  opts?: CatalogListingOptions,
): Promise<StorefrontCategoryDetail | null> {
  const db = rt._db.db;

  const catalogEnabled = await isFeatureEnabled(db, ctx.tenantId, "catalog");
  if (!catalogEnabled) {
    return null;
  }

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [cat] = await tx
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.slug, slug))
      .limit(1);

    if (!cat) {
      return null;
    }

    const page = Math.max(1, opts?.page ?? 1);
    const limit = Math.max(1, Math.min(100, opts?.limit ?? 24));
    const offset = (page - 1) * limit;

    const inStockCondition = opts?.inStockOnly
      ? sql`exists (select 1 from variants v join inventory_levels il on il.tenant_id = v.tenant_id and il.variant_id = v.id where v.tenant_id = ${schema.products.tenantId} and v.product_id = ${schema.products.id} and (il.on_hand - il.reserved) > 0)`
      : undefined;

    const baseWhere = and(
      eq(schema.productCategories.categoryId, cat.id),
      inArray(schema.products.status, [...LISTED_PRODUCT_STATUSES]),
      isNull(schema.products.deletedAt),
      inStockCondition,
    );

    const minPriceSql = sql`(select min(v.price) from variants v where v.tenant_id = ${schema.products.tenantId} and v.product_id = ${schema.products.id})`;
    let orderClause = asc(schema.productCategories.position);
    if (opts?.sort === "price_asc") {
      orderClause = asc(minPriceSql);
    } else if (opts?.sort === "price_desc") {
      orderClause = desc(minPriceSql);
    } else if (opts?.sort === "newest") {
      orderClause = desc(schema.products.createdAt);
    } else if (opts?.sort === "title") {
      orderClause = asc(schema.products.title);
    }

    const prodRows = await tx
      .select({
        product: schema.products,
      })
      .from(schema.productCategories)
      .innerJoin(
        schema.products,
        and(
          eq(schema.products.tenantId, schema.productCategories.tenantId),
          eq(schema.products.id, schema.productCategories.productId),
        ),
      )
      .where(baseWhere)
      .orderBy(orderClause)
      .limit(limit)
      .offset(offset);

    const countRows = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.productCategories)
      .innerJoin(
        schema.products,
        and(
          eq(schema.products.tenantId, schema.productCategories.tenantId),
          eq(schema.products.id, schema.productCategories.productId),
        ),
      )
      .where(baseWhere);

    const total = Number(countRows[0]?.count ?? prodRows.length);

    const productList = prodRows.map((r) => r.product);
    const productIds = productList.map((p) => p.id);
    const summaryItems = await buildProductSummaries(tx, productIds, productList);

    return {
      category: {
        id: cat.id,
        parentId: cat.parentId,
        name: cat.name,
        slug: cat.slug,
        description: cat.description,
        position: cat.position,
        imageMediaId: cat.imageMediaId,
        seo: cat.seo,
        createdAt: cat.createdAt.toISOString(),
        updatedAt: cat.updatedAt.toISOString(),
      },
      products: {
        items: summaryItems,
        total,
        page,
        limit,
      },
    };
  });
}

/** Storage keys of the given media files, by media id (the public image address is built from the key). */
async function mediaStorageKeys(
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  mediaIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(mediaIds)];
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({ id: schema.media.id, storageKey: schema.media.storageKey })
    .from(schema.media)
    .where(inArray(schema.media.id, ids));
  return new Map([...rows].map((r) => [r.id, r.storageKey]));
}

/**
 * Products for the storefront home page grid: the newest visible products (featured ones first), or the products of one
 * published collection. Returns an empty list when the catalog feature is off or nothing is published yet.
 */
export async function getStorefrontFeaturedProducts(
  rt: Runtime,
  ctx: TenantContext,
  opts?: { limit?: number | undefined; collectionSlug?: string | undefined },
): Promise<StorefrontProductSummary[]> {
  const db = rt._db.db;
  if (!(await isFeatureEnabled(db, ctx.tenantId, "catalog"))) return [];
  const limit = Math.max(1, Math.min(48, opts?.limit ?? 8));

  if (opts?.collectionSlug) {
    const res = await getStorefrontCollection(rt, ctx, opts.collectionSlug, { limit });
    return res?.products.items ?? [];
  }

  return withTenant(db, ctx.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.products)
      .where(and(inArray(schema.products.status, [...LISTED_PRODUCT_STATUSES]), isNull(schema.products.deletedAt)))
      .orderBy(desc(schema.products.isFeatured), desc(schema.products.createdAt))
      .limit(limit);
    return buildProductSummaries(tx, rows.map((r) => r.id), rows);
  });
}

/**
 * Helper to build product summaries from product records with price bounds and primary image.
 */
export async function buildProductSummaries(
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  productIds: string[],
  products: Array<typeof schema.products.$inferSelect>,
): Promise<StorefrontProductSummary[]> {
  if (productIds.length === 0) return [];

  // Query variants to determine min/max prices
  const variantRows = await tx
    .select({
      productId: schema.variants.productId,
      price: schema.variants.price,
      compareAtPrice: schema.variants.compareAtPrice,
    })
    .from(schema.variants)
    .where(inArray(schema.variants.productId, productIds));

  const pricesByProduct: Record<
    string,
    {
      priceMin: number;
      priceMax: number;
      compareAtPriceMin?: number | undefined;
      compareAtPriceMax?: number | undefined;
    }
  > = {};

  for (const v of variantRows) {
    const pId = v.productId;
    const price = Number(v.price);
    const compareAt = v.compareAtPrice ? Number(v.compareAtPrice) : undefined;
    const existing = pricesByProduct[pId];

    if (!existing) {
      pricesByProduct[pId] = {
        priceMin: price,
        priceMax: price,
        compareAtPriceMin: compareAt,
        compareAtPriceMax: compareAt,
      };
    } else {
      existing.priceMin = Math.min(existing.priceMin, price);
      existing.priceMax = Math.max(existing.priceMax, price);
      if (compareAt !== undefined) {
        existing.compareAtPriceMin =
          existing.compareAtPriceMin !== undefined
            ? Math.min(existing.compareAtPriceMin, compareAt)
            : compareAt;
        existing.compareAtPriceMax =
          existing.compareAtPriceMax !== undefined
            ? Math.max(existing.compareAtPriceMax, compareAt)
            : compareAt;
      }
    }
  }

  // Query primary media
  const mediaRows = await tx
    .select({
      productId: schema.productMedia.productId,
      mediaId: schema.productMedia.mediaId,
      alt: schema.productMedia.alt,
      position: schema.productMedia.position,
    })
    .from(schema.productMedia)
    .where(inArray(schema.productMedia.productId, productIds))
    .orderBy(schema.productMedia.position);

  const keysByMedia = await mediaStorageKeys(tx, mediaRows.map((m) => m.mediaId));
  const mediaByProduct: Record<string, { mediaId: string; alt: string | null; url: string | undefined }> = {};
  for (const m of mediaRows) {
    if (!mediaByProduct[m.productId]) {
      mediaByProduct[m.productId] = {
        mediaId: m.mediaId,
        alt: m.alt,
        url: publicMediaUrl(keysByMedia.get(m.mediaId)),
      };
    }
  }

  return products.map((p) => {
    const prices = pricesByProduct[p.id] ?? { priceMin: 0, priceMax: 0 };
    const primaryImg = mediaByProduct[p.id];

    return {
      id: p.id,
      title: p.title,
      slug: p.slug,
      shortDescription: p.shortDescription,
      priceMin: prices.priceMin,
      priceMax: prices.priceMax,
      compareAtPriceMin: prices.compareAtPriceMin,
      compareAtPriceMax: prices.compareAtPriceMax,
      isFeatured: p.isFeatured,
      priceOnRequest: Boolean(p.priceOnRequest),
      ratingAvg: p.ratingAvg,
      ratingCount: p.ratingCount,
      primaryImage: primaryImg
        ? {
            mediaId: primaryImg.mediaId,
            alt: primaryImg.alt,
            url: primaryImg.url,
          }
        : undefined,
    };
  });
}
