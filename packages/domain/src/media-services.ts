import crypto from "node:crypto";
import path from "node:path";
import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import sharp from "sharp";
import { type Db, schema, withTenant } from "@bs/db";
import type { MediaItem, MediaUsageReference, MediaUsageReport } from "@bs/contracts";
import type { Runtime } from "./runtime.ts";
import { assertPermission, type TenantContext } from "./context.ts";
import { invalidateCache } from "./cache-invalidation.ts";
import {
  assertMediaUploadQuota,
  getTenantMediaUsageStats,
} from "./system/quotas.ts";
import {
  getMediaKind,
  isAllowedMime,
  type MediaKind,
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
  resolveStorageConnection,
  type ResolvedStorageConfig,
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

function buildThumbnailUrl(
  r: { kind: string; storageKey: string },
  url: string,
  config?: ResolvedStorageConfig | null,
): string | null {
  if (r.kind !== "image") return null;
  const cdnBase = process.env.CDN_BASE_URL || config?.publicBaseUrl;
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

  let buffer: Buffer;
  let realBytes: number;

  if (params.directBuffer) {
    buffer = Buffer.isBuffer(params.directBuffer)
      ? params.directBuffer
      : Buffer.from(params.directBuffer);
    realBytes = buffer.length;
  } else {
    // 1. HeadObject gives the real size (fixes Q2)
    const head = await driver.head(params.storageKey);
    if (!head.exists) {
      throw new Error(`Uploaded file not found in storage: "${params.storageKey}"`);
    }
    realBytes = head.size ?? 0;
    if (realBytes <= 0) {
      throw new Error("Uploaded file is empty");
    }

    // 2. Read bytes for magic bytes inspection
    const fetched = await driver.get(params.storageKey);
    if (!fetched || fetched.length === 0) {
      throw new Error(`Failed to read uploaded file from storage: "${params.storageKey}"`);
    }
    buffer = fetched;
    realBytes = buffer.length;
  }

  // 3. Magic bytes verification (MEDIA-LIBRARY-PLAN §4)
  const magicResult = verifyMediaMagicBytes(declaredMime, buffer, params.filename);
  if (!magicResult.valid) {
    // Purge the invalid file from storage immediately
    await purgeMediaObjects(rt._db.db, {
      tenantId: ctx.tenantId,
      objects: [{ storageKey: params.storageKey, storageConnectionId: activeConfig.id }],
    }).catch(() => {});
    throw new Error(magicResult.error || "File verification failed: magic bytes mismatch");
  }

  const kind = magicResult.kind || getMediaKind(declaredMime) || "image";

  // 4. Quota check with real size (fixes Q1, Q2, Q3)
  try {
    await assertMediaUploadQuota(rt._db.db, ctx.tenantId, {
      kind,
      bytes: realBytes,
    });
  } catch (quotaErr) {
    // Purge the oversize file from storage
    await purgeMediaObjects(rt._db.db, {
      tenantId: ctx.tenantId,
      objects: [{ storageKey: params.storageKey, storageConnectionId: activeConfig.id }],
    }).catch(() => {});
    throw quotaErr;
  }

  // 5. Image dimensions with sharp
  let width: number | null = null;
  let height: number | null = null;
  if (kind === "image") {
    try {
      const meta = await sharp(buffer).metadata();
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
  }

  // 6. SHA-256 hash
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
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
  const thumbnailUrl = buildThumbnailUrl(row, url, activeConfig);

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
    ];

    if (query?.folder) {
      conditions.push(eq(schema.media.folder, query.folder));
    }

    if (query?.kinds && query.kinds.length > 0) {
      conditions.push(inArray(schema.media.kind, query.kinds));
    }

    if (query?.q && query.q.trim()) {
      const q = query.q.trim();
      const searchCond = or(
        sql`${schema.media.search} @@ websearch_to_tsquery('simple', ${q})`,
        ilike(schema.media.filename, `${q}%`),
        ilike(schema.media.filename, `%${q}%`),
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

    if (query?.offset && !query?.cursor) {
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

    const activeConn = await resolveStorageConnection(db, "public_media");

    const items: MediaItem[] = await Promise.all(
      pageRows.map(async (r) => {
        const url = (await resolvePublicMediaUrl(db, r.storageKey, r.storageConnectionId)) || "";
        const thumbnailUrl = buildThumbnailUrl(r, url, activeConn as ResolvedStorageConfig);
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
      .where(and(eq(schema.media.tenantId, ctx.tenantId), eq(schema.media.id, input.id)))
      .limit(1);

    if (!row) {
      throw new Error(`Media not found: "${input.id}"`);
    }

    // Resolve usage references
    const usageRows = await tx
      .select()
      .from(schema.mediaUsages)
      .where(and(eq(schema.mediaUsages.tenantId, ctx.tenantId), eq(schema.mediaUsages.mediaId, input.id)));

    const usages: MediaUsageReference[] = [];

    // Group owner IDs to resolve labels efficiently in single batch queries
    const productIds = usageRows.filter((u) => u.ownerType === "product").map((u) => u.ownerId);
    const variantIds = usageRows.filter((u) => u.ownerType === "variant").map((u) => u.ownerId);
    const collectionIds = usageRows.filter((u) => u.ownerType === "collection").map((u) => u.ownerId);
    const categoryIds = usageRows.filter((u) => u.ownerType === "category").map((u) => u.ownerId);
    const brandIds = usageRows.filter((u) => u.ownerType === "brand").map((u) => u.ownerId);

    const [productRows, variantRows, collectionRows, categoryRows, brandRows] = await Promise.all([
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
    ]);

    const productMap = new Map(productRows.map((p) => [p.id, p.title]));
    const variantMap = new Map(variantRows.map((v) => [v.id, v]));
    const collectionMap = new Map(collectionRows.map((c) => [c.id, c.title]));
    const categoryMap = new Map(categoryRows.map((c) => [c.id, c.name]));
    const brandMap = new Map(brandRows.map((b) => [b.id, b.name]));

    for (const u of usageRows) {
      if (u.ownerType === "product") {
        usages.push({
          ownerType: "product",
          ownerId: u.ownerId,
          field: u.field,
          label: productMap.get(u.ownerId) || "Product",
          adminPath: `/products/${u.ownerId}`,
        });
      } else if (u.ownerType === "variant") {
        const v = variantMap.get(u.ownerId);
        usages.push({
          ownerType: "variant",
          ownerId: u.ownerId,
          field: u.field,
          label: v ? `${v.productTitle || "Product"} (${v.title || v.sku || "Variant"})` : "Variant",
          adminPath: v ? `/products/${v.productId}` : `/products`,
        });
      } else if (u.ownerType === "collection") {
        usages.push({
          ownerType: "collection",
          ownerId: u.ownerId,
          field: u.field,
          label: collectionMap.get(u.ownerId) || "Collection",
          adminPath: `/collections/${u.ownerId}`,
        });
      } else if (u.ownerType === "category") {
        usages.push({
          ownerType: "category",
          ownerId: u.ownerId,
          field: u.field,
          label: categoryMap.get(u.ownerId) || "Category",
          adminPath: `/categories/${u.ownerId}`,
        });
      } else if (u.ownerType === "brand") {
        usages.push({
          ownerType: "brand",
          ownerId: u.ownerId,
          field: u.field,
          label: brandMap.get(u.ownerId) || "Brand",
          adminPath: `/brands`,
        });
      } else {
        usages.push({
          ownerType: u.ownerType,
          ownerId: u.ownerId,
          field: u.field,
          label: u.ownerType,
          adminPath: `/settings/branding`,
        });
      }
    }

    const activeConn = await resolveStorageConnection(db, "public_media");
    const url = (await resolvePublicMediaUrl(db, row.storageKey, row.storageConnectionId)) || "";
    const thumbnailUrl = buildThumbnailUrl(row, url, activeConn as ResolvedStorageConfig);

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

  const kind = getMediaKind(normMime) || "image";

  // Enforce upload quotas (per-kind + storage limit)
  await assertMediaUploadQuota(rt._db.db, ctx.tenantId, {
    kind,
    bytes: input.bytes,
  });

  const { driver } = await getActiveStorageDriver(rt._db.db, "public_media");

  return await driver.presignUpload({
    tenantId: ctx.tenantId,
    folder: input.folder ?? "products",
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
  return await finalizeUpload(rt, ctx, {
    storageKey: input.storageKey,
    declaredMime: input.mime,
    declaredBytes: input.bytes,
    filename: input.filename,
    title: input.title,
    alt: input.alt,
    caption: input.caption,
    folder: input.folder,
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

  const kind = getMediaKind(normMime) || "image";
  await assertMediaUploadQuota(rt._db.db, ctx.tenantId, {
    kind,
    bytes: input.fileBytes.length,
  });

  const { driver } = await getActiveStorageDriver(rt._db.db, "public_media");
  const { storageKey } = generateStorageKey(
    ctx.tenantId,
    input.folder || "products",
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
    folder: input.folder,
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

  const row = await withTenant(db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.media)
      .where(and(eq(schema.media.tenantId, ctx.tenantId), eq(schema.media.id, input.id)))
      .limit(1);

    if (!existing) {
      throw new Error(`Media not found: "${input.id}"`);
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
      .where(and(eq(schema.media.tenantId, ctx.tenantId), eq(schema.media.id, input.id)))
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

    return updated;
  });

  await invalidateCache(rt, ctx, { type: "media_updated" });

  const activeConn = await resolveStorageConnection(db, "public_media");
  const url = (await resolvePublicMediaUrl(db, row.storageKey, row.storageConnectionId)) || "";
  const thumbnailUrl = buildThumbnailUrl(row, url, activeConn as ResolvedStorageConfig);

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
        ),
      )
      .returning({ id: schema.media.id });

    if (updated.length > 0) {
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: ctx.actor.type,
        actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
        action: "media.trash",
        targetType: "media",
        targetId: updated[0]!.id,
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

  await invalidateCache(rt, ctx, { type: "media_updated" });
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
        ),
      )
      .returning({ id: schema.media.id });

    if (updated.length > 0) {
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: ctx.actor.type,
        actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
        action: "media.restore",
        targetType: "media",
        targetId: updated[0]!.id,
        diff: {
          restoredIds: updated.map((r) => r.id),
          restoredCount: updated.length,
        },
      });
    }

    return { restored: updated.length };
  });

  await invalidateCache(rt, ctx, { type: "media_updated" });
  return result;
}

/**
 * Permanently deletes trashed media files. Refuses items that still have usages (fixes L2).
 * Enqueues storage purge in the same business transaction (fixes L3, rule 13).
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
    // 1. Fetch target items (must be trashed)
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
        ),
      );

    if (targetRows.length === 0) {
      return { deleted: 0, blocked: [] };
    }

    const targetRowIds = targetRows.map((r) => r.id);

    // 2. Fetch usages for all target rows
    const usageRows = await tx
      .select()
      .from(schema.mediaUsages)
      .where(
        and(
          eq(schema.mediaUsages.tenantId, ctx.tenantId),
          inArray(schema.mediaUsages.mediaId, targetRowIds),
        ),
      );

    const blockedMap = new Map<string, typeof usageRows>();
    for (const u of usageRows) {
      const arr = blockedMap.get(u.mediaId) || [];
      arr.push(u);
      blockedMap.set(u.mediaId, arr);
    }

    const blocked: { id: string; usages: MediaUsageReference[] }[] = [];
    const allowedRows = targetRows.filter((r) => !blockedMap.has(r.id));

    // Resolve labels for blocked items
    if (usageRows.length > 0) {
      const productIds = usageRows.filter((u) => u.ownerType === "product").map((u) => u.ownerId);
      const [products] = await Promise.all([
        productIds.length > 0
          ? tx.select({ id: schema.products.id, title: schema.products.title }).from(schema.products).where(inArray(schema.products.id, productIds))
          : [],
      ]);
      const productMap = new Map(products.map((p) => [p.id, p.title]));

      for (const [mediaId, uList] of blockedMap.entries()) {
        blocked.push({
          id: mediaId,
          usages: uList.map((u) => ({
            ownerType: u.ownerType,
            ownerId: u.ownerId,
            field: u.field,
            label: productMap.get(u.ownerId) || u.ownerType,
            adminPath: u.ownerType === "product" ? `/products/${u.ownerId}` : "#",
          })),
        });
      }
    }

    if (allowedRows.length === 0) {
      return { deleted: 0, blocked };
    }

    const allowedIds = allowedRows.map((r) => r.id);

    // 3. Delete from database
    await tx
      .delete(schema.media)
      .where(and(eq(schema.media.tenantId, ctx.tenantId), inArray(schema.media.id, allowedIds)));

    // 4. Write audit log
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "media.delete",
      targetType: "media",
      targetId: allowedIds[0]!,
      diff: {
        deletedIds: allowedIds,
        deletedCount: allowedIds.length,
      },
    });

    const objectsToPurge = allowedRows.map((r) => ({
      storageKey: r.storageKey,
      storageConnectionId: r.storageConnectionId,
    }));

    // 5. Enqueue media.purge job inside business transaction or dispatch directly
    if (rt._jobs) {
      await rt._jobs.send("media.purge", {
        tenantId: ctx.tenantId,
        objects: objectsToPurge,
      });
    } else {
      await purgeMediaObjects(tx, {
        tenantId: ctx.tenantId,
        objects: objectsToPurge,
      }).catch((err) => {
        console.error("[storage] Direct purge error:", err);
      });
    }

    return { deleted: allowedIds.length, blocked };
  });

  await invalidateCache(rt, ctx, { type: "media_updated" });
  return result;
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
 * Domain helper to keep media_usages synchronized for an owner and field (MEDIA-LIBRARY-PLAN §5.2).
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
 * Trash sweep job: permanently deletes items trashed > 30 days ago that have NO usages (MEDIA-LIBRARY-PLAN §8).
 */
export async function runMediaTrashSweep(
  db: Db,
  tenantId?: string,
): Promise<{ sweptTenants: number; deletedCount: number }> {
  // Find candidates across tenants (or single tenant)
  const conditions = [
    sql`m.status = 'trashed'`,
    sql`m.trashed_at < (now() - INTERVAL '30 days')`,
    sql`NOT EXISTS (
      SELECT 1 FROM media_usages mu
      WHERE mu.tenant_id = m.tenant_id AND mu.media_id = m.id
    )`,
  ];

  if (tenantId) {
    conditions.push(sql`m.tenant_id = ${tenantId}`);
  }

  const query = sql`
    SELECT id, tenant_id, storage_key, storage_connection_id
    FROM media m
    WHERE ${sql.join(conditions, sql` AND `)}
  `;

  interface SweepCandidateRow {
    id: string;
    tenant_id: string;
    storage_key: string;
    storage_connection_id: string | null;
  }

  const candidatesRes = (await db.execute(query)) as unknown as {
    rows?: SweepCandidateRow[];
  };

  const rawRows = Array.isArray(candidatesRes) ? candidatesRes : (candidatesRes?.rows ?? []);
  const candidates = rawRows as SweepCandidateRow[];
  if (candidates.length === 0) {
    return { sweptTenants: 0, deletedCount: 0 };
  }

  // Group by tenant
  const byTenant = new Map<string, SweepCandidateRow[]>();
  for (const c of candidates) {
    const list = byTenant.get(c.tenant_id) || [];
    list.push(c);
    byTenant.set(c.tenant_id, list);
  }

  let totalDeleted = 0;

  for (const [tId, rows] of byTenant.entries()) {
    const rowIds = rows.map((r: SweepCandidateRow) => r.id);
    const objects = rows.map((r: SweepCandidateRow) => ({
      storageKey: r.storage_key,
      storageConnectionId: r.storage_connection_id,
    }));

    await withTenant(db, tId, async (tx) => {
      await tx.delete(schema.media).where(inArray(schema.media.id, rowIds));

      await tx.insert(schema.auditLogs).values({
        tenantId: tId,
        actorType: "system",
        actorId: "00000000-0000-0000-0000-000000000000",
        action: "media.trash_sweep",
        targetType: "media",
        targetId: rowIds[0]!,
        diff: {
          deletedCount: rowIds.length,
          deletedIds: rowIds,
        },
      });

      await purgeMediaObjects(tx, { tenantId: tId, objects });
    });

    totalDeleted += rowIds.length;
  }

  return { sweptTenants: byTenant.size, deletedCount: totalDeleted };
}

/**
 * Attaches an uploaded library image to a product and syncs media_usages (MEDIA-LIBRARY-PLAN §5.2).
 */
export async function attachProductMedia(
  rt: Runtime,
  ctx: TenantContext,
  input: { productId: string; mediaId: string; alt?: string | undefined },
) {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  const link = await withTenant(db, ctx.tenantId, async (tx) => {
    const [product] = await tx.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.id, input.productId)).limit(1);
    if (!product) throw new Error("Not Found: product not found");
    const [asset] = await tx.select({ id: schema.media.id, storageKey: schema.media.storageKey }).from(schema.media).where(eq(schema.media.id, input.mediaId)).limit(1);
    if (!asset) throw new Error("Not Found: image not found in the media library");

    const existing = await tx
      .select()
      .from(schema.productMedia)
      .where(and(eq(schema.productMedia.productId, input.productId), eq(schema.productMedia.mediaId, input.mediaId)))
      .limit(1);
    if (existing[0]) {
      return { id: existing[0].id, position: existing[0].position, storageKey: asset.storageKey };
    }

    const all = await tx
      .select({ position: schema.productMedia.position })
      .from(schema.productMedia)
      .where(eq(schema.productMedia.productId, input.productId));
    const position = all.length === 0 ? 0 : Math.max(...all.map((r) => r.position)) + 1;

    const [row] = await tx
      .insert(schema.productMedia)
      .values({ tenantId: ctx.tenantId, productId: input.productId, mediaId: input.mediaId, position, alt: input.alt ?? null })
      .returning();
    if (!row) throw new Error("Failed to attach image");

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
 * Removes an image from a product and syncs media_usages (MEDIA-LIBRARY-PLAN §5.2).
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
    if (deleted.length === 0) throw new Error("Not Found: image is not attached to this product");

    const rest = await tx
      .select({ id: schema.productMedia.id, mediaId: schema.productMedia.mediaId })
      .from(schema.productMedia)
      .where(eq(schema.productMedia.productId, input.productId))
      .orderBy(schema.productMedia.position);

    for (let i = 0; i < rest.length; i++) {
      const row = rest[i];
      if (row) await tx.update(schema.productMedia).set({ position: i, updatedAt: new Date() }).where(eq(schema.productMedia.id, row.id));
    }

    // Sync media usages for this product gallery
    await syncMediaUsages(tx, ctx, {
      ownerType: "product",
      ownerId: input.productId,
      field: "gallery",
      mediaIds: rest.map((l) => l.mediaId),
    });
  });

  await invalidateCache(rt, ctx, { type: "product_image_updated", productId: input.productId });
  return { success: true };
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
