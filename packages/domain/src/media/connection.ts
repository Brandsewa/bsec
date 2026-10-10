import fs from "node:fs";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetBucketCorsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { type Db, schema, withTenant } from "@bs/db";
import { decryptSecret } from "@bs/payments";
import { eq, sql } from "drizzle-orm";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { invalidateCache } from "../cache-invalidation.ts";
import { assertStorageQuota } from "../system/quotas.ts";
import {
  generateStorageKey,
  getR2Config,
  type PresignedUploadDescriptor,
  validateMediaUpload,
} from "./storage.ts";

export type StorageDriverType = "local" | "r2" | "s3";
export type StoragePurpose = "public_media" | "private_files";

export interface ResolvedStorageConfig {
  id: string | null; // null means resolved from env fallback
  name: string;
  driver: StorageDriverType;
  purpose: StoragePurpose;
  isActive: boolean;
  endpoint?: string | undefined;
  region?: string | undefined;
  bucket?: string | undefined;
  publicBaseUrl?: string | undefined;
  forcePathStyle?: boolean | undefined;
  localDir?: string | undefined;
  accountId?: string | undefined;
  directBrowserUpload?: boolean | undefined;
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
}

export interface MediaStorageDriver {
  readonly driverType: StorageDriverType;
  readonly config: ResolvedStorageConfig;

  presignUpload(params: {
    tenantId: string;
    folder: string;
    filename: string;
    mime: string;
    bytes: number;
    id?: string | undefined;
    expiresInSeconds?: number | undefined;
  }): Promise<PresignedUploadDescriptor & { method: "PUT" | "POST" }>;

  put(params: {
    key: string;
    body: Buffer | Uint8Array;
    contentType: string;
  }): Promise<void>;

  head(key: string): Promise<{ exists: boolean; size?: number | undefined; contentType?: string | undefined }>;

  delete(key: string): Promise<void>;

  publicUrl(key: string): string | undefined;

  presignDownload(key: string, expiresInSeconds?: number | undefined): Promise<string>;

  testConnection(adminOrigins?: string[]): Promise<{
    ok: boolean;
    error?: string | undefined;
    corsOk?: boolean | undefined;
    corsDetails?: string | undefined;
  }>;
}

/**
 * Sniffs magic bytes from the binary data to verify consistency with declared MIME types.
 * Helps prevent file spoofing (e.g. executable or HTML disguised as image/png).
 */
export function sniffMimeType(data: Buffer | Uint8Array): string | null {
  if (data.length < 4) return null;

  // JPEG: FF D8 FF
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return "image/png";
  }

  // GIF: GIF87a or GIF89a
  if (
    data.length >= 6 &&
    data[0] === 0x47 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x38 &&
    (data[4] === 0x37 || data[4] === 0x39) &&
    data[5] === 0x61
  ) {
    return "image/gif";
  }

  // WebP: RIFF ... WEBP
  if (
    data.length >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return "image/webp";
  }

  // AVIF: ... ftyp avif / avis
  if (data.length >= 12) {
    const b4 = data[4];
    const b5 = data[5];
    const b6 = data[6];
    const b7 = data[7];
    const b8 = data[8];
    const b9 = data[9];
    const b10 = data[10];
    const b11 = data[11];
    if (
      b4 !== undefined &&
      b5 !== undefined &&
      b6 !== undefined &&
      b7 !== undefined &&
      b8 !== undefined &&
      b9 !== undefined &&
      b10 !== undefined &&
      b11 !== undefined
    ) {
      const boxType = String.fromCharCode(b4, b5, b6, b7);
      if (boxType === "ftyp") {
        const brand = String.fromCharCode(b8, b9, b10, b11);
        if (brand === "avif" || brand === "avis") {
          return "image/avif";
        }
      }
    }
  }

  // SVG: text content with <svg
  const head = Buffer.from(data.subarray(0, Math.min(data.length, 1024)))
    .toString("utf8")
    .trim()
    .toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) {
    return "image/svg+xml";
  }

  return null;
}

/**
 * Validates that a requested local storage key does not escape the configured base directory.
 * Strictly prevents directory traversal (../, ..%2f, null bytes, absolute paths, symlink tricks).
 */
