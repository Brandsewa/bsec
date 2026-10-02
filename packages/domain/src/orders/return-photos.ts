import { createHash } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";
import {
  buildPresignedUploadDescriptor,
  getR2Config,
  createR2Client,
  buildPresignedDownloadUrl,
  type R2ClientConfig,
} from "../media/storage.ts";
import { checkRateLimit, RateLimitExceededError } from "../system/rate-limit.ts";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

export const ALLOWED_RETURN_PHOTO_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const MAX_RETURN_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_RETURN_PHOTOS_COUNT = 5;

/**
 * Where return photos live. They are customer evidence (often showing a home or a person), so they
 * must never sit in the public media bucket: `R2_PUBLIC_URL` serves that bucket whole, and a key
 * leaked in any signed link would then be readable by anyone, forever. They go in a separate
 * **private** bucket (`R2_PRIVATE_BUCKET_NAME`, no public address) and are read only through
 * short-lived signed URLs. Returns null (feature unavailable) when none is configured, or when it
 * is the same bucket as the public media bucket.
 */
export function getReturnPhotoStorageConfig(
  override?: Partial<R2ClientConfig>,
): Partial<R2ClientConfig> | null {
  const bucketName = override?.bucketName || process.env.R2_PRIVATE_BUCKET_NAME;
  if (!bucketName) return null;
  const publicBucket = process.env.R2_BUCKET_NAME || "bsec-media";
  if (!override?.bucketName && bucketName === publicBucket) return null;
  return { ...override, bucketName, publicUrl: undefined };
}

/** True when customers can attach photos (a private bucket is configured). */
export function isReturnPhotoStorageConfigured(): boolean {
  return getReturnPhotoStorageConfig() !== null;
}

