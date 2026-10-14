import crypto from "node:crypto";
import path from "node:path";
import { and, asc, desc, eq, ilike, inArray, lt, ne, or, sql } from "drizzle-orm";
import { type Db, schema, withTenant } from "@bs/db";
import type { MediaItem, MediaUsageReference, MediaUsageReport } from "@bs/contracts";
import type { Runtime } from "./runtime.ts";
import { assertPermission, type TenantContext } from "./context.ts";
import { invalidateCache, invalidateMediaCache } from "./cache-invalidation.ts";
import {
  assertMediaReplaceQuota,
  assertMediaUploadQuota,
  getTenantMediaUsageStats,
} from "./system/quotas.ts";
import {
  getMediaKind,
  isAllowedMime,
  type MediaKind,
  PRIVATE_MEDIA_FOLDERS,
  verifyMediaMagicBytes,
} from "./media/types.ts";
import {
  buildCloudflareImageTransformUrl,
  generateStorageKey,
  publicMediaUrl,
} from "./media/storage.ts";
import {
  getActiveStorageDriver,
  resolveDriverForMediaRow,
  resolvePublicMediaUrl,
} from "./media/connection.ts";

export {
  resolveDriverForMediaRow,
  resolveLocalMediaFilePath,
  getEnvironmentStorageConfig,
  resolveSafeLocalPath,
} from "./media/connection.ts";

export interface ListMediaQuery {
  cursor?: string | undefined;
  limit?: number | undefined;
  q?: string | undefined;
  kinds?: MediaKind[] | undefined;
  usage?: "any" | "used" | "unused" | undefined;
  trash?: boolean | undefined;
  sort?: "newest" | "oldest" | "name" | "largest" | undefined;
  // Compatibility fields
  folder?: string | undefined;
  offset?: number | undefined;
}

export interface RequestUploadInput {
  filename: string;
  mime: string;
  bytes: number;
  folder?: string | undefined;
}

export interface CreateMediaInput {
  storageKey: string;
  mime: string;
  bytes: number;
  filename?: string | undefined;
  title?: string | undefined;
  caption?: string | undefined;
  alt?: string | undefined;
  folder?: string | undefined;
  durationMs?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  cfImageId?: string | undefined;
}

export interface UpdateMediaInput {
  id: string;
  title?: string | undefined;
  alt?: string | undefined;
  caption?: string | undefined;
}

export interface FinalizeUploadParams {
  storageKey: string;
  declaredMime: string;
  declaredBytes?: number | undefined;
  filename?: string | undefined;
  title?: string | undefined;
  alt?: string | undefined;
  caption?: string | undefined;
  folder?: string | undefined;
  durationMs?: number | undefined;
  cfImageId?: string | undefined;
  directBuffer?: Buffer | Uint8Array | undefined;
}

export const libraryScope = sql`(${schema.media.folder} IS NULL OR ${schema.media.folder} NOT IN ('returns', 'expense-receipts'))`;

export function escapeLikePattern(pattern: string): string {
  return pattern.replace(/[\\%_]/g, "\\$&");
}

export function validateClientStorageKey(
  tenantId: string,
  storageKey: string,
): { folder: string; filename: string } {
  if (typeof storageKey !== "string" || !storageKey) {
    throw new Error("Bad Request: Invalid storage key");
  }
  if (storageKey.startsWith("/") || storageKey.includes("..") || storageKey.includes("\\")) {
    throw new Error("Bad Request: Invalid storage key format");
  }
  const parts = storageKey.split("/");
  if (parts.length !== 3) {
    throw new Error("Bad Request: Storage key must have format {tenantId}/{folder}/{filename}");
  }
  const [keyTenantId, folder, filename] = parts;
  if (keyTenantId !== tenantId) {
    throw new Error("Bad Request: Storage key belongs to a different tenant");
  }
  if (!folder || !filename) {
    throw new Error("Bad Request: Invalid storage key components");
  }
  if ((PRIVATE_MEDIA_FOLDERS as readonly string[]).includes(folder)) {
    throw new Error(`Bad Request: Storage key folder "${folder}" is restricted`);
  }
  const validPattern = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/;
  if (!validPattern.test(storageKey)) {
    throw new Error("Bad Request: Invalid characters in storage key");
  }
  return { folder, filename };
}

function encodeCursor(sortKey: string | number, id: string): string {
  return Buffer.from(JSON.stringify({ s: sortKey, id })).toString("base64url");
}

function decodeCursor(cursor?: string): { s: string | number; id: string } | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === "string" && parsed.s !== undefined) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Grid thumbnail for an image. Uses Cloudflare Image Transformations only when `CDN_BASE_URL` is set
 * explicitly (that zone must have Image Transformations enabled); otherwise the original public URL is used.
 * The storage connection's public base URL is NOT a resizer: `/cdn-cgi/image/` on it 404s on local storage and
 * on any zone without transformations, which blanks every tile.
 */
export function buildThumbnailUrl(r: { kind: string; storageKey: string }, url: string): string | null {
  if (r.kind !== "image") return null;
  const cdnBase = process.env.CDN_BASE_URL?.trim();
  if (cdnBase) {
    return buildCloudflareImageTransformUrl(cdnBase, r.storageKey, {
      width: 320,
      format: "auto",
      fit: "cover",
    });
  }
  return url;
}

/**
 * Shared internal upload finalization helper (MEDIA-LIBRARY-PLAN §7, §4, §6).
 * Used by createMediaRecord (after presigned upload) and uploadMediaDirect (proxy upload).
 */