export function resolveSafeLocalPath(baseDir: string, relativeKey: string): string {
  if (!relativeKey || typeof relativeKey !== "string") {
    throw new Error("Invalid storage key: key is required");
  }

  if (relativeKey.includes("\0")) {
    throw new Error("Invalid storage key: null byte rejected");
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(relativeKey);
  } catch {
    // Malformed URI encoding
    throw new Error("Invalid storage key: malformed encoding");
  }

  if (decoded.includes("..") || relativeKey.includes("..")) {
    throw new Error("Directory traversal rejected: relative key contains '..'");
  }

  const resolvedBase = path.resolve(/*turbopackIgnore: true*/ baseDir);
  const cleanKey = relativeKey.replace(/^[/\\]+/, "");
  const resolvedTarget = path.resolve(/*turbopackIgnore: true*/ resolvedBase, cleanKey);

  if (!resolvedTarget.startsWith(resolvedBase + path.sep) && resolvedTarget !== resolvedBase) {
    throw new Error("Directory traversal rejected: path outside storage directory");
  }

  return resolvedTarget;
}

/**
 * Local filesystem driver for local development, trials, or single-server deployments.
 * Direct browser uploads are disabled; all uploads are proxied through our server.
 */
export class LocalStorageDriver implements MediaStorageDriver {
  readonly driverType = "local" as const;
  readonly config: ResolvedStorageConfig;
  readonly baseDir: string;

  constructor(config: ResolvedStorageConfig) {
    this.config = config;
    this.baseDir = path.resolve(
      /*turbopackIgnore: true*/ config.localDir || process.env.MEDIA_LOCAL_DIR || "./.data/media",
    );
  }

  async presignUpload(params: {
    tenantId: string;
    folder: string;
    filename: string;
    mime: string;
    bytes: number;
    id?: string | undefined;
    expiresInSeconds?: number | undefined;
  }): Promise<PresignedUploadDescriptor & { method: "PUT" | "POST" }> {
    const { storageKey } = generateStorageKey(params.tenantId, params.folder, params.filename, params.id);
    return {
      uploadUrl: "/api/admin/media/upload",
      method: "POST",
      storageKey,
      headers: {},
      expiresInSeconds: params.expiresInSeconds ?? 900,
    };
  }

  async put(params: { key: string; body: Buffer | Uint8Array; contentType: string }): Promise<void> {
    const targetPath = resolveSafeLocalPath(this.baseDir, params.key);
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.promises.writeFile(targetPath, params.body);
  }

  async head(key: string): Promise<{ exists: boolean; size?: number | undefined; contentType?: string | undefined }> {
    try {
      const targetPath = resolveSafeLocalPath(this.baseDir, key);
      const stat = await fs.promises.stat(targetPath);
      return { exists: true, size: stat.size };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { exists: false };
      }
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const targetPath = resolveSafeLocalPath(this.baseDir, key);
      await fs.promises.unlink(targetPath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw err;
    }
  }

  publicUrl(key: string): string | undefined {
    if (!key) return undefined;
    const clean = key.replace(/^[/\\]+/, "").replace(/\\/g, "/");
    const base = this.config.publicBaseUrl?.trim().replace(/\/+$/, "");
    return base ? `${base}/media/${clean}` : `/media/${clean}`;
  }

  async presignDownload(key: string): Promise<string> {
    return this.publicUrl(key) ?? `/media/${key}`;
  }

  async testConnection(): Promise<{
    ok: boolean;
    error?: string | undefined;
    corsOk?: boolean | undefined;
    corsDetails?: string | undefined;
  }> {
    try {
      await fs.promises.mkdir(this.baseDir, { recursive: true });
      const testFile = path.join(this.baseDir, `_test_diagnostic_${Date.now()}.tmp`);
      await fs.promises.writeFile(testFile, "test");
      await fs.promises.stat(testFile);
      await fs.promises.unlink(testFile);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Local storage directory test failed",
      };
    }
  }
}

/**
 * S3-compatible driver (Cloudflare R2, AWS S3, MinIO, Backblaze, Wasabi, DigitalOcean Spaces).
 */
export class S3StorageDriver implements MediaStorageDriver {
  readonly driverType: "r2" | "s3";
  readonly config: ResolvedStorageConfig;
  readonly client: S3Client;
  readonly bucket: string;

