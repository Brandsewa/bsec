import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "./runtime.ts";
import { assertPermission, type TenantContext } from "./context.ts";
import { invalidateCache } from "./cache-invalidation.ts";
import { assertProductQuota } from "./system/quotas.ts";

export interface ListProductsQuery {
  search?: string | undefined;
  status?: "draft" | "active" | "archived" | undefined;
  categoryId?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface CreateProductInput {
  title: string;
  slug?: string | undefined;
  status?: "draft" | "active" | "archived" | undefined;
  descriptionJson?: unknown;
  shortDescription?: string | undefined;
  brandId?: string | undefined;
  productType?: string | undefined;
  tags?: string[] | undefined;
  requiresShipping?: boolean | undefined;
  isFeatured?: boolean | undefined;
  options?: Array<{ name: string; values: string[] }> | undefined;
  variants?: Array<{
    sku: string;
    title: string;
    price: number;
    compareAtPrice?: number | undefined;
    costPrice?: number | undefined;
    trackInventory?: boolean | undefined;
    allowBackorder?: boolean | undefined;
    optionValues?: Record<string, string> | undefined;
    imageMediaId?: string | undefined;
  }> | undefined;
}

export interface UpdateProductInput {
  id: string;
  title?: string | undefined;
  slug?: string | undefined;
  status?: "draft" | "active" | "archived" | undefined;
  descriptionJson?: unknown;
  shortDescription?: string | undefined;
  brandId?: string | null | undefined;
  productType?: string | undefined;
  tags?: string[] | undefined;
  requiresShipping?: boolean | undefined;
  isFeatured?: boolean | undefined;
}

export interface UpdateVariantInput {
  id: string;
  sku?: string | undefined;
  title?: string | undefined;
  price?: number | undefined;
  compareAtPrice?: number | null | undefined;
  costPrice?: number | null | undefined;
  trackInventory?: boolean | undefined;
  allowBackorder?: boolean | undefined;
  imageMediaId?: string | null | undefined;
}

export interface AdjustInventoryInput {
  variantId: string;
  locationId: string;
  quantityDelta: number;
  reason: "received" | "sold" | "damaged" | "returned" | "correction" | "transfer";
  notes?: string | undefined;
}

/**
 * List products with search, status filtering, and pagination.
 */
export async function listProducts(
  rt: Runtime,
  ctx: TenantContext,
  query?: ListProductsQuery,
) {
  assertPermission(ctx, "products.read");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const conditions = [];

    if (query?.status) {
      conditions.push(eq(schema.products.status, query.status));
    }
    if (query?.search?.trim()) {
      conditions.push(ilike(schema.products.title, `%${query.search.trim()}%`));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const limit = query?.limit ?? 50;
    const offset = query?.offset ?? 0;

    const rows = await tx
      .select()
      .from(schema.products)
      .where(whereClause)
      .orderBy(desc(schema.products.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ n: total } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.products)
      .where(whereClause);

    // One aggregate per page for price range, variant count and sellable stock.
    const ids = rows.map((r) => r.id);
    const summary = new Map<string, { variantCount: number; priceMin: number | null; priceMax: number | null; stock: number }>();
    if (ids.length > 0) {
      const agg = await tx
        .select({
          productId: schema.variants.productId,
          variantCount: sql<number>`count(distinct ${schema.variants.id})::int`,
          priceMin: sql<string | null>`min(${schema.variants.price})`,
          priceMax: sql<string | null>`max(${schema.variants.price})`,
          stock: sql<string>`coalesce(sum(${schema.inventoryLevels.available}), 0)`,
        })
        .from(schema.variants)
        .leftJoin(schema.inventoryLevels, eq(schema.inventoryLevels.variantId, schema.variants.id))
        .where(inArray(schema.variants.productId, ids))
        .groupBy(schema.variants.productId);
      for (const a of agg) {
        summary.set(a.productId, {
          variantCount: Number(a.variantCount),
          priceMin: a.priceMin === null ? null : Number(a.priceMin),
          priceMax: a.priceMax === null ? null : Number(a.priceMax),
          stock: Number(a.stock),
        });
      }
    }

    return {
      items: rows.map((r) => {
        const sm = summary.get(r.id);
        return {
          id: r.id,
          title: r.title,
          slug: r.slug,
          status: r.status as "draft" | "active" | "archived",
          descriptionJson: r.descriptionJson,
          shortDescription: r.shortDescription,
          brandId: r.brandId,
          productType: r.productType,
          tags: r.tags,
          seo: r.seo,
          taxClassId: r.taxClassId,
          hsn: r.hsn,
          requiresShipping: r.requiresShipping,
          isFeatured: r.isFeatured,
          publishedAt: r.publishedAt ? r.publishedAt.toISOString() : undefined,
          ratingAvg: r.ratingAvg,
          ratingCount: r.ratingCount,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          variantCount: sm?.variantCount ?? 0,
          priceMin: sm?.priceMin ?? null,
          priceMax: sm?.priceMax ?? null,
          stock: sm?.stock ?? 0,
        };
      }),
      total,
    };
  });
}

