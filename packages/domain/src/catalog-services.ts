import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import type { CollectionRule } from "@bs/contracts";
import type { Runtime } from "./runtime.ts";
import { assertPermission, type TenantContext } from "./context.ts";
import { invalidateCache } from "./cache-invalidation.ts";
import { publicMediaUrl } from "./media/storage.ts";
import { assertProductQuota } from "./system/quotas.ts";

export interface ListProductsQuery {
  search?: string | undefined;
  status?: "draft" | "active" | "unlisted" | "archived" | undefined;
  categoryId?: string | undefined;
  stock?: "in_stock" | "low" | "out" | undefined;
  createdFrom?: string | undefined;
  createdTo?: string | undefined;
  sort?: "created_desc" | "created_asc" | "updated_desc" | "updated_asc" | "title_asc" | "title_desc" | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface CreateProductInput {
  title: string;
  slug?: string | undefined;
  status?: "draft" | "active" | "unlisted" | "archived" | undefined;
  descriptionJson?: unknown;
  shortDescription?: string | undefined;
  brandId?: string | undefined;
  productType?: string | undefined;
  tags?: string[] | undefined;
  requiresShipping?: boolean | undefined;
  isFeatured?: boolean | undefined;
  priceOnRequest?: boolean | undefined;
  returnable?: boolean | undefined;
  seo?: unknown | undefined;
  primaryCategoryId?: string | undefined;
  extraCategoryIds?: string[] | undefined;
  collectionIds?: string[] | undefined;
  options?: Array<{ name: string; values: string[] }> | undefined;
  variants?: Array<{
    sku: string;
    title: string;
    price: number;
    compareAtPrice?: number | undefined;
    costPrice?: number | undefined;
    trackInventory?: boolean | undefined;
    allowBackorder?: boolean | undefined;
    preorderEnabled?: boolean | undefined;
    preorderShipsOn?: string | null | undefined;
    preorderMessage?: string | null | undefined;
    optionValues?: Record<string, string> | undefined;
    imageMediaId?: string | undefined;
  }> | undefined;
}

export interface UpdateProductInput {
  id: string;
  title?: string | undefined;
  slug?: string | undefined;
  status?: "draft" | "active" | "unlisted" | "archived" | undefined;
  descriptionJson?: unknown;
  shortDescription?: string | undefined;
  brandId?: string | null | undefined;
  productType?: string | undefined;
  tags?: string[] | undefined;
  requiresShipping?: boolean | undefined;
  isFeatured?: boolean | undefined;
  priceOnRequest?: boolean | undefined;
  returnable?: boolean | undefined;
  seo?: unknown | undefined;
  primaryCategoryId?: string | null | undefined;
  extraCategoryIds?: string[] | undefined;
  collectionIds?: string[] | undefined;
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
  preorderEnabled?: boolean | undefined;
  preorderShipsOn?: string | null | undefined;
  preorderMessage?: string | null | undefined;
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

    const from = query?.createdFrom ? new Date(query.createdFrom) : null;
    const to = query?.createdTo ? new Date(query.createdTo) : null;
    if (from && !Number.isNaN(from.getTime())) conditions.push(gte(schema.products.createdAt, from));
    if (to && !Number.isNaN(to.getTime())) conditions.push(lt(schema.products.createdAt, to));
    if (query?.stock) {
      // Sellable stock across all of the product's variants and locations.
      const stockOf = sql`coalesce((select sum(${schema.inventoryLevels.available}) from ${schema.inventoryLevels} join ${schema.variants} on ${schema.variants.id} = ${schema.inventoryLevels.variantId} where ${schema.variants.productId} = ${schema.products.id}), 0)`;
      conditions.push(query.stock === "out" ? sql`${stockOf} <= 0` : query.stock === "low" ? sql`${stockOf} between 1 and 5` : sql`${stockOf} > 5`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const limit = query?.limit ?? 50;
    const offset = query?.offset ?? 0;

    // id tie-break keeps paging stable when many rows share a timestamp or title.
    const orderBy = {
      created_desc: [desc(schema.products.createdAt), desc(schema.products.id)],
      created_asc: [asc(schema.products.createdAt), asc(schema.products.id)],
      updated_desc: [desc(schema.products.updatedAt), desc(schema.products.id)],
      updated_asc: [asc(schema.products.updatedAt), asc(schema.products.id)],
      title_asc: [asc(schema.products.title), asc(schema.products.id)],
      title_desc: [desc(schema.products.title), desc(schema.products.id)],
    }[query?.sort ?? "created_desc"];

    const rows = await tx
      .select()
      .from(schema.products)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset);

    const [{ n: total } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.products)
      .where(whereClause);

    // Fetch primary category and aggregates for listed products
    const ids = rows.map((r) => r.id);
    const summary = new Map<string, { variantCount: number; priceMin: number | null; priceMax: number | null; stock: number; preorderStatus: "active" | "passed" | null }>();
    const primaryCatMap = new Map<string, { id: string; name: string }>();

    if (ids.length > 0) {
      const agg = await tx
        .select({
          productId: schema.variants.productId,
          variantCount: sql<number>`count(distinct ${schema.variants.id})::int`,
          priceMin: sql<string | null>`min(${schema.variants.price})`,
          priceMax: sql<string | null>`max(${schema.variants.price})`,
          stock: sql<string>`coalesce(sum(${schema.inventoryLevels.available}), 0)`,
          preorderStatus: sql<string | null>`
            case
              when bool_or(${schema.variants.preorderEnabled} and ${schema.variants.preorderShipsOn} < current_date) then 'passed'
              when bool_or(${schema.variants.preorderEnabled}) then 'active'
              else null
            end
          `,
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
          preorderStatus: (a.preorderStatus as "active" | "passed" | null) ?? null,
        });
      }

      const primaryCategories = await tx
        .select({
          productId: schema.productCategories.productId,
          categoryId: schema.categories.id,
          categoryName: schema.categories.name,
        })
        .from(schema.productCategories)
        .innerJoin(schema.categories, eq(schema.categories.id, schema.productCategories.categoryId))
        .where(
          and(
            eq(schema.productCategories.tenantId, ctx.tenantId),
            inArray(schema.productCategories.productId, ids),
            eq(schema.productCategories.isPrimary, true),
          ),
        );
      for (const pc of primaryCategories) {
        primaryCatMap.set(pc.productId, { id: pc.categoryId, name: pc.categoryName });
      }
    }

