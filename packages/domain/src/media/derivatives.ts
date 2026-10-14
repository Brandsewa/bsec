import { and, eq, ne, sql } from "drizzle-orm";
import { type Db, schema, withTenant } from "@bs/db";
import type { MediaDerivativeItem } from "@bs/blocks";
import { resolveDriverForMediaRow } from "./connection.ts";

export interface ProcessMediaDeriveResult {
  derived: number;
  dominantColor: string | null;
  derivatives: MediaDerivativeItem[];
}

const DERIVATIVE_WIDTHS = [320, 640, 1024, 1600] as const;

/**
 * sharp is a native module. Load it only when an image is actually processed, so a service that merely imports
 * the domain package (web build step, platform, tests) never needs the native binary at start-up.
 */
async function loadSharp() {
  return (await import("sharp")).default;
}

/** EXIF orientations 5-8 turn the picture by 90 degrees, so the stored width and height swap. */
export function orientedSize(meta: { width?: number | undefined; height?: number | undefined; orientation?: number | undefined }): {
  width: number;
  height: number;
} {
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  return meta.orientation !== undefined && meta.orientation >= 5 ? { width: h, height: w } : { width: w, height: h };
}

/**
 * File name segment that identifies one uploaded file. Derived keys include it, so replacing a file never reuses
 * the old derived keys (no race with the old file's purge, no stale browser or CDN copies of the old image).
 */
function sourceFileId(storageKey: string): string {
  const base = storageKey.split("/").pop() ?? "src";
  return base.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "") || "src";
}

/**
 * Worker job handler for media.derive (Phase 4 Plan S2).
 * Generates WebP derivatives at widths [320, 640, 1024, 1600] (never upscaling),
 * extracts dominant color via sharp.stats(), strips metadata, and stores at:
 * ${tenantId}/_derived/${mediaId}/${sourceFileId}/w{width}.webp.
 *
 * Runs as app_rw under withTenant isolation with strict tenant-prefix assertions.
 * Derived files are excluded from tenant storage_mb quotas.
 */
export async function processMediaDerive(
  db: Db,
  params: { tenantId: string; mediaId: string },
): Promise<ProcessMediaDeriveResult> {
  if (!params.tenantId || !params.mediaId) {
    return { derived: 0, dominantColor: null, derivatives: [] };
  }

  return await withTenant(db, params.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        id: schema.media.id,
        tenantId: schema.media.tenantId,
        storageKey: schema.media.storageKey,
        storageConnectionId: schema.media.storageConnectionId,
        kind: schema.media.kind,
        mime: schema.media.mime,
        status: schema.media.status,
      })
      .from(schema.media)
      .where(and(eq(schema.media.id, params.mediaId), eq(schema.media.tenantId, params.tenantId)))
      .limit(1);

    if (!row || row.status !== "ready") {
      return { derived: 0, dominantColor: null, derivatives: [] };
    }

    // Only process static images; skip GIF, video, and documents
    if (row.kind !== "image" || row.mime === "image/gif") {
      return { derived: 0, dominantColor: null, derivatives: [] };
    }

    const driver = await resolveDriverForMediaRow(db, row.storageConnectionId, "public_media");
    if (!driver) {
      return { derived: 0, dominantColor: null, derivatives: [] };
    }

    const originalBytes = await driver.get(row.storageKey);
    if (!originalBytes || originalBytes.length === 0) {
      return { derived: 0, dominantColor: null, derivatives: [] };
    }

    const sharp = await loadSharp();
    let meta: { width?: number | undefined; height?: number | undefined; orientation?: number | undefined } = {};
    try {
      meta = await sharp(originalBytes).metadata();
    } catch {
      // Undecodable: handled just below
    }
    const { width: origW, height: origH } = orientedSize(meta);

    if (origW <= 0 || origH <= 0) {
      // Not decodable: record "no derivatives" so the backfill does not pick this row up forever
      await tx
        .update(schema.media)
        .set({ derivatives: {}, updatedAt: new Date() })
        .where(and(eq(schema.media.id, row.id), eq(schema.media.tenantId, params.tenantId)));
      return { derived: 0, dominantColor: null, derivatives: [] };
    }

    // Auto-orient first: phone photos carry the turn in EXIF, which is dropped from the derived files
    const image = sharp(originalBytes).rotate();

    // Extract dominant color from image statistics
    let dominantColor: string | null = null;
    try {
      const stats = await image.stats();
      if (stats.dominant) {
        const r = Math.round(stats.dominant.r);
        const g = Math.round(stats.dominant.g);
        const b = Math.round(stats.dominant.b);
        dominantColor = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
      }
    } catch {
      // Non-fatal if stats cannot extract dominant color
    }

    // Generate WebP derivatives at widths [320, 640, 1024, 1600] capped at original width (never upscale)
    const targetWidths = DERIVATIVE_WIDTHS.filter((w) => w < origW);
    const derivativesList: MediaDerivativeItem[] = [];

    for (const w of targetWidths) {
      const derivedKey = `${params.tenantId}/_derived/${row.id}/${sourceFileId(row.storageKey)}/w${w}.webp`;

      // Strict security assertion: derived keys must stay within tenant prefix
      if (!derivedKey.startsWith(`${params.tenantId}/`)) {
        throw new Error(
          `Security violation: derived key "${derivedKey}" does not match tenant prefix "${params.tenantId}/"`,
        );
      }

      // Generate stripped WebP variant
      const webpBuf = await sharp(originalBytes)
        .rotate()
        .resize({ width: w, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();

      await driver.put({
        key: derivedKey,
        body: webpBuf,
        contentType: "image/webp",
      });

      const h = Math.round(origH * (w / origW));
      derivativesList.push({
        w,
        h,
        bytes: webpBuf.length,
        key: derivedKey,
      });
    }

    const derivativesMap: Record<string, { key: string; width: number; height: number; bytes: number }> = {};
    for (const item of derivativesList) {
      derivativesMap[`w${item.w}`] = {
        key: item.key,
        width: item.w,
        height: item.h ?? Math.round(origH * (item.w / origW)),
        bytes: item.bytes ?? 0,
      };
    }

    // Update media row with derivatives and dominant color
    await tx
      .update(schema.media)
      .set({
        derivatives: derivativesMap,
        dominantColor,
        width: origW,
        height: origH,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.media.id, row.id), eq(schema.media.tenantId, params.tenantId)));

    return {
      derived: derivativesList.length,
      dominantColor,
      derivatives: derivativesList,
    };
  });
}

