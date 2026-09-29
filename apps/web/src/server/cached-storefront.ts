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
 * Cache entry with tag metadata for invalidation tracking.
 */
interface CacheEntry<T> {
  value: T;
  tags: Set<string>;
  cachedAt: number;
}

const storefrontCacheStore = new Map<string, CacheEntry<unknown>>();

/**
 * Helper to build standard tenant context for cached storefront reads
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

/**
 * Invalidates in-memory cached entries matching any of the specified revalidation tags.
 */
export function invalidateStorefrontCache(tags: string[]): number {
  if (tags.length === 0) return 0;
  const tagSet = new Set(tags);
  let purgedCount = 0;

  for (const [key, entry] of storefrontCacheStore.entries()) {
    let matches = false;
    for (const t of entry.tags) {
      if (tagSet.has(t)) {
        matches = true;
        break;
      }
    }
    if (matches) {
      storefrontCacheStore.delete(key);
      purgedCount++;
    }
  }

  return purgedCount;
}

/**
 * Clears the entire storefront in-memory cache (useful in tests).
 */
export function clearStorefrontCache(): void {
  storefrontCacheStore.clear();
}

/**
 * Returns current cache entries count for diagnostics and tests.
 */
export function getStorefrontCacheSize(): number {
  return storefrontCacheStore.size;
}

/**
 * Cached product detail loader with Next.js Cache Components and PLAN §11.6 invalidation tags.
 */
export async function getCachedStorefrontProduct(
  tenantId: string,
  slug: string,
): Promise<StorefrontProductDetail | null> {
  "use cache";
  const cacheKey = `product:${tenantId}:${slug}`;
  const existing = storefrontCacheStore.get(cacheKey);
  if (existing) {
    return existing.value as StorefrontProductDetail | null;
  }

  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId);
  const product = await getStorefrontProduct(rt, tenantCtx, slug);
  const tags = new Set<string>();

  if (product) {
    const prodIdTag = tenantTag(tenantId, "product", product.id);
    const prodGlobalTag = tenantTag(tenantId, "product");
    tags.add(prodIdTag);
    tags.add(prodGlobalTag);

    try {
      cacheTag(tenantTag(tenantId, "product", product.id));
      cacheTag(tenantTag(tenantId, "product"));
    } catch {
      // Ignore if outside Next.js request context
    }
  }

  storefrontCacheStore.set(cacheKey, {
    value: product,
    tags,
    cachedAt: Date.now(),
  });

  return product;
}

/**
 * Cached storefront collection loader with Next.js Cache Components.
 */
export async function getCachedStorefrontCollection(
  tenantId: string,
  slug: string,
  options?: CatalogListingOptions,
): Promise<StorefrontCollectionDetail | null> {
  "use cache";
  const optionsKey = JSON.stringify(options ?? {});
  const cacheKey = `collection:${tenantId}:${slug}:${optionsKey}`;
  const existing = storefrontCacheStore.get(cacheKey);
  if (existing) {
    return existing.value as StorefrontCollectionDetail | null;
  }

  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId);
  const res = await getStorefrontCollection(rt, tenantCtx, slug, options);
  const tags = new Set<string>();

  if (res?.collection) {
    const colIdTag = tenantTag(tenantId, "collection", res.collection.id);
    const colGlobalTag = tenantTag(tenantId, "collection");
    tags.add(colIdTag);
    tags.add(colGlobalTag);

    try {
      cacheTag(tenantTag(tenantId, "collection", res.collection.id));
      cacheTag(tenantTag(tenantId, "collection"));
    } catch {
      // Ignore outside Next.js
    }
  }

  storefrontCacheStore.set(cacheKey, {
    value: res,
    tags,
    cachedAt: Date.now(),
  });

  return res;
}

/**
 * Cached storefront category loader with Next.js Cache Components.
 */
