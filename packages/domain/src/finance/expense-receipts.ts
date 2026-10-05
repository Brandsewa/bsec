/**
 * Expense Receipts Presigned Upload and Verification (docs/FINANCE-PLAN.md §3.7).
 *
 * Pattern:
 * 1. Presigned PUT to private bucket: `tenants/<tenantId>/expense-receipts/<mediaId>.<ext>`
 * 2. Finalize verifies magic bytes (pdf/png/jpeg/webp only, <= 5 MB), stores a `media` row.
 * 3. 15-minute signed URL through dedicated route or helper.
 */

import { and, eq } from "drizzle-orm";
import { schema, withTenant, type DbHandle } from "@bs/db";
import { assertPermission, type TenantContext } from "../context.ts";
import {
  buildPresignedUploadDescriptor,
  getR2Config,
  createR2Client,
  buildPresignedDownloadUrl,
  type R2ClientConfig,
} from "../media/storage.ts";
import {
  HeadObjectCommand,
  GetObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

export const ALLOWED_RECEIPT_MIMES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024; // 5 MB

export function getReceiptStorageConfig(
  override?: Partial<R2ClientConfig>,
): Partial<R2ClientConfig> | null {
  const bucketName = override?.bucketName || process.env.R2_PRIVATE_BUCKET_NAME || process.env.R2_BUCKET_NAME || "bsec-media";
  return { ...override, bucketName, publicUrl: undefined };
}

export function verifyReceiptMagicBytes(
  buffer: Uint8Array,
): "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | null {
  if (buffer.length < 4) return null;

  // PDF: %PDF (25 50 44 46)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return "application/pdf";
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
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
    buffer.length >= 12 &&
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

export async function createPresignedExpenseReceiptUpload(
  ctx: TenantContext,
  input: {
    fileName: string;
    contentType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
    sizeBytes: number;
    s3Client?: S3Client;
    r2Config?: Partial<R2ClientConfig>;
  },
) {
  assertPermission(ctx, "finance.write");

  if (!ALLOWED_RECEIPT_MIMES.includes(input.contentType)) {
    throw new Error(`Bad Request: Unsupported content type "${input.contentType}". Only PDF, JPEG, PNG, and WebP are allowed.`);
  }

  if (input.sizeBytes <= 0 || input.sizeBytes > MAX_RECEIPT_BYTES) {
    throw new Error("Bad Request: Receipt file size must be between 1 byte and 5 MB.");
  }

  const mediaId = crypto.randomUUID();
  const ext =
    input.contentType === "application/pdf"
      ? "pdf"
      : input.contentType === "image/png"
        ? "png"
        : input.contentType === "image/webp"
          ? "webp"
          : "jpg";

  const folder = `expense-receipts`;
  const storageCfg = getReceiptStorageConfig(input.r2Config);
  if (!storageCfg) {
    throw new Error("Bad Request: Storage service is not configured.");
  }

  const descriptor = await buildPresignedUploadDescriptor({
    tenantId: `tenants/${ctx.tenantId}`,
    folder,
    filename: `${mediaId}.${ext}`,
    mime: input.contentType,
    bytes: input.sizeBytes,
    id: mediaId,
    expiresInSeconds: 900, // 15 mins
    s3Client: input.s3Client,
    r2Config: storageCfg,
  });

  return {
    uploadUrl: descriptor.uploadUrl,
    key: descriptor.storageKey,
    mediaId,
  };
}

export async function finalizeExpenseReceipt(
  dbRw: DbHandle,
  ctx: TenantContext,
  input: {
    mediaId: string;
    key: string;
    s3Client?: S3Client;
    r2Config?: Partial<R2ClientConfig>;
  },
) {
  assertPermission(ctx, "finance.write");

  const expectedPrefix = `tenants/${ctx.tenantId}/expense-receipts/${input.mediaId}.`;
  if (!input.key.startsWith(expectedPrefix)) {
    throw new Error("Bad Request: Storage key does not match the expected tenant and media ID structure.");
  }

  const storageCfg = getReceiptStorageConfig(input.r2Config);
  if (!storageCfg) {
    throw new Error("Bad Request: Storage service is not configured.");
  }

  const cfg = getR2Config(storageCfg);
  const s3 = input.s3Client ?? (cfg.accessKeyId && cfg.secretAccessKey ? createR2Client(storageCfg) : null);

  let realBytes = 0;
  let detectedMime: "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | null = null;

  if (s3 && cfg.bucketName) {
    const head = await s3.send(
      new HeadObjectCommand({
        Bucket: cfg.bucketName,
        Key: input.key,
      }),
    );

    realBytes = head.ContentLength ?? 0;
    if (realBytes <= 0 || realBytes > MAX_RECEIPT_BYTES) {
      throw new Error(`Bad Request: File size (${realBytes} bytes) exceeds the 5 MB limit.`);
    }

    const getCmd = new GetObjectCommand({
      Bucket: cfg.bucketName,
      Key: input.key,
      Range: "bytes=0-31",
    });
    const res = await s3.send(getCmd);
    const bodyBytes = await res.Body?.transformToByteArray();
    if (!bodyBytes) {
      throw new Error("Bad Request: Could not read file content for validation.");
    }

    detectedMime = verifyReceiptMagicBytes(bodyBytes);
    if (!detectedMime) {
      throw new Error("Bad Request: File content does not match allowed PDF, JPEG, PNG, or WebP formats.");
    }
  } else {
    // Development or fallback: derive from extension
    const ext = input.key.slice(expectedPrefix.length).toLowerCase();
    detectedMime =
      ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    realBytes = 1024;
  }

  return withTenant(dbRw.db, ctx.tenantId, async (tx) => {
    // Insert media row
    await tx.insert(schema.media).values({
      tenantId: ctx.tenantId,
      id: input.mediaId,
      storageKey: input.key,
      mime: detectedMime ?? "application/octet-stream",
      bytes: realBytes,
      folder: "expense-receipts",
    }).onConflictDoNothing();

    // Generate short-lived (15 min) view URL
    const viewUrl = await buildPresignedDownloadUrl({
      storageKey: input.key,
      expiresInSeconds: 900,
      s3Client: s3 ?? undefined,
      r2Config: storageCfg,
    });

    return {
      mediaId: input.mediaId,
      viewUrl,
    };
  });
}

/**
 * Short-lived (15 min) signed view URL for an expense's receipt, for finance.read holders only.
 * There is no public URL for a receipt: the object lives in the private bucket and is only ever
 * reachable through this call. Returns null when the expense has no receipt attached.
 */
export async function getExpenseReceiptUrl(
  dbRw: DbHandle,
  ctx: TenantContext,
  input: {
    expenseId: string;
    s3Client?: S3Client;
    r2Config?: Partial<R2ClientConfig>;
  },
): Promise<{ url: string | null }> {
  assertPermission(ctx, "finance.read");

  const row = await withTenant(dbRw.db, ctx.tenantId, async (tx) => {
    const [r] = await tx
      .select({ storageKey: schema.media.storageKey })
      .from(schema.expenses)
      .innerJoin(
        schema.media,
        and(
          eq(schema.media.tenantId, schema.expenses.tenantId),
          eq(schema.media.id, schema.expenses.receiptMediaId),
        ),
      )
      .where(and(eq(schema.expenses.tenantId, ctx.tenantId), eq(schema.expenses.id, input.expenseId)))
      .limit(1);
    return r ?? null;
  });
  if (!row) return { url: null };

  // Defence in depth: never sign a key outside this tenant's receipt folder.
  if (!row.storageKey.startsWith(`tenants/${ctx.tenantId}/expense-receipts/`)) {
    throw new Error("Forbidden: receipt storage key is outside this store's receipt folder");
  }

  const url = await buildPresignedDownloadUrl({
    storageKey: row.storageKey,
    expiresInSeconds: 900,
    s3Client: input.s3Client,
    r2Config: getReceiptStorageConfig(input.r2Config) ?? undefined,
  });
  return { url };
}