async function finalizeUpload(
  rt: Runtime,
  ctx: TenantContext,
  params: FinalizeUploadParams,
): Promise<MediaItem> {
  const declaredMime = params.declaredMime.toLowerCase().trim();
  if (declaredMime === "image/svg+xml") {
    throw new Error("SVG uploads are disabled for security reasons");
  }
  if (!isAllowedMime(declaredMime)) {
    throw new Error(`Unsupported media format: "${declaredMime}"`);
  }

  const { driver, config: activeConfig } = await getActiveStorageDriver(rt._db.db, "public_media");

  let realBytes: number;
  let magicBuffer: Uint8Array;

  if (params.directBuffer) {
    const directBuf = Buffer.isBuffer(params.directBuffer)
      ? params.directBuffer
      : Buffer.from(params.directBuffer);
    realBytes = directBuf.length;
    magicBuffer = directBuf.subarray(0, 4096);
  } else {
    // 1. HeadObject gives the real size (fixes Q2, B3)
    const head = await driver.head(params.storageKey);
    if (!head.exists) {
      throw new Error(`Uploaded file not found in storage: "${params.storageKey}"`);
    }
    realBytes = head.size ?? 0;
    if (realBytes <= 0) {
      throw new Error("Uploaded file is empty");
    }

    // 2. Quota check with real size BEFORE fetching object content (fixes B3, Q1, Q2, Q3)
    const previewKind = getMediaKind(declaredMime) || "image";
    try {
      await assertMediaUploadQuota(rt._db.db, ctx.tenantId, {
        kind: previewKind,
        bytes: realBytes,
      });
    } catch (quotaErr) {
      // Purge the oversize file from storage immediately without downloading it
      await purgeMediaObjects(rt._db.db, {
        tenantId: ctx.tenantId,
        objects: [{ storageKey: params.storageKey, storageConnectionId: activeConfig.id }],
      }).catch(() => {});
      throw quotaErr;
    }

    // 3. Read only first 4 KB for magic bytes inspection (fixes B3)
    const chunk = driver.getRange
      ? await driver.getRange(params.storageKey, 0, 4095)
      : await driver.get(params.storageKey);
    if (!chunk || chunk.length === 0) {
      throw new Error(`Failed to read uploaded file from storage: "${params.storageKey}"`);
    }
    magicBuffer = chunk;
  }

  // 4. Magic bytes verification (MEDIA-LIBRARY-PLAN §4)
  const magicResult = verifyMediaMagicBytes(declaredMime, magicBuffer, params.filename);
  if (!magicResult.valid) {
    // Purge the invalid file from storage immediately
    await purgeMediaObjects(rt._db.db, {
      tenantId: ctx.tenantId,
      objects: [{ storageKey: params.storageKey, storageConnectionId: activeConfig.id }],
    }).catch(() => {});
    throw new Error(magicResult.error || "File verification failed: magic bytes mismatch");
  }

  const kind = magicResult.kind || getMediaKind(declaredMime) || "image";

  // Re-verify quota if directBuffer (which skipped the pre-get quota check)
  if (params.directBuffer) {
    try {
      await assertMediaUploadQuota(rt._db.db, ctx.tenantId, {
        kind,
        bytes: realBytes,
      });
    } catch (quotaErr) {
      await purgeMediaObjects(rt._db.db, {
        tenantId: ctx.tenantId,
        objects: [{ storageKey: params.storageKey, storageConnectionId: activeConfig.id }],
      }).catch(() => {});
      throw quotaErr;
    }
  }

  // 5. Download full object ONLY for images to inspect dimensions with sharp
  let width: number | null = null;
  let height: number | null = null;
  // Hash only the complete content; a partial hash would make unrelated files look like duplicates.
  let sha256: string | null = null;

  if (kind === "image") {
    let fullImageBuffer: Buffer;
    if (params.directBuffer) {
      fullImageBuffer = Buffer.isBuffer(params.directBuffer)
        ? params.directBuffer
        : Buffer.from(params.directBuffer);
    } else {
      const fetched = await driver.get(params.storageKey);
      if (!fetched || fetched.length === 0) {
        throw new Error(`Failed to download image file from storage: "${params.storageKey}"`);
      }
      fullImageBuffer = fetched;
    }

    try {
      const sharpModule = await import("sharp");
      const sharp = sharpModule.default;
      const meta = await sharp(fullImageBuffer).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
    } catch (err) {
      await purgeMediaObjects(rt._db.db, {
        tenantId: ctx.tenantId,
        objects: [{ storageKey: params.storageKey, storageConnectionId: activeConfig.id }],
      }).catch(() => {});
      throw new Error("Failed to process image metadata: corrupted or invalid image file", {
        cause: err,
      });
    }

    sha256 = crypto.createHash("sha256").update(fullImageBuffer).digest("hex");
  } else {
    // For videos and documents, do not download the entire file; hash only when the full bytes are in hand.
    if (params.directBuffer) {
      sha256 = crypto.createHash("sha256").update(params.directBuffer).digest("hex");
    }
  }

  const filename = params.filename?.trim() || path.basename(params.storageKey);

  // 7. Insert row inside tenant transaction + audit log
  const row = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [inserted] = await tx
      .insert(schema.media)
      .values({
        tenantId: ctx.tenantId,
        storageKey: params.storageKey,
        storageConnectionId: activeConfig.id ?? null,
        kind,
        mime: declaredMime,
        filename,
        title: params.title?.trim() || null,
        alt: params.alt?.trim().slice(0, 512) || null,
        caption: params.caption?.trim().slice(0, 1000) || null,
        bytes: realBytes,
        width,
        height,
        durationMs: params.durationMs ?? null,
        sha256,
        status: "ready",
        folder: params.folder || "products",
        uploadedBy: ctx.actor.type === "staff" ? ctx.actor.userId : null,
        cfImageId: params.cfImageId ?? null,
      })
      .returning();

    if (!inserted) throw new Error("Failed to save media record");

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "media.upload",
      targetType: "media",
      targetId: inserted.id,
      diff: {
        filename,
        bytes: realBytes,
        kind,
        mime: declaredMime,
        width,
        height,
      },
    });

    return inserted;
  });

  await invalidateCache(rt, ctx, { type: "media_updated" });

  const url = (await resolvePublicMediaUrl(rt._db.db, row.storageKey, row.storageConnectionId)) || "";
  const thumbnailUrl = buildThumbnailUrl(row, url);

  return {
    id: row.id,
    kind: row.kind as MediaKind,
    mime: row.mime,
    filename: row.filename,
    title: row.title,
    alt: row.alt,
    caption: row.caption,
    bytes: Number(row.bytes),
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    url,
    thumbnailUrl,
    status: row.status as "ready" | "trashed",
    trashedAt: row.trashedAt ? row.trashedAt.toISOString() : null,
    usageCount: 0,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    storageKey: row.storageKey,
    storageConnectionId: row.storageConnectionId,
    cfImageId: row.cfImageId,
    folder: row.folder,
  };
}

/**
 * List media assets within current tenant with search, filtering, stable cursor paging,
 * accurate total count, and usage count (MEDIA-LIBRARY-PLAN §7, fixes L1).
 */
