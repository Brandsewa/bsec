import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import {
  validateBlockDocument,
  walkBlocks,
  type BlockCollectionSummary,
  type BlockData,
  type BlockInstance,
  type BlockProduct,
} from "@bs/blocks";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { isFeatureEnabled } from "../features.ts";
import { buildCloudflareImageUrl, publicMediaUrl } from "../media/storage.ts";
import { buildProductSummaries, type StorefrontProductSummary } from "../storefront/catalog.ts";
import { STOREFRONT_PRODUCT_STATUSES } from "../storefront/product-status.ts";

type Tx = Parameters<Parameters<typeof withTenant>[2]>[0];
type ProductRow = typeof schema.products.$inferSelect;

const DEFAULT_LIMIT = 8;

const toBlockProduct = (s: StorefrontProductSummary): BlockProduct => ({
  id: s.id,
  title: s.title,
  slug: s.slug,
  priceMin: s.priceMin,
  compareAtPriceMin: s.compareAtPriceMin,
  ratingAvg: s.ratingAvg,
  ratingCount: s.ratingCount,
  imageMediaId: s.primaryImage?.mediaId,
  imageUrl: s.primaryImage?.url,
  imageAlt: s.primaryImage?.alt,
});

const liveProducts = () =>
  and(inArray(schema.products.status, [...STOREFRONT_PRODUCT_STATUSES]), isNull(schema.products.deletedAt));

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

/**
 * Resolves the store data that data-driven blocks (product grids/carousels, collection
 * grids) need, keyed by block id. One tenant transaction per page; public data only (same
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
  walkBlocks(blocks, (b) => {
    if (b.hidden) return;
    if (b.type === "ProductGrid" || b.type === "ProductCarousel") productBlocks.push(b);
    else if (b.type === "CollectionGrid") collectionBlocks.push(b);
  });
  if (productBlocks.length === 0 && collectionBlocks.length === 0) return {};

  const db = rt._db.db;
  if (!(await isFeatureEnabled(db, ctx.tenantId, "catalog"))) return {};

  return withTenant(db, ctx.tenantId, async (tx) => {
    const out: Record<string, BlockData> = {};

    for (const b of productBlocks) {
      const rows = await loadProducts(tx, b.props);
      const summaries = await buildProductSummaries(
        tx,
        rows.map((r) => r.id),
        rows,
      );
      out[b.id] = { kind: "products", products: summaries.map(toBlockProduct) };
    }

    for (const b of collectionBlocks) {
      out[b.id] = { kind: "collections", collections: await loadCollections(tx, b.props) };
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
    for (const key of ["items", "images"] as const) {
      const list = b.props[key];
      if (Array.isArray(list)) {
        for (const it of list) {
          if (it && typeof it === "object") {
            add((it as Record<string, unknown>).avatarMediaId);
            add((it as Record<string, unknown>).mediaId);
          }
        }
      }
    }
  });
  for (const d of Object.values(data)) {
    if (d.kind === "products") for (const p of d.products) add(p.imageMediaId);
    else for (const c of d.collections) add(c.imageMediaId);
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