    return {
      items: rows.map((r) => {
        const sm = summary.get(r.id);
        const pCat = primaryCatMap.get(r.id);
        return {
          id: r.id,
          title: r.title,
          slug: r.slug,
          status: r.status as "draft" | "active" | "unlisted" | "archived",
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
          priceOnRequest: Boolean(r.priceOnRequest),
          returnable: r.returnable,
          publishedAt: r.publishedAt ? r.publishedAt.toISOString() : undefined,
          ratingAvg: r.ratingAvg,
          ratingCount: r.ratingCount,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          variantCount: sm?.variantCount ?? 0,
          priceMin: sm?.priceMin ?? null,
          priceMax: sm?.priceMax ?? null,
          stock: sm?.stock ?? 0,
          preorderStatus: sm?.preorderStatus ?? null,
          primaryCategoryId: pCat?.id ?? null,
          primaryCategoryName: pCat?.name ?? null,
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
      .select({
        id: schema.productMedia.id,
        productId: schema.productMedia.productId,
        mediaId: schema.productMedia.mediaId,
        position: schema.productMedia.position,
        storageKey: schema.media.storageKey,
      })
      .from(schema.productMedia)
      .innerJoin(schema.media, eq(schema.media.id, schema.productMedia.mediaId))
      .where(eq(schema.productMedia.productId, input.id))
      .orderBy(schema.productMedia.position);

    const prodCategories = await tx
      .select({
        categoryId: schema.productCategories.categoryId,
        categoryName: schema.categories.name,
        isPrimary: schema.productCategories.isPrimary,
      })
      .from(schema.productCategories)
      .innerJoin(schema.categories, eq(schema.categories.id, schema.productCategories.categoryId))
      .where(
        and(
          eq(schema.productCategories.tenantId, ctx.tenantId),
          eq(schema.productCategories.productId, input.id),
        ),
      );

    const primaryCat = prodCategories.find((c) => c.isPrimary);
    const extraCategoryIds = prodCategories.filter((c) => !c.isPrimary).map((c) => c.categoryId);

    const prodCollections = await tx
      .select({ collectionId: schema.collectionProducts.collectionId })
      .from(schema.collectionProducts)
      .where(
        and(
          eq(schema.collectionProducts.tenantId, ctx.tenantId),
          eq(schema.collectionProducts.productId, input.id),
        ),
      );
    const collectionIds = prodCollections.map((c) => c.collectionId);

    return {
      id: p.id,
      title: p.title,
      slug: p.slug,
      status: p.status as "draft" | "active" | "unlisted" | "archived",
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
      priceOnRequest: Boolean(p.priceOnRequest),
      returnable: p.returnable,
      publishedAt: p.publishedAt ? p.publishedAt.toISOString() : undefined,
      ratingAvg: p.ratingAvg,
      ratingCount: p.ratingCount,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      primaryCategoryId: primaryCat?.categoryId ?? null,
      primaryCategoryName: primaryCat?.categoryName ?? null,
      extraCategoryIds,
      collectionIds,
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
        preorderEnabled: v.preorderEnabled,
        preorderShipsOn: v.preorderShipsOn ? String(v.preorderShipsOn).slice(0, 10) : null,
        preorderMessage: v.preorderMessage,
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
        url: publicMediaUrl(m.storageKey),
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

  // Enforce primary category requirement to move to active or unlisted
  const targetStatus = input.status ?? "draft";
  if ((targetStatus === "active" || targetStatus === "unlisted") && !input.primaryCategoryId) {
    throw new Error("A primary category is required to publish or list a product.");
  }

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
        priceOnRequest: input.priceOnRequest ?? false,
        returnable: input.returnable ?? true,
        seo: input.seo,
      })
      .returning();

    if (!product) {
      throw new Error("Failed to create product");
    }

    // Save primary category and extra categories
    if (input.primaryCategoryId) {
      await tx.insert(schema.productCategories).values({
        tenantId: ctx.tenantId,
        productId: product.id,
        categoryId: input.primaryCategoryId,
        position: 0,
        isPrimary: true,
      });
    }

    if (input.extraCategoryIds && input.extraCategoryIds.length > 0) {
      for (let i = 0; i < input.extraCategoryIds.length; i++) {
        const catId = input.extraCategoryIds[i];
        if (!catId || catId === input.primaryCategoryId) continue;
        await tx.insert(schema.productCategories).values({
          tenantId: ctx.tenantId,
          productId: product.id,
          categoryId: catId,
          position: i + 1,
          isPrimary: false,
        });
      }
    }

    // Save collection associations
    if (input.collectionIds && input.collectionIds.length > 0) {
      for (let i = 0; i < input.collectionIds.length; i++) {
        const colId = input.collectionIds[i];
        if (!colId) continue;
        await tx.insert(schema.collectionProducts).values({
          tenantId: ctx.tenantId,
          productId: product.id,
          collectionId: colId,
          position: i,
        });
      }
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
          price: BigInt(input.priceOnRequest ? 0 : v.price),
          compareAtPrice: v.compareAtPrice ? BigInt(v.compareAtPrice) : null,
          costPrice: v.costPrice ? BigInt(v.costPrice) : null,
          trackInventory: v.trackInventory ?? true,
          allowBackorder: v.allowBackorder ?? false,
          preorderEnabled: v.preorderEnabled ?? false,
          preorderShipsOn: v.preorderShipsOn ? v.preorderShipsOn : null,
          preorderMessage: v.preorderMessage ? v.preorderMessage : null,
          optionValues: v.optionValues,
          position: i,
          imageMediaId: v.imageMediaId,
        })
        .returning();
      if (variant) createdVariants.push(variant);
    }

    return getProduct(rt, ctx, { id: product.id });
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
    const [existing] = await tx
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, input.id));

    if (!existing) {
      throw new Error(`Product not found: "${input.id}"`);
    }

    const nextStatus = input.status ?? existing.status;

    // Determine primary category
    let effectivePrimaryCatId: string | null;
    if (input.primaryCategoryId !== undefined) {
      effectivePrimaryCatId = input.primaryCategoryId;
    } else {
      const [currentPrimary] = await tx
        .select({ categoryId: schema.productCategories.categoryId })
        .from(schema.productCategories)
        .where(
          and(
            eq(schema.productCategories.tenantId, ctx.tenantId),
            eq(schema.productCategories.productId, input.id),
            eq(schema.productCategories.isPrimary, true),
          ),
        );
      effectivePrimaryCatId = currentPrimary?.categoryId ?? null;
    }

