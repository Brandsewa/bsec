import { desc, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "./runtime.ts";
import { assertPermission, type TenantContext } from "./context.ts";
import {
  buildPresignedUploadDescriptor,
  validateMediaUpload,
} from "./media/storage.ts";

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

    return {
      items: rows.map((r) => ({
        id: r.id,
        storageKey: r.storageKey,
        cfImageId: r.cfImageId,
        mime: r.mime,
        bytes: Number(r.bytes),
        width: r.width,
        height: r.height,
        alt: r.alt,
        folder: r.folder,
        createdAt: r.createdAt.toISOString(),
      })),
      total: rows.length,
    };
  });
}

/**
 * Generates an upload presigned descriptor after validating MIME and size.
 */
export async function requestMediaUpload(
  _rt: Runtime,
  ctx: TenantContext,
  input: RequestUploadInput,
) {
  assertPermission(ctx, "content.write");

  const validation = validateMediaUpload(input.mime, input.bytes);
  if (!validation.valid) {
    throw new Error(validation.error || "Invalid media upload");
  }

  // Generate upload descriptor
  const bucketBaseUrl = process.env.R2_PUBLIC_URL || "https://r2.bscommerce.in/uploads";
  return buildPresignedUploadDescriptor({
    bucketBaseUrl,
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

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .insert(schema.media)
      .values({
        tenantId: ctx.tenantId,
        storageKey: input.storageKey,
        mime: input.mime,
        bytes: input.bytes,
        width: input.width,
        height: input.height,
        alt: input.alt,
        folder: input.folder ?? "products",
        cfImageId: input.cfImageId,
      })
      .returning();

    if (!row) throw new Error("Failed to save media record");

    return {
      id: row.id,
      storageKey: row.storageKey,
      cfImageId: row.cfImageId,
      mime: row.mime,
      bytes: Number(row.bytes),
      width: row.width,
      height: row.height,
      alt: row.alt,
      folder: row.folder,
      createdAt: row.createdAt.toISOString(),
    };
  });
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

  return withTenant(db, ctx.tenantId, async (tx) => {
    await tx.delete(schema.media).where(eq(schema.media.id, input.id));
    return { success: true };
  });
}
