import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { withMarketScope } from "../markets/scope.ts";
import { schema, withTenant } from "@bs/db";
import {
  collectMediaIds as collectDocumentMediaIds,
  validateBlockDocument,
  walkBlocks,
  type BlockCollectionSummary,
  type BlockBlogPost,
  type BlockReview,
  type BlockData,
  type BlockInstance,
  type BlockProduct,
  type ResolvedMenuItem,
} from "@bs/blocks";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { isFeatureEnabled } from "../features.ts";
import { computeCanonicalPath } from "../content-services.ts";
import { buildCloudflareImageUrl, publicMediaUrl } from "../media/storage.ts";
import { buildProductSummaries, type StorefrontProductSummary } from "../storefront/catalog.ts";
import { LISTED_PRODUCT_STATUSES } from "../storefront/product-status.ts";
import { blogMenuTargetsTx, recentBlogPostsTx, type BlogPostSummary } from "../blog/queries.ts";

type Tx = Parameters<Parameters<typeof withTenant>[2]>[0];
type ProductRow = typeof schema.products.$inferSelect;

const DEFAULT_LIMIT = 8;

const toBlockProduct = (s: StorefrontProductSummary): BlockProduct => ({
  id: s.id,
  title: s.title,
  slug: s.slug,
  priceMin: s.priceMin,
  compareAtPriceMin: s.compareAtPriceMin,
  priceOnRequest: s.priceOnRequest,
  ratingAvg: s.ratingAvg,
  ratingCount: s.ratingCount,
  imageMediaId: s.primaryImage?.mediaId,
  imageUrl: s.primaryImage?.url,
  imageAlt: s.primaryImage?.alt,
  priceMax: s.priceMax,
  ...(s.brand?.name ? { brandName: s.brand.name } : null),
});

const liveProducts = () =>
  and(inArray(schema.products.status, [...LISTED_PRODUCT_STATUSES]), isNull(schema.products.deletedAt));

async function newest(tx: Tx, limit: number): Promise<ProductRow[]> {
  return tx.select().from(schema.products).where(liveProducts()).orderBy(desc(schema.products.createdAt)).limit(limit);
}

async function loadProducts(tx: Tx, props: Record<string, unknown>): Promise<ProductRow[]> {
  const limit = Math.min(Math.max(Number(props.limit) || DEFAULT_LIMIT, 1), 48);
  const collectionSlug = typeof props.collectionSlug === "string" ? props.collectionSlug : "";
  const slugs = Array.isArray(props.productSlugs) ? (props.productSlugs as unknown[]).filter((s): s is string => typeof s === "string") : [];
  // Older documents have no `source`: a collection slug meant "collection", otherwise "newest".
  const source = (props.source as string | undefined) ?? (collectionSlug ? "collection" : "newest");

  switch (source) {
    case "featured": {
      const rows = await tx
        .select()
        .from(schema.products)
        .where(and(liveProducts(), eq(schema.products.isFeatured, true)))
        .orderBy(desc(schema.products.createdAt))
        .limit(limit);
      return rows.length > 0 ? rows : newest(tx, limit);
    }
    case "collection": {
      const [col] = await tx
        .select({ id: schema.collections.id })
        .from(schema.collections)
        .where(and(eq(schema.collections.slug, collectionSlug), eq(schema.collections.published, true)))
        .limit(1);
      if (!col) return [];
      const rows = await tx
        .select({ product: schema.products })
        .from(schema.collectionProducts)
        .innerJoin(
          schema.products,
          and(
            eq(schema.products.tenantId, schema.collectionProducts.tenantId),
            eq(schema.products.id, schema.collectionProducts.productId),
          ),
        )
        .where(and(eq(schema.collectionProducts.collectionId, col.id), liveProducts()))
        .orderBy(asc(schema.collectionProducts.position))
        .limit(limit);
      return rows.map((r) => r.product);
    }
    case "manual": {
      if (slugs.length === 0) return [];
      const rows = await tx
        .select()
        .from(schema.products)
        .where(and(liveProducts(), inArray(schema.products.slug, slugs.slice(0, limit))));
      const bySlug = new Map(rows.map((r) => [r.slug, r]));
      return slugs.slice(0, limit).map((s) => bySlug.get(s)).filter((r): r is ProductRow => !!r);
    }
    default:
      return newest(tx, limit);
  }
}

/**
 * Adds what the showcase card needs beyond the product summary: the first category's name (for the badge)
 * and, for single-variant products, the variant id so the card's cart button can add it directly.
 */
/**
 * Products related to one product: others from the same collections, then the same categories, then the newest, never the
 * product itself. Only products customers can see.
 */