/**
 * Get product detail by ID including options, variants, and media.
 */
export async function getProduct(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string },
) {
  assertPermission(ctx, "products.read");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [p] = await tx
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, input.id));

    if (!p) {
      throw new Error(`Product not found: "${input.id}"`);
    }

    const options = await tx
      .select()
      .from(schema.productOptions)
      .where(eq(schema.productOptions.productId, input.id));

    const variants = await tx
      .select()
      .from(schema.variants)
      .where(eq(schema.variants.productId, input.id));

    const mediaRows = await tx
      .select()
      .from(schema.productMedia)
      .where(eq(schema.productMedia.productId, input.id));

    return {
      id: p.id,
      title: p.title,
      slug: p.slug,
      status: p.status as "draft" | "active" | "archived",
      descriptionJson: p.descriptionJson,
      shortDescription: p.shortDescription,
      brandId: p.brandId,
      productType: p.productType,
      tags: p.tags,
      seo: p.seo,
      taxClassId: p.taxClassId,
      hsn: p.hsn,
      requiresShipping: p.requiresShipping,
      isFeatured: p.isFeatured,
      publishedAt: p.publishedAt ? p.publishedAt.toISOString() : undefined,
      ratingAvg: p.ratingAvg,
      ratingCount: p.ratingCount,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      options: options.map((o) => ({
        id: o.id,
        productId: o.productId,
        name: o.name,
        position: o.position,
        values: o.values,
      })),
      variants: variants.map((v) => ({
        id: v.id,
        productId: v.productId,
        sku: v.sku,
        barcode: v.barcode,
        title: v.title,
        optionValues: v.optionValues as Record<string, string> | null,
        price: Number(v.price),
        compareAtPrice: v.compareAtPrice ? Number(v.compareAtPrice) : undefined,
        costPrice: v.costPrice ? Number(v.costPrice) : undefined,
        weightGrams: v.weightGrams,
        dimensions: v.dimensions as Record<string, unknown> | null,
        trackInventory: v.trackInventory,
        allowBackorder: v.allowBackorder,
        position: v.position,
        imageMediaId: v.imageMediaId,
        createdAt: v.createdAt.toISOString(),
        updatedAt: v.updatedAt.toISOString(),
      })),
      media: mediaRows.map((m) => ({
        id: m.id,
        productId: m.productId,
        mediaId: m.mediaId,
        position: m.position,
        isPrimary: m.position === 0,
      })),
    };
  });
}

/**
 * Creates a product with optional options, variants, and inventory tracking.
 */
