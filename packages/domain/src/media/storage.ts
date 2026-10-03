/**
 * Media Storage & Cloudflare Images Helpers per PLAN §5.5 & §8.1.
 * Supports S3/R2 SigV4 presigned PUT uploads and Cloudflare Images API integration.
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Copies bytes into a fresh, plain ArrayBuffer. Node's Buffer/Uint8Array are typed as
 * Uint8Array<ArrayBufferLike>, which includes SharedArrayBuffer and so isn't directly
 * assignable to BlobPart's ArrayBuffer-only requirement under strict lib.dom typings.
 */
function toArrayBuffer(data: Uint8Array | Buffer): ArrayBuffer {
  const out = new ArrayBuffer(data.byteLength);
  new Uint8Array(out).set(data);
  return out;
}

export const ALLOWED_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/svg+xml",
] as const;

export const MAX_MEDIA_BYTES = 10 * 1024 * 1024; // 10 MB

export interface MediaValidationResult {
  valid: boolean;
  error?: string;
}

export interface StorageKeyInfo {
  storageKey: string;
  extension: string;
}

export interface CloudflareTransformOptions {
  width?: number;
  height?: number;
  fit?: "scale-down" | "contain" | "cover" | "crop" | "pad";
  format?: "avif" | "webp" | "auto" | "json";
  quality?: number;
}

export interface PresignedUploadDescriptor {
  uploadUrl: string;
  storageKey: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
}

export interface R2ClientConfig {
  accountId?: string | undefined;
  endpoint?: string | undefined;
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
  bucketName?: string | undefined;
  publicUrl?: string | undefined;
}

/**
 * Resolves R2 storage credentials and endpoint from environment variables or custom config.
 * Follows the Coolify R2 backup endpoint pattern:
 * https://<account-id>.r2.cloudflarestorage.com
 */
export function getR2Config(override?: Partial<R2ClientConfig>): R2ClientConfig {
  const accountId =
    override?.accountId ||
    process.env.R2_ACCOUNT_ID ||
    process.env.CLOUDFLARE_ACCOUNT_ID ||
    "7a0533854a8ded58696db809f403f26c"; // default from infra/coolify/RUNBOOK.md

  const endpoint =
    override?.endpoint ||
    process.env.R2_ENDPOINT ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);

  const accessKeyId = override?.accessKeyId || process.env.R2_ACCESS_KEY_ID || "";
  const secretAccessKey = override?.secretAccessKey || process.env.R2_SECRET_ACCESS_KEY || "";
  const bucketName = override?.bucketName || process.env.R2_BUCKET_NAME || "bsec-media";
  const publicUrl = override?.publicUrl || process.env.R2_PUBLIC_URL;

  return {
    accountId,
    endpoint,
    accessKeyId,
    secretAccessKey,
    bucketName,
    publicUrl,
  };
}

/** True when R2 write credentials are configured, i.e. uploads can actually succeed. */
export function isMediaStorageConfigured(override?: Partial<R2ClientConfig>): boolean {
  const cfg = getR2Config(override);
  return Boolean(cfg.accessKeyId && cfg.secretAccessKey);
}

/**
 * The public address of a stored file (R2_PUBLIC_URL is the bucket's public domain, e.g. https://media.bcom.si).
 * Undefined when no public address is configured, so callers show no image instead of a broken one.
 */
export function publicMediaUrl(storageKey: string | null | undefined, override?: Partial<R2ClientConfig>): string | undefined {
  if (!storageKey) return undefined;
  const base = getR2Config(override).publicUrl?.trim().replace(/\/+$/, "");
  return base ? `${base}/${storageKey.replace(/^\/+/, "")}` : undefined;
}

/**
 * Creates an S3-compatible client for Cloudflare R2 operations.
 */