async function loadRelatedProducts(tx: Tx, productId: string, limit: number): Promise<ProductRow[]> {
  const collections = await tx.select({ id: schema.collectionProducts.collectionId }).from(schema.collectionProducts).where(eq(schema.collectionProducts.productId, productId));
  const categories = await tx.select({ id: schema.productCategories.categoryId }).from(schema.productCategories).where(eq(schema.productCategories.productId, productId));
  const ids: string[] = [];
  const add = (rows: Array<{ productId: string }>) => {
    for (const r of rows) if (r.productId !== productId && !ids.includes(r.productId)) ids.push(r.productId);
  };
  if (collections.length > 0) {
    add(await tx.select({ productId: schema.collectionProducts.productId }).from(schema.collectionProducts).where(inArray(schema.collectionProducts.collectionId, collections.map((c) => c.id))).limit(100));
  }
  if (categories.length > 0) {
    add(await tx.select({ productId: schema.productCategories.productId }).from(schema.productCategories).where(inArray(schema.productCategories.categoryId, categories.map((c) => c.id))).limit(100));
  }
  const related = ids.length > 0 ? await tx.select().from(schema.products).where(and(liveProducts(), inArray(schema.products.id, ids.slice(0, 100)))) : [];
  const rank = new Map(ids.map((id, i) => [id, i]));
  const rows = related.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)).slice(0, limit);
  if (rows.length >= limit) return rows;
  const fill = await newest(tx, limit + rows.length + 1);
  const have = new Set(rows.map((r) => r.id));
  for (const r of fill) {
    if (rows.length >= limit) break;
    if (r.id !== productId && !have.has(r.id)) rows.push(r);
  }
  return rows;
}

/** One Product showcase's tabs. A "related" tab lists products related to `relatedTo` (the product page's product), else the newest. */
async function resolveShowcase(tx: Tx, b: BlockInstance, relatedTo?: string): Promise<BlockData> {
  const tabs = Array.isArray(b.props["tabs"]) ? (b.props["tabs"] as Array<Record<string, unknown>>).slice(0, 6) : [];
  const limit = Number(b.props["limit"]) || 10;
  const resolved: Array<{ products: BlockProduct[] }> = [];
  for (const tab of tabs.length > 0 ? tabs : [{ source: "newest" }]) {
    const rows =
      tab["source"] === "related" && relatedTo
        ? await loadRelatedProducts(tx, relatedTo, limit)
        : await loadProducts(tx, { source: tab["source"] === "related" ? "newest" : tab["source"], collectionSlug: tab["collectionSlug"], limit });
    const summaries = await buildProductSummaries(tx, rows.map((r) => r.id), rows);
    resolved.push({ products: await enrichShowcaseProducts(tx, summaries.map(toBlockProduct)) });
  }
  return { kind: "product-tabs", tabs: resolved };
}

/**
 * Product page: the render data of the Product showcase blocks that have a "related" tab, for this product. The theme's page
 * data is resolved once per store, so these blocks are resolved again per product and laid over it.
 */
export async function resolveRelatedBlockData(
  rt: Runtime,
  ctx: TenantContext,
  input: { productId: string; blocks: BlockInstance[] },
): Promise<Record<string, BlockData>> {
  const targets: BlockInstance[] = [];
  walkBlocks(input.blocks, (b) => {
    if (b.hidden || b.type !== "ProductShowcase") return;
    const tabs = Array.isArray(b.props["tabs"]) ? (b.props["tabs"] as Array<Record<string, unknown>>) : [];
    if (tabs.some((t) => t["source"] === "related")) targets.push(b);
  });
  if (targets.length === 0) return {};
  const db = rt._db.db;
  if (!(await isFeatureEnabled(db, ctx.tenantId, "catalog"))) return {};
  return withMarketScope(db, ctx, async (tx) => {
    const out: Record<string, BlockData> = {};
    for (const b of targets) out[b.id] = await resolveShowcase(tx, b, input.productId);
    return out;
  });
}

async function enrichShowcaseProducts(tx: Tx, products: BlockProduct[]): Promise<BlockProduct[]> {
  if (products.length === 0) return products;
  const ids = products.map((p) => p.id);
  const variantRows = await tx.select({ id: schema.variants.id, productId: schema.variants.productId }).from(schema.variants).where(inArray(schema.variants.productId, ids));
  const variantsBy = new Map<string, string[]>();
  for (const v of variantRows) variantsBy.set(v.productId, [...(variantsBy.get(v.productId) ?? []), v.id]);
  const catRows = await tx
    .select({ productId: schema.productCategories.productId, name: schema.categories.name, position: schema.productCategories.position })
    .from(schema.productCategories)
    .innerJoin(schema.categories, and(eq(schema.categories.tenantId, schema.productCategories.tenantId), eq(schema.categories.id, schema.productCategories.categoryId)))
    .where(inArray(schema.productCategories.productId, ids))
    .orderBy(asc(schema.productCategories.position));
  const categoryBy = new Map<string, string>();
  for (const c of catRows) if (!categoryBy.has(c.productId)) categoryBy.set(c.productId, c.name);
  return products.map((p) => {
    const vs = variantsBy.get(p.id) ?? [];
    const category = categoryBy.get(p.id);
    return { ...p, ...(category ? { categoryName: category } : null), ...(vs.length === 1 && vs[0] ? { quickAddVariantId: vs[0] } : null) };
  });
}