/** Magic byte verification for JPEG, PNG, and WebP */
export function verifyImageMagicBytes(buffer: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  // WebP: RIFF .... WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

/**
 * Resolves orderId from an order guest view action token.
 */
export async function resolveOrderIdFromToken(
  db: Db,
  tenantId: string,
  token: string,
): Promise<string | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const tokenHash = createHash("sha256").update(trimmed).digest("hex");

  const [t] = await db
    .select({ targetId: schema.actionTokens.targetId })
    .from(schema.actionTokens)
    .where(
      and(
        eq(schema.actionTokens.tenantId, tenantId),
        eq(schema.actionTokens.purpose, "order_view"),
        eq(schema.actionTokens.tokenHash, tokenHash),
        gt(schema.actionTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return t?.targetId ?? null;
}

/**
 * Checks per-order and per-IP rate limits for photo uploads.
 * Limit: 20 uploads per hour per order, 30 per hour per IP.
 */
export async function checkReturnPhotoRateLimit(
  db: Db,
  tenantId: string,
  orderId: string,
  clientIp?: string | undefined,
): Promise<void> {
  const orderKey = `return_photo:order:${tenantId}:${orderId}`;
  const orderRes = await checkRateLimit(db, {
    key: orderKey,
    limit: 20,
    windowSeconds: 3600,
  });

  if (!orderRes.allowed) {
    throw new RateLimitExceededError(
      "Too many photo upload attempts for this order. Please try again later.",
      orderRes.retryAfter,
      orderRes.limit,
      orderKey,
    );
  }

  if (clientIp && clientIp.trim()) {
    const ipKey = `return_photo:ip:${tenantId}:${clientIp.trim()}`;
    const ipRes = await checkRateLimit(db, {
      key: ipKey,
      limit: 30,
      windowSeconds: 3600,
    });
    if (!ipRes.allowed) {
      throw new RateLimitExceededError(
        "Too many photo upload attempts. Please try again later.",
        ipRes.retryAfter,
        ipRes.limit,
        ipKey,
      );
    }
  }
}

export interface PresignedReturnPhotoInput {
  orderId: string;
  filename: string;
  mime: string;
  bytes: number;
  s3Client?: S3Client | undefined;
  r2Config?: Partial<R2ClientConfig> | undefined;
}

export interface PresignedReturnPhotoResult {
  mediaId: string;
  uploadUrl: string;
  storageKey: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
}

/**
 * Creates a presigned upload URL for a customer return photo.
 * Stores strictly under `tenants/<tenantId>/returns/<orderId>/<mediaId>.<ext>`.
 */
export async function createPresignedReturnPhotoUpload(
  rt: Runtime,
  ctx: TenantContext,
  input: PresignedReturnPhotoInput,
): Promise<PresignedReturnPhotoResult> {
  const mime = input.mime.toLowerCase().trim();
  if (!ALLOWED_RETURN_PHOTO_MIMES.includes(mime as (typeof ALLOWED_RETURN_PHOTO_MIMES)[number])) {
    throw new Error(`Bad Request: Unsupported file format "${input.mime}". Only JPEG, PNG, and WebP images are allowed.`);
  }

  if (input.bytes <= 0 || input.bytes > MAX_RETURN_PHOTO_BYTES) {
    throw new Error("Bad Request: Photo size must be between 1 byte and 5 MB.");
  }

  // Verify the order exists in this tenant
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [order] = await tx
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(and(eq(schema.orders.tenantId, ctx.tenantId), eq(schema.orders.id, input.orderId)))
      .limit(1);
    if (!order) {
      throw new Error("Not Found: Order not found");
    }
  });

  const mediaId = crypto.randomUUID();
  const folder = `returns/${input.orderId}`;
  // The extension comes from the validated content type, never from the client's filename, so the
  // key always matches what finalize expects (a filename with no dot used to yield mismatched keys).
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";

  const storageCfg = getReturnPhotoStorageConfig(input.r2Config);
  if (!storageCfg) {
    throw new Error("Bad Request: Photo uploads are not available for this store yet.");
  }

  const descriptor = await buildPresignedUploadDescriptor({
    tenantId: `tenants/${ctx.tenantId}`,
    folder,
    filename: `photo.${ext}`,
    mime,
    bytes: input.bytes,
    id: mediaId,
    expiresInSeconds: 900,
    s3Client: input.s3Client,
    r2Config: storageCfg,
  });

  return {
    mediaId,
    uploadUrl: descriptor.uploadUrl,
    storageKey: descriptor.storageKey,
    headers: descriptor.headers,
    expiresInSeconds: descriptor.expiresInSeconds,
  };
}

export interface FinalizeReturnPhotoInput {
  orderId: string;
  mediaId: string;
  storageKey: string;
  s3Client?: S3Client | undefined;
  r2Config?: Partial<R2ClientConfig> | undefined;
}

/**
 * Finalizes an uploaded return photo.
 * Fails closed:
 *  - Verifies key strictly belongs to `tenants/<tenantId>/returns/<orderId>/<mediaId>.<ext>`
 *  - Looks up the real object in R2 (HeadObject & GetObject range bytes=0-31)
 *  - Reads size and MIME strictly from storage and magic bytes, never trusting the client
 *  - Inserts the verified media row
 */
export async function finalizeReturnPhoto(
  rt: Runtime,
  ctx: TenantContext,
  input: FinalizeReturnPhotoInput,
): Promise<{ id: string; storageKey: string; mime: string; bytes: number }> {
  const expectedPrefix = `tenants/${ctx.tenantId}/returns/${input.orderId}/${input.mediaId}.`;
  if (!input.storageKey.startsWith(expectedPrefix)) {
    throw new Error("Bad Request: Storage key does not match the expected tenant, order, and media ID structure.");
  }

  const ext = input.storageKey.slice(expectedPrefix.length).toLowerCase();
  if (!["jpg", "jpeg", "png", "webp"].includes(ext)) {
    throw new Error("Bad Request: Invalid file extension in storage key.");
  }

  // Verify order exists
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [order] = await tx
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(and(eq(schema.orders.tenantId, ctx.tenantId), eq(schema.orders.id, input.orderId)))
      .limit(1);
    if (!order) {
      throw new Error("Not Found: Order not found");
    }
  });

  const storageCfg = getReturnPhotoStorageConfig(input.r2Config);
  if (!storageCfg) {
    throw new Error("Bad Request: Photo uploads are not available for this store yet.");
  }
  const cfg = getR2Config(storageCfg);
  const s3 = input.s3Client ?? (cfg.accessKeyId && cfg.secretAccessKey ? createR2Client(storageCfg) : null);

  if (!s3 || !cfg.bucketName) {
    throw new Error("Bad Request: Storage service is not configured.");
  }

  let realBytes = 0;
  let detectedMime: "image/jpeg" | "image/png" | "image/webp" | null = null;

  try {
    // 1. HeadObject for real size
    const head = await s3.send(
      new HeadObjectCommand({
        Bucket: cfg.bucketName,
        Key: input.storageKey,
      }),
    );

    realBytes = head.ContentLength ?? 0;
    if (realBytes <= 0 || realBytes > MAX_RETURN_PHOTO_BYTES) {
      throw new Error(`Bad Request: Photo size (${realBytes} bytes) must be between 1 byte and 5 MB.`);
    }

    // 2. GetObject first 32 bytes for magic bytes inspection
    const getCmd = new GetObjectCommand({
      Bucket: cfg.bucketName,
      Key: input.storageKey,
      Range: "bytes=0-31",
    });
    const res = await s3.send(getCmd);
    if (!res.Body) {
      throw new Error("Bad Request: Empty response body from storage.");
    }

    const streamBytes = await res.Body.transformToByteArray();
    detectedMime = verifyImageMagicBytes(streamBytes);
    if (!detectedMime) {
      throw new Error("Bad Request: Invalid or corrupted image format. Only valid JPEG, PNG, or WebP files are allowed.");
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith("Bad Request:")) throw err;
    throw new Error(
      `Bad Request: Uploaded file not found in storage or failed verification: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  return await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [created] = await tx
      .insert(schema.media)
      .values({
        id: input.mediaId,
        tenantId: ctx.tenantId,
        storageKey: input.storageKey,
        mime: detectedMime,
        bytes: realBytes,
        folder: "returns",
      })
      .returning({
        id: schema.media.id,
        storageKey: schema.media.storageKey,
        mime: schema.media.mime,
        bytes: schema.media.bytes,
      });

    if (!created) throw new Error("Failed to finalize return photo");
    return created;
  });
}

/**
 * Generates short-lived signed download URLs for private return photo media IDs.
 */
export async function getReturnPhotoUrls(
  db: Db,
  tenantId: string,
  photoIds: string[],
  opts?: { s3Client?: S3Client | undefined; r2Config?: Partial<R2ClientConfig> | undefined },
): Promise<Array<{ id: string; url: string; filename: string }>> {
  if (photoIds.length === 0) return [];
  const storageCfg = getReturnPhotoStorageConfig(opts?.r2Config);
  if (!storageCfg) return [];

  const mediaRows = await db
    .select({ id: schema.media.id, storageKey: schema.media.storageKey })
    .from(schema.media)
    .where(and(eq(schema.media.tenantId, tenantId), sql`${schema.media.id} = ANY(${photoIds}::uuid[])`));

  const out: Array<{ id: string; url: string; filename: string }> = [];
  for (const m of mediaRows) {
    const url = await buildPresignedDownloadUrl({
      storageKey: m.storageKey,
      expiresInSeconds: 900,
      s3Client: opts?.s3Client,
      r2Config: storageCfg,
    });
    const filename = m.storageKey.split("/").pop() ?? "photo.jpg";
    out.push({ id: m.id, url, filename });
  }
  return out;
}

/**
 * Cleans up unattached return photos older than 24 hours. Idempotent.
 *
 * Runs per tenant inside `withTenant`: `media` and `returns` are protected by row level
 * security, and the worker connects as `app_rw`, so a query with no tenant context would see no
 * rows at all. The stored file is deleted first; if that fails (or no storage client is
 * available) the record is kept so the next run retries, instead of orphaning the file for good.
 */
export async function cleanupOrphanedReturnPhotos(
  db: Db,
  opts?: { s3Client?: S3Client | undefined; r2Config?: Partial<R2ClientConfig> | undefined } | S3Client,
): Promise<{ deletedCount: number }> {
  const s3ClientInput = opts && "send" in opts ? opts : (opts as { s3Client?: S3Client } | undefined)?.s3Client;
  const r2ConfigInput = opts && !("send" in opts) ? (opts as { r2Config?: Partial<R2ClientConfig> })?.r2Config : undefined;
  const storageCfg = getReturnPhotoStorageConfig(r2ConfigInput);
  if (!storageCfg) return { deletedCount: 0 };
  const cfg = getR2Config(storageCfg);
  const s3 = s3ClientInput ?? (cfg.accessKeyId && cfg.secretAccessKey ? createR2Client(storageCfg) : null);
  if (!s3 || !cfg.bucketName) return { deletedCount: 0 };

  const tenants = await db.select({ id: schema.tenants.id }).from(schema.tenants);
  let deletedCount = 0;

  for (const t of tenants) {
    const rows = await withTenant(db, t.id, async (tx) => {
      const res = await tx.execute(sql`
        SELECT m.id, m.storage_key AS "storageKey"
        FROM media m
        WHERE m.tenant_id = ${t.id}
          AND m.folder = 'returns'
          AND m.created_at < now() - interval '24 hours'
          AND NOT EXISTS (
            SELECT 1 FROM returns r
            WHERE r.tenant_id = m.tenant_id
              AND m.id = ANY(r.photos)
          )
      `);
      return (res.rows ?? []) as Array<{ id: string; storageKey: string }>;
    });

    for (const row of rows) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: cfg.bucketName, Key: row.storageKey }));
      } catch {
        continue; // keep the record; the next run retries
      }
      await withTenant(db, t.id, async (tx) => {
        await tx.delete(schema.media).where(and(eq(schema.media.tenantId, t.id), eq(schema.media.id, row.id)));
      });
      deletedCount += 1;
    }
  }

  return { deletedCount };
}
