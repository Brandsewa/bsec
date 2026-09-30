import "server-only";
import { cacheTag } from "next/cache";
import {
  tenantTag,
  getStorefrontProduct,
  getStorefrontCollection,
  getStorefrontCategory,
  getStorefrontHomePage,
  getStorefrontPage,
  getBrandSettings,
  getStoreSettings,
  getStorefrontFeaturedProducts,
  type StorefrontProductSummary,
  type CatalogListingOptions,
  type StorefrontProductDetail,
  type StorefrontCollectionDetail,
  type StorefrontCategoryDetail,
  type TenantContext,
} from "@bs/domain";
import { server } from "./runtime.ts";

/**
 * These loaders rely entirely on Next.js Cache Components ("use cache" + cacheTag()):
 * Next itself memoizes the function's return value keyed by its arguments and invalidates it
 * when revalidateTag() is called with a matching tag (see packages/domain/src/cache-invalidation.ts
 * for the write side). There must be no second, hand-rolled cache layer here — a manual Map on
 * top of "use cache" creates two independently-invalidated caches that can silently disagree, and
 * (being process-local, unbounded, in-memory) is wrong for anything beyond a single dev process.
 * cacheTag() is called unconditionally: outside a real Next cache scope (e.g. a plain unit test
 * importing this module directly) it throws, which is the correct signal that the caller isn't
 * exercising a real "use cache" context — don't swallow it silently.
 */

/**
 * Helper to build standard tenant context for cached storefront reads.
 */
function createStorefrontTenantContext(tenantId: string): TenantContext {
  return {
    tenantId,
    storeStatus: "live",
    actor: { type: "system" as const },
    roles: ["store_admin"],
    permissions: ["products.read", "settings.write", "content.write", "theme.publish"],
    requestId: crypto.randomUUID(),
  };
}

export async function getCachedStorefrontProduct(
  tenantId: string,
  slug: string,
): Promise<StorefrontProductDetail | null> {
  "use cache";
  // Tag before the lookup: a "not found" (e.g. a draft that is published later) must be invalidated too.
  cacheTag(tenantTag(tenantId, "product"));
  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId);
  const product = await getStorefrontProduct(rt, tenantCtx, slug);

  if (product) {
    cacheTag(tenantTag(tenantId, "product", product.id));
  }

  return product;
}

export async function getCachedStorefrontCollection(
  tenantId: string,
  slug: string,
  options?: CatalogListingOptions,
): Promise<StorefrontCollectionDetail | null> {
  "use cache";
  cacheTag(tenantTag(tenantId, "collection"));
  // A collection page lists products, so product changes must refresh it too.
  cacheTag(tenantTag(tenantId, "product"));
  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId);
  const res = await getStorefrontCollection(rt, tenantCtx, slug, options);

  if (res?.collection) {
    cacheTag(tenantTag(tenantId, "collection", res.collection.id));
  }

  return res;
}

export async function getCachedStorefrontCategory(
  tenantId: string,
  slug: string,
  options?: CatalogListingOptions,
): Promise<StorefrontCategoryDetail | null> {
  "use cache";
  cacheTag(tenantTag(tenantId, "category"));
  cacheTag(tenantTag(tenantId, "product"));
  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId);
  const res = await getStorefrontCategory(rt, tenantCtx, slug, options);

  if (res?.category) {
    cacheTag(tenantTag(tenantId, "category", res.category.id));
  }

  return res;
}

export async function getCachedStorefrontHomePage(tenantId: string) {
  "use cache";
  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId);
  const home = await getStorefrontHomePage(rt, tenantCtx);

  cacheTag(tenantTag(tenantId, "page", "home"));
  cacheTag(tenantTag(tenantId, "store-shell"));

  return home;
}

export async function getCachedStorefrontPage(tenantId: string, slug: string) {
  "use cache";
  // Tag before the lookup so a page that did not exist yet (or was unpublished) refreshes when it is published.
  cacheTag(tenantTag(tenantId, "page", slug));
  cacheTag(tenantTag(tenantId, "store-shell"));
  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId);
  const page = await getStorefrontPage(rt, tenantCtx, slug);

  return page;
}

export async function getCachedBrandSettings(tenantId: string) {
  "use cache";
  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId);
  const settings = await getBrandSettings(rt, tenantCtx);

  cacheTag(tenantTag(tenantId, "theme"));
  cacheTag(tenantTag(tenantId, "store-shell"));
  cacheTag(tenantTag(tenantId, "nav"));

  return settings;
}

/** The store's public name (header, footer, page title). Invalidated with the rest of the store shell. */
export async function getCachedStoreName(tenantId: string): Promise<string> {
  "use cache";
  cacheTag(tenantTag(tenantId, "store-shell"));
  const { rt } = server();
  const settings = await getStoreSettings(rt, createStorefrontTenantContext(tenantId));
  return settings.storeName;
}

/** Products for a ProductGrid block on the home page or a custom page. */
export async function getCachedStorefrontFeaturedProducts(
  tenantId: string,
  limit: number,
  collectionSlug?: string,
): Promise<StorefrontProductSummary[]> {
  "use cache";
  cacheTag(tenantTag(tenantId, "product"));
  cacheTag(tenantTag(tenantId, "collection"));
  const { rt } = server();
  return getStorefrontFeaturedProducts(rt, createStorefrontTenantContext(tenantId), { limit, collectionSlug });
}