export function createR2Client(config?: Partial<R2ClientConfig>): S3Client {
  const cfg = getR2Config(config);
  return new S3Client({
    region: "auto",
    ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
    credentials: {
      accessKeyId: cfg.accessKeyId || "placeholder-access-key",
      secretAccessKey: cfg.secretAccessKey || "placeholder-secret-key",
    },
    // R2 requires path-style addressing off or on depending on setup, auto works with endpoint
    forcePathStyle: true,
  });
}

/**
 * Validates uploaded media file mime type and file size.
 */
export function validateMediaUpload(
  mime: string,
  bytes: number,
  options?: {
    maxBytes?: number;
    allowedMimes?: readonly string[] | string[];
  },
): MediaValidationResult {
  const maxBytes = options?.maxBytes ?? MAX_MEDIA_BYTES;
  const allowed = options?.allowedMimes ?? ALLOWED_IMAGE_MIMES;

  if (bytes <= 0) {
    return { valid: false, error: "File size must be greater than zero bytes" };
  }

  if (bytes > maxBytes) {
    const maxMb = (maxBytes / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `File size exceeds maximum allowed limit of ${maxMb} MB`,
    };
  }

  if (!allowed.includes(mime)) {
    return {
      valid: false,
      error: `Unsupported MIME type: "${mime}". Allowed types: ${allowed.join(", ")}`,
    };
  }

  return { valid: true };
}

/**
 * Generates an isolated R2 storage key in format: `${tenantId}/${folder}/${id}.${ext}`.
 */
export function generateStorageKey(
  tenantId: string,
  folder: string,
  filename: string,
  id?: string,
): StorageKeyInfo {
  const cleanFolder = folder.replace(/^\/+|\/+$/g, "").trim() || "general";
  const fileId = id || crypto.randomUUID();

  const parts = filename.split(".");
  const ext = (parts.length > 1 ? parts.pop() : "bin")?.toLowerCase().trim() || "bin";

  const storageKey = `${tenantId}/${cleanFolder}/${fileId}.${ext}`;
  return { storageKey, extension: ext };
}

/**
 * Constructs a Cloudflare Images standard delivery URL.
 * Format: `https://imagedelivery.net/<account-hash>/<imageId>/<variant>`
 */
export function buildCloudflareImageUrl(
  deliveryBaseUrl: string,
  cfImageId: string,
  variant: string,
): string {
  const base = deliveryBaseUrl.replace(/\/+$/, "");
  return `${base}/${cfImageId}/${variant}`;
}

/**
 * Constructs a Cloudflare Image Resizing / transformation URL.
 * Format: `<baseUrl>/cdn-cgi/image/<options>/<storageKey>`
 */
export function buildCloudflareImageTransformUrl(
  cdnBaseUrl: string,
  imagePath: string,
  options: CloudflareTransformOptions,
): string {
  const base = cdnBaseUrl.replace(/\/+$/, "");
  const cleanPath = imagePath.replace(/^\/+/, "");

  const optionPairs: string[] = [];
  if (options.width) optionPairs.push(`width=${options.width}`);
  if (options.height) optionPairs.push(`height=${options.height}`);
  if (options.fit) optionPairs.push(`fit=${options.fit}`);
  if (options.format) optionPairs.push(`format=${options.format}`);
  if (options.quality) optionPairs.push(`quality=${options.quality}`);

  const optionsStr = optionPairs.join(",");
  return `${base}/cdn-cgi/image/${optionsStr}/${cleanPath}`;
}

/**
 * Generates a genuine S3/R2 SigV4 presigned PUT upload URL with expiry.
 * Authenticates directly with R2 credentials.
 */