/** Collection showcase set to "categories": active categories, by pick order or all of them. */
async function loadCategoryCards(tx: Tx, props: Record<string, unknown>): Promise<BlockCollectionSummary[]> {
  const toCard = (r: typeof schema.categories.$inferSelect): BlockCollectionSummary => ({
    slug: r.slug,
    title: r.name,
    imageMediaId: r.imageMediaId ?? undefined,
    ...(r.description ? { description: r.description } : {}),
  });
  if (props.showAll === true) {
    const all = await tx.select().from(schema.categories).where(eq(schema.categories.isActive, true)).orderBy(asc(schema.categories.position), asc(schema.categories.name)).limit(48);
    return all.map(toCard);
  }
  const slugs = Array.isArray(props.categorySlugs) ? (props.categorySlugs as unknown[]).filter((s): s is string => typeof s === "string").slice(0, 24) : [];
  if (slugs.length === 0) return [];
  const rows = await tx.select().from(schema.categories).where(and(eq(schema.categories.isActive, true), inArray(schema.categories.slug, slugs)));
  const bySlug = new Map(rows.map((r) => [r.slug.toLowerCase(), r]));
  return slugs.map((s) => bySlug.get(s.toLowerCase())).filter((r): r is NonNullable<typeof r> => !!r).map(toCard);
}

async function loadCollections(tx: Tx, props: Record<string, unknown>): Promise<BlockCollectionSummary[]> {
  if (props.source === "categories") return loadCategoryCards(tx, props);
  if (props.showAll === true) {
    // Collection Archive: every published collection, with how many listed products it holds (manual collections; automated ones show no count).
    const all = await tx.select().from(schema.collections).where(eq(schema.collections.published, true)).orderBy(asc(schema.collections.title)).limit(48);
    const counts = await tx
      .select({ collectionId: schema.collectionProducts.collectionId, n: sql<number>`count(*)::int` })
      .from(schema.collectionProducts)
      .innerJoin(
        schema.products,
        and(eq(schema.products.tenantId, schema.collectionProducts.tenantId), eq(schema.products.id, schema.collectionProducts.productId)),
      )
      .where(inArray(schema.products.status, [...LISTED_PRODUCT_STATUSES]))
      .groupBy(schema.collectionProducts.collectionId);
    const countById = new Map(counts.map((c) => [c.collectionId, c.n]));
    return all.map((r) => ({
      slug: r.slug,
      title: r.title,
      imageMediaId: r.imageMediaId ?? undefined,
      ...(r.description ? { description: r.description } : {}),
      ...(r.type === "manual" ? { productCount: countById.get(r.id) ?? 0 } : {}),
    }));
  }
  const slugs = Array.isArray(props.collectionSlugs) ? (props.collectionSlugs as unknown[]).filter((s): s is string => typeof s === "string").slice(0, 24) : [];
  if (slugs.length === 0) return [];
  const rows = await tx
    .select()
    .from(schema.collections)
    .where(and(eq(schema.collections.published, true), inArray(schema.collections.slug, slugs)));
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  return slugs
    .map((s) => bySlug.get(s))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => ({ slug: r.slug, title: r.title, imageMediaId: r.imageMediaId ?? undefined, ...(r.description ? { description: r.description } : {}) }));
}

function extractSlug(url: string, prefix: string): string {
  const clean = url.trim().toLowerCase().split("?")[0]?.replace(/\/+$/, "") ?? "";
  const match = clean.match(new RegExp(`^/?${prefix}/([^/]+)$`));
  return match?.[1] ?? "";
}

function extractBrandSlug(url: string): string {
  const clean = url.trim().toLowerCase();
  const match = clean.match(/[?&]brand=([^&]+)/);
  return match?.[1] ?? "";
}