    // If moving to active/unlisted from draft/archived, or updating an active/unlisted product, require primary category
    if ((nextStatus === "active" || nextStatus === "unlisted") && !effectivePrimaryCatId) {
      throw new Error("A primary category is required to publish or list a product.");
    }

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
    if (input.priceOnRequest !== undefined) updateValues.priceOnRequest = input.priceOnRequest;
    if (input.returnable !== undefined) updateValues.returnable = input.returnable;
    if (input.seo !== undefined) updateValues.seo = input.seo;

    const [row] = await tx
      .update(schema.products)
      .set(updateValues)
      .where(eq(schema.products.id, input.id))
      .returning();

    if (!row) {
      throw new Error(`Product not found: "${input.id}"`);
    }

    if (input.priceOnRequest) {
      await tx.update(schema.variants).set({ price: 0n }).where(eq(schema.variants.productId, row.id));
    }

    // Update product_categories if primary or extra categories are passed
    if (input.primaryCategoryId !== undefined || input.extraCategoryIds !== undefined) {
      await tx
        .delete(schema.productCategories)
        .where(
          and(
            eq(schema.productCategories.tenantId, ctx.tenantId),
            eq(schema.productCategories.productId, row.id),
          ),
        );

      if (effectivePrimaryCatId) {
        await tx.insert(schema.productCategories).values({
          tenantId: ctx.tenantId,
          productId: row.id,
          categoryId: effectivePrimaryCatId,
          position: 0,
          isPrimary: true,
        });
      }

      if (input.extraCategoryIds && input.extraCategoryIds.length > 0) {
        for (let i = 0; i < input.extraCategoryIds.length; i++) {
          const catId = input.extraCategoryIds[i];
          if (!catId || catId === effectivePrimaryCatId) continue;
          await tx.insert(schema.productCategories).values({
            tenantId: ctx.tenantId,
            productId: row.id,
            categoryId: catId,
            position: i + 1,
            isPrimary: false,
          });
        }
      }
    }

    // Update collection_products if collectionIds are passed
    if (input.collectionIds !== undefined) {
      await tx
        .delete(schema.collectionProducts)
        .where(
          and(
            eq(schema.collectionProducts.tenantId, ctx.tenantId),
            eq(schema.collectionProducts.productId, row.id),
          ),
        );

      for (let i = 0; i < input.collectionIds.length; i++) {
        const colId = input.collectionIds[i];
        if (!colId) continue;
        await tx.insert(schema.collectionProducts).values({
          tenantId: ctx.tenantId,
          productId: row.id,
          collectionId: colId,
          position: i,
        });
      }
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

    return getProduct(rt, ctx, { id: row.id });
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
    if (input.preorderEnabled !== undefined) updateValues.preorderEnabled = input.preorderEnabled;
    if (input.preorderShipsOn !== undefined) updateValues.preorderShipsOn = input.preorderShipsOn;
    if (input.preorderMessage !== undefined) updateValues.preorderMessage = input.preorderMessage;
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
      preorderEnabled: row.preorderEnabled,
      preorderShipsOn: row.preorderShipsOn ? String(row.preorderShipsOn).slice(0, 10) : null,
      preorderMessage: row.preorderMessage,
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
  query?:
    | {
        locationId?: string | undefined;
        search?: string | undefined;
        stock?: "in_stock" | "low" | "out" | undefined;
        sort?: "product_asc" | "product_desc" | "on_hand_desc" | "on_hand_asc" | "available_desc" | "available_asc" | undefined;
        limit?: number | undefined;
        offset?: number | undefined;
      }
    | undefined,
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

    const onHandOf = sql<number>`coalesce(${schema.inventoryLevels.onHand}, 0)`;
    const availableOf = sql<number>`(coalesce(${schema.inventoryLevels.onHand}, 0) - coalesce(${schema.inventoryLevels.reserved}, 0))`;
    if (query?.stock) {
      conditions.push(query.stock === "out" ? sql`${availableOf} <= 0` : query.stock === "low" ? sql`${availableOf} between 1 and 5` : sql`${availableOf} > 5`);
    }

    const whereClause = and(...conditions);
    const limit = query?.limit ?? 50;
    const offset = query?.offset ?? 0;

    const byName = [asc(schema.products.title), asc(schema.variants.title), asc(schema.locations.name)];
    const orderBy = {
      product_asc: byName,
      product_desc: [desc(schema.products.title), desc(schema.variants.title), desc(schema.locations.name)],
      on_hand_desc: [desc(onHandOf), ...byName],
      on_hand_asc: [asc(onHandOf), ...byName],
      available_desc: [desc(availableOf), ...byName],
      available_asc: [asc(availableOf), ...byName],
    }[query?.sort ?? "product_asc"];

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
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset);

    const [{ n: total } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.variants)
      .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
      .innerJoin(schema.locations, sql`true`)
      .leftJoin(
        schema.inventoryLevels,
        and(eq(schema.inventoryLevels.variantId, schema.variants.id), eq(schema.inventoryLevels.locationId, schema.locations.id)),
      )
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
export interface ListCategoriesQuery {
  parentId?: string | null | undefined;
  status?: "all" | "active" | "featured" | "inactive" | undefined;
  search?: string | undefined;
}

export async function getCategoryStats(rt: Runtime, ctx: TenantContext) {
  assertPermission(ctx, "products.read");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [allCategories, assignedProducts] = await Promise.all([
      tx
        .select({
          id: schema.categories.id,
          parentId: schema.categories.parentId,
          isActive: schema.categories.isActive,
        })
        .from(schema.categories),
      tx
        .select({ count: sql<number>`count(distinct ${schema.productCategories.productId})` })
        .from(schema.productCategories),
    ]);

    const total = allCategories.length;
    const active = allCategories.filter((c) => c.isActive).length;
    const inactive = total - active;
    const parents = allCategories.filter((c) => c.parentId === null).length;
    const productsAssigned = Number(assignedProducts[0]?.count ?? 0);

    return {
      total,
      active,
      inactive,
      parents,
      productsAssigned,
    };
  });
}