export async function createProduct(
  rt: Runtime,
  ctx: TenantContext,
  input: CreateProductInput,
) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  await assertProductQuota(db, ctx.tenantId);

  return withTenant(db, ctx.tenantId, async (tx) => {
    const slug =
      input.slug?.trim() ||
      input.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

    const [product] = await tx
      .insert(schema.products)
      .values({
        tenantId: ctx.tenantId,
        title: input.title,
        slug,
        status: input.status ?? "draft",
        descriptionJson: input.descriptionJson,
        shortDescription: input.shortDescription,
        brandId: input.brandId,
        productType: input.productType,
        tags: input.tags ?? [],
        requiresShipping: input.requiresShipping ?? true,
        isFeatured: input.isFeatured ?? false,
      })
      .returning();

    if (!product) {
      throw new Error("Failed to create product");
    }

    // Insert options if provided
    const createdOptions = [];
    if (input.options && input.options.length > 0) {
      for (let i = 0; i < input.options.length; i++) {
        const opt = input.options[i];
        if (!opt) continue;
        const [o] = await tx
          .insert(schema.productOptions)
          .values({
            tenantId: ctx.tenantId,
            productId: product.id,
            name: opt.name,
            position: i,
            values: opt.values,
          })
          .returning();
        if (o) createdOptions.push(o);
      }
    }

    // Insert variants
    const createdVariants = [];
    const variantsToInsert =
      input.variants && input.variants.length > 0
        ? input.variants
        : [
            {
              sku: `${slug.toUpperCase()}-DEF`,
              title: "Default Variant",
              price: 0,
              trackInventory: true,
              allowBackorder: false,
            },
          ];

    for (let i = 0; i < variantsToInsert.length; i++) {
      const v = variantsToInsert[i];
      if (!v) continue;
      const [variant] = await tx
        .insert(schema.variants)
        .values({
          tenantId: ctx.tenantId,
          productId: product.id,
          sku: v.sku,
          title: v.title,
          price: BigInt(v.price),
          compareAtPrice: v.compareAtPrice ? BigInt(v.compareAtPrice) : null,
          costPrice: v.costPrice ? BigInt(v.costPrice) : null,
          trackInventory: v.trackInventory ?? true,
          allowBackorder: v.allowBackorder ?? false,
          optionValues: v.optionValues,
          position: i,
          imageMediaId: v.imageMediaId,
        })
        .returning();
      if (variant) createdVariants.push(variant);
    }

    return {
      id: product.id,
      title: product.title,
      slug: product.slug,
      status: product.status as "draft" | "active" | "archived",
      descriptionJson: product.descriptionJson,
      shortDescription: product.shortDescription,
      brandId: product.brandId,
      productType: product.productType,
      tags: product.tags,
      seo: product.seo,
      taxClassId: product.taxClassId,
      hsn: product.hsn,
      requiresShipping: product.requiresShipping,
      isFeatured: product.isFeatured,
      publishedAt: product.publishedAt ? product.publishedAt.toISOString() : undefined,
      ratingAvg: product.ratingAvg,
      ratingCount: product.ratingCount,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
      options: createdOptions.map((o) => ({
        id: o.id,
        productId: o.productId,
        name: o.name,
        position: o.position,
        values: o.values,
      })),
      variants: createdVariants.map((v) => ({
        id: v.id,
        productId: v.productId,
        sku: v.sku,
        barcode: v.barcode,
        title: v.title,
        optionValues: v.optionValues as Record<string, string> | null,
        price: Number(v.price),
        compareAtPrice: v.compareAtPrice ? Number(v.compareAtPrice) : undefined,
        costPrice: v.costPrice ? Number(v.costPrice) : undefined,
        weightGrams: v.weightGrams,
        dimensions: v.dimensions as Record<string, unknown> | null,
        trackInventory: v.trackInventory,
        allowBackorder: v.allowBackorder,
        position: v.position,
        imageMediaId: v.imageMediaId,
        createdAt: v.createdAt.toISOString(),
        updatedAt: v.updatedAt.toISOString(),
      })),
      media: [],
    };
  });
}

/**
 * Updates a product by ID.
 */
export async function updateProduct(
  rt: Runtime,
  ctx: TenantContext,
  input: UpdateProductInput,
) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const updateValues: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (input.title !== undefined) updateValues.title = input.title;
    if (input.slug !== undefined) updateValues.slug = input.slug;
    if (input.status !== undefined) updateValues.status = input.status;
    if (input.descriptionJson !== undefined) updateValues.descriptionJson = input.descriptionJson;
    if (input.shortDescription !== undefined) updateValues.shortDescription = input.shortDescription;
    if (input.brandId !== undefined) updateValues.brandId = input.brandId;
    if (input.productType !== undefined) updateValues.productType = input.productType;
    if (input.tags !== undefined) updateValues.tags = input.tags;
    if (input.requiresShipping !== undefined) updateValues.requiresShipping = input.requiresShipping;
    if (input.isFeatured !== undefined) updateValues.isFeatured = input.isFeatured;

    const [row] = await tx
      .update(schema.products)
      .set(updateValues)
      .where(eq(schema.products.id, input.id))
      .returning();

    if (!row) {
      throw new Error(`Product not found: "${input.id}"`);
    }

    const catRows = await tx
      .select({ categoryId: schema.productCategories.categoryId })
      .from(schema.productCategories)
      .where(eq(schema.productCategories.productId, row.id));

    const colRows = await tx
      .select({ collectionId: schema.collectionProducts.collectionId })
      .from(schema.collectionProducts)
      .where(eq(schema.collectionProducts.productId, row.id));

    await invalidateCache(rt, ctx, {
      type: "product_updated",
      productId: row.id,
      categoryIds: catRows.map((c) => c.categoryId),
      collectionIds: colRows.map((c) => c.collectionId),
      isFeatured: row.isFeatured,
    });

    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      status: row.status as "draft" | "active" | "archived",
      descriptionJson: row.descriptionJson,
      shortDescription: row.shortDescription,
      brandId: row.brandId,
      productType: row.productType,
      tags: row.tags,
      seo: row.seo,
      taxClassId: row.taxClassId,
      hsn: row.hsn,
      requiresShipping: row.requiresShipping,
      isFeatured: row.isFeatured,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : undefined,
      ratingAvg: row.ratingAvg,
      ratingCount: row.ratingCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