async function loadMenusData(
  tx: Tx,
  tenantId: string,
  headerBlocks: BlockInstance[],
  footerBlocks: BlockInstance[],
): Promise<{
  headerData: Record<string, ResolvedMenuItem[]>;
  footerData: Record<string, Array<ResolvedMenuItem[] | null>>;
}> {
  const handles = new Set<string>();

  for (const b of headerBlocks) {
    const handle =
      typeof b.props.menuHandle === "string" && b.props.menuHandle.trim()
        ? b.props.menuHandle.trim()
        : "header";
    handles.add(handle);
  }

  for (const b of footerBlocks) {
    if (Array.isArray(b.props.columns)) {
      for (const col of b.props.columns as Array<Record<string, unknown>>) {
        if (col && typeof col.menuHandle === "string" && col.menuHandle.trim()) {
          handles.add(col.menuHandle.trim());
        }
      }
    }
  }

  if (handles.size === 0) {
    return { headerData: {}, footerData: {} };
  }

  const menuRows = await tx
    .select()
    .from(schema.menus)
    .where(and(eq(schema.menus.tenantId, tenantId), inArray(schema.menus.handle, [...handles])));

  const menusByHandle = new Map(menuRows.map((m) => [m.handle, m.items]));

  const pageTargetIds = new Set<string>();
  const pageSlugs = new Set<string>();
  const collectionTargetIds = new Set<string>();
  const collectionSlugs = new Set<string>();
  const productTargetIds = new Set<string>();
  const productSlugs = new Set<string>();
  const categoryTargetIds = new Set<string>();
  const categorySlugs = new Set<string>();
  const brandTargetIds = new Set<string>();
  const brandSlugs = new Set<string>();
  const blogCategoryTargetIds = new Set<string>();
  const blogPostTargetIds = new Set<string>();

  function collectFromItems(items: unknown) {
    if (!Array.isArray(items)) return;
    for (const it of items) {
      if (!it || typeof it !== "object") continue;
      const item = it as Record<string, unknown>;
      const type = typeof item.type === "string" ? item.type : "url";
      const targetId = typeof item.targetId === "string" && item.targetId ? item.targetId : undefined;
      const url = typeof item.url === "string" ? item.url : "";

      if (type === "page") {
        if (targetId) pageTargetIds.add(targetId);
        const s = extractSlug(url, "pages");
        if (s) pageSlugs.add(s);
      } else if (type === "collection") {
        if (targetId) collectionTargetIds.add(targetId);
        const s = extractSlug(url, "collections");
        if (s) collectionSlugs.add(s);
      } else if (type === "product") {
        if (targetId) productTargetIds.add(targetId);
        const s = extractSlug(url, "products");
        if (s) productSlugs.add(s);
      } else if (type === "category") {
        if (targetId) categoryTargetIds.add(targetId);
        const s = extractSlug(url, "categories");
        if (s) categorySlugs.add(s);
      } else if (type === "blog_category") {
        if (targetId) blogCategoryTargetIds.add(targetId);
      } else if (type === "blog_post") {
        if (targetId) blogPostTargetIds.add(targetId);
      } else if (type === "brand") {
        if (targetId) brandTargetIds.add(targetId);
        const s = extractBrandSlug(url);
        if (s) brandSlugs.add(s);
      }

      if (Array.isArray(item.children)) {
        collectFromItems(item.children);
      }
    }
  }

  for (const items of menusByHandle.values()) {
    collectFromItems(items);
  }

  const allTenantPages = await tx
    .select({
      id: schema.pages.id,
      parentId: schema.pages.parentId,
      slug: schema.pages.slug,
      title: schema.pages.title,
      type: schema.pages.type,
      status: schema.pages.status,
    })
    .from(schema.pages)
    .where(eq(schema.pages.tenantId, tenantId));

  const pagesById = new Map(allTenantPages.map((p) => [p.id, p]));
  const publishedPagesById = new Map(
    allTenantPages
      .filter((p) => p.status === "published" || p.type === "home")
      .map((p) => [p.id, p]),
  );
  const publishedPagesBySlug = new Map(
    allTenantPages
      .filter((p) => p.status === "published" || p.type === "home")
      .map((p) => [p.slug.toLowerCase(), p]),
  );

  const collections =
    collectionTargetIds.size > 0 || collectionSlugs.size > 0
      ? await tx
          .select({ id: schema.collections.id, slug: schema.collections.slug, published: schema.collections.published })
          .from(schema.collections)
          .where(
            and(
              eq(schema.collections.tenantId, tenantId),
              eq(schema.collections.published, true),
            ),
          )
      : [];
  const publishedColsById = new Map(collections.map((c) => [c.id, c]));
  const publishedColsBySlug = new Map(collections.map((c) => [c.slug.toLowerCase(), c]));

  const products =
    productTargetIds.size > 0 || productSlugs.size > 0
      ? await tx
          .select({ id: schema.products.id, slug: schema.products.slug })
          .from(schema.products)
          .where(and(eq(schema.products.tenantId, tenantId), liveProducts()))
      : [];
  const liveProductsById = new Map(products.map((p) => [p.id, p]));
  const liveProductsBySlug = new Map(products.map((p) => [p.slug.toLowerCase(), p]));

  const categories =
    categoryTargetIds.size > 0 || categorySlugs.size > 0
      ? await tx
          .select({ id: schema.categories.id, slug: schema.categories.slug })
          .from(schema.categories)
          .where(and(eq(schema.categories.tenantId, tenantId), eq(schema.categories.isActive, true)))
      : [];
  const activeCatsById = new Map(categories.map((c) => [c.id, c]));
  const activeCatsBySlug = new Map(categories.map((c) => [c.slug.toLowerCase(), c]));

  const brands =
    brandTargetIds.size > 0 || brandSlugs.size > 0
      ? await tx
          .select({ id: schema.brands.id, slug: schema.brands.slug })
          .from(schema.brands)
          .where(eq(schema.brands.tenantId, tenantId))
      : [];
  const activeBrandsById = new Map(brands.map((b) => [b.id, b]));
  const activeBrandsBySlug = new Map(brands.map((b) => [b.slug.toLowerCase(), b]));

  const blogTargets =
    blogCategoryTargetIds.size > 0 || blogPostTargetIds.size > 0
      ? await blogMenuTargetsTx(tx, tenantId, { categoryIds: blogCategoryTargetIds, postIds: blogPostTargetIds })
      : { categories: new Map<string, string>(), posts: new Map<string, string>() };

  const SAFE_SCHEME = /^(\/(?!\/)|#|https:\/\/|mailto:|tel:)/i;

  function resolveItem(it: unknown, depth = 1): ResolvedMenuItem | null {
    if (!it || typeof it !== "object") return null;
    const item = it as Record<string, unknown>;
    const label =
      typeof item.title === "string" && item.title.trim()
        ? item.title.trim()
        : typeof item.label === "string" && item.label.trim()
          ? item.label.trim()
          : "";
    if (!label) return null;

    const id = typeof item.id === "string" && item.id ? item.id : crypto.randomUUID();
    const type = typeof item.type === "string" ? item.type : "url";
    const targetId = typeof item.targetId === "string" && item.targetId ? item.targetId : undefined;
    const rawUrl = typeof item.url === "string" ? item.url.trim() : "";
    const openInNewTab = Boolean(item.openInNewTab || item.newTab);

    let resolvedUrl: string | null;

    switch (type) {
      case "page": {
        if (targetId) {
          const page = publishedPagesById.get(targetId);
          if (!page) return null; // dead target: skip
          resolvedUrl = computeCanonicalPath(page, pagesById);
        } else {
          const s = extractSlug(rawUrl, "pages") || rawUrl.replace(/^\/+/, "");
          const page = publishedPagesBySlug.get(s);
          if (!page) return null; // dead target: skip
          resolvedUrl = computeCanonicalPath(page, pagesById);
        }
        break;
      }
      case "collection": {
        let col = targetId ? publishedColsById.get(targetId) : undefined;
        if (!col) {
          const s = extractSlug(rawUrl, "collections") || rawUrl.replace(/^\/+/, "");
          col = publishedColsBySlug.get(s);
        }
        if (!col) return null; // dead target: skip
        resolvedUrl = `/collections/${col.slug}`;
        break;
      }
      case "product": {
        let prod = targetId ? liveProductsById.get(targetId) : undefined;
        if (!prod) {
          const s = extractSlug(rawUrl, "products") || rawUrl.replace(/^\/+/, "");
          prod = liveProductsBySlug.get(s);
        }
        if (!prod) return null; // dead target: skip
        resolvedUrl = `/products/${prod.slug}`;
        break;
      }
      case "category": {
        let cat = targetId ? activeCatsById.get(targetId) : undefined;
        if (!cat) {
          const s = extractSlug(rawUrl, "categories") || rawUrl.replace(/^\/+/, "");
          cat = activeCatsBySlug.get(s);
        }
        if (!cat) return null; // dead target: skip
        resolvedUrl = `/categories/${cat.slug}`;
        break;
      }
      case "brand": {
        let br = targetId ? activeBrandsById.get(targetId) : undefined;
        if (!br) {
          const s = extractBrandSlug(rawUrl) || rawUrl.replace(/^\/+/, "");
          br = activeBrandsBySlug.get(s);
        }
        if (!br) return null; // dead target: skip
        resolvedUrl = `/collections/all?brand=${br.slug}`;
        break;
      }
      case "home": {
        resolvedUrl = "/";
        break;
      }
      case "search": {
        resolvedUrl = "/search";
        break;
      }
      case "account": {
        resolvedUrl = "/account/login";
        break;
      }
      case "blog": {
        resolvedUrl = rawUrl || "/blog";
        break;
      }
      case "blog_category": {
        const path = targetId ? blogTargets.categories.get(targetId) : undefined;
        if (!path) return null; // hidden or deleted category: skip
        resolvedUrl = `/blog/category/${path}`;
        break;
      }
      case "blog_post": {
        const slug = targetId ? blogTargets.posts.get(targetId) : undefined;
        if (!slug) return null; // draft, scheduled or deleted post: skip
        resolvedUrl = `/blog/${slug}`;
        break;
      }
      case "policy": {
        resolvedUrl = rawUrl || "/policies";
        break;
      }
      case "url":
      default: {
        if (!rawUrl || !SAFE_SCHEME.test(rawUrl)) {
          return null; // unsafe or empty: skip
        }
        resolvedUrl = rawUrl;
        break;
      }
    }

    const resolvedChildren: ResolvedMenuItem[] = [];
    if (depth < 3 && Array.isArray(item.children)) {
      for (const ch of item.children) {
        const resChild = resolveItem(ch, depth + 1);
        if (resChild) resolvedChildren.push(resChild);
      }
    }

    const safeNewTab = openInNewTab && resolvedUrl.startsWith("https://");

    return {
      id,
      label,
      url: resolvedUrl,
      href: resolvedUrl,
      type,
      ...(safeNewTab ? { newTab: true, openInNewTab: true } : {}),
      ...(resolvedChildren.length > 0 ? { children: resolvedChildren } : {}),
    };
  }

  function resolveItemList(rawItems: unknown): ResolvedMenuItem[] {
    if (!Array.isArray(rawItems)) return [];
    const list: ResolvedMenuItem[] = [];
    for (const it of rawItems) {
      const res = resolveItem(it, 1);
      if (res) list.push(res);
    }
    return list;
  }

  const headerData: Record<string, ResolvedMenuItem[]> = {};
  for (const b of headerBlocks) {
    const handle =
      typeof b.props.menuHandle === "string" && b.props.menuHandle.trim()
        ? b.props.menuHandle.trim()
        : "header";
    const rawItems = menusByHandle.get(handle);
    if (rawItems) {
      headerData[b.id] = resolveItemList(rawItems);
    }
  }

  const footerData: Record<string, Array<ResolvedMenuItem[] | null>> = {};
  for (const b of footerBlocks) {
    if (Array.isArray(b.props.columns)) {
      const cols: Array<ResolvedMenuItem[] | null> = [];
      for (const col of b.props.columns as Array<Record<string, unknown>>) {
        if (col && typeof col.menuHandle === "string" && col.menuHandle.trim()) {
          const rawItems = menusByHandle.get(col.menuHandle.trim());
          cols.push(rawItems ? resolveItemList(rawItems) : null);
        } else {
          cols.push(null);
        }
      }
      footerData[b.id] = cols;
    }
  }

  return { headerData, footerData };
}

/**
 * Resolves the store data that data-driven blocks (product grids/carousels, collection
 * grids, headers, footers) need, keyed by block id. One tenant transaction per page; public data only (same
 * visibility rules as the storefront catalog), so it is safe for both the storefront render
 * and the editor preview. Blocks that cannot resolve get no entry and render an empty state.
 */
/** A blog summary in the shape the blocks draw (ready-to-use image URL, category link path). */
export function toBlockBlogPost(p: BlogPostSummary): BlockBlogPost {
  return {
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt,
    publishedAt: p.publishedAt,
    authorName: p.authorName,
    readingMinutes: p.readingMinutes,
    ...(p.image ? { imageUrl: p.image.url, imageAlt: p.image.alt, imageWidth: p.image.width, imageHeight: p.image.height } : {}),
    ...(p.category ? { categoryName: p.category.name, categoryPath: p.category.path } : {}),
  };
}

/**
 * Published product reviews for the Floating reviews widget (the same `reviews` rows the product pages show), with
 * the product's name and link. Only reviews of products customers can see; on-hold reviews never appear.
 */
export async function recentReviewsTx(
  tx: Tx,
  tenantId: string,
  opts: { limit: number; minRating: number; source: "latest" | "top" },
): Promise<BlockReview[]> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit) || 12, 1), 24);
  const minRating = Math.min(Math.max(Math.trunc(opts.minRating) || 1, 1), 5);
  const rows = await tx
    .select({
      id: schema.reviews.id,
      rating: schema.reviews.rating,
      title: schema.reviews.title,
      body: schema.reviews.body,
      reviewerName: schema.reviews.reviewerName,
      orderItemId: schema.reviews.orderItemId,
      createdAt: schema.reviews.createdAt,
      productTitle: schema.products.title,
      productSlug: schema.products.slug,
    })
    .from(schema.reviews)
    .innerJoin(schema.products, and(eq(schema.products.tenantId, schema.reviews.tenantId), eq(schema.products.id, schema.reviews.productId)))
    .where(
      and(
        eq(schema.reviews.tenantId, tenantId),
        eq(schema.reviews.status, "published"),
        sql`${schema.reviews.rating} >= ${minRating}`,
        liveProducts(),
      ),
    )
    .orderBy(...(opts.source === "top" ? [desc(schema.reviews.rating), desc(schema.reviews.createdAt)] : [desc(schema.reviews.createdAt)]))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    ...(r.title ? { title: r.title } : null),
    body: r.body,
    reviewerName: r.reviewerName,
    verified: Boolean(r.orderItemId),
    productTitle: r.productTitle,
    productSlug: r.productSlug,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function resolveBlockData(
  rt: Runtime,
  ctx: TenantContext,
  blocks: BlockInstance[],
): Promise<Record<string, BlockData>> {
  const productBlocks: BlockInstance[] = [];
  const collectionBlocks: BlockInstance[] = [];
  const showcaseBlocks: BlockInstance[] = [];
  const headerBlocks: BlockInstance[] = [];
  const footerBlocks: BlockInstance[] = [];
  const fileBlocks: BlockInstance[] = [];
  const blogBlocks: BlockInstance[] = [];
  const reviewBlocks: BlockInstance[] = [];

  walkBlocks(blocks, (b) => {
    if (b.hidden) return;
    if (b.type === "ProductShowcase") showcaseBlocks.push(b);
    else if (b.type === "ProductGrid" || b.type === "ProductCarousel") productBlocks.push(b);
    else if (b.type === "CollectionGrid" || b.type === "CollectionShowcase") collectionBlocks.push(b);
    else if (b.type === "SiteHeader") headerBlocks.push(b);
    else if (b.type === "SiteFooter") footerBlocks.push(b);
    else if (b.type === "FileDownload") fileBlocks.push(b);
    else if (b.type === "BlogPosts" || b.type === "BlogShowcase") blogBlocks.push(b);
    else if (b.type === "ReviewsMarquee") reviewBlocks.push(b);
  });

  if (
    productBlocks.length === 0 &&
    collectionBlocks.length === 0 &&
    showcaseBlocks.length === 0 &&
    headerBlocks.length === 0 &&
    footerBlocks.length === 0 &&
    fileBlocks.length === 0 &&
    blogBlocks.length === 0 &&
    reviewBlocks.length === 0
  ) {
    return {};
  }

  const db = rt._db.db;
  const catalogEnabled = await isFeatureEnabled(db, ctx.tenantId, "catalog");

  return withMarketScope(db, ctx, async (tx) => {
    const out: Record<string, BlockData> = {};

    if (catalogEnabled) {
      for (const b of productBlocks) {
        const rows = await loadProducts(tx, b.props);
        const summaries = await buildProductSummaries(
          tx,
          rows.map((r) => r.id),
          rows,
        );
        out[b.id] = { kind: "products", products: summaries.map(toBlockProduct) };
      }

      for (const b of showcaseBlocks) {
        out[b.id] = await resolveShowcase(tx, b);
      }

      // Floating reviews widgets: reviews belong to catalog products, so they follow the catalog feature.
      for (const b of reviewBlocks) {
        out[b.id] = {
          kind: "reviews",
          reviews: await recentReviewsTx(tx, ctx.tenantId, {
            limit: Number(b.props["limit"]) || 12,
            minRating: Number(b.props["minRating"]) || 4,
            source: b.props["source"] === "latest" ? "latest" : "top",
          }),
        };
      }

      for (const b of collectionBlocks) {
        out[b.id] = { kind: "collections", collections: await loadCollections(tx, b.props) };
      }
    }

    // Recent Posts widgets (ADR-033): one bounded query per block, inside this transaction.
    for (const b of blogBlocks) {
      const source = b.props["source"];
      const res = await recentBlogPostsTx(tx, ctx.tenantId, {
        limit: Number(b.props["count"]) || 3,
        categorySlug: source === "category" && typeof b.props["categorySlug"] === "string" ? b.props["categorySlug"] : undefined,
        featuredOnly: source === "featured",
      });
      out[b.id] = {
        kind: "blog-posts",
        posts: res.enabled ? res.posts.map(toBlockBlogPost) : [],
        viewAllHref: res.categoryPath ? `/blog/category/${res.categoryPath}` : "/blog",
      };
    }

    if (headerBlocks.length > 0 || footerBlocks.length > 0) {
      const { headerData, footerData } = await loadMenusData(
        tx,
        ctx.tenantId,
        headerBlocks,
        footerBlocks,
      );

      for (const b of headerBlocks) {
        const items = headerData[b.id];
        if (items) {
          out[b.id] = { kind: "menu", items };
        }
      }

      for (const b of footerBlocks) {
        const cols = footerData[b.id];
        if (cols) {
          out[b.id] = { kind: "footer-menus", columns: cols };
        }
      }
    }

    if (fileBlocks.length > 0) {
      const fileMediaIds = fileBlocks
        .map((b) => b.props.mediaId)
        .filter((id): id is string => typeof id === "string" && Boolean(id));
      if (fileMediaIds.length > 0) {
        const rows = await tx
          .select({
            id: schema.media.id,
            filename: schema.media.filename,
            mime: schema.media.mime,
            bytes: schema.media.bytes,
            storageKey: schema.media.storageKey,
          })
          .from(schema.media)
          .where(inArray(schema.media.id, fileMediaIds));
        const byId = new Map(rows.map((r) => [r.id, r]));
        for (const b of fileBlocks) {
          const mediaId = typeof b.props.mediaId === "string" ? b.props.mediaId : "";
          const row = byId.get(mediaId);
          if (row) {
            out[b.id] = {
              kind: "file",
              filename: row.filename ?? "download",
              mime: row.mime,
              bytes: row.bytes,
              url: publicMediaUrl(row.storageKey) ?? undefined,
            };
          }
        }
      }
    }

    return out;
  });
}