  constructor(config: ResolvedStorageConfig) {
    this.config = config;
    this.driverType = config.driver as "r2" | "s3";
    this.bucket = config.bucket || process.env.R2_BUCKET_NAME || "bsec-media";

    const endpoint =
      config.endpoint ||
      (config.driver === "r2" && config.accountId
        ? `https://${config.accountId}.r2.cloudflarestorage.com`
        : process.env.R2_ENDPOINT);

    const region = config.driver === "r2" ? "auto" : config.region || "us-east-1";

    this.client = new S3Client({
      region,
      ...(endpoint ? { endpoint } : {}),
      credentials: {
        accessKeyId: config.accessKeyId || "placeholder-access-key",
        secretAccessKey: config.secretAccessKey || "placeholder-secret-key",
      },
      forcePathStyle: config.forcePathStyle ?? (config.driver === "r2"),
    });
  }

  async presignUpload(params: {
    tenantId: string;
    folder: string;
    filename: string;
    mime: string;
    bytes: number;
    id?: string | undefined;
    expiresInSeconds?: number | undefined;
  }): Promise<PresignedUploadDescriptor & { method: "PUT" | "POST" }> {
    const { storageKey } = generateStorageKey(params.tenantId, params.folder, params.filename, params.id);

    // If direct browser upload is NOT enabled, route through the server proxy endpoint
    if (!this.config.directBrowserUpload) {
      return {
        uploadUrl: "/api/admin/media/upload",
        method: "POST",
        storageKey,
        headers: {},
        expiresInSeconds: params.expiresInSeconds ?? 900,
      };
    }

    // Direct browser PUT upload: do NOT sign or include Content-Length header to prevent browser forbidden header rejection!
    const expiresIn = params.expiresInSeconds ?? 900;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      ContentType: params.mime,
    });

    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn });

    return {
      uploadUrl,
      method: "PUT",
      storageKey,
      headers: {
        "Content-Type": params.mime,
      },
      expiresInSeconds: expiresIn,
    };
  }

  async put(params: { key: string; body: Buffer | Uint8Array; contentType: string }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
      }),
    );
  }

  async head(key: string): Promise<{ exists: boolean; size?: number | undefined; contentType?: string | undefined }> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return {
        exists: true,
        size: res.ContentLength,
        contentType: res.ContentType,
      };
    } catch (err: unknown) {
      const name = (err as { name?: string }).name;
      if (name === "NotFound" || name === "NoSuchKey") {
        return { exists: false };
      }
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  publicUrl(key: string): string | undefined {
    if (!key) return undefined;
    const cleanKey = key.replace(/^\/+/, "");
    const base = this.config.publicBaseUrl?.trim().replace(/\/+$/, "");
    return base ? `${base}/${cleanKey}` : undefined;
  }

  async presignDownload(key: string, expiresInSeconds = 900): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return await getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async testConnection(adminOrigins?: string[]): Promise<{
    ok: boolean;
    error?: string | undefined;
    corsOk?: boolean | undefined;
    corsDetails?: string | undefined;
  }> {
    const testKey = `_diagnostic_test_${Date.now()}.txt`;
    try {
      // 1. Put 1-byte object
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: testKey,
          Body: Buffer.from("1"),
          ContentType: "text/plain",
        }),
      );

      // 2. Head object
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: testKey,
        }),
      );

      // 3. Delete object
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: testKey,
        }),
      );

      // 4. Test CORS configuration on bucket
      let corsOk = true;
      let corsDetails: string | undefined;

      try {
        const corsRes = await this.client.send(
          new GetBucketCorsCommand({
            Bucket: this.bucket,
          }),
        );

        const rules = corsRes.CORSRules ?? [];
        if (rules.length === 0) {
          corsOk = false;
          corsDetails =
            "Bucket has no CORS rules configured. Direct browser uploads will fail unless bucket CORS is configured or server-proxied upload is used.";
        } else {
          // Check if PUT is allowed
          const hasPut = rules.some((r) => r.AllowedMethods?.includes("PUT"));
          if (!hasPut) {
            corsOk = false;
            corsDetails =
              "Bucket CORS configuration does not allow the PUT method. Direct browser uploads will fail.";
          } else if (adminOrigins && adminOrigins.length > 0) {
            const hasOrigin = rules.some((r) =>
              r.AllowedOrigins?.some((o) => o === "*" || adminOrigins.includes(o)),
            );
            if (!hasOrigin) {
              corsOk = false;
              corsDetails = `Bucket CORS configuration does not allow configured admin origins (${adminOrigins.join(", ")}). Direct browser uploads may be blocked.`;
            }
          }
        }
      } catch (corsErr: unknown) {
        const errName = (corsErr as { name?: string }).name;
        if (errName === "NoSuchCORSConfiguration") {
          corsOk = false;
          corsDetails =
            "Bucket has no CORS configuration (NoSuchCORSConfiguration). Direct browser uploads will fail unless bucket CORS is configured or server-proxied upload is used.";
        } else {
          corsDetails = `Could not inspect bucket CORS (${errName || "Unknown"}). If using direct browser uploads, ensure bucket CORS allows your admin origin.`;
        }
      }

      return {
        ok: true,
        corsOk,
        corsDetails,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "S3/R2 storage connection test failed",
      };
    }
  }
}