/**
 * Deletes a product by ID.
 */
export async function deleteProduct(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string },
) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    await tx.delete(schema.products).where(eq(schema.products.id, input.id));
    return { success: true };
  });
}

/**
 * Updates a product variant by ID.
 */
export async function updateVariant(
  rt: Runtime,
  ctx: TenantContext,
  input: UpdateVariantInput,
) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const updateValues: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (input.sku !== undefined) updateValues.sku = input.sku;
    if (input.title !== undefined) updateValues.title = input.title;
    if (input.price !== undefined) updateValues.price = BigInt(input.price);
    if (input.compareAtPrice !== undefined)
      updateValues.compareAtPrice = input.compareAtPrice !== null ? BigInt(input.compareAtPrice) : null;
    if (input.costPrice !== undefined)
      updateValues.costPrice = input.costPrice !== null ? BigInt(input.costPrice) : null;
    if (input.trackInventory !== undefined) updateValues.trackInventory = input.trackInventory;
    if (input.allowBackorder !== undefined) updateValues.allowBackorder = input.allowBackorder;
    if (input.imageMediaId !== undefined) updateValues.imageMediaId = input.imageMediaId;

    const [row] = await tx
      .update(schema.variants)
      .set(updateValues)
      .where(eq(schema.variants.id, input.id))
      .returning();

    if (!row) {
      throw new Error(`Variant not found: "${input.id}"`);
    }

    const catRows = await tx
      .select({ categoryId: schema.productCategories.categoryId })
      .from(schema.productCategories)
      .where(eq(schema.productCategories.productId, row.productId));

    const colRows = await tx
      .select({ collectionId: schema.collectionProducts.collectionId })
      .from(schema.collectionProducts)
      .where(eq(schema.collectionProducts.productId, row.productId));

    const isImageOnly =
      input.imageMediaId !== undefined &&
      input.price === undefined &&
      input.compareAtPrice === undefined;

    if (isImageOnly) {
      await invalidateCache(rt, ctx, {
        type: "product_image_updated",
        productId: row.productId,
      });
    } else {
      await invalidateCache(rt, ctx, {
        type: "product_price_changed",
        productId: row.productId,
        categoryIds: catRows.map((c) => c.categoryId),
        collectionIds: colRows.map((c) => c.collectionId),
      });
    }

    return {
      id: row.id,
      productId: row.productId,
      sku: row.sku,
      barcode: row.barcode,
      title: row.title,
      optionValues: row.optionValues as Record<string, string> | null,
      price: Number(row.price),
      compareAtPrice: row.compareAtPrice ? Number(row.compareAtPrice) : undefined,
      costPrice: row.costPrice ? Number(row.costPrice) : undefined,
      weightGrams: row.weightGrams,
      dimensions: row.dimensions as Record<string, unknown> | null,
      trackInventory: row.trackInventory,
      allowBackorder: row.allowBackorder,
      position: row.position,
      imageMediaId: row.imageMediaId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

/**
 * Adjusts inventory level and records movement in ledger (PLAN §5.5).
 */
export async function adjustInventory(
  rt: Runtime,
  ctx: TenantContext,
  input: AdjustInventoryInput,
) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    // Find or create inventory level
    const [existing] = await tx
      .select()
      .from(schema.inventoryLevels)
      .where(
        and(
          eq(schema.inventoryLevels.variantId, input.variantId),
          eq(schema.inventoryLevels.locationId, input.locationId),
        ),
      );

    const currentOnHand = existing?.onHand ?? 0;
    const newOnHand = Math.max(0, currentOnHand + input.quantityDelta);

    if (existing) {
      await tx
        .update(schema.inventoryLevels)
        .set({
          onHand: newOnHand,
          updatedAt: new Date(),
        })
        .where(eq(schema.inventoryLevels.id, existing.id));
    } else {
      await tx.insert(schema.inventoryLevels).values({
        tenantId: ctx.tenantId,
        variantId: input.variantId,
        locationId: input.locationId,
        onHand: newOnHand,
        reserved: 0,
      });
    }

    // Ledger entry for auditability (movement ledger)
    await tx.insert(schema.inventoryMovements).values({
      tenantId: ctx.tenantId,
      variantId: input.variantId,
      locationId: input.locationId,
      delta: input.quantityDelta,
      reason: input.reason,
      note: input.notes,
    });

    const isFlip = (currentOnHand === 0 && newOnHand > 0) || (currentOnHand > 0 && newOnHand === 0);
    if (isFlip) {
      const [v] = await tx
        .select({ productId: schema.variants.productId })
        .from(schema.variants)
        .where(eq(schema.variants.id, input.variantId));
      if (v) {
        const colRows = await tx
          .select({ collectionId: schema.collectionProducts.collectionId })
          .from(schema.collectionProducts)
          .where(eq(schema.collectionProducts.productId, v.productId));

        await invalidateCache(rt, ctx, {
          type: "inventory_out_of_stock_flip",
          productId: v.productId,
          collectionIds: colRows.map((c) => c.collectionId),
        });
      }
    }

    return {
      success: true,
      newOnHand,
    };
  });
}