/** Media ids referenced by blocks (props) and by resolved data (product/collection images). */
function collectMediaIds(blocks: BlockInstance[], data: Record<string, BlockData>): string[] {
  const docCollected = collectDocumentMediaIds({ version: 1, blocks });
  const ids = new Set<string>(docCollected.all);
  for (const d of Object.values(data)) {
    if (d.kind === "products") {
      for (const p of d.products) {
        if (p.imageMediaId) ids.add(p.imageMediaId);
      }
    } else if (d.kind === "product-tabs") {
      for (const tab of d.tabs) {
        for (const p of tab.products) {
          if (p.imageMediaId) ids.add(p.imageMediaId);
        }
      }
    } else if (d.kind === "collections") {
      for (const c of d.collections) {
        if (c.imageMediaId) ids.add(c.imageMediaId);
      }
    }
  }
  return [...ids].slice(0, 500);
}

export interface BlockMediaMeta {
  url?: string | undefined;
  width?: number | null | undefined;
  height?: number | null | undefined;
  focalX?: number | null | undefined;
  focalY?: number | null | undefined;
  dominantColor?: string | null | undefined;
  derivatives?: Record<string, { key: string; width: number; height: number; bytes: number }> | null | undefined;
}

export interface PageRenderData {
  data: Record<string, BlockData>;
  media: Record<string, string>;
  mediaMeta?: Record<string, BlockMediaMeta> | undefined;
}

