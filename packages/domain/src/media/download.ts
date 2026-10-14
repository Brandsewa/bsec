import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { type Db, schema, withTenant } from "@bs/db";
import { PRIVATE_MEDIA_FOLDERS } from "./types.ts";
import {
  type LocalStorageDriver,
  resolveDriverForMediaRow,
  resolveSafeLocalPath,
} from "./connection.ts";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SanitizedFilename {
  safeFilename: string;
  encodedFilename: string;
  dispositionHeader: string;
}

/**
 * Sanitizes a filename for use in Content-Disposition headers (RFC 6266 / RFC 5987).
 * Strips CR/LF, null bytes, control characters, path separators, and double quotes.
 */
export function sanitizeDownloadFilename(
  rawFilename: string | null | undefined,
  fallback = "download",
): SanitizedFilename {
  let name = (rawFilename ?? "").trim();
  // Strip control characters, CR, LF, NUL, DEL safely without regex control characters
  name = Array.from(name)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("");
  // Replace path separators / and \
  name = name.replace(/[/\\]+/g, "_");
  // Replace double quotes
  name = name.replace(/"/g, "");
  // Collapse and replace directory traversal sequences ..
  name = name.replace(/\.{2,}/g, "_");
  // Collapse multiple underscores
  name = name.replace(/_+/g, "_");
  // Strip leading and trailing whitespace, dots, and underscores
  name = name.replace(/^[\s._]+|[\s._]+$/g, "");

  if (!name) {
    name = fallback;
  }

  // Safe ASCII filename for legacy parameter: replace non-ASCII printable or quotes with _
  let safeFilename = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "").replace(/_+/g, "_").trim();
  safeFilename = safeFilename.replace(/^[\s._]+|[\s._]+$/g, "");
  if (!safeFilename) {
    safeFilename = fallback;
  }

  // RFC 5987 / RFC 6266 encoded filename for UTF-8
  const encodedFilename = encodeURIComponent(name)
    .replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A");

  const dispositionHeader = `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`;

  return {
    safeFilename,
    encodedFilename,
    dispositionHeader,
  };
}

export interface MediaDownloadResult {
  mediaId: string;
  driverType: "local" | "s3" | "r2";
  mime: string;
  bytes: number;
  safeFilename: string;
  encodedFilename: string;
  dispositionHeader: string;
  localFilePath?: string;
  downloadUrl?: string;
}

/**
 * Resolves a media item for storefront download under tenant isolation (RLS).
 * Serves ready or trashed (before permanent purge), non-private library media only.
 * Returns either a local file path (for local driver) or a presigned 60s download URL
 * with ResponseContentDisposition set (for S3/R2 drivers).
 */
export async function getMediaForStorefrontDownload(
  db: Db,
  tenantId: string,
  mediaId: string,
): Promise<MediaDownloadResult | null> {
  if (!mediaId || typeof mediaId !== "string" || !UUID_REGEX.test(mediaId)) {
    return null;
  }

  return await withTenant(db, tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: schema.media.id,
        tenantId: schema.media.tenantId,
        storageKey: schema.media.storageKey,
        storageConnectionId: schema.media.storageConnectionId,
        mime: schema.media.mime,
        bytes: schema.media.bytes,
        folder: schema.media.folder,
        status: schema.media.status,
        filename: schema.media.filename,
        title: schema.media.title,
      })
      .from(schema.media)
      .where(and(eq(schema.media.id, mediaId), eq(schema.media.tenantId, tenantId)))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return null;
    }

    // Reject private folders (returns, expense-receipts)
    if (row.folder && (PRIVATE_MEDIA_FOLDERS as readonly string[]).includes(row.folder)) {
      return null;
    }

    // Must be ready or trashed (trashed item still downloadable while it exists before purge)
    if (row.status !== "ready" && row.status !== "trashed") {
      return null;
    }

    // Sanitize filename
    const rawName = row.filename || row.title || path.basename(row.storageKey) || "download";
    const sanitized = sanitizeDownloadFilename(rawName);

    // Resolve driver
    const driver = await resolveDriverForMediaRow(db, row.storageConnectionId);
    if (!driver) {
      return null;
    }

    if (driver.driverType === "local") {
      const localDriver = driver as LocalStorageDriver;
      try {
        const localFilePath = resolveSafeLocalPath(localDriver.baseDir, row.storageKey);
        const stat = await fs.promises.stat(localFilePath);
        if (!stat.isFile()) {
          return null;
        }

        return {
          mediaId: row.id,
          driverType: "local",
          mime: row.mime,
          bytes: Number(row.bytes),
          safeFilename: sanitized.safeFilename,
          encodedFilename: sanitized.encodedFilename,
          dispositionHeader: sanitized.dispositionHeader,
          localFilePath,
        };
      } catch {
        // File does not exist on disk (e.g. purged or missing)
        return null;
      }
    }

    // S3 or R2 driver: generate short-lived (60 s) presigned URL with ResponseContentDisposition
    const downloadUrl = await driver.presignDownload(row.storageKey, {
      expiresInSeconds: 60,
      responseContentDisposition: sanitized.dispositionHeader,
    });

    return {
      mediaId: row.id,
      driverType: driver.driverType,
      mime: row.mime,
      bytes: Number(row.bytes),
      safeFilename: sanitized.safeFilename,
      encodedFilename: sanitized.encodedFilename,
      dispositionHeader: sanitized.dispositionHeader,
      downloadUrl,
    };
  });
}