/**
 * List inventory levels across variants and locations.
 */
export async function listInventoryLevels(
  rt: Runtime,
  ctx: TenantContext,
  query?: { locationId?: string | undefined; search?: string | undefined; limit?: number | undefined; offset?: number | undefined } | undefined,
) {
  assertPermission(ctx, "products.read");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    // Every stock-tracked variant at every active location. A variant that has never had stock has no
    // inventory_levels row yet: it is listed with 0 on hand so the owner can add the first stock
    // (adjustInventory creates the row).
    const conditions = [
      eq(schema.variants.trackInventory, true),
      isNull(schema.products.deletedAt),
      eq(schema.locations.isActive, true),
    ];
    if (query?.locationId) {
      conditions.push(eq(schema.locations.id, query.locationId));
    }
    const search = query?.search?.trim();
    if (search) {
      const match = or(
        ilike(schema.products.title, `%${search}%`),
        ilike(schema.variants.title, `%${search}%`),
        ilike(schema.variants.sku, `%${search}%`),
      );
      if (match) conditions.push(match);
    }

    const whereClause = and(...conditions);
    const limit = query?.limit ?? 50;
    const offset = query?.offset ?? 0;

    const rows = await tx
      .select({
        levelId: schema.inventoryLevels.id,
        variantId: schema.variants.id,
        locationId: schema.locations.id,
        onHand: schema.inventoryLevels.onHand,
        reserved: schema.inventoryLevels.reserved,
        variantSku: schema.variants.sku,
        variantTitle: schema.variants.title,
        productTitle: schema.products.title,
        locationName: schema.locations.name,
      })
      .from(schema.variants)
      .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
      .innerJoin(schema.locations, sql`true`)
      .leftJoin(
        schema.inventoryLevels,
        and(eq(schema.inventoryLevels.variantId, schema.variants.id), eq(schema.inventoryLevels.locationId, schema.locations.id)),
      )
      .where(whereClause)
      .orderBy(schema.products.title, schema.variants.title, schema.locations.name)
      .limit(limit)
      .offset(offset);

    const [{ n: total } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.variants)
      .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
      .innerJoin(schema.locations, sql`true`)
      .where(whereClause);

    return {
      items: rows.map((r) => {
        const onHand = r.onHand ?? 0;
        const reserved = r.reserved ?? 0;
        return {
          // A variant with no stock row yet has no row id: use a stable composite for the list key.
          id: r.levelId ?? `${r.variantId}:${r.locationId}`,
          variantId: r.variantId,
          locationId: r.locationId,
          onHand,
          reserved,
          available: onHand - reserved,
          variantSku: r.variantSku,
          variantTitle: r.variantTitle,
          productTitle: r.productTitle,
          locationName: r.locationName,
        };
      }),
      total,
    };
  });
}