export async function buildPresignedUploadDescriptor(params: {
  tenantId: string;
  folder: string;
  filename: string;
  mime: string;
  bytes: number;
  id?: string | undefined;
  expiresInSeconds?: number | undefined;
  bucketBaseUrl?: string | undefined;
  r2Config?: Partial<R2ClientConfig> | undefined;
  s3Client?: S3Client | undefined;
}): Promise<PresignedUploadDescriptor> {
  const { storageKey } = generateStorageKey(
    params.tenantId,
    params.folder,
    params.filename,
    params.id,
  );

  const expiresIn = params.expiresInSeconds ?? 900;
  const cfg = getR2Config(params.r2Config);
  const client = params.s3Client ?? createR2Client(params.r2Config);

  const command = new PutObjectCommand({
    Bucket: cfg.bucketName,
    Key: storageKey,
    ContentType: params.mime,
    ContentLength: params.bytes,
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn,
  });

  return {
    uploadUrl,
    storageKey,
    headers: {
      "Content-Type": params.mime,
      "Content-Length": String(params.bytes),
    },
    expiresInSeconds: expiresIn,
  };
}

/**
 * Generates a short-lived S3/R2 SigV4 presigned GET download URL for private files (such as return photos).
 */
export async function buildPresignedDownloadUrl(params: {
  storageKey: string;
  expiresInSeconds?: number | undefined;
  r2Config?: Partial<R2ClientConfig> | undefined;
  s3Client?: S3Client | undefined;
}): Promise<string> {
  const expiresIn = params.expiresInSeconds ?? 900;
  const cfg = getR2Config(params.r2Config);
  const client = params.s3Client ?? createR2Client(params.r2Config);

  const command = new GetObjectCommand({
    Bucket: cfg.bucketName,
    Key: params.storageKey,
  });

  return await getSignedUrl(client, command, {
    expiresIn,
  });
}

export interface CloudflareImageUploadResult {
  success: boolean;
  id?: string;
  filename?: string;
  uploaded?: string;
  requireSignedURLs?: boolean;
  variants?: string[];
  error?: string;
}

/**
 * Invokes Cloudflare Images Direct Upload or re-encode API.
 * Real API call path to api.cloudflare.com/client/v4/accounts/<account-id>/images/v1.
 * Skips/gracefully reports unconfigured state when CLOUDFLARE_IMAGES_API_TOKEN is not set.
 */
export async function uploadToCloudflareImages(params: {
  file: Blob | Buffer | Uint8Array;
  filename: string;
  accountId?: string;
  apiToken?: string;
  metadata?: Record<string, string>;
}): Promise<CloudflareImageUploadResult> {
  const accountId =
    params.accountId ||
    process.env.CLOUDFLARE_ACCOUNT_ID ||
    process.env.R2_ACCOUNT_ID ||
    "7a0533854a8ded58696db809f403f26c";
  const apiToken =
    params.apiToken ||
    process.env.CLOUDFLARE_IMAGES_API_TOKEN ||
    process.env.CLOUDFLARE_API_TOKEN;

  if (!apiToken) {
    return {
      success: false,
      error:
        "CLOUDFLARE_IMAGES_API_TOKEN not configured in environment. Direct Cloudflare Images re-encoding skipped.",
    };
  }

  const formData = new FormData();
  const blob =
    params.file instanceof Blob
      ? params.file
      : new Blob([toArrayBuffer(params.file as Uint8Array | Buffer)]);
  formData.append("file", blob, params.filename);

  if (params.metadata) {
    formData.append("metadata", JSON.stringify(params.metadata));
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      body: formData,
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    return {
      success: false,
      error: `Cloudflare Images API returned ${response.status}: ${errorBody}`,
    };
  }

  const data = (await response.json()) as {
    success: boolean;
    result?: {
      id: string;
      filename: string;
      uploaded: string;
      requireSignedURLs: boolean;
      variants: string[];
    };
    errors?: Array<{ code: number; message: string }>;
  };

  if (!data.success || !data.result) {
    const msg = data.errors?.map((e) => e.message).join(", ") || "Upload failed";
    return { success: false, error: msg };
  }

  return {
    success: true,
    id: data.result.id,
    filename: data.result.filename,
    uploaded: data.result.uploaded,
    requireSignedURLs: data.result.requireSignedURLs,
    variants: data.result.variants,
  };
}
