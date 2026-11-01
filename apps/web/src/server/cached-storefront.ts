import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import {
  tenantTag,
  getStorefrontProduct,
  getStorefrontCollection,
  getStorefrontCategory,
  listStorefrontCategories,
  getStorefrontCustomFields,
  getStorefrontCoupons,
  getBlogMagazine,
  getBlogSidebar,
  type StorefrontCoupon,
  type StorefrontCustomField,
  getStorefrontHomePage,
  getStorefrontPage,
  getStorefrontPageByPath,
  getBrandSettings,
  getStorefrontThemePage,
  getStorefrontThemeTokens,
  THEME_SYSTEM_PAGES,
  type ThemeSystemPageKey,
  resolvePageRenderData,
  resolveRelatedBlockData,
  getStoreSettings,
  listPublicBlogPosts,
  listPublicBlogCategories,
  getPublicBlogPost,
  listBlogForFeed,
  type PublicBlogListQuery,
  type CatalogListingOptions,
  type StorefrontProductDetail,
  type StorefrontCollectionDetail,
  type StorefrontCategoryDetail,
  type StorefrontCategoryCard,
  type TenantContext,
  listStorefrontMarkets,
  type StorefrontMarket,
} from "@bs/domain";
import { renderBlockDocument, resolveDefaultPages, walkBlocks, type BlockInstance } from "@bs/blocks";
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
function createStorefrontTenantContext(tenantId: string, marketId?: string | null): TenantContext {
  return {
    tenantId,
    storeStatus: "live",
    actor: { type: "system" as const },
    roles: ["store_admin"],
    permissions: ["products.read", "settings.write", "content.write", "theme.publish"],
    requestId: crypto.randomUUID(),
    // The market is an argument of every cached loader below, so it is part of the cache key: two markets never share a price (ADR-040).
    marketId: marketId ?? null,
  };
}

/** The markets a shopper can pick (base + active). Tagged like the rest of the shell, so a market edit refreshes it. */
export async function getCachedStorefrontMarkets(tenantId: string): Promise<StorefrontMarket[]> {
  "use cache";
  cacheTag(tenantTag(tenantId, "store-shell"));
  const { rt } = server();
  return listStorefrontMarkets(rt, tenantId);
}

export async function getCachedStorefrontProduct(
  tenantId: string,
  slug: string,
  marketId?: string | null,
): Promise<StorefrontProductDetail | null> {
  "use cache";
  // Tag before the lookup: a "not found" (e.g. a draft that is published later) must be invalidated too.
  cacheTag(tenantTag(tenantId, "product"));
  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId, marketId);
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
  marketId?: string | null,
): Promise<StorefrontCollectionDetail | null> {
  "use cache";
  cacheTag(tenantTag(tenantId, "collection"));
  // A collection page lists products, so product changes must refresh it too.
  cacheTag(tenantTag(tenantId, "product"));
  // Filter menu changes also invalidate collection listings.
  cacheTag(tenantTag(tenantId, "nav"));
  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId, marketId);
  const res = await getStorefrontCollection(rt, tenantCtx, slug, options);

  if (res?.collection) {
    cacheTag(tenantTag(tenantId, "collection", res.collection.id));
  }

  return res;
}

/** The coupons the store shows on product pages. Short-lived: a discount edit shows within a minute. */
export async function getCachedStorefrontCoupons(tenantId: string): Promise<StorefrontCoupon[]> {
  "use cache";
  cacheTag(tenantTag(tenantId, "product"));
  cacheLife({ stale: 30, revalidate: 60, expire: 3600 });
  const { rt } = server();
  return getStorefrontCoupons(rt, createStorefrontTenantContext(tenantId));
}

/** The custom fields to show for one product (ADR-034), refreshed with the product and with field changes. */
export async function getCachedProductCustomFields(tenantId: string, productId: string): Promise<StorefrontCustomField[]> {
  "use cache";
  cacheTag(tenantTag(tenantId, "product", productId));
  cacheTag(tenantTag(tenantId, "product"));
  const { rt } = server();
  return getStorefrontCustomFields(rt, createStorefrontTenantContext(tenantId), { resourceType: "product", resourceId: productId });
}