export async function listMedia(
  rt: Runtime,
  ctx: TenantContext,
  query?: ListMediaQuery,
): Promise<{ items: MediaItem[]; nextCursor: string | null; total: number }> {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;
  const isTrash = query?.trash === true;
  const limit = Math.min(Math.max(query?.limit ?? 40, 1), 100);
  const sort = query?.sort ?? "newest";

  return withTenant(db, ctx.tenantId, async (tx) => {
    const conditions = [
      eq(schema.media.tenantId, ctx.tenantId),
      isTrash ? eq(schema.media.status, "trashed") : ne(schema.media.status, "trashed"),
      libraryScope,
    ];

    if (query?.folder) {
      conditions.push(eq(schema.media.folder, query.folder));
    }

    if (query?.kinds && query.kinds.length > 0) {
      conditions.push(inArray(schema.media.kind, query.kinds));
    }

    if (query?.q && query.q.trim()) {
      const q = query.q.trim();
      const escaped = escapeLikePattern(q);
      const searchCond = or(
        sql`${schema.media.search} @@ websearch_to_tsquery('simple', ${q})`,
        ilike(schema.media.filename, `%${escaped}%`),
      );
      if (searchCond) {
        conditions.push(searchCond);
      }
    }

    if (query?.usage === "used") {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM media_usages mu WHERE mu.tenant_id = ${schema.media.tenantId} AND mu.media_id = ${schema.media.id})`,
      );
    } else if (query?.usage === "unused") {
      conditions.push(
        sql`NOT EXISTS (SELECT 1 FROM media_usages mu WHERE mu.tenant_id = ${schema.media.tenantId} AND mu.media_id = ${schema.media.id})`,
      );
    }

    // 1. Compute exact total matching the filters (fixes L1)
    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.media)
      .where(and(...conditions));
    const total = totalRow?.count ?? 0;

    // 2. Cursor pagination condition
    const cursorObj = decodeCursor(query?.cursor);
    const cursorConditions = [...conditions];

    if (cursorObj) {
      const { s, id } = cursorObj;
      if (sort === "oldest") {
        const sDate = new Date(s);
        cursorConditions.push(
          sql`(${schema.media.createdAt} > ${sDate} OR (${schema.media.createdAt} = ${sDate} AND ${schema.media.id} > ${id}))`,
        );
      } else if (sort === "name") {
        const sName = String(s).toLowerCase();
        cursorConditions.push(
          sql`(lower(${schema.media.filename}) > ${sName} OR (lower(${schema.media.filename}) = ${sName} AND ${schema.media.id} > ${id}))`,
        );
      } else if (sort === "largest") {
        const sBytes = Number(s);
        cursorConditions.push(
          sql`(${schema.media.bytes} < ${sBytes} OR (${schema.media.bytes} = ${sBytes} AND ${schema.media.id} < ${id}))`,
        );
      } else {
        // default "newest"
        const sDate = new Date(s);
        cursorConditions.push(
          sql`(${schema.media.createdAt} < ${sDate} OR (${schema.media.createdAt} = ${sDate} AND ${schema.media.id} < ${id}))`,
        );
      }
    }

    // 3. Ordering
    let orderClauses;
    if (sort === "oldest") {
      orderClauses = [asc(schema.media.createdAt), asc(schema.media.id)];
    } else if (sort === "name") {
      orderClauses = [asc(sql`lower(${schema.media.filename})`), asc(schema.media.id)];
    } else if (sort === "largest") {
      orderClauses = [desc(schema.media.bytes), desc(schema.media.id)];
    } else {
      orderClauses = [desc(schema.media.createdAt), desc(schema.media.id)];
    }

    // Fetch limit + 1 to know if a next page exists
    const queryBuilder = tx
      .select({
        id: schema.media.id,
        storageKey: schema.media.storageKey,
        storageConnectionId: schema.media.storageConnectionId,
        cfImageId: schema.media.cfImageId,
        kind: schema.media.kind,
        mime: schema.media.mime,
        filename: schema.media.filename,
        title: schema.media.title,
        alt: schema.media.alt,
        caption: schema.media.caption,
        bytes: schema.media.bytes,
        width: schema.media.width,
        height: schema.media.height,
        durationMs: schema.media.durationMs,
        status: schema.media.status,
        folder: schema.media.folder,
        uploadedBy: schema.media.uploadedBy,
        trashedAt: schema.media.trashedAt,
        createdAt: schema.media.createdAt,
        updatedAt: schema.media.updatedAt,
        usageCount: sql<number>`(SELECT count(*)::int FROM media_usages mu WHERE mu.tenant_id = ${schema.media.tenantId} AND mu.media_id = ${schema.media.id})`,
      })
      .from(schema.media)
      .where(and(...cursorConditions))
      .orderBy(...orderClauses)
      .limit(limit + 1);

    if (typeof query?.offset === "number" && !query?.cursor) {
      queryBuilder.offset(query.offset);
    }

    const rows = await queryBuilder;
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1];
      if (last) {
        let sortVal: string | number;
        if (sort === "oldest" || sort === "newest") {
          sortVal = last.createdAt.toISOString();
        } else if (sort === "name") {
          sortVal = (last.filename || "").toLowerCase();
        } else {
          sortVal = Number(last.bytes);
        }
        nextCursor = encodeCursor(sortVal, last.id);
      }
    }


    const items: MediaItem[] = await Promise.all(
      pageRows.map(async (r) => {
        const url = (await resolvePublicMediaUrl(db, r.storageKey, r.storageConnectionId)) || "";
        const thumbnailUrl = buildThumbnailUrl(r, url);
        return {
          id: r.id,
          kind: r.kind as MediaKind,
          mime: r.mime,
          filename: r.filename,
          title: r.title,
          alt: r.alt,
          caption: r.caption,
          bytes: Number(r.bytes),
          width: r.width,
          height: r.height,
          durationMs: r.durationMs,
          url,
          thumbnailUrl,
          status: r.status as "ready" | "trashed",
          trashedAt: r.trashedAt ? r.trashedAt.toISOString() : null,
          usageCount: r.usageCount,
          uploadedBy: r.uploadedBy,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          storageKey: r.storageKey,
          storageConnectionId: r.storageConnectionId,
          cfImageId: r.cfImageId,
          folder: r.folder,
        };
      }),
    );

    return {
      items,
      nextCursor,
      total,
    };
  });
}
import { findUntrackedReferences } from "./media/untracked-references.ts";
export { findUntrackedReferences };

/**
 * Shared helper to resolve full MediaUsageReference labels and admin paths across both tracked media_usages
 * and untracked references (MEDIA-LIBRARY-PLAN §7, §9, S1, B5).
 */
export async function resolveMediaUsageLabels(
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  tenantId: string,
  mediaIds: string[],
): Promise<Map<string, MediaUsageReference[]>> {
  const result = new Map<string, MediaUsageReference[]>();
  if (mediaIds.length === 0) return result;

  // 1. Fetch tracked media_usages
  const usageRows = await tx
    .select()
    .from(schema.mediaUsages)
    .where(
      and(
        eq(schema.mediaUsages.tenantId, tenantId),
        inArray(schema.mediaUsages.mediaId, mediaIds),
      ),
    );

  const productIds = usageRows.filter((u) => u.ownerType === "product").map((u) => u.ownerId);
  const variantIds = usageRows.filter((u) => u.ownerType === "variant").map((u) => u.ownerId);
  const collectionIds = usageRows.filter((u) => u.ownerType === "collection").map((u) => u.ownerId);
  const categoryIds = usageRows.filter((u) => u.ownerType === "category").map((u) => u.ownerId);
  const brandIds = usageRows.filter((u) => u.ownerType === "brand").map((u) => u.ownerId);
  const pageIds = usageRows.filter((u) => u.ownerType === "page").map((u) => u.ownerId);
  const themeIds = usageRows.filter((u) => u.ownerType === "theme").map((u) => u.ownerId);

  const [productRows, variantRows, collectionRows, categoryRows, brandRows, pageRows, themeRows] = await Promise.all([
    productIds.length > 0
      ? tx.select({ id: schema.products.id, title: schema.products.title }).from(schema.products).where(inArray(schema.products.id, productIds))
      : [],
    variantIds.length > 0
      ? tx
          .select({
            id: schema.variants.id,
            productId: schema.variants.productId,
            sku: schema.variants.sku,
            title: schema.variants.title,
            productTitle: schema.products.title,
          })
          .from(schema.variants)
          .leftJoin(schema.products, eq(schema.products.id, schema.variants.productId))
          .where(inArray(schema.variants.id, variantIds))
      : [],
    collectionIds.length > 0
      ? tx.select({ id: schema.collections.id, title: schema.collections.title }).from(schema.collections).where(inArray(schema.collections.id, collectionIds))
      : [],
    categoryIds.length > 0
      ? tx.select({ id: schema.categories.id, name: schema.categories.name }).from(schema.categories).where(inArray(schema.categories.id, categoryIds))
      : [],
    brandIds.length > 0
      ? tx.select({ id: schema.brands.id, name: schema.brands.name }).from(schema.brands).where(inArray(schema.brands.id, brandIds))
      : [],
    pageIds.length > 0
      ? tx.select({ id: schema.pages.id, title: schema.pages.title, slug: schema.pages.slug, type: schema.pages.type }).from(schema.pages).where(inArray(schema.pages.id, pageIds))
      : [],
    themeIds.length > 0
      ? tx.select({ id: schema.themes.id, name: schema.themes.name }).from(schema.themes).where(inArray(schema.themes.id, themeIds))
      : [],
  ]);

  const productMap = new Map(productRows.map((p) => [p.id, p.title]));
  const variantMap = new Map(variantRows.map((v) => [v.id, v]));
  const collectionMap = new Map(collectionRows.map((c) => [c.id, c.title]));
  const categoryMap = new Map(categoryRows.map((c) => [c.id, c.name]));
  const brandMap = new Map(brandRows.map((b) => [b.id, b.name]));
  const pageMap = new Map(pageRows.map((p) => [p.id, p]));
  const themeMap = new Map(themeRows.map((t) => [t.id, t.name]));

  for (const u of usageRows) {
    const list = result.get(u.mediaId) || [];
    if (u.ownerType === "product") {
      list.push({
        ownerType: "product",
        ownerId: u.ownerId,
        field: u.field,
        label: productMap.get(u.ownerId) || "Product",
        adminPath: `/products/${u.ownerId}`,
      });
    } else if (u.ownerType === "variant") {
      const v = variantMap.get(u.ownerId);
      list.push({
        ownerType: "variant",
        ownerId: u.ownerId,
        field: u.field,
        label: v ? `${v.productTitle || "Product"} (${v.title || v.sku || "Variant"})` : "Variant",
        adminPath: v ? `/products/${v.productId}` : `/products`,
      });
    } else if (u.ownerType === "collection") {
      list.push({
        ownerType: "collection",
        ownerId: u.ownerId,
        field: u.field,
        label: collectionMap.get(u.ownerId) || "Collection",
        adminPath: `/collections/${u.ownerId}`,
      });
    } else if (u.ownerType === "category") {
      list.push({
        ownerType: "category",
        ownerId: u.ownerId,
        field: u.field,
        label: categoryMap.get(u.ownerId) || "Category",
        adminPath: `/categories/${u.ownerId}`,
      });
    } else if (u.ownerType === "brand") {
      list.push({
        ownerType: "brand",
        ownerId: u.ownerId,
        field: u.field,
        label: brandMap.get(u.ownerId) || "Brand",
        adminPath: `/brands`,
      });
    } else if (u.ownerType === "store_branding") {
      let label = "Store branding";
      let adminPath = "/settings/branding";
      if (u.field === "status_background") {
        label = "Store status (Background image)";
        adminPath = "/settings/storefront";
      } else if (u.field === "seo_og_image") {
        label = "Default social share image";
        adminPath = "/settings/storefront";
      } else if (u.field === "logo") {
        label = "Store branding (Logo)";
        adminPath = "/settings/branding";
      } else if (u.field === "logo_dark") {
        label = "Store branding (Dark Logo)";
        adminPath = "/settings/branding";
      } else if (u.field === "favicon") {
        label = "Store branding (Favicon)";
        adminPath = "/settings/branding";
      } else if (u.field === "apple_touch_icon") {
        label = "Store branding (Apple Touch Icon)";
        adminPath = "/settings/branding";
      } else if (u.field === "social_image") {
        label = "Store branding (Social Image)";
        adminPath = "/settings/branding";
      }
      list.push({
        ownerType: "store_branding",
        ownerId: u.ownerId,
        field: u.field,
        label,
        adminPath,
      });
    } else if (u.ownerType === "page") {
      const p = pageMap.get(u.ownerId);
      let label = p?.title || "Page";
      if (p?.type === "header") label = "Header";
      else if (p?.type === "footer") label = "Footer";
      else if (p?.type === "product_template") label = "Product page";
      else if (p?.type === "collection_template") label = "Collection page";
      else if (p?.type === "cart_template") label = "Cart page";
      else if (p?.type === "home") label = "Home page";

      list.push({
        ownerType: "page",
        ownerId: u.ownerId,
        field: u.field,
        label,
        adminPath: `/online-store/editor/${u.ownerId}`,
      });
    } else if (u.ownerType === "theme") {
      const tName = themeMap.get(u.ownerId);
      list.push({
        ownerType: "theme",
        ownerId: u.ownerId,
        field: u.field,
        label: tName ? `Theme: ${tName}` : "Theme settings",
        adminPath: `/online-store/theme-library`,
      });
    } else {
      list.push({
        ownerType: u.ownerType,
        ownerId: u.ownerId,
        field: u.field,
        label: u.ownerType,
        adminPath: `/settings/branding`,
      });
    }
    result.set(u.mediaId, list);
  }

  // 2. Fetch untracked references (defensive check for branding, status, seo, page blocks, themes)
  const untracked = await findUntrackedReferences(tx, tenantId, mediaIds);
  for (const [mId, refs] of untracked.entries()) {
    const list = result.get(mId) || [];
    for (const ref of refs) {
      if (
        !list.some(
          (existing) =>
            existing.ownerType === ref.ownerType &&
            existing.field === ref.field &&
            existing.ownerId === ref.ownerId,
        )
      ) {
        list.push(ref);
      }
    }
    result.set(mId, list);
  }

  return result;
}

/**
 * Get media item with full "Used in" resolution (MEDIA-LIBRARY-PLAN §7, Acceptance criteria 7).
 */
export async function getMedia(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string },
) {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        id: schema.media.id,
        storageKey: schema.media.storageKey,
        storageConnectionId: schema.media.storageConnectionId,
        cfImageId: schema.media.cfImageId,
        kind: schema.media.kind,
        mime: schema.media.mime,
        filename: schema.media.filename,
        title: schema.media.title,
        alt: schema.media.alt,
        caption: schema.media.caption,
        bytes: schema.media.bytes,
        width: schema.media.width,
        height: schema.media.height,
        durationMs: schema.media.durationMs,
        status: schema.media.status,
        folder: schema.media.folder,
        uploadedBy: schema.media.uploadedBy,
        trashedAt: schema.media.trashedAt,
        createdAt: schema.media.createdAt,
        updatedAt: schema.media.updatedAt,
      })
      .from(schema.media)
      .where(and(eq(schema.media.tenantId, ctx.tenantId), eq(schema.media.id, input.id), libraryScope))
      .limit(1);

    if (!row) {
      throw new Error(`Not Found: Media not found: "${input.id}"`);
    }

    const usagesMap = await resolveMediaUsageLabels(tx, ctx.tenantId, [input.id]);
    const usages = usagesMap.get(input.id) || [];

    const url = (await resolvePublicMediaUrl(db, row.storageKey, row.storageConnectionId)) || "";
    const thumbnailUrl = buildThumbnailUrl(row, url);

    return {
      id: row.id,
      kind: row.kind as MediaKind,
      mime: row.mime,
      filename: row.filename,
      title: row.title,
      alt: row.alt,
      caption: row.caption,
      bytes: Number(row.bytes),
      width: row.width,
      height: row.height,
      durationMs: row.durationMs,
      url,
      thumbnailUrl,
      status: row.status as "ready" | "trashed",
      trashedAt: row.trashedAt ? row.trashedAt.toISOString() : null,
      usageCount: usages.length,
      uploadedBy: row.uploadedBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      storageKey: row.storageKey,
      storageConnectionId: row.storageConnectionId,
      cfImageId: row.cfImageId,
      folder: row.folder,
      usages,
    };
  });
}

/**
 * Returns media storage and per-kind quota report (MEDIA-LIBRARY-PLAN §6.3).
 */
export async function getMediaUsage(
  rt: Runtime,
  ctx: TenantContext,
): Promise<MediaUsageReport> {
  assertPermission(ctx, "content.write");
  return await getTenantMediaUsageStats(rt._db.db, ctx.tenantId);
}

/**
 * Generates an upload presigned descriptor after checking allowed formats and per-kind quota
 * (MEDIA-LIBRARY-PLAN §4, §6.2).
 */
export async function requestMediaUpload(
  rt: Runtime,
  ctx: TenantContext,
  input: RequestUploadInput,
) {
  assertPermission(ctx, "content.write");
  const normMime = input.mime.toLowerCase().trim();

  if (normMime === "image/svg+xml") {
    throw new Error("SVG uploads are disabled for security reasons");
  }
  if (!isAllowedMime(normMime)) {
    throw new Error(`Unsupported media format: "${input.mime}"`);
  }

  const requestedFolder = input.folder ?? "products";
  if ((PRIVATE_MEDIA_FOLDERS as readonly string[]).includes(requestedFolder)) {
    throw new Error(`Bad Request: Presigning upload to private folder "${requestedFolder}" is restricted`);
  }

  const kind = getMediaKind(normMime) || "image";

  // Enforce upload quotas (per-kind + storage limit)
  await assertMediaUploadQuota(rt._db.db, ctx.tenantId, {
    kind,
    bytes: input.bytes,
  });

  const { driver } = await getActiveStorageDriver(rt._db.db, "public_media");

  return await driver.presignUpload({
    tenantId: ctx.tenantId,
    folder: requestedFolder,
    filename: input.filename,
    mime: normMime,
    bytes: input.bytes,
  });
}

/**
 * Creates a media database record after upload completes, validating real size, magic bytes,
 * and Sharp dimensions (MEDIA-LIBRARY-PLAN §4, §6, §7).
 */
export async function createMediaRecord(
  rt: Runtime,
  ctx: TenantContext,
  input: CreateMediaInput,
) {
  assertPermission(ctx, "content.write");

  // Validate client-provided storage key (fixes B2)
  const { folder: keyFolder } = validateClientStorageKey(ctx.tenantId, input.storageKey);

  // Refuse if input.folder differs from the validated storage key folder (fixes R1)
  if (input.folder && input.folder !== keyFolder) {
    throw new Error(`Bad Request: Declared folder "${input.folder}" does not match storage key folder "${keyFolder}"`);
  }

  // Ensure key doesn't already exist before making any storage calls
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select({ id: schema.media.id })
      .from(schema.media)
      .where(
        and(
          eq(schema.media.tenantId, ctx.tenantId),
          eq(schema.media.storageKey, input.storageKey),
        ),
      )
      .limit(1);

    if (existing) {
      throw new Error(`Bad Request: Storage key "${input.storageKey}" already registered in library`);
    }
  });

  return await finalizeUpload(rt, ctx, {
    storageKey: input.storageKey,
    declaredMime: input.mime,
    declaredBytes: input.bytes,
    filename: input.filename,
    title: input.title,
    alt: input.alt,
    caption: input.caption,
    folder: keyFolder,
    durationMs: input.durationMs,
    cfImageId: input.cfImageId,
  });
}

/**
 * Direct file upload proxy (MEDIA-LIBRARY-PLAN §7, §4).
 */
export async function uploadMediaDirect(
  rt: Runtime,
  ctx: TenantContext,
  input: {
    fileBytes: Buffer | Uint8Array;
    filename: string;
    mime: string;
    folder?: string | undefined;
    alt?: string | undefined;
    title?: string | undefined;
    caption?: string | undefined;
    durationMs?: number | undefined;
  },
) {
  assertPermission(ctx, "content.write");
  const normMime = input.mime.toLowerCase().trim();

  if (normMime === "image/svg+xml") {
    throw new Error("SVG uploads are disabled for security reasons");
  }
  if (!isAllowedMime(normMime)) {
    throw new Error(`Unsupported media format: "${input.mime}"`);
  }

  const folder = input.folder || "products";
  if ((PRIVATE_MEDIA_FOLDERS as readonly string[]).includes(folder)) {
    throw new Error(`Bad Request: Uploading directly to private folder "${folder}" is restricted`);
  }

  const kind = getMediaKind(normMime) || "image";
  await assertMediaUploadQuota(rt._db.db, ctx.tenantId, {
    kind,
    bytes: input.fileBytes.length,
  });

  const { driver } = await getActiveStorageDriver(rt._db.db, "public_media");
  const { storageKey } = generateStorageKey(
    ctx.tenantId,
    folder,
    input.filename,
  );

  await driver.put({
    key: storageKey,
    body: input.fileBytes,
    contentType: normMime,
  });

  return await finalizeUpload(rt, ctx, {
    storageKey,
    declaredMime: normMime,
    declaredBytes: input.fileBytes.length,
    filename: input.filename,
    title: input.title,
    alt: input.alt,
    caption: input.caption,
    folder,
    durationMs: input.durationMs,
    directBuffer: input.fileBytes,
  });
}

/**
 * Update media metadata (title, alt, caption) with audit logging (MEDIA-LIBRARY-PLAN §7).
 */
export async function updateMedia(
  rt: Runtime,
  ctx: TenantContext,
  input: UpdateMediaInput,
): Promise<MediaItem> {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;

  const { row, usageCount } = await withTenant(db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.media)
      .where(and(eq(schema.media.tenantId, ctx.tenantId), eq(schema.media.id, input.id), libraryScope))
      .limit(1);

    if (!existing) {
      throw new Error(`Not Found: Media not found: "${input.id}"`);
    }

    const setVals: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (input.title !== undefined) setVals.title = input.title ? input.title.trim() : null;
    if (input.alt !== undefined) setVals.alt = input.alt ? input.alt.trim().slice(0, 512) : null;
    if (input.caption !== undefined) setVals.caption = input.caption ? input.caption.trim().slice(0, 1000) : null;

    const [updated] = await tx
      .update(schema.media)
      .set(setVals)
      .where(and(eq(schema.media.tenantId, ctx.tenantId), eq(schema.media.id, input.id), libraryScope))
      .returning();

    if (!updated) throw new Error("Failed to update media");

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "media.update",
      targetType: "media",
      targetId: input.id,
      diff: {
        before: { title: existing.title, alt: existing.alt, caption: existing.caption },
        after: { title: updated.title, alt: updated.alt, caption: updated.caption },
      },
    });

    const [usageRes] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.mediaUsages)
      .where(and(eq(schema.mediaUsages.tenantId, ctx.tenantId), eq(schema.mediaUsages.mediaId, input.id)));

    return { row: updated, usageCount: usageRes?.count ?? 0 };
  });

  await invalidateMediaCache(rt, ctx, [input.id]);

  const url = (await resolvePublicMediaUrl(db, row.storageKey, row.storageConnectionId)) || "";
  const thumbnailUrl = buildThumbnailUrl(row, url);

  return {
    id: row.id,
    kind: row.kind as MediaKind,
    mime: row.mime,
    filename: row.filename,
    title: row.title,
    alt: row.alt,
    caption: row.caption,
    bytes: Number(row.bytes),
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    url,
    thumbnailUrl,
    status: row.status as "ready" | "trashed",
    trashedAt: row.trashedAt ? row.trashedAt.toISOString() : null,
    usageCount,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    storageKey: row.storageKey,
    storageConnectionId: row.storageConnectionId,
    cfImageId: row.cfImageId,
    folder: row.folder,
  };
}

/**
 * Move media items to trash (MEDIA-LIBRARY-PLAN §7, Acceptance criteria 8).
 * Allowed even when used (storefront still displays them), returns used items with counts.
 */
export async function trashMedia(
  rt: Runtime,
  ctx: TenantContext,
  input: { ids: string[] },
): Promise<{ trashed: number; used: { id: string; usageCount: number }[] }> {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;
  const uniqueIds = Array.from(new Set(input.ids)).slice(0, 100);
  if (uniqueIds.length === 0) return { trashed: 0, used: [] };

  const result = await withTenant(db, ctx.tenantId, async (tx) => {
    // Check usages
    const usageCounts = await tx
      .select({
        mediaId: schema.mediaUsages.mediaId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.mediaUsages)
      .where(
        and(
          eq(schema.mediaUsages.tenantId, ctx.tenantId),
          inArray(schema.mediaUsages.mediaId, uniqueIds),
        ),
      )
      .groupBy(schema.mediaUsages.mediaId);

    const usageMap = new Map(usageCounts.map((u) => [u.mediaId, u.count]));

    const updated = await tx
      .update(schema.media)
      .set({
        status: "trashed",
        trashedAt: new Date(),
        trashedBy: ctx.actor.type === "staff" ? ctx.actor.userId : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.media.tenantId, ctx.tenantId),
          inArray(schema.media.id, uniqueIds),
          ne(schema.media.status, "trashed"),
          libraryScope,
        ),
      )
      .returning({ id: schema.media.id });

    const firstUpdated = updated[0];
    if (firstUpdated) {
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: ctx.actor.type,
        actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
        action: "media.trash",
        targetType: "media",
        targetId: firstUpdated.id,
        diff: {
          trashedIds: updated.map((r) => r.id),
          trashedCount: updated.length,
        },
      });
    }

    const used = updated
      .filter((r) => (usageMap.get(r.id) || 0) > 0)
      .map((r) => ({ id: r.id, usageCount: usageMap.get(r.id) ?? 0 }));

    return { trashed: updated.length, used };
  });

  await invalidateMediaCache(rt, ctx, uniqueIds);
  return result;
}

/**
 * Restores trashed media items back to ready status (MEDIA-LIBRARY-PLAN §7, Acceptance criteria 8).
 */
export async function restoreMedia(
  rt: Runtime,
  ctx: TenantContext,
  input: { ids: string[] },
): Promise<{ restored: number }> {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;
  const uniqueIds = Array.from(new Set(input.ids)).slice(0, 100);
  if (uniqueIds.length === 0) return { restored: 0 };

  const result = await withTenant(db, ctx.tenantId, async (tx) => {
    const updated = await tx
      .update(schema.media)
      .set({
        status: "ready",
        trashedAt: null,
        trashedBy: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.media.tenantId, ctx.tenantId),
          inArray(schema.media.id, uniqueIds),
          eq(schema.media.status, "trashed"),
          libraryScope,
        ),
      )
      .returning({ id: schema.media.id });

    const firstRestored = updated[0];
    if (firstRestored) {
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: ctx.actor.type,
        actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
        action: "media.restore",
        targetType: "media",
        targetId: firstRestored.id,
        diff: {
          restoredIds: updated.map((r) => r.id),
          restoredCount: updated.length,
        },
      });
    }

    return { restored: updated.length };
  });

  await invalidateMediaCache(rt, ctx, uniqueIds);
  return result;
}

/**
 * Permanently deletes trashed media files. Refuses items that still have usages (fixes L2, B5).
 * Enqueues storage purge in the same business transaction (fixes L3, rule 13, B4).
 */
export async function deleteMediaPermanent(
  rt: Runtime,
  ctx: TenantContext,
  input: { ids: string[] },
): Promise<{
  deleted: number;
  blocked: { id: string; usages: MediaUsageReference[] }[];
}> {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;
  const uniqueIds = Array.from(new Set(input.ids)).slice(0, 100);
  if (uniqueIds.length === 0) return { deleted: 0, blocked: [] };

  const result = await withTenant(db, ctx.tenantId, async (tx) => {
    // 1. Fetch target items (must be trashed and in libraryScope)
    const targetRows = await tx
      .select({
        id: schema.media.id,
        storageKey: schema.media.storageKey,
        storageConnectionId: schema.media.storageConnectionId,
      })
      .from(schema.media)
      .where(
        and(
          eq(schema.media.tenantId, ctx.tenantId),
          inArray(schema.media.id, uniqueIds),
          eq(schema.media.status, "trashed"),
          libraryScope,
        ),
      );

    if (targetRows.length === 0) {
      return { deleted: 0, blocked: [], allowedIds: [] as string[] };
    }

    const targetRowIds = targetRows.map((r) => r.id);

    // 2. Resolve usages across tracked media_usages and untracked references (B5, S1)
    const usagesMap = await resolveMediaUsageLabels(tx, ctx.tenantId, targetRowIds);

    const blocked: { id: string; usages: MediaUsageReference[] }[] = [];
    const allowedRows: typeof targetRows = [];

    for (const r of targetRows) {
      const uList = usagesMap.get(r.id);
      if (uList && uList.length > 0) {
        blocked.push({ id: r.id, usages: uList });
      } else {
        allowedRows.push(r);
      }
    }

    if (allowedRows.length === 0) {
      return { deleted: 0, blocked, allowedIds: [] as string[] };
    }

    const allowedIds = allowedRows.map((r) => r.id);

    // 3. Delete from database
    await tx
      .delete(schema.media)
      .where(and(eq(schema.media.tenantId, ctx.tenantId), inArray(schema.media.id, allowedIds)));

    // 4. Write audit log
    const firstAllowed = allowedRows[0];
    if (firstAllowed) {
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: ctx.actor.type,
        actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
        action: "media.delete",
        targetType: "media",
        targetId: firstAllowed.id,
        diff: {
          deletedIds: allowedIds,
          deletedCount: allowedIds.length,
        },
      });
    }

    const objectsToPurge = allowedRows.map((r) => ({
      storageKey: r.storageKey,
      storageConnectionId: r.storageConnectionId,
    }));

    // 5. Enqueue media.purge job inside business transaction (Rule 13, B4)
    if (rt._jobs) {
      await rt._jobs.send("media.purge", {
        tenantId: ctx.tenantId,
        objects: objectsToPurge,
      });
    }

    return { deleted: allowedIds.length, blocked, allowedIds };
  });

  await invalidateMediaCache(rt, ctx, result.allowedIds);
  return { deleted: result.deleted, blocked: result.blocked };
}

/**
 * Backward compatibility alias: delete calls trashMedia for a single file (MEDIA-LIBRARY-PLAN §7).
 */
export async function deleteMediaRecord(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string },
) {
  assertPermission(ctx, "content.write");
  await trashMedia(rt, ctx, { ids: [input.id] });
  return { success: true };
}

/**
 * Domain helper to keep media_usages synchronized for an owner and field (MEDIA-LIBRARY-PLAN §5.2, B6).
 * Replaces the usage records for one (ownerType, ownerId, field) set with given media IDs.
 */
export async function syncMediaUsages(
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  ctx: TenantContext,
  params: {
    ownerType: "product" | "variant" | "collection" | "category" | "brand" | "page" | "theme" | "store_branding";
    ownerId: string;
    field: string;
    mediaIds: (string | null | undefined)[];
  },
): Promise<void> {
  const validIds = Array.from(new Set(params.mediaIds.filter((id): id is string => Boolean(id))));

  await tx
    .delete(schema.mediaUsages)
    .where(
      and(
        eq(schema.mediaUsages.tenantId, ctx.tenantId),
        eq(schema.mediaUsages.ownerType, params.ownerType),
        eq(schema.mediaUsages.ownerId, params.ownerId),
        eq(schema.mediaUsages.field, params.field),
      ),
    );

  if (validIds.length === 0) return;

  // Validate tenant ownership and reject private folders (B6, B1)
  const existing = await tx
    .select({ id: schema.media.id, folder: schema.media.folder })
    .from(schema.media)
    .where(
      and(
        eq(schema.media.tenantId, ctx.tenantId),
        inArray(schema.media.id, validIds),
      ),
    );

  if (existing.length !== validIds.length) {
    throw new Error("Bad Request: One or more media items do not exist in tenant's media library");
  }

  for (const item of existing) {
    if (item.folder && (PRIVATE_MEDIA_FOLDERS as readonly string[]).includes(item.folder)) {
      throw new Error(`Bad Request: Media item "${item.id}" is in a private folder and cannot be used in public entities`);
    }
  }

  await tx.insert(schema.mediaUsages).values(
    validIds.map((mediaId) => ({
      tenantId: ctx.tenantId,
      mediaId,
      ownerType: params.ownerType,
      ownerId: params.ownerId,
      field: params.field,
    })),
  );
}

/**
 * Clears all media_usages records when an owner entity is deleted (MEDIA-LIBRARY-PLAN §5.2).
 */
export async function clearMediaUsagesForOwner(
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  ctx: TenantContext,
  params: {
    ownerType: string;
    ownerId: string;
  },
): Promise<void> {
  await tx
    .delete(schema.mediaUsages)
    .where(
      and(
        eq(schema.mediaUsages.tenantId, ctx.tenantId),
        eq(schema.mediaUsages.ownerType, params.ownerType),
        eq(schema.mediaUsages.ownerId, params.ownerId),
      ),
    );
}

/**
 * Purges physical storage objects for a tenant, strictly asserting tenant prefix (MEDIA-LIBRARY-PLAN §8).
 */
export async function purgeMediaObjects(
  db: Db,
  params: {
    tenantId: string;
    objects: { storageKey: string; storageConnectionId?: string | null }[];
  },
): Promise<{ purged: number }> {
  let purged = 0;
  for (const obj of params.objects) {
    // Assert tenant prefix strictly (Security rule 10 & PLAN §8)
    if (!obj.storageKey.startsWith(`${params.tenantId}/`)) {
      throw new Error(
        `Security violation: storageKey "${obj.storageKey}" does not start with tenant prefix "${params.tenantId}/"`,
      );
    }

    try {
      const driver = await resolveDriverForMediaRow(db, obj.storageConnectionId, "public_media");
      if (driver) {
        await driver.delete(obj.storageKey);
        purged++;
      }
    } catch (err) {
      console.warn(`[storage] Could not delete physical object "${obj.storageKey}":`, err);
    }
  }
  return { purged };
}

/**
 * Trash sweep job: permanently deletes items trashed > 30 days ago that have NO usages (MEDIA-LIBRARY-PLAN §8, B4).
 */
export async function runMediaTrashSweep(
  db: Db,
  tenantId?: string,
  jobs?: { send: (name: string, payload: unknown) => Promise<unknown> } | null,
): Promise<{ sweptTenants: number; deletedCount: number }> {
  // 1. Determine target tenants (operates across tenants inside withTenant, B4)
  const targetTenantIds: string[] = tenantId
    ? [tenantId]
    : (await db.select({ id: schema.tenants.id }).from(schema.tenants)).map((t) => t.id);

  let sweptTenants = 0;
  let totalDeleted = 0;

  type SweepRow = {
    id: string;
    storage_key: string;
    storage_connection_id: string | null;
    [key: string]: unknown;
  };

  for (const tId of targetTenantIds) {
    const deletedForTenant = await withTenant(db, tId, async (tx) => {
      // 2. Select candidates older than 30 days, trashed, within libraryScope, and no tracked media_usages
      const candidateRes = await tx.execute<SweepRow>(sql`
        SELECT m.id, m.storage_key, m.storage_connection_id
        FROM media m
        WHERE m.tenant_id = ${tId}
          AND m.status = 'trashed'
          AND m.trashed_at < now() - interval '30 days'
          AND (m.folder IS NULL OR m.folder NOT IN ('returns', 'expense-receipts'))
          AND NOT EXISTS (
            SELECT 1 FROM media_usages mu
            WHERE mu.tenant_id = m.tenant_id
              AND mu.media_id = m.id
          )
      `);
      const candidates = (candidateRes.rows ?? []) as SweepRow[];
      if (candidates.length === 0) return [];

      const candidateIds = candidates.map((c) => c.id);

      // Check untracked references (B5)
      const untracked = await findUntrackedReferences(tx, tId, candidateIds);
      const safeToDeleteCandidates = candidates.filter((c) => !untracked.has(c.id));
      if (safeToDeleteCandidates.length === 0) return [];

      const safeIds = safeToDeleteCandidates.map((c) => c.id);

      // 3. Atomically delete with RETURNING, re-checking conditions (B4)
      const deletedRows = await tx
        .delete(schema.media)
        .where(
          and(
            eq(schema.media.tenantId, tId),
            inArray(schema.media.id, safeIds),
            eq(schema.media.status, "trashed"),
            lt(schema.media.trashedAt, sql`now() - interval '30 days'`),
            sql`(${schema.media.folder} IS NULL OR ${schema.media.folder} NOT IN ('returns', 'expense-receipts'))`,
            sql`NOT EXISTS (
              SELECT 1 FROM media_usages mu
              WHERE mu.tenant_id = ${schema.media.tenantId}
                AND mu.media_id = ${schema.media.id}
            )`,
          ),
        )
        .returning({
          id: schema.media.id,
          storage_key: schema.media.storageKey,
          storage_connection_id: schema.media.storageConnectionId,
        });

      if (deletedRows.length === 0) return [];

      const deletedIds = deletedRows.map((r) => r.id);

      // 4. Audit log with actorType: "system", actorId: null (B4)
      const firstDeleted = deletedRows[0];
      if (firstDeleted) {
        await tx.insert(schema.auditLogs).values({
          tenantId: tId,
          actorType: "system",
          actorId: null,
          action: "media.trash_sweep",
          targetType: "media",
          targetId: firstDeleted.id,
          diff: {
            deletedCount: deletedRows.length,
            deletedIds,
          },
        });
      }

      return deletedRows;
    });

    if (deletedForTenant.length > 0) {
      sweptTenants++;
      totalDeleted += deletedForTenant.length;

      // 5. Purge after commit by enqueueing media.purge (Rule 13, B4)
      const objects = deletedForTenant.map((r) => ({
        storageKey: r.storage_key,
        storageConnectionId: r.storage_connection_id,
      }));

      if (jobs) {
        await jobs.send("media.purge", {
          tenantId: tId,
          objects,
        });
      }
    }
  }

  return { sweptTenants, deletedCount: totalDeleted };
}

/**
 * Attaches an uploaded library image or video to a product and syncs media_usages (MEDIA-LIBRARY-PLAN §3, §5.2 / S3).
 * Primary (position 0) must always be an image.
 */
export async function attachProductMedia(
  rt: Runtime,
  ctx: TenantContext,
  input: { productId: string; mediaId: string; alt?: string | undefined },
) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  const link = await withTenant(db, ctx.tenantId, async (tx) => {
    const [product] = await tx
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.id, input.productId))
      .limit(1);
    if (!product) throw new Error("Not Found: product not found");

    const [asset] = await tx
      .select({
        id: schema.media.id,
        storageKey: schema.media.storageKey,
        kind: schema.media.kind,
        status: schema.media.status,
      })
      .from(schema.media)
      .where(and(eq(schema.media.tenantId, ctx.tenantId), eq(schema.media.id, input.mediaId), libraryScope))
      .limit(1);
    if (!asset) throw new Error("Not Found: media item not found in library");
    if (asset.status === "trashed") {
      throw new Error("Bad Request: This file is in the Trash. Restore it before adding it to a product");
    }

    if (asset.kind !== "image" && asset.kind !== "video") {
      throw new Error("Bad Request: Only images and videos can be added to the product gallery");
    }

    const currentLinks = await tx
      .select({
        id: schema.productMedia.id,
        position: schema.productMedia.position,
        mediaId: schema.productMedia.mediaId,
        kind: schema.media.kind,
      })
      .from(schema.productMedia)
      .innerJoin(schema.media, eq(schema.media.id, schema.productMedia.mediaId))
      .where(eq(schema.productMedia.productId, input.productId))
      .orderBy(schema.productMedia.position);

    const existing = currentLinks.find((l) => l.mediaId === input.mediaId);
    if (existing) {
      return { id: existing.id, position: existing.position, storageKey: asset.storageKey };
    }

    const hasImage = currentLinks.some((l) => l.kind === "image");

    if (asset.kind === "video") {
      // Invariant: product must have at least one image before adding a video (S3)
      if (!hasImage || currentLinks.length === 0) {
        throw new Error("Bad Request: A product must have at least one image before adding a video");
      }
    }

    const position = currentLinks.length === 0 ? 0 : Math.max(...currentLinks.map((r) => r.position)) + 1;

    const [row] = await tx
      .insert(schema.productMedia)
      .values({
        tenantId: ctx.tenantId,
        productId: input.productId,
        mediaId: input.mediaId,
        position,
        alt: input.alt ?? null,
      })
      .returning();
    if (!row) throw new Error("Failed to attach media");

    // Sync media usages for this product gallery
    const allLinks = await tx
      .select({ mediaId: schema.productMedia.mediaId })
      .from(schema.productMedia)
      .where(eq(schema.productMedia.productId, input.productId));

    await syncMediaUsages(tx, ctx, {
      ownerType: "product",
      ownerId: input.productId,
      field: "gallery",
      mediaIds: allLinks.map((l) => l.mediaId),
    });

    return { id: row.id, position: row.position, storageKey: asset.storageKey };
  });

  await invalidateCache(rt, ctx, { type: "product_image_updated", productId: input.productId });
  return { id: link.id, position: link.position, isPrimary: link.position === 0, url: publicMediaUrl(link.storageKey) };
}

/**
 * Removes an image or video from a product and syncs media_usages (MEDIA-LIBRARY-PLAN §3, §5.2 / S3).
 * If the primary item was removed, promotes the next available image to position 0.
 */
export async function detachProductMedia(
  rt: Runtime,
  ctx: TenantContext,
  input: { productId: string; productMediaId: string },
) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  await withTenant(db, ctx.tenantId, async (tx) => {
    const deleted = await tx
      .delete(schema.productMedia)
      .where(and(eq(schema.productMedia.id, input.productMediaId), eq(schema.productMedia.productId, input.productId)))
      .returning({ id: schema.productMedia.id });
    if (deleted.length === 0) throw new Error("Not Found: media item is not attached to this product");

    const remaining = await tx
      .select({
        id: schema.productMedia.id,
        mediaId: schema.productMedia.mediaId,
        kind: schema.media.kind,
      })
      .from(schema.productMedia)
      .innerJoin(schema.media, eq(schema.media.id, schema.productMedia.mediaId))
      .where(eq(schema.productMedia.productId, input.productId))
      .orderBy(schema.productMedia.position);

    // The primary item must stay an image: removing the last image while videos remain is refused (rolls back the delete).
    if (remaining.length > 0 && !remaining.some((r) => r.kind === "image")) {
      throw new Error("Bad Request: Remove the videos first. A product's main media must be an image");
    }

    // If remaining item at position 0 is not an image, promote the next image to position 0 (S3)
    if (remaining.length > 0) {
      const first = remaining[0];
      if (first && first.kind !== "image") {
        const nextImageIdx = remaining.findIndex((r) => r.kind === "image");
        if (nextImageIdx > 0) {
          const [promoted] = remaining.splice(nextImageIdx, 1);
          if (promoted) {
            remaining.unshift(promoted);
          }
        }
      }
    }

    for (let i = 0; i < remaining.length; i++) {
      const row = remaining[i];
      if (row) {
        await tx.update(schema.productMedia).set({ position: i, updatedAt: new Date() }).where(eq(schema.productMedia.id, row.id));
      }
    }

    // Sync media usages for this product gallery
    await syncMediaUsages(tx, ctx, {
      ownerType: "product",
      ownerId: input.productId,
      field: "gallery",
      mediaIds: remaining.map((l) => l.mediaId),
    });
  });

  await invalidateCache(rt, ctx, { type: "product_image_updated", productId: input.productId });
  return { success: true };
}

/**
 * Reorders product media items gap-free, enforcing that position 0 is always an image (MEDIA-LIBRARY-PLAN §3 / S3).
 */
export async function reorderProductMedia(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string; order: string[] },
): Promise<{ success: boolean }> {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  await withTenant(db, ctx.tenantId, async (tx) => {
    const [product] = await tx
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.id, input.id))
      .limit(1);
    if (!product) throw new Error("Not Found: product not found");

    const current = await tx
      .select({
        id: schema.productMedia.id,
        mediaId: schema.productMedia.mediaId,
        kind: schema.media.kind,
      })
      .from(schema.productMedia)
      .innerJoin(schema.media, eq(schema.media.id, schema.productMedia.mediaId))
      .where(eq(schema.productMedia.productId, input.id));

    if (input.order.length !== current.length || new Set(input.order).size !== input.order.length) {
      throw new Error("Bad Request: order must contain each of the product's current media items exactly once");
    }

    const currentMap = new Map(current.map((c) => [c.id, c]));
    for (const id of input.order) {
      if (!currentMap.has(id)) {
        throw new Error("Bad Request: order contains invalid or foreign product media IDs");
      }
    }

    // Invariant: Position 0 must always be an image (MEDIA-LIBRARY-PLAN §3 / S3)
    const firstId = input.order[0];
    if (firstId) {
      const firstItem = currentMap.get(firstId);
      if (firstItem && firstItem.kind !== "image") {
        throw new Error("Bad Request: The primary media (position 0) must be an image");
      }
    }

    for (let i = 0; i < input.order.length; i++) {
      const pmId = input.order[i];
      if (pmId) {
        await tx
          .update(schema.productMedia)
          .set({ position: i, updatedAt: new Date() })
          .where(eq(schema.productMedia.id, pmId));
      }
    }

    // Write audit log
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "product.update",
      targetType: "product",
      targetId: input.id,
      diff: {
        reorderMedia: input.order,
      },
    });

    // Sync media usages with the new order
    const orderedMediaIds = input.order
      .map((id) => currentMap.get(id)?.mediaId)
      .filter((mId): mId is string => Boolean(mId));

    await syncMediaUsages(tx, ctx, {
      ownerType: "product",
      ownerId: input.id,
      field: "gallery",
      mediaIds: orderedMediaIds,
    });
  });

  await invalidateCache(rt, ctx, { type: "product_image_updated", productId: input.id });
  return { success: true };
}

/**
 * Updates product-level alt text on an attached product media item (MEDIA-LIBRARY-PLAN §3 / S3).
 */
export async function updateProductMedia(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string; productMediaId: string; alt?: string | null | undefined },
): Promise<{ success: boolean }> {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  await withTenant(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select({ id: schema.productMedia.id })
      .from(schema.productMedia)
      .where(
        and(
          eq(schema.productMedia.id, input.productMediaId),
          eq(schema.productMedia.productId, input.id),
        ),
      )
      .limit(1);

    if (!row) throw new Error("Not Found: image is not attached to this product");

    await tx
      .update(schema.productMedia)
      .set({
        alt: input.alt !== undefined ? input.alt : undefined,
        updatedAt: new Date(),
      })
      .where(eq(schema.productMedia.id, input.productMediaId));
  });

  await invalidateCache(rt, ctx, { type: "product_image_updated", productId: input.id });
  return { success: true };
}

export interface ReplaceMediaInput {
  id: string;
  storageKey: string;
  mime: string;
  bytes: number;
  filename?: string | undefined;
  durationMs?: number | undefined;
}

/**
 * Replaces a media file's physical object and metadata while preserving its ID, usages, and text fields
 * (MEDIA-LIBRARY-PLAN §6.2, §7 / S6).
 */
export async function replaceMedia(
  rt: Runtime,
  ctx: TenantContext,
  input: ReplaceMediaInput,
): Promise<MediaItem> {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;

  // 1. Validate storage key shape and tenant prefix (B2, R1)
  const { folder: keyFolder } = validateClientStorageKey(ctx.tenantId, input.storageKey);

  // 2. Check that target item exists, belongs to tenant, is in libraryScope, and is NOT trashed
  const existing = await withTenant(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.media)
      .where(and(eq(schema.media.tenantId, ctx.tenantId), eq(schema.media.id, input.id), libraryScope))
      .limit(1);

    if (!row) {
      throw new Error("Not Found: media item not found");
    }
    if (row.status === "trashed") {
      throw new Error("Bad Request: Trashed files cannot be replaced. Restore the file first.");
    }

    // Ensure storage key is not already registered by another item
    const [dup] = await tx
      .select({ id: schema.media.id })
      .from(schema.media)
      .where(
        and(
          eq(schema.media.tenantId, ctx.tenantId),
          eq(schema.media.storageKey, input.storageKey),
          ne(schema.media.id, input.id),
        ),
      )
      .limit(1);

    if (dup) {
      throw new Error(`Bad Request: Storage key "${input.storageKey}" already registered in library`);
    }

    return row;
  });

  const normMime = input.mime.toLowerCase().trim();
  if (normMime === "image/svg+xml") {
    throw new Error("SVG uploads are disabled for security reasons");
  }
  if (!isAllowedMime(normMime)) {
    throw new Error(`Unsupported media format: "${input.mime}"`);
  }

  // 3. Derived kind must match existing item's kind (S6: Same kind required)
  const newKind = getMediaKind(normMime);
  if (!newKind || newKind !== existing.kind) {
    throw new Error(`Bad Request: Replacement file must be of the same type (${existing.kind})`);
  }

  const { driver, config: activeConfig } = await getActiveStorageDriver(db, "public_media");

  // 4. HeadObject gets real physical size
  const head = await driver.head(input.storageKey);
  if (!head.exists) {
    throw new Error(`Uploaded file not found in storage: "${input.storageKey}"`);
  }
  const realBytes = head.size ?? 0;
  if (realBytes <= 0) {
    throw new Error("Uploaded file is empty");
  }

  // 5. Net quota check (counts realBytes - oldBytes)
  try {
    await assertMediaReplaceQuota(db, ctx.tenantId, {
      kind: newKind,
      bytes: realBytes,
      oldBytes: Number(existing.bytes),
    });
  } catch (quotaErr) {
    // Purge the oversize uploaded file immediately
    await purgeMediaObjects(db, {
      tenantId: ctx.tenantId,
      objects: [{ storageKey: input.storageKey, storageConnectionId: activeConfig.id }],
    }).catch(() => {});
    throw quotaErr;
  }

  // 6. Magic bytes verification (read first 4 KB)
  const chunk = driver.getRange
    ? await driver.getRange(input.storageKey, 0, 4095)
    : await driver.get(input.storageKey);
  if (!chunk || chunk.length === 0) {
    throw new Error(`Failed to read uploaded file from storage: "${input.storageKey}"`);
  }

  const magicResult = verifyMediaMagicBytes(normMime, chunk, input.filename || existing.filename || undefined);
  if (!magicResult.valid) {
    await purgeMediaObjects(db, {
      tenantId: ctx.tenantId,
      objects: [{ storageKey: input.storageKey, storageConnectionId: activeConfig.id }],
    }).catch(() => {});
    throw new Error(magicResult.error || "File verification failed: magic bytes mismatch");
  }

  // 7. Extract dimensions. A replacement image that sharp cannot read is refused, as at upload.
  let width: number | null = null;
  let height: number | null = null;
  let sha256: string | null = null;
  if (newKind === "image") {
    try {
      const fullBytes = await driver.get(input.storageKey);
      if (!fullBytes || fullBytes.length === 0) {
        throw new Error("empty image body");
      }
      const sharpModule = await import("sharp");
      const sharp = sharpModule.default;
      const meta = await sharp(fullBytes).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
      sha256 = crypto.createHash("sha256").update(fullBytes).digest("hex");
    } catch (err) {
      await purgeMediaObjects(db, {
        tenantId: ctx.tenantId,
        objects: [{ storageKey: input.storageKey, storageConnectionId: activeConfig.id }],
      }).catch(() => {});
      throw new Error("Failed to process image metadata: corrupted or invalid image file", { cause: err });
    }
  }

  const oldStorageKey = existing.storageKey;
  const oldConnectionId = existing.storageConnectionId;

  // 8. Atomic transaction: update media row and write audit log
  const updatedItem = await withTenant(db, ctx.tenantId, async (tx) => {
    const updateValues: Record<string, unknown> = {
      storageKey: input.storageKey,
      storageConnectionId: activeConfig.id,
      mime: normMime,
      bytes: realBytes,
      width,
      height,
      durationMs: input.durationMs ?? null,
      sha256,
      folder: keyFolder,
      updatedAt: new Date(),
    };
    if (input.filename) {
      updateValues.filename = input.filename;
    }

    const [updated] = await tx
      .update(schema.media)
      .set(updateValues)
      .where(and(eq(schema.media.tenantId, ctx.tenantId), eq(schema.media.id, input.id)))
      .returning();

    if (!updated) {
      throw new Error("Failed to update media record");
    }

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "media.replace",
      targetType: "media",
      targetId: input.id,
      diff: {
        oldKey: oldStorageKey,
        newKey: input.storageKey,
        oldBytes: Number(existing.bytes),
        newBytes: realBytes,
      },
    });

    const url = (await resolvePublicMediaUrl(db, updated.storageKey, updated.storageConnectionId)) || "";
    const thumbnailUrl = buildThumbnailUrl(updated, url);

    const usagesMap = await resolveMediaUsageLabels(tx, ctx.tenantId, [updated.id]);
    const usages = usagesMap.get(updated.id) || [];

    return {
      id: updated.id,
      kind: updated.kind as MediaKind,
      mime: updated.mime,
      filename: updated.filename,
      title: updated.title,
      alt: updated.alt,
      caption: updated.caption,
      bytes: Number(updated.bytes),
      width: updated.width,
      height: updated.height,
      durationMs: updated.durationMs,
      url,
      thumbnailUrl,
      status: updated.status as "ready" | "trashed",
      trashedAt: updated.trashedAt ? updated.trashedAt.toISOString() : null,
      usageCount: usages.length,
      uploadedBy: updated.uploadedBy,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      storageKey: updated.storageKey,
      storageConnectionId: updated.storageConnectionId,
      cfImageId: updated.cfImageId,
      folder: updated.folder,
      usages,
    };
  });

  // 9. Post-commit: purge old storage object (via job if available, or direct fallback)
  if (rt._jobs) {
    await rt._jobs.send("media.purge", {
      tenantId: ctx.tenantId,
      objects: [{ storageKey: oldStorageKey, storageConnectionId: oldConnectionId }],
    });
  } else {
    await purgeMediaObjects(db, {
      tenantId: ctx.tenantId,
      objects: [{ storageKey: oldStorageKey, storageConnectionId: oldConnectionId }],
    });
  }

  // 10. Post-commit: cache fan-out to owners (S5)
  await invalidateMediaCache(rt, ctx, [input.id]);

  return updatedItem;
}

/**
 * Resolves the public delivery URL for a media asset by ID within a tenant.
 */
export async function resolveMediaUrlById(
  rt: Runtime,
  tenantId: string,
  mediaId: string | null | undefined,
): Promise<string | undefined> {
  if (!mediaId) return undefined;
  const db = rt._db.db;
  return withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({
        id: schema.media.id,
        storageKey: schema.media.storageKey,
        storageConnectionId: schema.media.storageConnectionId,
      })
      .from(schema.media)
      .where(and(eq(schema.media.tenantId, tenantId), eq(schema.media.id, mediaId)))
      .limit(1);

    if (!row) return undefined;
    return resolvePublicMediaUrl(db, row.storageKey, row.storageConnectionId);
  });
}
