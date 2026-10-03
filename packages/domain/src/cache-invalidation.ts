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
      // Product title, description, SEO -> product, its categories, its collections, home page if featured
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
      // Custom/landing page publish or rollback -> page:<slug>
      tags.push(tenantTag(tenantId, "page", change.slug));
      break;
    }
    case "nav_updated": {
      // Menu -> nav
      tags.push(tenantTag(tenantId, "nav"));
      break;
    }
    case "collection_updated": {
      // Collection rules or order -> collection, pages that embed it (home page)
      tags.push(tenantTag(tenantId, "collection", change.collectionId));
      tags.push(tenantTag(tenantId, "collection"));
      tags.push(tenantTag(tenantId, "page", "home"));
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