/**
 * Backfill job handler for media.backfill_derivatives (Phase 4 Plan S2).
 * Processes existing library images in throttled batches (default 50 per pass)
 * and re-enqueues itself if additional candidates remain.
 */
export async function backfillMediaDerivatives(
  db: Db,
  params?: {
    tenantId?: string | undefined;
    batchSize?: number | undefined;
    jobs?: { send: (queue: string, data: object, options?: { startAfter?: number }) => Promise<unknown> } | null | undefined;
  },
): Promise<{ processed: number; hasMore: boolean }> {
  const batchSize = params?.batchSize ?? 50;
  const targetTenants: string[] = params?.tenantId
    ? [params.tenantId]
    : (await db.select({ id: schema.tenants.id }).from(schema.tenants)).map((t) => t.id);

  let totalProcessed = 0;
  let hasMore = false;

  for (const tId of targetTenants) {
    let tenantHasMore = false;
    const candidates = await withTenant(db, tId, async (tx) => {
      return await tx
        .select({ id: schema.media.id })
        .from(schema.media)
        .where(
          and(
            eq(schema.media.tenantId, tId),
            eq(schema.media.kind, "image"),
            eq(schema.media.status, "ready"),
            ne(schema.media.mime, "image/gif"),
            sql`${schema.media.derivatives} is null`,
          ),
        )
        .limit(batchSize + 1);
    });

    const itemsToProcess = candidates.slice(0, batchSize);
    if (candidates.length > batchSize) {
      tenantHasMore = true;
      hasMore = true;
    }

    for (const item of itemsToProcess) {
      try {
        await processMediaDerive(db, { tenantId: tId, mediaId: item.id });
        totalProcessed++;
      } catch (err) {
        // Unreadable file: record "no derivatives" so it is not selected again and cannot make this job loop forever
        console.warn(`[media.derive] Failed to process derivative for ${item.id}:`, err);
        await withTenant(db, tId, async (tx) => {
          await tx
            .update(schema.media)
            .set({ derivatives: {}, updatedAt: new Date() })
            .where(and(eq(schema.media.id, item.id), eq(schema.media.tenantId, tId), sql`${schema.media.derivatives} is null`));
        }).catch(() => undefined);
      }
    }

    if (tenantHasMore && params?.jobs) {
      // Pause between batches so a big library cannot starve the worker
      await params.jobs.send("media.backfill_derivatives", { tenantId: tId }, { startAfter: 30 });
    }
  }

  return { processed: totalProcessed, hasMore };
}
