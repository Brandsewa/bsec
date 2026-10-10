import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import {
  validateBlockDocument,
  walkBlocks,
  type BlockCollectionSummary,
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

async function loadCollections(tx: Tx, props: Record<string, unknown>): Promise<BlockCollectionSummary[]> {
  const slugs = Array.isArray(props.collectionSlugs) ? (props.collectionSlugs as unknown[]).filter((s): s is string => typeof s === "string").slice(0, 12) : [];
  if (slugs.length === 0) return [];
  const rows = await tx
    .select()
    .from(schema.collections)
    .where(and(eq(schema.collections.published, true), inArray(schema.collections.slug, slugs)));
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  return slugs
    .map((s) => bySlug.get(s))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => ({ slug: r.slug, title: r.title, imageMediaId: r.imageMediaId ?? undefined }));
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

  walkBlocks(blocks, (b) => {
    if (b.hidden) return;
    if (b.type === "ProductShowcase") showcaseBlocks.push(b);
    else if (b.type === "ProductGrid" || b.type === "ProductCarousel") productBlocks.push(b);
    else if (b.type === "CollectionGrid") collectionBlocks.push(b);
    else if (b.type === "SiteHeader") headerBlocks.push(b);
    else if (b.type === "SiteFooter") footerBlocks.push(b);
  });

  if (
    productBlocks.length === 0 &&
    collectionBlocks.length === 0 &&
    showcaseBlocks.length === 0 &&
    headerBlocks.length === 0 &&
    footerBlocks.length === 0
  ) {
    return {};
  }

  const db = rt._db.db;
  const catalogEnabled = await isFeatureEnabled(db, ctx.tenantId, "catalog");

  return withTenant(db, ctx.tenantId, async (tx) => {
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
        const tabs = Array.isArray(b.props["tabs"]) ? (b.props["tabs"] as Array<Record<string, unknown>>).slice(0, 6) : [];
        const limit = Number(b.props["limit"]) || 10;
        const resolved: Array<{ products: BlockProduct[] }> = [];
        for (const tab of tabs.length > 0 ? tabs : [{ source: "newest" }]) {
          const rows = await loadProducts(tx, { source: tab["source"], collectionSlug: tab["collectionSlug"], limit });
          const summaries = await buildProductSummaries(tx, rows.map((r) => r.id), rows);
          resolved.push({ products: await enrichShowcaseProducts(tx, summaries.map(toBlockProduct)) });
        }
        out[b.id] = { kind: "product-tabs", tabs: resolved };
      }

      for (const b of collectionBlocks) {
        out[b.id] = { kind: "collections", collections: await loadCollections(tx, b.props) };
      }
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

    return out;
  });
}

/** Media ids referenced by blocks (props) and by resolved data (product/collection images). */
function collectMediaIds(blocks: BlockInstance[], data: Record<string, BlockData>): string[] {
  const ids = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string" && v) ids.add(v);
  };
  walkBlocks(blocks, (b) => {
    if (b.hidden) return;
    add(b.props.backgroundMediaId);
    add(b.props.mediaId);
    for (const key of ["items", "images", "slides"] as const) {
      const list = b.props[key];
      if (Array.isArray(list)) {
        for (const it of list) {
          if (it && typeof it === "object") {
            add((it as Record<string, unknown>).avatarMediaId);
            add((it as Record<string, unknown>).mediaId);
            add((it as Record<string, unknown>).backgroundMediaId);
          }
        }
      }
    }
  });
  for (const d of Object.values(data)) {
    if (d.kind === "products") for (const p of d.products) add(p.imageMediaId);
    else if (d.kind === "product-tabs") for (const tab of d.tabs) for (const p of tab.products) add(p.imageMediaId);
    else if (d.kind === "collections") for (const c of d.collections) add(c.imageMediaId);
  }
  return [...ids].slice(0, 500);
}

/**
 * Turns media ids into public delivery URLs. Cloudflare Images when configured
 * (CF_IMAGES_DELIVERY_URL=https://imagedelivery.net/<account-hash>), otherwise the R2 public
 * URL. Ids that cannot be resolved are omitted and the block renders its placeholder.
 */
async function resolveMediaUrls(tx: Tx, ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const cfBase = process.env.CF_IMAGES_DELIVERY_URL;
  if (!cfBase && !publicMediaUrl("probe")) return {};
  const rows = await tx
    .select({ id: schema.media.id, cfImageId: schema.media.cfImageId, storageKey: schema.media.storageKey })
    .from(schema.media)
    .where(inArray(schema.media.id, ids));
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (cfBase && r.cfImageId) out[r.id] = buildCloudflareImageUrl(cfBase, r.cfImageId, "public");
    else {
      const url = publicMediaUrl(r.storageKey);
      if (url) out[r.id] = url;
    }
  }
  return out;
}

export interface PageRenderData {
  data: Record<string, BlockData>;
  media: Record<string, string>;
}

/** Everything a page's blocks need to render: store data plus resolved media URLs. */
export async function resolvePageRenderData(
  rt: Runtime,
  ctx: TenantContext,
  blocks: BlockInstance[],
): Promise<PageRenderData> {
  const data = await resolveBlockData(rt, ctx, blocks);
  const ids = collectMediaIds(blocks, data);
  const media = ids.length
    ? await withTenant(rt._db.db, ctx.tenantId, (tx) => resolveMediaUrls(tx, ids))
    : {};
  return { data, media };
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
    return { data: {}, media: {} };
  }
  return resolvePageRenderData(rt, ctx, result.data.blocks);
}