// In-process cache for resolved storage connections (60-second TTL)
interface CacheEntry {
  config: ResolvedStorageConfig | null;
  expiresAt: number;
}
const storageConfigCache = new Map<string, CacheEntry>();

export function invalidateStorageConnectionCache(): void {
  storageConfigCache.clear();
}

/**
 * Resolves storage configuration following PLAN §3.1.2:
 * 1. Active DB connection for the purpose.
 * 2. Existing environment variable fallback (R2_*).
 * 3. Not configured (returns null).
 */
export async function resolveStorageConnection(
  db: Db,
  purpose: StoragePurpose = "public_media",
): Promise<ResolvedStorageConfig | null> {
  const cacheKey = `purpose:${purpose}`;
  const cached = storageConfigCache.get(cacheKey);
  const now = Date.now();
  if (!process.env.VITEST && cached && cached.expiresAt > now) {
    return cached.config;
  }

  // 1. Check active database connection
  try {
    const rows = await db
      .select()
      .from(schema.platformStorageConnections)
      .where(sql`${schema.platformStorageConnections.purpose} = ${purpose} AND ${schema.platformStorageConnections.isActive} = true`)
      .limit(1);

    if (rows[0]) {
      const row = rows[0];
      let accessKeyId: string | undefined;
      let secretAccessKey: string | undefined;

      if (row.accessKeyIdCiphertext && row.iv) {
        try {
          accessKeyId = decryptSecret({ ciphertext: row.accessKeyIdCiphertext, iv: row.iv });
        } catch {
          // Decryption failed (key missing/mismatch)
        }
      }

      if (row.secretAccessKeyCiphertext && row.iv) {
        try {
          secretAccessKey = decryptSecret({ ciphertext: row.secretAccessKeyCiphertext, iv: row.iv });
        } catch {
          // Decryption failed
        }
      }

      const config: ResolvedStorageConfig = {
        id: row.id,
        name: row.name,
        driver: row.driver as StorageDriverType,
        purpose: row.purpose as StoragePurpose,
        isActive: row.isActive,
        endpoint: row.endpoint ?? undefined,
        region: row.region ?? undefined,
        bucket: row.bucket ?? undefined,
        publicBaseUrl: row.publicBaseUrl ?? undefined,
        forcePathStyle: row.forcePathStyle,
        localDir: row.localDir ?? undefined,
        accountId: row.accountId ?? undefined,
        directBrowserUpload: row.directBrowserUpload,
        accessKeyId,
        secretAccessKey,
      };

      storageConfigCache.set(cacheKey, { config, expiresAt: now + 60_000 });
      return config;
    }
  } catch {
    // If table doesn't exist yet (e.g. before migration), fall back cleanly to env
  }

  // 2. Env fallback
  const envConfig = getEnvironmentStorageConfig(purpose);
  if (envConfig) {
    storageConfigCache.set(cacheKey, { config: envConfig, expiresAt: now + 60_000 });
    return envConfig;
  }

  // 3. Not configured
  if (!process.env.VITEST) {
    storageConfigCache.set(cacheKey, { config: null, expiresAt: now + 60_000 });
  }
  return null;
}

/**
 * Returns the environment fallback storage configuration if defined.
 */