export async function listCategories(rt: Runtime, ctx: TenantContext, query?: ListCategoriesQuery | undefined) {
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
    if (query?.status) {
      if (query.status === "active") conditions.push(eq(schema.categories.isActive, true));
      if (query.status === "featured") conditions.push(eq(schema.categories.isFeatured, true));
      if (query.status === "inactive") conditions.push(eq(schema.categories.isActive, false));
    }
    if (query?.search?.trim()) {
      const term = `%${query.search.trim().toLowerCase()}%`;
      conditions.push(
        or(
          ilike(schema.categories.name, term),
          ilike(schema.categories.slug, term),
        ),
      );
    }

    const rows = await tx
      .select({
        id: schema.categories.id,
        parentId: schema.categories.parentId,
        name: schema.categories.name,
        slug: schema.categories.slug,
        description: schema.categories.description,
        imageMediaId: schema.categories.imageMediaId,
        position: schema.categories.position,
        path: schema.categories.path,
        isActive: schema.categories.isActive,
        isFeatured: schema.categories.isFeatured,
        seo: schema.categories.seo,
        createdAt: schema.categories.createdAt,
        updatedAt: schema.categories.updatedAt,
        imageKey: schema.media.storageKey,
      })
      .from(schema.categories)
      .leftJoin(schema.media, eq(schema.media.id, schema.categories.imageMediaId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(schema.categories.position), asc(schema.categories.name));

    // Also get productCount and childrenCount for each category
    const [productCounts, childCounts] = await Promise.all([
      tx
        .select({
          categoryId: schema.productCategories.categoryId,
          count: sql<number>`count(distinct ${schema.productCategories.productId})`,
        })
        .from(schema.productCategories)
        .groupBy(schema.productCategories.categoryId),
      tx
        .select({
          parentId: schema.categories.parentId,
          count: sql<number>`count(*)`,
        })
        .from(schema.categories)
        .where(sql`${schema.categories.parentId} IS NOT NULL`)
        .groupBy(schema.categories.parentId),
    ]);

    const prodCountMap = new Map<string, number>();
    for (const p of productCounts) {
      prodCountMap.set(p.categoryId, Number(p.count));
    }
    const childCountMap = new Map<string, number>();
    for (const c of childCounts) {
      if (c.parentId) childCountMap.set(c.parentId, Number(c.count));
    }

    return rows.map((r) => ({
      id: r.id,
      parentId: r.parentId,
      name: r.name,
      slug: r.slug,
      description: r.description,
      imageMediaId: r.imageMediaId,
      imageUrl: r.imageKey ? publicMediaUrl(r.imageKey) : null,
      position: r.position,
      path: r.path,
      isActive: r.isActive,
      isFeatured: r.isFeatured,
      seo: r.seo as { title?: string | null; description?: string | null } | null,
      productCount: prodCountMap.get(r.id) ?? 0,
      childrenCount: childCountMap.get(r.id) ?? 0,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  });
}

export async function getCategory(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "products.read");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        id: schema.categories.id,
        parentId: schema.categories.parentId,
        name: schema.categories.name,
        slug: schema.categories.slug,
        description: schema.categories.description,
        imageMediaId: schema.categories.imageMediaId,
        position: schema.categories.position,
        path: schema.categories.path,
        isActive: schema.categories.isActive,
        isFeatured: schema.categories.isFeatured,
        seo: schema.categories.seo,
        createdAt: schema.categories.createdAt,
        updatedAt: schema.categories.updatedAt,
        imageKey: schema.media.storageKey,
      })
      .from(schema.categories)
      .leftJoin(schema.media, eq(schema.media.id, schema.categories.imageMediaId))
      .where(eq(schema.categories.id, input.id))
      .limit(1);

    if (!row) throw new Error(`Category not found: "${input.id}"`);

    const [prodCount, childCount] = await Promise.all([
      tx
        .select({ count: sql<number>`count(distinct ${schema.productCategories.productId})` })
        .from(schema.productCategories)
        .where(eq(schema.productCategories.categoryId, row.id)),
      tx
        .select({ count: sql<number>`count(*)` })
        .from(schema.categories)
        .where(eq(schema.categories.parentId, row.id)),
    ]);

    return {
      id: row.id,
      parentId: row.parentId,
      name: row.name,
      slug: row.slug,
      description: row.description,
      imageMediaId: row.imageMediaId,
      imageUrl: row.imageKey ? publicMediaUrl(row.imageKey) : null,
      position: row.position,
      path: row.path,
      isActive: row.isActive,
      isFeatured: row.isFeatured,
      seo: row.seo as { title?: string | null; description?: string | null } | null,
      productCount: Number(prodCount[0]?.count ?? 0),
      childrenCount: Number(childCount[0]?.count ?? 0),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

/**
 * Helper to calculate tree depth and build path. Refuses depth > 3 levels.
 */
async function calculateCategoryTreePath(
  tx: Db,
  parentId?: string | null,
): Promise<{ path: string; depth: number }> {
  if (!parentId) {
    return { path: "/", depth: 1 };
  }
  const [parent] = await tx
    .select({ id: schema.categories.id, path: schema.categories.path, parentId: schema.categories.parentId })
    .from(schema.categories)
    .where(eq(schema.categories.id, parentId))
    .limit(1);

  if (!parent) {
    throw new Error(`Parent category not found: "${parentId}"`);
  }

  // Calculate parent depth by counting segments in path
  const parentDepth = (parent.path.match(/\//g) || []).length;
  if (parentDepth >= 3) {
    throw new Error("Category tree maximum depth is 3 levels. Cannot create subcategories beyond 3 levels.");
  }

  const path = `${parent.path.replace(/\/$/, "")}/${parent.id}/`;
  return { path, depth: parentDepth + 1 };
}

export interface CreateCategoryInput {
  name: string;
  slug?: string | undefined;
  description?: string | undefined;
  parentId?: string | null | undefined;
  imageMediaId?: string | null | undefined;
  position?: number | undefined;
  isActive?: boolean | undefined;
  isFeatured?: boolean | undefined;
  seo?: { title?: string | null | undefined; description?: string | null | undefined } | undefined;
}

export async function createCategory(
  rt: Runtime,
  ctx: TenantContext,
  input: CreateCategoryInput,
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

    const { path } = await calculateCategoryTreePath(tx, input.parentId);

    const [row] = await tx
      .insert(schema.categories)
      .values({
        tenantId: ctx.tenantId,
        name: input.name.trim(),
        slug,
        description: input.description?.trim() || null,
        parentId: input.parentId || null,
        imageMediaId: input.imageMediaId || null,
        position: input.position ?? 0,
        path,
        isActive: input.isActive ?? true,
        isFeatured: input.isFeatured ?? false,
        seo: input.seo || null,
      })
      .returning();

    if (!row) throw new Error("Failed to create category");

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "category.created",
      targetType: "category",
      targetId: row.id,
      diff: {
        name: row.name,
        slug: row.slug,
        parentId: row.parentId,
        isActive: row.isActive,
      },
    });

    await invalidateCache(rt, ctx, {
      type: "category_updated",
      categoryId: row.id,
    });

    return {
      id: row.id,
      parentId: row.parentId,
      name: row.name,
      slug: row.slug,
      description: row.description,
      imageMediaId: row.imageMediaId,
      imageUrl: null,
      position: row.position,
      path: row.path,
      isActive: row.isActive,
      isFeatured: row.isFeatured,
      seo: row.seo as { title?: string | null; description?: string | null } | null,
      productCount: 0,
      childrenCount: 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export interface UpdateCategoryInput {
  id: string;
  name?: string | undefined;
  slug?: string | undefined;
  description?: string | null | undefined;
  parentId?: string | null | undefined;
  imageMediaId?: string | null | undefined;
  position?: number | undefined;
  isActive?: boolean | undefined;
  isFeatured?: boolean | undefined;
  seo?: { title?: string | null | undefined; description?: string | null | undefined } | null | undefined;
}

export async function updateCategory(
  rt: Runtime,
  ctx: TenantContext,
  input: UpdateCategoryInput,
) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.id, input.id))
      .limit(1);

    if (!existing) throw new Error(`Category not found: "${input.id}"`);

    const updateValues: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) updateValues.name = input.name.trim();
    if (input.slug !== undefined) updateValues.slug = input.slug.trim();
    if (input.description !== undefined) updateValues.description = input.description ? input.description.trim() : null;
    if (input.imageMediaId !== undefined) updateValues.imageMediaId = input.imageMediaId;
    if (input.position !== undefined) updateValues.position = input.position;
    if (input.isActive !== undefined) updateValues.isActive = input.isActive;
    if (input.isFeatured !== undefined) updateValues.isFeatured = input.isFeatured;
    if (input.seo !== undefined) updateValues.seo = input.seo;

    if (input.parentId !== undefined && input.parentId !== existing.parentId) {
      if (input.parentId === input.id) {
        throw new Error("A category cannot be its own parent");
      }
      const { path } = await calculateCategoryTreePath(tx, input.parentId);
      updateValues.parentId = input.parentId;
      updateValues.path = path;
    }

    const [row] = await tx
      .update(schema.categories)
      .set(updateValues)
      .where(eq(schema.categories.id, input.id))
      .returning();

    if (!row) throw new Error(`Category not found: "${input.id}"`);

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "category.updated",
      targetType: "category",
      targetId: row.id,
      diff: updateValues,
    });

    await invalidateCache(rt, ctx, {
      type: "category_updated",
      categoryId: row.id,
    });

    return getCategory(rt, ctx, { id: row.id });
  });
}

