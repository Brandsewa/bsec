import { and, eq, inArray } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { TenantContext } from "./context.ts";
import type { Runtime } from "./runtime.ts";
import { tenantTag } from "./cache-tags.ts";
import { findUntrackedReferences } from "./media/untracked-references.ts";

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
  | { type: "blog_post_changed"; postId: string; slug?: string | undefined; previousSlug?: string | undefined; categoryId?: string | null | undefined }
  | { type: "blog_category_changed"; categoryId?: string | undefined }
  | { type: "blog_settings_changed" }
  | { type: "markets_changed" }
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
            slug?: string | undefined;
            pageType?: string | undefined;
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
    case "markets_changed": {
      // A market's prices, catalog or countries changed: every product, collection and category view can differ per market.
      for (const kind of ["product", "collection", "category", "store-shell", "nav", "seo"] as const) tags.push(tenantTag(tenantId, kind));
      tags.push(tenantTag(tenantId, "page", "home"));
      break;
    }
    case "theme_or_brand_published": {
      // Theme or branding publish -> theme, store-shell (all pages)
      tags.push(tenantTag(tenantId, "theme"));
      tags.push(tenantTag(tenantId, "store-shell"));
      break;
    }
    case "blog_post_changed": {
      // A post shows in lists, the Recent Posts widget (home or any page), its category pages, the feed and the sitemap.
      tags.push(tenantTag(tenantId, "blog"));
      tags.push(tenantTag(tenantId, "blog", change.postId));
      if (change.categoryId) tags.push(tenantTag(tenantId, "blog", `cat:${change.categoryId}`));
      tags.push(tenantTag(tenantId, "page", "home"));
      tags.push(tenantTag(tenantId, "nav"));
      tags.push(tenantTag(tenantId, "seo"));
      break;
    }
    case "blog_category_changed":
    case "blog_settings_changed": {
      tags.push(tenantTag(tenantId, "blog"));
      if (change.type === "blog_category_changed" && change.categoryId) tags.push(tenantTag(tenantId, "blog", `cat:${change.categoryId}`));
      tags.push(tenantTag(tenantId, "page", "home"));
      tags.push(tenantTag(tenantId, "nav"));
      tags.push(tenantTag(tenantId, "seo"));
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
          case "blog_post":
          case "blog_category": {
            tags.push(tenantTag(tenantId, "blog"));
            tags.push(tenantTag(tenantId, "page", "home"));
            break;
          }
          case "store_branding":
          case "branding": {
            tags.push(tenantTag(tenantId, "store-shell"));
            tags.push(tenantTag(tenantId, "seo"));
            tags.push(tenantTag(tenantId, "theme"));
            break;
          }
          case "store_status": {
            tags.push(tenantTag(tenantId, "store-shell"));
            tags.push(tenantTag(tenantId, "seo"));
            break;
          }
          case "seo_settings": {
            tags.push(tenantTag(tenantId, "seo"));
            break;
          }
          case "page": {
            if (o.slug) {
              tags.push(tenantTag(tenantId, "page", o.slug));
              if (o.slug === "home" || o.pageType === "home") {
                tags.push(tenantTag(tenantId, "page", "home"));
                tags.push(tenantTag(tenantId, "store-shell"));
              }
              if (
                o.slug === "template-header" ||
                o.pageType === "header" ||
                o.slug === "template-footer" ||
                o.pageType === "footer"
              ) {
                tags.push(tenantTag(tenantId, "nav"));
                tags.push(tenantTag(tenantId, "store-shell"));
              }
              if (o.slug === "template-product" || o.pageType === "product_template") {
                tags.push(tenantTag(tenantId, "product"));
              }
              if (o.slug === "template-collection" || o.pageType === "collection_template") {
                tags.push(tenantTag(tenantId, "collection"));
              }
              if (o.slug === "template-collections" || o.pageType === "collections_archive_template") {
                tags.push(tenantTag(tenantId, "collection"));
              }
              if (o.slug === "template-blog" || o.slug === "template-blog-post" || o.pageType === "blog_archive_template" || o.pageType === "blog_post_template") {
                tags.push(tenantTag(tenantId, "blog"));
              }
              if (o.slug === "template-cart" || o.pageType === "cart_template") {
                tags.push(tenantTag(tenantId, "store-shell"));
              }
            }
            tags.push(tenantTag(tenantId, "page", o.ownerId));
            break;
          }
          case "theme": {
            tags.push(tenantTag(tenantId, "theme"));
            tags.push(tenantTag(tenantId, "store-shell"));
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

    const untrackedMap = await findUntrackedReferences(tx, ctx.tenantId, ids);

    // Look up page metadata (slug, type) for cache tag derivation
    const allPageIds = new Set<string>();
    for (const u of usageRows) {
      if (u.ownerType === "page") allPageIds.add(u.ownerId);
    }
    for (const refs of untrackedMap.values()) {
      for (const r of refs) {
        if (r.ownerType === "page") allPageIds.add(r.ownerId);
      }
    }

    const pageMap = new Map<string, { slug: string; type: string }>();
    if (allPageIds.size > 0) {
      const pRows = await tx
        .select({ id: schema.pages.id, slug: schema.pages.slug, type: schema.pages.type })
        .from(schema.pages)
        .where(inArray(schema.pages.id, Array.from(allPageIds)));
      for (const p of pRows) {
        pageMap.set(p.id, { slug: p.slug, type: p.type });
      }
    }

    const usageOwners: Array<{
      ownerType: string;
      ownerId: string;
      productId?: string | undefined;
      slug?: string | undefined;
      pageType?: string | undefined;
      field?: string | undefined;
    }> = usageRows.map((u) => {
      const p = u.ownerType === "page" ? pageMap.get(u.ownerId) : undefined;
      return {
        ownerType: u.ownerType,
        ownerId: u.ownerId,
        productId: u.ownerType === "variant" ? variantProductMap.get(u.ownerId) : undefined,
        slug: p?.slug,
        pageType: p?.type,
        field: u.field,
      };
    });

    for (const refs of untrackedMap.values()) {
      for (const r of refs) {
        const p = r.ownerType === "page" ? pageMap.get(r.ownerId) : undefined;
        usageOwners.push({
          ownerType: r.ownerType,
          ownerId: r.ownerId,
          slug: p?.slug,
          pageType: p?.type,
          field: r.field,
        });
      }
    }

    return usageOwners;
  });

  return await invalidateCache(rt, ctx, {
    type: "media_updated",
    mediaIds: ids,
    owners,
  });
}