// --- Categories ---
export async function listCategories(rt: Runtime, ctx: TenantContext, query?: { parentId?: string | null | undefined } | undefined) {
  assertPermission(ctx, "products.read");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const conditions = [];
    if (query?.parentId !== undefined) {
      if (query.parentId === null) {
        conditions.push(sql`${schema.categories.parentId} IS NULL`);
      } else {
        conditions.push(eq(schema.categories.parentId, query.parentId));
      }
    }
    const rows = await tx
      .select()
      .from(schema.categories)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(schema.categories.position);

    return rows.map((r) => ({
      id: r.id,
      parentId: r.parentId,
      name: r.name,
      slug: r.slug,
      description: r.description,
      position: r.position,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  });
}

export async function createCategory(
  rt: Runtime,
  ctx: TenantContext,
  input: { name: string; slug?: string | undefined; description?: string | undefined; parentId?: string | undefined; position?: number | undefined },
) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const slug =
      input.slug?.trim() ||
      input.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

    const [row] = await tx
      .insert(schema.categories)
      .values({
        tenantId: ctx.tenantId,
        name: input.name,
        slug,
        description: input.description,
        parentId: input.parentId,
        position: input.position ?? 0,
      })
      .returning();

    if (!row) throw new Error("Failed to create category");
    return {
      id: row.id,
      parentId: row.parentId,
      name: row.name,
      slug: row.slug,
      description: row.description,
      position: row.position,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export async function updateCategory(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string; name?: string | undefined; slug?: string | undefined; description?: string | undefined; parentId?: string | null | undefined; position?: number | undefined },
) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const updateValues: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) updateValues.name = input.name;
    if (input.slug !== undefined) updateValues.slug = input.slug;
    if (input.description !== undefined) updateValues.description = input.description;
    if (input.parentId !== undefined) updateValues.parentId = input.parentId;
    if (input.position !== undefined) updateValues.position = input.position;

    const [row] = await tx
      .update(schema.categories)
      .set(updateValues)
      .where(eq(schema.categories.id, input.id))
      .returning();

    if (!row) throw new Error(`Category not found: "${input.id}"`);
    return {
      id: row.id,
      parentId: row.parentId,
      name: row.name,
      slug: row.slug,
      description: row.description,
      position: row.position,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export async function deleteCategory(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    await tx.delete(schema.categories).where(eq(schema.categories.id, input.id));
    return { success: true };
  });
}

// --- Collections ---
export async function listCollections(rt: Runtime, ctx: TenantContext) {
  assertPermission(ctx, "products.read");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const rows = await tx.select().from(schema.collections).orderBy(schema.collections.title);
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      description: undefined,
      imageMediaId: r.imageMediaId,
      isAutomated: r.type === "automated",
      rules: r.rules,
      sortOrder: r.sortOrder,
      publishedAt: r.published ? r.updatedAt.toISOString() : undefined,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  });
}

export async function getCollection(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "products.read");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [row] = await tx.select().from(schema.collections).where(eq(schema.collections.id, input.id));
    if (!row) throw new Error(`Collection not found: "${input.id}"`);

    const colProducts = await tx
      .select({ productId: schema.collectionProducts.productId })
      .from(schema.collectionProducts)
      .where(eq(schema.collectionProducts.collectionId, input.id));

    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      description: undefined,
      imageMediaId: row.imageMediaId,
      isAutomated: row.type === "automated",
      rules: row.rules,
      sortOrder: row.sortOrder,
      publishedAt: row.published ? row.updatedAt.toISOString() : undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      productIds: colProducts.map((p) => p.productId),
    };
  });
}