export async function deleteCategory(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    // 1. Guard against child categories
    const [hasChildren] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(schema.categories)
      .where(eq(schema.categories.parentId, input.id));

    if (Number(hasChildren?.count ?? 0) > 0) {
      throw new Error("Cannot delete category with subcategories. Reassign or delete the subcategories first.");
    }

    // 2. Guard against primary category on any product (or assigned products)
    const [assignedProd] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(schema.productCategories)
      .where(eq(schema.productCategories.categoryId, input.id));

    if (Number(assignedProd?.count ?? 0) > 0) {
      throw new Error("Cannot delete category because products are assigned to it. Reassign or remove products from this category first.");
    }

    const [row] = await tx
      .delete(schema.categories)
      .where(eq(schema.categories.id, input.id))
      .returning();

    if (!row) throw new Error(`Category not found: "${input.id}"`);

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "category.deleted",
      targetType: "category",
      targetId: row.id,
      diff: { name: row.name, slug: row.slug },
    });

    await invalidateCache(rt, ctx, {
      type: "category_updated",
      categoryId: row.id,
    });

    return { success: true };
  });
}

// --- Collections ---
export interface ListCollectionsQuery {
  status?: "all" | "active" | "draft" | undefined;
  type?: "all" | "manual" | "automated" | undefined;
  search?: string | undefined;
}

export async function getCollectionStats(rt: Runtime, ctx: TenantContext) {
  assertPermission(ctx, "products.read");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: schema.collections.id,
        published: schema.collections.published,
        type: schema.collections.type,
        indexable: schema.collections.indexable,
      })
      .from(schema.collections);

    const total = rows.length;
    const active = rows.filter((r) => r.published).length;
    const draft = total - active;
    const manual = rows.filter((r) => r.type === "manual").length;
    const automated = rows.filter((r) => r.type === "automated").length;
    const indexable = rows.filter((r) => r.indexable).length;

    return {
      total,
      active,
      draft,
      manual,
      automated,
      indexable,
    };
  });
}

export async function listCollections(
  rt: Runtime,
  ctx: TenantContext,
  query?: ListCollectionsQuery | undefined,
) {
  assertPermission(ctx, "products.read");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const conditions = [];
    if (query?.status) {
      if (query.status === "active") conditions.push(eq(schema.collections.published, true));
      if (query.status === "draft") conditions.push(eq(schema.collections.published, false));
    }
    if (query?.type && query.type !== "all") {
      conditions.push(eq(schema.collections.type, query.type));
    }
    if (query?.search?.trim()) {
      const term = `%${query.search.trim().toLowerCase()}%`;
      conditions.push(
        or(
          ilike(schema.collections.title, term),
          ilike(schema.collections.slug, term),
        ),
      );
    }

    const rows = await tx
      .select({
        id: schema.collections.id,
        title: schema.collections.title,
        slug: schema.collections.slug,
        imageMediaId: schema.collections.imageMediaId,
        type: schema.collections.type,
        match: schema.collections.match,
        rules: schema.collections.rules,
        sortOrder: schema.collections.sortOrder,
        published: schema.collections.published,
        indexable: schema.collections.indexable,
        createdAt: schema.collections.createdAt,
        updatedAt: schema.collections.updatedAt,
        imageKey: schema.media.storageKey,
      })
      .from(schema.collections)
      .leftJoin(schema.media, eq(schema.media.id, schema.collections.imageMediaId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.collections.updatedAt));

    // Get manual product counts
    const manualCounts = await tx
      .select({
        collectionId: schema.collectionProducts.collectionId,
        count: sql<number>`count(*)`,
      })
      .from(schema.collectionProducts)
      .groupBy(schema.collectionProducts.collectionId);

    const manualCountMap = new Map<string, number>();
    for (const m of manualCounts) {
      manualCountMap.set(m.collectionId, Number(m.count));
    }

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      imageMediaId: r.imageMediaId,
      imageUrl: r.imageKey ? publicMediaUrl(r.imageKey) : null,
      type: r.type as "manual" | "automated",
      match: (r.match ?? "all") as "all" | "any",
      rules: (r.rules as CollectionRule[] | null) ?? null,
      sortOrder: r.sortOrder,
      published: r.published,
      indexable: r.indexable,
      productCount: r.type === "manual" ? manualCountMap.get(r.id) ?? 0 : undefined,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  });
}