/** All visible categories for the /categories page, cached under the category and product tags (PLAN §11.6). */
export async function getCachedStorefrontCategories(tenantId: string): Promise<StorefrontCategoryCard[]> {
  "use cache";
  cacheTag(tenantTag(tenantId, "category"));
  cacheTag(tenantTag(tenantId, "product"));
  const { rt } = server();
  return listStorefrontCategories(rt, createStorefrontTenantContext(tenantId));
}

export async function getCachedStorefrontCategory(
  tenantId: string,
  slug: string,
  options?: CatalogListingOptions,
  marketId?: string | null,
): Promise<StorefrontCategoryDetail | null> {
  "use cache";
  cacheTag(tenantTag(tenantId, "category"));
  cacheTag(tenantTag(tenantId, "product"));
  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId, marketId);
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
  let needsBlog = false;
  walkBlocks(rendered.blocks as BlockInstance[], (b) => {
    if (b.type === "BlogPosts" || b.type === "BlogShowcase") needsBlog = true;
    // Review changes invalidate the product tags (cache-invalidation.ts review_updated), so the widget follows them.
    if (b.type === "ReviewsMarquee") needsCatalog = true;
    if (b.type === "ProductGrid" || b.type === "ProductCarousel" || b.type === "CollectionGrid" || b.type === "CollectionShowcase" || b.type === "ProductShowcase") needsCatalog = true;
    if (b.type === "SiteHeader" || b.type === "SiteFooter") needsNav = true;
  });
  if (needsCatalog) {
    cacheTag(tenantTag(tenantId, "product"));
    cacheTag(tenantTag(tenantId, "collection"));
    cacheTag(tenantTag(tenantId, "category"));
  }
  if (needsNav) {
    cacheTag(tenantTag(tenantId, "nav"));
  }
  if (needsBlog) {
    // A page with a Recent Posts widget refreshes when posts change. The worker cannot revalidate tags, so scheduled
    // posts appear through a short lifetime instead (ADR-033).
    cacheTag(tenantTag(tenantId, "blog"));
    cacheLife({ stale: 30, revalidate: 60, expire: 3600 });
  }
  const { rt } = server();
  return resolvePageRenderData(rt, tenantCtx, rendered.blocks);
}

export async function getCachedStorefrontHomePage(tenantId: string, marketId?: string | null) {
  "use cache";
  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId, marketId);
  const home = await getStorefrontHomePage(rt, tenantCtx);

  cacheTag(tenantTag(tenantId, "page", "home"));
  cacheTag(tenantTag(tenantId, "store-shell"));

  const renderData = await loadRenderData(tenantId, tenantCtx, home.document);
  return { ...home, renderData };
}

export async function getCachedStorefrontPage(tenantId: string, slug: string, marketId?: string | null) {
  "use cache";
  // Tag before the lookup so a page that did not exist yet (or was unpublished) refreshes when it is published.
  cacheTag(tenantTag(tenantId, "page", slug));
  cacheTag(tenantTag(tenantId, "store-shell"));
  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId, marketId);
  const page = await getStorefrontPage(rt, tenantCtx, slug);
  if (!page) return page;

  const renderData = await loadRenderData(tenantId, tenantCtx, page.document);
  return { ...page, renderData };
}

export async function getCachedStorefrontPageByPath(tenantId: string, pathSegments: string[], marketId?: string | null) {
  "use cache";
  const targetSlug = pathSegments[pathSegments.length - 1];
  if (targetSlug) {
    cacheTag(tenantTag(tenantId, "page", targetSlug));
  }
  cacheTag(tenantTag(tenantId, "store-shell"));
  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId, marketId);
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
/**
 * Product page: the data of the theme's Product showcase blocks that list related products, for one product. Refreshes when
 * products or collections change, like the rest of the product page.
 */
export async function getCachedRelatedShowcaseData(tenantId: string, productId: string, blocks: BlockInstance[], marketId?: string | null) {
  "use cache";
  cacheTag(tenantTag(tenantId, "product"));
  cacheTag(tenantTag(tenantId, "collection"));
  const { rt } = server();
  return resolveRelatedBlockData(rt, createStorefrontTenantContext(tenantId, marketId), { productId, blocks });
}

export async function getCachedThemePage(tenantId: string, key: ThemeSystemPageKey, marketId?: string | null) {
  "use cache";
  cacheTag(tenantTag(tenantId, "page", THEME_SYSTEM_PAGES[key].slug));
  if (key === "header" || key === "footer") {
    cacheTag(tenantTag(tenantId, "nav"));
  }
  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId, marketId);
  const page = await getStorefrontThemePage(rt, tenantCtx, key);
  if (!page) return null;
  const renderData = await loadRenderData(tenantId, tenantCtx, { version: 1, blocks: page.blocks });
  return { blocks: page.blocks, renderData };
}