export async function createCollection(
  rt: Runtime,
  ctx: TenantContext,
  input: {
    title: string;
    slug?: string | undefined;
    description?: string | undefined;
    isAutomated?: boolean | undefined;
    rules?: unknown;
    productIds?: string[] | undefined;
  },
) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const slug =
      input.slug?.trim() ||
      input.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

    const [row] = await tx
      .insert(schema.collections)
      .values({
        tenantId: ctx.tenantId,
        title: input.title,
        slug,
        type: input.isAutomated ? "automated" : "manual",
        rules: input.rules,
        published: true,
      })
      .returning();

    if (!row) throw new Error("Failed to create collection");

    if (input.productIds && input.productIds.length > 0) {
      for (let i = 0; i < input.productIds.length; i++) {
        const pId = input.productIds[i];
        if (!pId) continue;
        await tx.insert(schema.collectionProducts).values({
          tenantId: ctx.tenantId,
          collectionId: row.id,
          productId: pId,
          position: i,
        });
      }
    }

    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      description: undefined,
      imageMediaId: row.imageMediaId,
      isAutomated: row.type === "automated",
      rules: row.rules,
      sortOrder: row.sortOrder,
      publishedAt: row.published ? row.updatedAt.toISOString() : undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export async function updateCollection(
  rt: Runtime,
  ctx: TenantContext,
  input: {
    id: string;
    title?: string | undefined;
    slug?: string | undefined;
    description?: string | undefined;
    isAutomated?: boolean | undefined;
    rules?: unknown;
    productIds?: string[] | undefined;
  },
) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const updateValues: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) updateValues.title = input.title;
    if (input.slug !== undefined) updateValues.slug = input.slug;
    if (input.isAutomated !== undefined) updateValues.type = input.isAutomated ? "automated" : "manual";
    if (input.rules !== undefined) updateValues.rules = input.rules;

    const [row] = await tx
      .update(schema.collections)
      .set(updateValues)
      .where(eq(schema.collections.id, input.id))
      .returning();

    if (!row) throw new Error(`Collection not found: "${input.id}"`);

    if (input.productIds !== undefined) {
      await tx.delete(schema.collectionProducts).where(eq(schema.collectionProducts.collectionId, input.id));
      for (let i = 0; i < input.productIds.length; i++) {
        const pId = input.productIds[i];
        if (!pId) continue;
        await tx.insert(schema.collectionProducts).values({
          tenantId: ctx.tenantId,
          collectionId: row.id,
          productId: pId,
          position: i,
        });
      }
    }

    await invalidateCache(rt, ctx, {
      type: "collection_updated",
      collectionId: row.id,
    });

    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      description: undefined,
      imageMediaId: row.imageMediaId,
      isAutomated: row.type === "automated",
      rules: row.rules,
      sortOrder: row.sortOrder,
      publishedAt: row.published ? row.updatedAt.toISOString() : undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export async function deleteCollection(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    await tx.delete(schema.collections).where(eq(schema.collections.id, input.id));
    return { success: true };
  });
}

// --- Brands ---
export async function listBrands(rt: Runtime, ctx: TenantContext) {
  assertPermission(ctx, "products.read");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const rows = await tx.select().from(schema.brands).orderBy(schema.brands.name);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      logoMediaId: r.logoMediaId,
      createdAt: r.createdAt.toISOString(),
    }));
  });
}

export async function createBrand(
  rt: Runtime,
  ctx: TenantContext,
  input: { name: string; slug?: string | undefined; logoMediaId?: string | undefined },
) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const slug =
      input.slug?.trim() ||
      input.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

    const [row] = await tx
      .insert(schema.brands)
      .values({
        tenantId: ctx.tenantId,
        name: input.name,
        slug,
        logoMediaId: input.logoMediaId,
      })
      .returning();

    if (!row) throw new Error("Failed to create brand");
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      logoMediaId: row.logoMediaId,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

export async function updateBrand(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string; name?: string | undefined; slug?: string | undefined; logoMediaId?: string | null | undefined },
) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const updateValues: Record<string, unknown> = {};
    if (input.name !== undefined) updateValues.name = input.name;
    if (input.slug !== undefined) updateValues.slug = input.slug;
    if (input.logoMediaId !== undefined) updateValues.logoMediaId = input.logoMediaId;

    const [row] = await tx
      .update(schema.brands)
      .set(updateValues)
      .where(eq(schema.brands.id, input.id))
      .returning();

    if (!row) throw new Error(`Brand not found: "${input.id}"`);
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      logoMediaId: row.logoMediaId,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

export async function deleteBrand(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    await tx.delete(schema.brands).where(eq(schema.brands.id, input.id));
    return { success: true };
  });
}