export async function getCollection(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "products.read");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        id: schema.collections.id,
        title: schema.collections.title,
        slug: schema.collections.slug,
        imageMediaId: schema.collections.imageMediaId,
        type: schema.collections.type,
        match: schema.collections.match,
        rules: schema.collections.rules,
        sortOrder: schema.collections.sortOrder,
        published: schema.collections.published,
        indexable: schema.collections.indexable,
        seo: schema.collections.seo,
        createdAt: schema.collections.createdAt,
        updatedAt: schema.collections.updatedAt,
        imageKey: schema.media.storageKey,
      })
      .from(schema.collections)
      .leftJoin(schema.media, eq(schema.media.id, schema.collections.imageMediaId))
      .where(eq(schema.collections.id, input.id))
      .limit(1);

    if (!row) throw new Error(`Collection not found: "${input.id}"`);

    // Fetch manual assigned products in order
    const colProducts = await tx
      .select({
        id: schema.products.id,
        title: schema.products.title,
        slug: schema.products.slug,
        status: schema.products.status,
        position: schema.collectionProducts.position,
      })
      .from(schema.collectionProducts)
      .innerJoin(
        schema.products,
        and(
          eq(schema.products.tenantId, schema.collectionProducts.tenantId),
          eq(schema.products.id, schema.collectionProducts.productId),
        ),
      )
      .where(eq(schema.collectionProducts.collectionId, input.id))
      .orderBy(asc(schema.collectionProducts.position));

    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      imageMediaId: row.imageMediaId,
      imageUrl: row.imageKey ? publicMediaUrl(row.imageKey) : null,
      type: row.type as "manual" | "automated",
      match: (row.match ?? "all") as "all" | "any",
      rules: (row.rules as CollectionRule[] | null) ?? null,
      sortOrder: row.sortOrder,
      published: row.published,
      indexable: row.indexable,
      seo: row.seo as { title?: string | null; description?: string | null } | null,
      productCount: colProducts.length,
      productIds: colProducts.map((p) => p.id),
      products: colProducts.map((p) => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        status: p.status,
        imageUrl: null,
        priceMin: null,
      })),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export interface CreateCollectionInput {
  title: string;
  slug?: string | undefined;
  description?: string | undefined;
  imageMediaId?: string | null | undefined;
  type?: "manual" | "automated" | undefined;
  match?: "all" | "any" | undefined;
  rules?: unknown[] | undefined;
  sortOrder?: string | undefined;
  published?: boolean | undefined;
  indexable?: boolean | undefined;
  seo?: { title?: string | null | undefined; description?: string | null | undefined } | undefined;
  productIds?: string[] | undefined;
}

export async function createCollection(
  rt: Runtime,
  ctx: TenantContext,
  input: CreateCollectionInput,
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

    const isAutomated = input.type === "automated";

    const [row] = await tx
      .insert(schema.collections)
      .values({
        tenantId: ctx.tenantId,
        title: input.title.trim(),
        slug,
        imageMediaId: input.imageMediaId || null,
        type: isAutomated ? "automated" : "manual",
        match: input.match ?? "all",
        rules: isAutomated && input.rules ? input.rules : null,
        sortOrder: input.sortOrder ?? "manual",
        published: input.published ?? true,
        indexable: input.indexable ?? false, // Defaults to not indexable (Owner decision)
        seo: input.seo || null,
      })
      .returning();

    if (!row) throw new Error("Failed to create collection");

    if (!isAutomated && input.productIds && input.productIds.length > 0) {
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

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "collection.created",
      targetType: "collection",
      targetId: row.id,
      diff: {
        title: row.title,
        slug: row.slug,
        type: row.type,
        indexable: row.indexable,
        published: row.published,
      },
    });

    await invalidateCache(rt, ctx, {
      type: "collection_updated",
      collectionId: row.id,
    });

    return getCollection(rt, ctx, { id: row.id });
  });
}

export interface UpdateCollectionInput {
  id: string;
  title?: string | undefined;
  slug?: string | undefined;
  imageMediaId?: string | null | undefined;
  type?: "manual" | "automated" | undefined;
  match?: "all" | "any" | undefined;
  rules?: unknown[] | null | undefined;
  sortOrder?: string | undefined;
  published?: boolean | undefined;
  indexable?: boolean | undefined;
  seo?: { title?: string | null | undefined; description?: string | null | undefined } | null | undefined;
  productIds?: string[] | undefined;
}

export async function updateCollection(
  rt: Runtime,
  ctx: TenantContext,
  input: UpdateCollectionInput,
) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const updateValues: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) updateValues.title = input.title.trim();
    if (input.slug !== undefined) updateValues.slug = input.slug.trim();
    if (input.imageMediaId !== undefined) updateValues.imageMediaId = input.imageMediaId;
    if (input.type !== undefined) updateValues.type = input.type;
    if (input.match !== undefined) updateValues.match = input.match;
    if (input.rules !== undefined) updateValues.rules = input.rules;
    if (input.sortOrder !== undefined) updateValues.sortOrder = input.sortOrder;
    if (input.published !== undefined) updateValues.published = input.published;
    if (input.indexable !== undefined) updateValues.indexable = input.indexable;
    if (input.seo !== undefined) updateValues.seo = input.seo;

    const [row] = await tx
      .update(schema.collections)
      .set(updateValues)
      .where(eq(schema.collections.id, input.id))
      .returning();

    if (!row) throw new Error(`Collection not found: "${input.id}"`);

    if (input.productIds !== undefined && row.type === "manual") {
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

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "collection.updated",
      targetType: "collection",
      targetId: row.id,
      diff: updateValues,
    });

    await invalidateCache(rt, ctx, {
      type: "collection_updated",
      collectionId: row.id,
    });

    return getCollection(rt, ctx, { id: row.id });
  });
}