/**
 * Turns media ids into public delivery URLs and responsive metadata. Cloudflare Images when configured
 * (CF_IMAGES_DELIVERY_URL=https://imagedelivery.net/<account-hash>), otherwise the R2 public
 * URL. Ids that cannot be resolved are omitted and the block renders its placeholder.
 */
async function resolveMedia(
  tx: Tx,
  ids: string[],
): Promise<{ media: Record<string, string>; mediaMeta: Record<string, BlockMediaMeta> }> {
  if (ids.length === 0) return { media: {}, mediaMeta: {} };
  const cfBase = process.env.CF_IMAGES_DELIVERY_URL;
  if (!cfBase && !publicMediaUrl("probe")) return { media: {}, mediaMeta: {} };
  const rows = await tx
    .select({
      id: schema.media.id,
      cfImageId: schema.media.cfImageId,
      storageKey: schema.media.storageKey,
      width: schema.media.width,
      height: schema.media.height,
      focalX: schema.media.focalX,
      focalY: schema.media.focalY,
      dominantColor: schema.media.dominantColor,
      derivatives: schema.media.derivatives,
    })
    .from(schema.media)
    .where(inArray(schema.media.id, ids));
  const media: Record<string, string> = {};
  const mediaMeta: Record<string, BlockMediaMeta> = {};
  for (const r of rows) {
    const url: string | undefined =
      cfBase && r.cfImageId
        ? buildCloudflareImageUrl(cfBase, r.cfImageId, "public")
        : (publicMediaUrl(r.storageKey) ?? undefined);
    if (url) {
      media[r.id] = url;
    }
    mediaMeta[r.id] = {
      url,
      width: r.width,
      height: r.height,
      focalX: r.focalX,
      focalY: r.focalY,
      dominantColor: r.dominantColor,
      derivatives: r.derivatives as Record<string, { key: string; width: number; height: number; bytes: number }> | null,
    };
  }
  return { media, mediaMeta };
}

