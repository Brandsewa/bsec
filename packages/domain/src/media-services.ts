import { and, desc, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "./runtime.ts";
import { assertPermission, type TenantContext } from "./context.ts";
import { invalidateCache } from "./cache-invalidation.ts";
import {
  publicMediaUrl,
  validateMediaUpload,
} from "./media/storage.ts";
import {
  getActiveStorageDriver,
  resolvePublicMediaUrl,
  resolveStorageConnection,
} from "./media/connection.ts";

export { uploadMediaDirect } from "./media/connection.ts";

export interface ListMediaQuery {
  folder?: string | undefined;
  limit?: number | undefined;
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
  width?: number | undefined;
  height?: number | undefined;
  alt?: string | undefined;
  folder?: string | undefined;
  cfImageId?: string | undefined;
}

/**
 * List media assets within current tenant.
 */
export async function listMedia(
  rt: Runtime,
  ctx: TenantContext,
  query?: ListMediaQuery,
) {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const limit = query?.limit ?? 50;
    const offset = query?.offset ?? 0;

    const rows = await tx
      .select()
      .from(schema.media)
      .where(query?.folder ? eq(schema.media.folder, query.folder) : undefined)
      .orderBy(desc(schema.media.createdAt))
      .limit(limit)
      .offset(offset);

    const items = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        storageKey: r.storageKey,
        storageConnectionId: r.storageConnectionId ?? undefined,
        cfImageId: r.cfImageId,
        mime: r.mime,
        bytes: Number(r.bytes),
        width: r.width,
        height: r.height,
        alt: r.alt,
        folder: r.folder,
        createdAt: r.createdAt.toISOString(),
        url: await resolvePublicMediaUrl(db, r.storageKey, r.storageConnectionId),
      })),
    );

    return {
      items,
      total: rows.length,
    };
  });
}

/**
 * Generates an upload presigned descriptor after validating MIME and size.
 */
export async function requestMediaUpload(
  rt: Runtime,
  ctx: TenantContext,
  input: RequestUploadInput,
) {
  assertPermission(ctx, "content.write");

  const validation = validateMediaUpload(input.mime, input.bytes);
  if (!validation.valid) {
    throw new Error(validation.error || "Invalid media upload");
  }

  const { driver } = await getActiveStorageDriver(rt._db.db, "public_media");

  return await driver.presignUpload({
    tenantId: ctx.tenantId,
    folder: input.folder ?? "products",
    filename: input.filename,
    mime: input.mime,
    bytes: input.bytes,
  });
}

/**
 * Creates a media database record after upload completes.
 */
export async function createMediaRecord(
  rt: Runtime,
  ctx: TenantContext,
  input: CreateMediaInput,
) {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;

  const activeConn = await resolveStorageConnection(db, "public_media");

  const row = await withTenant(db, ctx.tenantId, async (tx) => {
    const [inserted] = await tx
      .insert(schema.media)
      .values({
        tenantId: ctx.tenantId,
        storageKey: input.storageKey,
        storageConnectionId: activeConn?.id ?? null,
        mime: input.mime,
        bytes: input.bytes,
        width: input.width,
        height: input.height,
        alt: input.alt,
        folder: input.folder ?? "products",
        cfImageId: input.cfImageId,
      })
      .returning();

    if (!inserted) throw new Error("Failed to save media record");
    return inserted;
  });

  await invalidateCache(rt, ctx, { type: "media_updated" });

  const url = await resolvePublicMediaUrl(db, row.storageKey, row.storageConnectionId);

  return {
    id: row.id,
    storageKey: row.storageKey,
    storageConnectionId: row.storageConnectionId ?? undefined,
    cfImageId: row.cfImageId,
    mime: row.mime,
    bytes: Number(row.bytes),
    width: row.width,
    height: row.height,
    alt: row.alt,
    folder: row.folder,
    createdAt: row.createdAt.toISOString(),
    url,
  };
}

/**
 * Deletes a media asset record by ID.
 */
export async function deleteMediaRecord(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string },
) {
  assertPermission(ctx, "content.write");
  const db = rt._db.db;

  await withTenant(db, ctx.tenantId, async (tx) => {
    const existing = await tx
      .select()
      .from(schema.media)
      .where(eq(schema.media.id, input.id))
      .limit(1);

    if (existing[0]) {
      try {
        const { driver } = await getActiveStorageDriver(db, "public_media");
        await driver.delete(existing[0].storageKey);
      } catch {
        // If driver delete fails (e.g. file already gone), proceed with row deletion
      }
    }

    await tx.delete(schema.media).where(eq(schema.media.id, input.id));
  });

  await invalidateCache(rt, ctx, { type: "media_updated" });
  return { success: true };
}

/**
 * Attaches an uploaded library image to a product. The first image becomes the primary one (position 0).
 * Attaching the same image twice returns the existing link.
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
    return { id: row.id, position: row.position, storageKey: asset.storageKey };
  });

  await invalidateCache(rt, ctx, { type: "product_image_updated", productId: input.productId });
  return { id: link.id, position: link.position, isPrimary: link.position === 0, url: publicMediaUrl(link.storageKey) };
}

/** Removes an image from a product (the file stays in the media library) and keeps the remaining order gap-free. */
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
      .select({ id: schema.productMedia.id })
      .from(schema.productMedia)
      .where(eq(schema.productMedia.productId, input.productId))
      .orderBy(schema.productMedia.position);
    for (let i = 0; i < rest.length; i++) {
      const row = rest[i];
      if (row) await tx.update(schema.productMedia).set({ position: i, updatedAt: new Date() }).where(eq(schema.productMedia.id, row.id));
    }
  });

  await invalidateCache(rt, ctx, { type: "product_image_updated", productId: input.productId });
  return { success: true };
}