export async function deleteCollection(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .delete(schema.collections)
      .where(eq(schema.collections.id, input.id))
      .returning();

    if (!row) throw new Error(`Collection not found: "${input.id}"`);

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "collection.deleted",
      targetType: "collection",
      targetId: row.id,
      diff: { title: row.title, slug: row.slug },
    });

    await invalidateCache(rt, ctx, {
      type: "collection_updated",
      collectionId: row.id,
    });

    return { success: true };
  });
}

// --- Brands ---
export async function getBrandStats(rt: Runtime, ctx: TenantContext) {
  assertPermission(ctx, "products.read");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [allBrands, usedBrands] = await Promise.all([
      tx.select({ id: schema.brands.id }).from(schema.brands),
      tx
        .select({ brandId: schema.products.brandId })
        .from(schema.products)
        .where(sql`${schema.products.brandId} IS NOT NULL`)
        .groupBy(schema.products.brandId),
    ]);

    const total = allBrands.length;
    const used = usedBrands.length;
    const unused = Math.max(0, total - used);

    return { total, used, unused };
  });
}

export async function listBrands(rt: Runtime, ctx: TenantContext, query?: { search?: string | undefined } | undefined) {
  assertPermission(ctx, "products.read");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const conditions = [];
    if (query?.search?.trim()) {
      const term = `%${query.search.trim().toLowerCase()}%`;
      conditions.push(or(ilike(schema.brands.name, term), ilike(schema.brands.slug, term)));
    }

    const rows = await tx
      .select({
        id: schema.brands.id,
        name: schema.brands.name,
        slug: schema.brands.slug,
        logoMediaId: schema.brands.logoMediaId,
        createdAt: schema.brands.createdAt,
        updatedAt: schema.brands.updatedAt,
        logoKey: schema.media.storageKey,
      })
      .from(schema.brands)
      .leftJoin(schema.media, eq(schema.media.id, schema.brands.logoMediaId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(schema.brands.name));

    const productCounts = await tx
      .select({
        brandId: schema.products.brandId,
        count: sql<number>`count(*)`,
      })
      .from(schema.products)
      .where(sql`${schema.products.brandId} IS NOT NULL`)
      .groupBy(schema.products.brandId);

    const countMap = new Map<string, number>();
    for (const p of productCounts) {
      if (p.brandId) countMap.set(p.brandId, Number(p.count));
    }

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      logoMediaId: r.logoMediaId,
      logoUrl: r.logoKey ? publicMediaUrl(r.logoKey) : null,
      productCount: countMap.get(r.id) ?? 0,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  });
}

export async function getBrand(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "products.read");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        id: schema.brands.id,
        name: schema.brands.name,
        slug: schema.brands.slug,
        logoMediaId: schema.brands.logoMediaId,
        createdAt: schema.brands.createdAt,
        updatedAt: schema.brands.updatedAt,
        logoKey: schema.media.storageKey,
      })
      .from(schema.brands)
      .leftJoin(schema.media, eq(schema.media.id, schema.brands.logoMediaId))
      .where(eq(schema.brands.id, input.id))
      .limit(1);

    if (!row) throw new Error(`Brand not found: "${input.id}"`);

    const [prodCount] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(schema.products)
      .where(eq(schema.products.brandId, row.id));

    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      logoMediaId: row.logoMediaId,
      logoUrl: row.logoKey ? publicMediaUrl(row.logoKey) : null,
      productCount: Number(prodCount?.count ?? 0),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export async function createBrand(
  rt: Runtime,
  ctx: TenantContext,
  input: { name: string; slug?: string | undefined; logoMediaId?: string | null | undefined },
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
        name: input.name.trim(),
        slug,
        logoMediaId: input.logoMediaId || null,
      })
      .returning();

    if (!row) throw new Error("Failed to create brand");

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "brand.created",
      targetType: "brand",
      targetId: row.id,
      diff: { name: row.name, slug: row.slug },
    });

    return getBrand(rt, ctx, { id: row.id });
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
    const updateValues: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) updateValues.name = input.name.trim();
    if (input.slug !== undefined) updateValues.slug = input.slug.trim();
    if (input.logoMediaId !== undefined) updateValues.logoMediaId = input.logoMediaId;

    const [row] = await tx
      .update(schema.brands)
      .set(updateValues)
      .where(eq(schema.brands.id, input.id))
      .returning();

    if (!row) throw new Error(`Brand not found: "${input.id}"`);

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "brand.updated",
      targetType: "brand",
      targetId: row.id,
      diff: updateValues,
    });

    return getBrand(rt, ctx, { id: row.id });
  });
}

export async function deleteBrand(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [prodCount] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(schema.products)
      .where(eq(schema.products.brandId, input.id));

    const affected = Number(prodCount?.count ?? 0);

    const [row] = await tx.delete(schema.brands).where(eq(schema.brands.id, input.id)).returning();
    if (!row) throw new Error(`Brand not found: "${input.id}"`);

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "brand.deleted",
      targetType: "brand",
      targetId: row.id,
      diff: { name: row.name, slug: row.slug, affectedProducts: affected },
    });

    return { success: true, affectedProducts: affected };
  });
}

// --- Locations ---
export interface ListLocationsQuery {
  status?: "all" | "active" | "inactive" | undefined;
}

export async function getLocationStats(rt: Runtime, ctx: TenantContext) {
  assertPermission(ctx, "products.read");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const rows = await tx.select({ isActive: schema.locations.isActive }).from(schema.locations);
    const total = rows.length;
    const active = rows.filter((r) => r.isActive).length;
    const inactive = total - active;

    return { total, active, inactive };
  });
}

