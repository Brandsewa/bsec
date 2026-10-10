import "server-only";
import { cacheTag } from "next/cache";
import {
  tenantTag,
  getStorefrontProduct,
  getStorefrontCollection,
  getStorefrontCategory,
  getStorefrontHomePage,
  getStorefrontPage,
  getStorefrontPageByPath,
  getBrandSettings,
  getStorefrontThemePage,
  getStorefrontThemeTokens,
  THEME_SYSTEM_PAGES,
  type ThemeSystemPageKey,
  resolvePageRenderData,
  getStoreSettings,
  type CatalogListingOptions,
  type StorefrontProductDetail,
  type StorefrontCollectionDetail,
  type StorefrontCategoryDetail,
  type TenantContext,
} from "@bs/domain";
import { renderBlockDocument, walkBlocks, type BlockInstance } from "@bs/blocks";
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
  // Filter menu changes also invalidate collection listings.
  cacheTag(tenantTag(tenantId, "nav"));
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

/**
 * Resolves store data + media URLs for a page's data-driven blocks inside the same cached
 * scope as the page, and tags it so product/collection edits refresh the page. Pages without
 * data blocks get no extra tags.
 */
async function loadRenderData(tenantId: string, tenantCtx: TenantContext, document: unknown) {
  const rendered = renderBlockDocument(document);
  if (!rendered.success) return { data: {}, media: {} };
  let needsCatalog = false;
  let needsNav = false;
  walkBlocks(rendered.blocks as BlockInstance[], (b) => {
    if (b.type === "ProductGrid" || b.type === "ProductCarousel" || b.type === "CollectionGrid" || b.type === "ProductShowcase") needsCatalog = true;
    if (b.type === "SiteHeader" || b.type === "SiteFooter") needsNav = true;
  });
  if (needsCatalog) {
    cacheTag(tenantTag(tenantId, "product"));
    cacheTag(tenantTag(tenantId, "collection"));
  }
  if (needsNav) {
    cacheTag(tenantTag(tenantId, "nav"));
  }
  const { rt } = server();
  return resolvePageRenderData(rt, tenantCtx, rendered.blocks);
}

export async function getCachedStorefrontHomePage(tenantId: string) {
  "use cache";
  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId);
  const home = await getStorefrontHomePage(rt, tenantCtx);

  cacheTag(tenantTag(tenantId, "page", "home"));
  cacheTag(tenantTag(tenantId, "store-shell"));

  const renderData = await loadRenderData(tenantId, tenantCtx, home.document);
  return { ...home, renderData };
}

export async function getCachedStorefrontPage(tenantId: string, slug: string) {
  "use cache";
  // Tag before the lookup so a page that did not exist yet (or was unpublished) refreshes when it is published.
  cacheTag(tenantTag(tenantId, "page", slug));
  cacheTag(tenantTag(tenantId, "store-shell"));
  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId);
  const page = await getStorefrontPage(rt, tenantCtx, slug);
  if (!page) return page;

  const renderData = await loadRenderData(tenantId, tenantCtx, page.document);
  return { ...page, renderData };
}

export async function getCachedStorefrontPageByPath(tenantId: string, pathSegments: string[]) {
  "use cache";
  const targetSlug = pathSegments[pathSegments.length - 1];
  if (targetSlug) {
    cacheTag(tenantTag(tenantId, "page", targetSlug));
  }
  cacheTag(tenantTag(tenantId, "store-shell"));
  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId);
  const result = await getStorefrontPageByPath(rt, tenantCtx, pathSegments);
  if (!result) return null;

  const renderData = await loadRenderData(tenantId, tenantCtx, result.page.document);
  return { ...result, renderData };
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

/**
 * A store's header, footer, product or collection layout (published blocks plus the data its
 * widgets need), or null when the store has none and the built-in layout applies. Tagged with
 * the page's own tag so publishing it in the editor refreshes every page that uses it.
 */
export async function getCachedThemePage(tenantId: string, key: ThemeSystemPageKey) {
  "use cache";
  cacheTag(tenantTag(tenantId, "page", THEME_SYSTEM_PAGES[key].slug));
  if (key === "header" || key === "footer") {
    cacheTag(tenantTag(tenantId, "nav"));
  }
  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId);
  const page = await getStorefrontThemePage(rt, tenantCtx, key);
  if (!page) return null;
  const renderData = await loadRenderData(tenantId, tenantCtx, { version: 1, blocks: page.blocks });
  return { blocks: page.blocks, renderData };
}

/** Theme tokens when the store uses the theme system (see THEME_TOKENS_SOURCE), else null. */
export async function getCachedThemeTokens(tenantId: string) {
  "use cache";
  cacheTag(tenantTag(tenantId, "theme"));
  cacheTag(tenantTag(tenantId, "store-shell"));
  const { rt } = server();
  return getStorefrontThemeTokens(rt, createStorefrontTenantContext(tenantId));
}