export function getEnvironmentStorageConfig(
  purpose: StoragePurpose = "public_media",
): ResolvedStorageConfig | null {
  const envCfg = getR2Config();
  if (purpose === "public_media") {
    if (envCfg.accessKeyId && envCfg.secretAccessKey) {
      return {
        id: null,
        name: "Environment (R2)",
        driver: "r2",
        purpose: "public_media",
        isActive: true,
        endpoint: envCfg.endpoint,
        accountId: envCfg.accountId,
        bucket: envCfg.bucketName,
        publicBaseUrl: envCfg.publicUrl,
        accessKeyId: envCfg.accessKeyId,
        secretAccessKey: envCfg.secretAccessKey,
        directBrowserUpload: true,
      };
    } else if (envCfg.publicUrl) {
      // Read-only public URL support when public domain is configured but write keys are omitted
      return {
        id: null,
        name: "Environment (R2 Read-Only)",
        driver: "r2",
        purpose: "public_media",
        isActive: true,
        endpoint: envCfg.endpoint,
        accountId: envCfg.accountId,
        bucket: envCfg.bucketName,
        publicBaseUrl: envCfg.publicUrl,
        directBrowserUpload: true,
      };
    } else if (process.env.MEDIA_LOCAL_DIR || process.env.NODE_ENV === "development") {
      return {
        id: null,
        name: "Local Filesystem",
        driver: "local",
        purpose: "public_media",
        isActive: true,
        localDir: process.env.MEDIA_LOCAL_DIR || "./.data/media",
        directBrowserUpload: false,
      };
    }
  } else if (purpose === "private_files") {
    const privateBucket = process.env.R2_PRIVATE_BUCKET_NAME || envCfg.bucketName;
    if (envCfg.accessKeyId && envCfg.secretAccessKey && privateBucket) {
      return {
        id: null,
        name: "Environment (Private R2)",
        driver: "r2",
        purpose: "private_files",
        isActive: true,
        endpoint: envCfg.endpoint,
        accountId: envCfg.accountId,
        bucket: privateBucket,
        publicBaseUrl: undefined,
        accessKeyId: envCfg.accessKeyId,
        secretAccessKey: envCfg.secretAccessKey,
        directBrowserUpload: false,
      };
    }
  }
  return null;
}

/**
 * Resolves the appropriate storage driver for an existing media row.
 * If storageConnectionId is set, resolves that specific connection (even if no longer active).
 * If storageConnectionId is NULL or undefined, resolves via environment fallback.
 */
export async function resolveDriverForMediaRow(
  db: Db,
  storageConnectionId: string | null | undefined,
  purpose: StoragePurpose = "public_media",
): Promise<MediaStorageDriver | null> {
  if (storageConnectionId) {
    const config = await resolveStorageConnectionById(db, storageConnectionId);
    if (config) {
      return createStorageDriver(config);
    }
  }
  const envConfig = getEnvironmentStorageConfig(purpose);
  if (envConfig) {
    return createStorageDriver(envConfig);
  }
  return null;
}

/**
 * Resolves the absolute local filesystem path for a media file key.
 * 1. Checks if the key references a media record in the DB, resolving through the media row's connection.
 * 2. If row connection is local, verifies file existence in that connection's localDir.
 * 3. Falls back to active connection's localDir, then env fallback (MEDIA_LOCAL_DIR / ./.data/media),
 *    and any other configured local connections.
 * 4. Strictly validates path safety with resolveSafeLocalPath to prevent traversal.
 */