export async function listLocations(rt: Runtime, ctx: TenantContext, query?: ListLocationsQuery | undefined) {
  assertPermission(ctx, "products.read");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const conditions = [];
    if (query?.status === "active") conditions.push(eq(schema.locations.isActive, true));
    if (query?.status === "inactive") conditions.push(eq(schema.locations.isActive, false));

    const rows = await tx
      .select()
      .from(schema.locations)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.locations.isDefault), asc(schema.locations.name));

    // Get stock on hand per location
    const stockCounts = await tx
      .select({
        locationId: schema.inventoryLevels.locationId,
        totalOnHand: sql<number>`sum(${schema.inventoryLevels.onHand})`,
      })
      .from(schema.inventoryLevels)
      .groupBy(schema.inventoryLevels.locationId);

    const stockMap = new Map<string, number>();
    for (const s of stockCounts) {
      stockMap.set(s.locationId, Number(s.totalOnHand ?? 0));
    }

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      address: (r.address as { line1?: string; line2?: string | null; city?: string; stateCode?: string; countryCode?: string } | null) ?? null,
      pincode: r.pincode,
      isDefault: r.isDefault,
      isActive: r.isActive,
      stockCount: stockMap.get(r.id) ?? 0,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  });
}

export async function getLocation(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "products.read");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.id, input.id))
      .limit(1);

    if (!row) throw new Error(`Location not found: "${input.id}"`);

    const [stockCount] = await tx
      .select({
        totalOnHand: sql<number>`sum(${schema.inventoryLevels.onHand})`,
      })
      .from(schema.inventoryLevels)
      .where(eq(schema.inventoryLevels.locationId, row.id));

    return {
      id: row.id,
      name: row.name,
      address: (row.address as { line1?: string; line2?: string | null; city?: string; stateCode?: string; countryCode?: string } | null) ?? null,
      pincode: row.pincode,
      isDefault: row.isDefault,
      isActive: row.isActive,
      stockCount: Number(stockCount?.totalOnHand ?? 0),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export interface CreateLocationInput {
  name: string;
  address?: {
    line1?: string | undefined;
    line2?: string | null | undefined;
    city?: string | undefined;
    stateCode?: string | undefined;
    countryCode?: string | undefined;
  } | undefined;
  pincode?: string | undefined;
  isDefault?: boolean | undefined;
  isActive?: boolean | undefined;
}

export async function createLocation(
  rt: Runtime,
  ctx: TenantContext,
  input: CreateLocationInput,
) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    // If setting as default, clear existing default in same transaction
    if (input.isDefault) {
      await tx
        .update(schema.locations)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(schema.locations.isDefault, true));
    }

    const [row] = await tx
      .insert(schema.locations)
      .values({
        tenantId: ctx.tenantId,
        name: input.name.trim(),
        address: input.address || null,
        pincode: input.pincode?.trim() || null,
        isDefault: input.isDefault ?? false,
        isActive: input.isActive ?? true,
      })
      .returning();

    if (!row) throw new Error("Failed to create location");

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "location.created",
      targetType: "location",
      targetId: row.id,
      diff: { name: row.name, isDefault: row.isDefault, isActive: row.isActive },
    });

    return getLocation(rt, ctx, { id: row.id });
  });
}

export interface UpdateLocationInput {
  id: string;
  name?: string | undefined;
  address?: {
    line1?: string | undefined;
    line2?: string | null | undefined;
    city?: string | undefined;
    stateCode?: string | undefined;
    countryCode?: string | undefined;
  } | null | undefined;
  pincode?: string | null | undefined;
  isDefault?: boolean | undefined;
  isActive?: boolean | undefined;
}

export async function updateLocation(
  rt: Runtime,
  ctx: TenantContext,
  input: UpdateLocationInput,
) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.id, input.id))
      .limit(1);

    if (!existing) throw new Error(`Location not found: "${input.id}"`);

    // Rule: The default location cannot be deactivated
    if (existing.isDefault && input.isActive === false) {
      throw new Error("The default location cannot be deactivated. Set another location as default first.");
    }

    // Rule: The last active location cannot be deactivated
    if (existing.isActive && input.isActive === false) {
      const [activeCount] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(schema.locations)
        .where(eq(schema.locations.isActive, true));

      if (Number(activeCount?.count ?? 0) <= 1) {
        throw new Error("Cannot deactivate the only active location. Stores must have at least one active location.");
      }
    }

    // If making this location default, clear other default in same transaction
    if (input.isDefault && !existing.isDefault) {
      await tx
        .update(schema.locations)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(schema.locations.isDefault, true));
    }

    const updateValues: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) updateValues.name = input.name.trim();
    if (input.address !== undefined) updateValues.address = input.address;
    if (input.pincode !== undefined) updateValues.pincode = input.pincode ? input.pincode.trim() : null;
    if (input.isDefault !== undefined) updateValues.isDefault = input.isDefault;
    if (input.isActive !== undefined) updateValues.isActive = input.isActive;

    const [row] = await tx
      .update(schema.locations)
      .set(updateValues)
      .where(eq(schema.locations.id, input.id))
      .returning();

    if (!row) throw new Error(`Location not found: "${input.id}"`);

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "location.updated",
      targetType: "location",
      targetId: row.id,
      diff: updateValues,
    });

    return getLocation(rt, ctx, { id: row.id });
  });
}

export async function deleteLocation(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.id, input.id))
      .limit(1);

    if (!existing) throw new Error(`Location not found: "${input.id}"`);

    // Rule: The default location cannot be deleted
    if (existing.isDefault) {
      throw new Error("The default location cannot be deleted. Set another location as default first.");
    }

    // Rule: A location holding stock cannot be deleted
    const [stock] = await tx
      .select({ total: sql<number>`sum(${schema.inventoryLevels.onHand})` })
      .from(schema.inventoryLevels)
      .where(eq(schema.inventoryLevels.locationId, input.id));

    if (Number(stock?.total ?? 0) > 0) {
      throw new Error("Cannot delete a location with stock on hand. Adjust or transfer stock to zero first, or deactivate the location instead.");
    }

    // Rule: The last active location cannot be deleted
    const [activeCount] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(schema.locations)
      .where(eq(schema.locations.isActive, true));

    if (existing.isActive && Number(activeCount?.count ?? 0) <= 1) {
      throw new Error("Cannot delete the only active location.");
    }

    // Delete inventory level zero-rows linked to this location before deleting location
    await tx.delete(schema.inventoryLevels).where(eq(schema.inventoryLevels.locationId, input.id));

    const [row] = await tx.delete(schema.locations).where(eq(schema.locations.id, input.id)).returning();
    if (!row) throw new Error(`Location not found: "${input.id}"`);

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "location.deleted",
      targetType: "location",
      targetId: row.id,
      diff: { name: row.name },
    });

    return { success: true };
  });
}