/** Everything a page's blocks need to render: store data plus resolved media URLs. */
export async function resolvePageRenderData(
  rt: Runtime,
  ctx: TenantContext,
  blocks: BlockInstance[],
): Promise<PageRenderData> {
  const data = await resolveBlockData(rt, ctx, blocks);
  const ids = collectMediaIds(blocks, data);
  const { media, mediaMeta } = ids.length
    ? await withTenant(rt._db.db, ctx.tenantId, (tx) => resolveMedia(tx, ids))
    : { media: {}, mediaMeta: {} };
  return { data, media, mediaMeta };
}

/**
 * Editor preview: validates the (possibly unsaved) blocks the way a save would, then resolves
 * render data for them. Validation first means a malicious payload cannot pick arbitrary queries.
 */
export async function previewPageRenderData(
  rt: Runtime,
  ctx: TenantContext,
  input: { blocks: unknown[] },
): Promise<PageRenderData> {
  assertPermission(ctx, "content.write");
  const result = validateBlockDocument({ version: 1, blocks: input.blocks });
  if (!result.success) {
    // Unsaved edits can be mid-way invalid; the editor shows empty states rather than failing.
    return { data: {}, media: {}, mediaMeta: {} };
  }
  return resolvePageRenderData(rt, ctx, result.data.blocks);
}