export async function resolveLocalMediaFilePath(
  db: Db,
  storageKey: string,
): Promise<string | null> {
  if (!storageKey || typeof storageKey !== "string") {
    return null;
  }

  const candidateDirs: string[] = [];

  // 1. Try to find the media record's specific connection
  const parts = storageKey.split("/");
  const tenantIdCandidate = parts[0];
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    tenantIdCandidate || "",
  );

  if (isUuid && tenantIdCandidate) {
    try {
      const rows = await withTenant(db, tenantIdCandidate, async (tx) => {
        return tx
          .select({ storageConnectionId: schema.media.storageConnectionId })
          .from(schema.media)
          .where(eq(schema.media.storageKey, storageKey))
          .limit(1);
      });

      if (rows[0]) {
        const connId = rows[0].storageConnectionId;
        if (connId) {
          const conn = await resolveStorageConnectionById(db, connId);
          if (conn && conn.driver === "local" && conn.localDir) {
            candidateDirs.push(conn.localDir);
          }
        } else {
          // Explicit null storageConnectionId means environment fallback
          const envCfg = getEnvironmentStorageConfig("public_media");
          if (envCfg && envCfg.driver === "local" && envCfg.localDir) {
            candidateDirs.push(envCfg.localDir);
          }
        }
      }
    } catch {
      // Query or tenant context failure; continue to fallback directories
    }
  }

  // 2. Active connection directory
  try {
    const active = await resolveStorageConnection(db, "public_media");
    if (active && active.driver === "local" && active.localDir) {
      if (!candidateDirs.includes(active.localDir)) {
        candidateDirs.push(active.localDir);
      }
    }
  } catch {
    // ignore
  }

  // 3. Environment fallback directory
  const envDir = process.env.MEDIA_LOCAL_DIR || "./.data/media";
  if (!candidateDirs.includes(envDir)) {
    candidateDirs.push(envDir);
  }

  // 4. Any other registered local connections
  try {
    const allLocal = await db
      .select({ localDir: schema.platformStorageConnections.localDir })
      .from(schema.platformStorageConnections)
      .where(sql`${schema.platformStorageConnections.driver} = 'local'`);
    for (const r of allLocal) {
      if (r.localDir && !candidateDirs.includes(r.localDir)) {
        candidateDirs.push(r.localDir);
      }
    }
  } catch {
    // ignore
  }

  // Check existence across candidate directories in priority order
  for (const dir of candidateDirs) {
    try {
      const resolvedBase = path.resolve(/*turbopackIgnore: true*/ dir);
      const safePath = resolveSafeLocalPath(resolvedBase, storageKey);
      const stat = await fs.promises.stat(safePath);
      if (stat.isFile()) {
        return safePath;
      }
    } catch {
      // Not found in this directory, or traversal attempt; continue
    }
  }

  return null;
}

/**
 * Resolves a storage connection by its ID (for media written with that connection).
 */
export async function resolveStorageConnectionById(
  db: Db,
  connectionId: string,
): Promise<ResolvedStorageConfig | null> {
  const cacheKey = `id:${connectionId}`;
  const cached = storageConfigCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.config;
  }

  try {
    const rows = await db
      .select()
      .from(schema.platformStorageConnections)
      .where(eq(schema.platformStorageConnections.id, connectionId))
      .limit(1);

    if (rows[0]) {
      const row = rows[0];
      let accessKeyId: string | undefined;
      let secretAccessKey: string | undefined;

      if (row.accessKeyIdCiphertext && row.iv) {
        try {
          accessKeyId = decryptSecret({ ciphertext: row.accessKeyIdCiphertext, iv: row.iv });
        } catch {
          // Decryption failed
        }
      }

      if (row.secretAccessKeyCiphertext && row.iv) {
        try {
          secretAccessKey = decryptSecret({ ciphertext: row.secretAccessKeyCiphertext, iv: row.iv });
        } catch {
          // Decryption failed
        }
      }

      const config: ResolvedStorageConfig = {
        id: row.id,
        name: row.name,
        driver: row.driver as StorageDriverType,
        purpose: row.purpose as StoragePurpose,
        isActive: row.isActive,
        endpoint: row.endpoint ?? undefined,
        region: row.region ?? undefined,
        bucket: row.bucket ?? undefined,
        publicBaseUrl: row.publicBaseUrl ?? undefined,
        forcePathStyle: row.forcePathStyle,
        localDir: row.localDir ?? undefined,
        accountId: row.accountId ?? undefined,
        directBrowserUpload: row.directBrowserUpload,
        accessKeyId,
        secretAccessKey,
      };

      storageConfigCache.set(cacheKey, { config, expiresAt: now + 60_000 });
      return config;
    }
  } catch {
    // DB query failed or table missing
  }

  storageConfigCache.set(cacheKey, { config: null, expiresAt: now + 60_000 });
  return null;
}

/**
 * Creates a driver instance from resolved configuration.
 */
export function createStorageDriver(config: ResolvedStorageConfig): MediaStorageDriver {
  if (config.driver === "local") {
    return new LocalStorageDriver(config);
  }
  return new S3StorageDriver(config);
}

/**
 * Gets the active driver for a purpose, or throws a friendly error if not configured.
 */
