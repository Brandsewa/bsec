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
  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId);
  const product = await getStorefrontProduct(rt, tenantCtx, slug);

  if (product) {
    cacheTag(tenantTag(tenantId, "product", product.id));
    cacheTag(tenantTag(tenantId, "product"));
  }

  return product;
}

export async function getCachedStorefrontCollection(
  tenantId: string,
  slug: string,
  options?: CatalogListingOptions,
): Promise<StorefrontCollectionDetail | null> {
  "use cache";
  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId);
  const res = await getStorefrontCollection(rt, tenantCtx, slug, options);

  if (res?.collection) {
    cacheTag(tenantTag(tenantId, "collection", res.collection.id));
    cacheTag(tenantTag(tenantId, "collection"));
  }

  return res;
}

export async function getCachedStorefrontCategory(
  tenantId: string,
  slug: string,
  options?: CatalogListingOptions,
): Promise<StorefrontCategoryDetail | null> {
  "use cache";
  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId);
  const res = await getStorefrontCategory(rt, tenantCtx, slug, options);

  if (res?.category) {
    cacheTag(tenantTag(tenantId, "category", res.category.id));
    cacheTag(tenantTag(tenantId, "category"));
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
  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId);
  const page = await getStorefrontPage(rt, tenantCtx, slug);

  if (page) {
    cacheTag(tenantTag(tenantId, "page", slug));
    cacheTag(tenantTag(tenantId, "store-shell"));
  }

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
