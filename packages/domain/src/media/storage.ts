/**
 * Media Storage & Cloudflare Images Helpers per PLAN §5.5 & §8.1.
 */

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
 * Generates direct R2 PUT upload details for client-side uploads.
 */
export function buildPresignedUploadDescriptor(params: {
  bucketBaseUrl: string;
  tenantId: string;
  folder: string;
  filename: string;
  mime: string;
  bytes: number;
  id?: string;
  expiresInSeconds?: number;
}): PresignedUploadDescriptor {
  const { storageKey } = generateStorageKey(
    params.tenantId,
    params.folder,
    params.filename,
    params.id,
  );

  const base = params.bucketBaseUrl.replace(/\/+$/, "");
  const uploadUrl = `${base}/${storageKey}`;

  return {
    uploadUrl,
    storageKey,
    headers: {
      "Content-Type": params.mime,
      "Content-Length": String(params.bytes),
    },
    expiresInSeconds: params.expiresInSeconds ?? 900,
  };
}