export async function getActiveStorageDriver(
  db: Db,
  purpose: StoragePurpose = "public_media",
): Promise<{ driver: MediaStorageDriver; config: ResolvedStorageConfig }> {
  const config = await resolveStorageConnection(db, purpose);
  if (!config || (config.driver !== "local" && (!config.accessKeyId || !config.secretAccessKey))) {
    throw new Error(
      "Precondition: Image storage is not set up yet. Ask the platform team to connect it, then try again.",
    );
  }
  return {
    driver: createStorageDriver(config),
    config,
  };
}

/**
 * Resolves public URL for a media row, taking into account its original storage_connection_id.
 * Switching active connection affects new uploads only and never breaks existing images.
 */
export async function resolvePublicMediaUrl(
  db: Db,
  storageKey: string | null | undefined,
  storageConnectionId?: string | null,
): Promise<string | undefined> {
  if (!storageKey) return undefined;

  let config: ResolvedStorageConfig | null = null;
  if (storageConnectionId) {
    config = await resolveStorageConnectionById(db, storageConnectionId);
  }
  if (!config) {
    config = await resolveStorageConnection(db, "public_media");
  }

  if (!config) return undefined;
  const driver = createStorageDriver(config);
  return driver.publicUrl(storageKey);
}

export function publicMediaUrlSync(
  storageKey: string | null | undefined,
  storageConnectionId?: string | null,
): string | undefined {
  if (!storageKey) return undefined;
  if (storageConnectionId) {
    const cached = storageConfigCache.get(`id:${storageConnectionId}`);
    if (cached?.config) {
      return createStorageDriver(cached.config).publicUrl(storageKey);
    }
  }
  const activeCached = storageConfigCache.get("purpose:public_media");
  if (activeCached?.config) {
    return createStorageDriver(activeCached.config).publicUrl(storageKey);
  }
  return undefined;
}

/**
 * Direct server-proxied media upload (PLAN §3.1.4).
 * Replaces direct browser uploads as the default path, avoiding bucket CORS failures.
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
  },
) {
  assertPermission(ctx, "content.write");

  // 1. Validation
  const validation = validateMediaUpload(input.mime, input.fileBytes.length);
  if (!validation.valid) {
    throw new Error(validation.error || "Invalid media upload");
  }

  // 2. Magic byte sniffing
  const sniffed = sniffMimeType(input.fileBytes);
  if (!sniffed) {
    throw new Error(
      "File verification failed: file content is not a recognized image format.",
    );
  }
  if (sniffed !== input.mime) {
    throw new Error(
      `File verification failed: declared MIME "${input.mime}" does not match file contents ("${sniffed}").`,
    );
  }

  // 3. Quota check
  const uploadSizeMb = input.fileBytes.length / (1024 * 1024);
  await assertStorageQuota(rt._db.db, ctx.tenantId, uploadSizeMb);

  // 4. Resolve active driver
  const { driver, config } = await getActiveStorageDriver(rt._db.db, "public_media");

  // 5. Generate isolated key
  const { storageKey } = generateStorageKey(
    ctx.tenantId,
    input.folder || "products",
    input.filename,
  );

  // 6. Write through driver
  await driver.put({
    key: storageKey,
    body: input.fileBytes,
    contentType: input.mime,
  });

  // 7. Persist media row
  const created = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .insert(schema.media)
      .values({
        tenantId: ctx.tenantId,
        storageKey,
        storageConnectionId: config.id ?? null,
        mime: input.mime,
        bytes: input.fileBytes.length,
        folder: input.folder || "products",
        alt: input.alt ?? null,
      })
      .returning();
    if (!row) {
      throw new Error("Failed to insert media row");
    }
    return row;
  });

  await invalidateCache(rt, ctx, { type: "media_updated" });

  const publicUrl = driver.publicUrl(storageKey);

  return {
    id: created.id,
    storageKey: created.storageKey,
    storageConnectionId: created.storageConnectionId ?? undefined,
    cfImageId: created.cfImageId ?? undefined,
    mime: created.mime,
    bytes: Number(created.bytes),
    width: created.width ?? undefined,
    height: created.height ?? undefined,
    alt: created.alt ?? undefined,
    folder: created.folder,
    createdAt: created.createdAt.toISOString(),
    url: publicUrl,
  };
}