/**
 * The Collection Archive (/collections): the theme's archive template when the store has one, else a default
 * layout of a single "list every published collection" grid. Same cache tags as the collection pages.
 */
export async function getCachedCollectionsArchive(tenantId: string) {
  "use cache";
  cacheTag(tenantTag(tenantId, "page", THEME_SYSTEM_PAGES.collections.slug));
  cacheTag(tenantTag(tenantId, "collection"));
  const { rt } = server();
  const tenantCtx = createStorefrontTenantContext(tenantId);
  const page = await getStorefrontThemePage(rt, tenantCtx, "collections");
  const blocks: BlockInstance[] = page?.blocks ?? [
    { id: "default-archive", type: "CollectionGrid", version: 1, props: { title: "Collections", subtitle: "Browse everything we sell.", collectionSlugs: [], showAll: true, columns: "3" } },
  ];
  const renderData = await loadRenderData(tenantId, tenantCtx, { version: 1, blocks });
  return { blocks, renderData, usesTheme: Boolean(page) };
}

/** Copy and switches for the default pages (checkout, order success, payment failed, search, 404); built-in text when the store's theme sets none. */
export async function getCachedDefaultPages(tenantId: string) {
  const tokens = await getCachedThemeTokens(tenantId).catch(() => null);
  return resolveDefaultPages(tokens?.["defaultPages"]);
}

/** Theme tokens when the store uses the theme system (see THEME_TOKENS_SOURCE), else null. */
export async function getCachedThemeTokens(tenantId: string) {
  "use cache";
  cacheTag(tenantTag(tenantId, "theme"));
  cacheTag(tenantTag(tenantId, "store-shell"));
  const { rt } = server();
  return getStorefrontThemeTokens(rt, createStorefrontTenantContext(tenantId));
}

/**
 * Blog archive data (/blog, /blog/page/n, category pages). Tagged `blog`; the lifetime is short because the
 * worker's scheduled-publish job cannot revalidate tags (ADR-033), so a scheduled post shows within about a minute.
 */
export async function getCachedBlogList(tenantId: string, query: PublicBlogListQuery) {
  "use cache";
  cacheTag(tenantTag(tenantId, "blog"));
  cacheLife({ stale: 30, revalidate: 60, expire: 3600 });
  const { rt } = server();
  const ctx = createStorefrontTenantContext(tenantId);
  const [list, categories] = await Promise.all([listPublicBlogPosts(rt, ctx, query), listPublicBlogCategories(rt, ctx)]);
  return { list, categories };
}

/** The magazine blog index data (latest posts and a row per category). */
export async function getCachedBlogMagazine(tenantId: string, opts: { latest: number; perCategory: number }) {
  "use cache";
  cacheTag(tenantTag(tenantId, "blog"));
  cacheLife({ stale: 30, revalidate: 60, expire: 3600 });
  const { rt } = server();
  return getBlogMagazine(rt, createStorefrontTenantContext(tenantId), opts);
}

/** Featured posts and categories for the post page sidebar. */
export async function getCachedBlogSidebar(tenantId: string, featured: number) {
  "use cache";
  cacheTag(tenantTag(tenantId, "blog"));
  cacheLife({ stale: 30, revalidate: 60, expire: 3600 });
  const { rt } = server();
  return getBlogSidebar(rt, createStorefrontTenantContext(tenantId), { featured });
}

export async function getCachedBlogPost(tenantId: string, slug: string) {
  "use cache";
  cacheTag(tenantTag(tenantId, "blog"));
  cacheLife({ stale: 30, revalidate: 60, expire: 3600 });
  const { rt } = server();
  const res = await getPublicBlogPost(rt, createStorefrontTenantContext(tenantId), slug);
  if (res.kind === "post") cacheTag(tenantTag(tenantId, "blog", res.post.id));
  return res;
}

export async function getCachedBlogFeed(tenantId: string) {
  "use cache";
  cacheTag(tenantTag(tenantId, "blog"));
  cacheLife({ stale: 30, revalidate: 60, expire: 3600 });
  const { rt } = server();
  return listBlogForFeed(rt, createStorefrontTenantContext(tenantId), 20);
}
