import { and, eq, inArray } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { TenantContext } from "./context.ts";
import type { Runtime } from "./runtime.ts";
import { tenantTag } from "./cache-tags.ts";

export type CacheChange =
  | {
      type: "product_updated";
      productId: string;
      categoryIds?: string[] | undefined;
      collectionIds?: string[] | undefined;
      isFeatured?: boolean | undefined;
    }
  | {
      type: "product_price_changed";
      productId: string;
      categoryIds?: string[] | undefined;
      collectionIds?: string[] | undefined;
    }
  | {
      type: "product_image_updated";
      productId: string;
    }
  | {
      type: "inventory_out_of_stock_flip";
      productId: string;
      collectionIds?: string[] | undefined;
    }
  | {
      type: "theme_or_brand_published";
    }
  | {
      type: "home_page_published";
    }
  | {
      type: "page_published";
      slug: string;
      extraSlugs?: string[] | undefined;
    }
  | {
      type: "nav_updated";
    }
  | {
      type: "collection_updated";
      collectionId: string;
      isHomeFeatured?: boolean | undefined;
    }
  | {
      type: "category_updated";
      categoryId: string;
    }
  | {
      type: "store_or_seo_updated";
    }
  | {
      type: "review_updated";
      productId: string;
    }
  | {
      type: "media_updated";
      mediaIds?: string[] | undefined;
      owners?:
        | Array<{
            ownerType: string;
            ownerId: string;
            productId?: string | undefined;
            field?: string | undefined;
          }>
        | undefined;
    }
  | {
      type: "brand_updated";
      brandId: string;
    };

/**
 * Computes all cache tags that must be invalidated for a specific mutation event
 * according to the PLAN §11.6 Cache Invalidation Matrix.
 */
export function computeInvalidationTags(
  ctx: TenantContext | string,
  change: CacheChange,
): string[] {
  const tags: string[] = [];
  const tenantId = typeof ctx === "string" ? ctx : ctx.tenantId;

  switch (change.type) {
    case "product_updated": {
      // Product title, description, SEO -> product, its categories, its collections, home page if featured, nav
      tags.push(tenantTag(tenantId, "product", change.productId));
      tags.push(tenantTag(tenantId, "product"));
      for (const catId of change.categoryIds ?? []) {
        tags.push(tenantTag(tenantId, "category", catId));
      }
      for (const colId of change.collectionIds ?? []) {
        tags.push(tenantTag(tenantId, "collection", colId));
      }
      if (change.isFeatured) {
        tags.push(tenantTag(tenantId, "page", "home"));
      }
      tags.push(tenantTag(tenantId, "nav"));
      break;
    }
    case "product_price_changed": {
      // Price or compare-at price -> product, its collections and categories
      tags.push(tenantTag(tenantId, "product", change.productId));
      tags.push(tenantTag(tenantId, "product"));
      for (const catId of change.categoryIds ?? []) {
        tags.push(tenantTag(tenantId, "category", catId));
      }
      for (const colId of change.collectionIds ?? []) {
        tags.push(tenantTag(tenantId, "collection", colId));
      }
      break;
    }
    case "product_image_updated": {
      // Product image -> product
      tags.push(tenantTag(tenantId, "product", change.productId));
      tags.push(tenantTag(tenantId, "product"));
      break;
    }
    case "inventory_out_of_stock_flip": {
      // Out of stock flip -> product, collections
      tags.push(tenantTag(tenantId, "product", change.productId));
      tags.push(tenantTag(tenantId, "product"));
      for (const colId of change.collectionIds ?? []) {
        tags.push(tenantTag(tenantId, "collection", colId));
      }
      break;
    }
    case "theme_or_brand_published": {
      // Theme or branding publish -> theme, store-shell (all pages)
      tags.push(tenantTag(tenantId, "theme"));
      tags.push(tenantTag(tenantId, "store-shell"));
      break;
    }
    case "home_page_published": {
      // Home page publish -> page:home
      tags.push(tenantTag(tenantId, "page", "home"));
      break;
    }
    case "page_published": {
      // Custom/landing page publish or rollback -> page:<slug>, nav
      tags.push(tenantTag(tenantId, "page", change.slug));
      for (const s of change.extraSlugs ?? []) {
        tags.push(tenantTag(tenantId, "page", s));
      }
      tags.push(tenantTag(tenantId, "nav"));
      break;
    }
    case "nav_updated": {
      // Menu -> nav
      tags.push(tenantTag(tenantId, "nav"));
      break;
    }
    case "collection_updated": {
      // Collection rules or order -> collection, pages that embed it (home page), nav
      tags.push(tenantTag(tenantId, "collection", change.collectionId));
      tags.push(tenantTag(tenantId, "collection"));
      tags.push(tenantTag(tenantId, "page", "home"));
      tags.push(tenantTag(tenantId, "nav"));
      break;
    }
    case "brand_updated": {
      tags.push(tenantTag(tenantId, "nav"));
      break;
    }
    case "category_updated": {
      // Category details, active/featured, position -> category, all categories, nav
      tags.push(tenantTag(tenantId, "category", change.categoryId));
      tags.push(tenantTag(tenantId, "category"));
      tags.push(tenantTag(tenantId, "nav"));
      break;
    }
    case "store_or_seo_updated": {
      // Store settings, status, SEO settings -> store-shell, seo
      tags.push(tenantTag(tenantId, "store-shell"));
      tags.push(tenantTag(tenantId, "seo"));
      break;
    }
    case "review_updated": {
      // Product reviews updated -> product page, all products list (for stars)
      tags.push(tenantTag(tenantId, "product", change.productId));
      tags.push(tenantTag(tenantId, "product"));
      break;
    }
    case "media_updated": {
      tags.push(tenantTag(tenantId, "storage"));
      for (const o of change.owners ?? []) {
        switch (o.ownerType) {
          case "product": {
            tags.push(tenantTag(tenantId, "product", o.ownerId));
            tags.push(tenantTag(tenantId, "product"));
            break;
          }
          case "variant": {
            const prodId = o.productId || o.ownerId;
            tags.push(tenantTag(tenantId, "product", prodId));
            tags.push(tenantTag(tenantId, "product"));
            break;
          }
          case "collection": {
            tags.push(tenantTag(tenantId, "collection", o.ownerId));
            tags.push(tenantTag(tenantId, "collection"));
            break;
          }
          case "category": {
            tags.push(tenantTag(tenantId, "category", o.ownerId));
            tags.push(tenantTag(tenantId, "category"));
            tags.push(tenantTag(tenantId, "nav"));
            break;
          }
          case "brand": {
            tags.push(tenantTag(tenantId, "nav"));
            break;
          }
          case "store_branding": {
            tags.push(tenantTag(tenantId, "store-shell"));
            tags.push(tenantTag(tenantId, "seo"));
            tags.push(tenantTag(tenantId, "theme"));
            break;
          }
        }
      }
      break;
    }
  }

  return Array.from(new Set(tags));
}