export async function getCachedStorefrontCategory(
  tenantId: string,
  slug: string,
  options?: CatalogListingOptions,
): Promise<StorefrontCategoryDetail | null> {
  "use cache";
  const optionsKey = JSON.stringify(options ?? {});
  const cacheKey = `category:${tenantId}:${slug}:${optionsKey}`;
  const existing = storefrontCacheStore.get(cacheKey);
  if (existing) {
    return existing.value as StorefrontCategoryDetail | null;
  }

  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId);
  const res = await getStorefrontCategory(rt, tenantCtx, slug, options);
  const tags = new Set<string>();

  if (res?.category) {
    const catIdTag = tenantTag(tenantId, "category", res.category.id);
    const catGlobalTag = tenantTag(tenantId, "category");
    tags.add(catIdTag);
    tags.add(catGlobalTag);

    try {
      cacheTag(tenantTag(tenantId, "category", res.category.id));
      cacheTag(tenantTag(tenantId, "category"));
    } catch {
      // Ignore outside Next.js
    }
  }

  storefrontCacheStore.set(cacheKey, {
    value: res,
    tags,
    cachedAt: Date.now(),
  });

  return res;
}

/**
 * Cached storefront home page loader with Next.js Cache Components.
 */
export async function getCachedStorefrontHomePage(tenantId: string) {
  "use cache";
  const cacheKey = `home:${tenantId}`;
  const existing = storefrontCacheStore.get(cacheKey);
  if (existing) {
    return existing.value as Awaited<ReturnType<typeof getStorefrontHomePage>>;
  }

  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId);
  const home = await getStorefrontHomePage(rt, tenantCtx);
  const tags = new Set<string>();

  const homeTag = tenantTag(tenantId, "page", "home");
  const shellTag = tenantTag(tenantId, "store-shell");
  tags.add(homeTag);
  tags.add(shellTag);

  try {
    cacheTag(tenantTag(tenantId, "page", "home"));
    cacheTag(tenantTag(tenantId, "store-shell"));
  } catch {
    // Ignore outside Next.js
  }

  storefrontCacheStore.set(cacheKey, {
    value: home,
    tags,
    cachedAt: Date.now(),
  });

  return home;
}

/**
 * Cached storefront custom page loader with Next.js Cache Components.
 */
export async function getCachedStorefrontPage(tenantId: string, slug: string) {
  "use cache";
  const cacheKey = `page:${tenantId}:${slug}`;
  const existing = storefrontCacheStore.get(cacheKey);
  if (existing) {
    return existing.value as Awaited<ReturnType<typeof getStorefrontPage>>;
  }

  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId);
  const page = await getStorefrontPage(rt, tenantCtx, slug);
  const tags = new Set<string>();

  if (page) {
    const pageTag = tenantTag(tenantId, "page", slug);
    const shellTag = tenantTag(tenantId, "store-shell");
    tags.add(pageTag);
    tags.add(shellTag);

    try {
      cacheTag(tenantTag(tenantId, "page", slug));
      cacheTag(tenantTag(tenantId, "store-shell"));
    } catch {
      // Ignore outside Next.js
    }
  }

  storefrontCacheStore.set(cacheKey, {
    value: page,
    tags,
    cachedAt: Date.now(),
  });

  return page;
}

/**
 * Cached storefront brand settings loader with Next.js Cache Components.
 */
export async function getCachedBrandSettings(tenantId: string) {
  "use cache";
  const cacheKey = `brand:${tenantId}`;
  const existing = storefrontCacheStore.get(cacheKey);
  if (existing) {
    return existing.value as Awaited<ReturnType<typeof getBrandSettings>>;
  }

  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId);
  const settings = await getBrandSettings(rt, tenantCtx);
  const tags = new Set<string>();

  const themeTag = tenantTag(tenantId, "theme");
  const shellTag = tenantTag(tenantId, "store-shell");
  const navTag = tenantTag(tenantId, "nav");
  tags.add(themeTag);
  tags.add(shellTag);
  tags.add(navTag);

  try {
    cacheTag(tenantTag(tenantId, "theme"));
    cacheTag(tenantTag(tenantId, "store-shell"));
    cacheTag(tenantTag(tenantId, "nav"));
  } catch {
    // Ignore outside Next.js
  }

  storefrontCacheStore.set(cacheKey, {
    value: settings,
    tags,
    cachedAt: Date.now(),
  });

  return settings;
}