/**
 * Triggers cache invalidation for the computed tags on the runtime.
 */
export async function invalidateCache(
  rt: Runtime,
  ctx: TenantContext | string,
  change: CacheChange,
): Promise<string[]> {
  const tags = computeInvalidationTags(ctx, change);
  if (rt.revalidateTags && tags.length > 0) {
    await rt.revalidateTags(tags);
  }
  return tags;
}

/**
 * Automatically resolves all owners from media_usages for the affected media IDs
 * and invalidates tenant-prefixed cache tags for each owner (MEDIA-LIBRARY-PLAN §11 / S5).
 */
export async function invalidateMediaCache(
  rt: Runtime,
  ctx: TenantContext,
  mediaIds: string[],
): Promise<string[]> {
  const ids = Array.from(new Set(mediaIds)).slice(0, 100);
  if (ids.length === 0) {
    return await invalidateCache(rt, ctx, { type: "media_updated" });
  }

  const db = rt._db.db;
  const owners = await withTenant(db, ctx.tenantId, async (tx) => {
    const usageRows = await tx
      .select({
        ownerType: schema.mediaUsages.ownerType,
        ownerId: schema.mediaUsages.ownerId,
        field: schema.mediaUsages.field,
      })
      .from(schema.mediaUsages)
      .where(
        and(
          eq(schema.mediaUsages.tenantId, ctx.tenantId),
          inArray(schema.mediaUsages.mediaId, ids),
        ),
      );

    const variantOwnerIds = usageRows
      .filter((u) => u.ownerType === "variant")
      .map((u) => u.ownerId);

    const variantProductMap = new Map<string, string>();
    if (variantOwnerIds.length > 0) {
      const vRows = await tx
        .select({ id: schema.variants.id, productId: schema.variants.productId })
        .from(schema.variants)
        .where(inArray(schema.variants.id, variantOwnerIds));
      for (const v of vRows) {
        variantProductMap.set(v.id, v.productId);
      }
    }

    return usageRows.map((u) => ({
      ownerType: u.ownerType,
      ownerId: u.ownerId,
      productId: u.ownerType === "variant" ? variantProductMap.get(u.ownerId) : undefined,
      field: u.field,
    }));
  });

  return await invalidateCache(rt, ctx, {
    type: "media_updated",
    mediaIds: ids,
    owners,
  });
}
