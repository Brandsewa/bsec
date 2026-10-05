import { sql } from "drizzle-orm";
import { withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { resolveEffectiveQuota } from "../system/quotas.ts";
import type { StorageUsageBreakdownItem, StorageUsageView } from "@bs/contracts";

/**
 * Retrieves storage usage information for store admin.
 * Read-only view with strict key containment — never leaks storage credentials,
 * bucket names, endpoints, or object keys (PLAN §10.2 / Settings Phase 8).
 */
export async function getStorageUsage(
  rt: Runtime,
  ctx: TenantContext,
): Promise<StorageUsageView> {
  assertPermission(ctx, "settings.read");

  // 1. Single indexed aggregate grouping by folder under withTenant isolation
  const rows = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    return await tx.execute<{ folder: string; bytes: string; count: string }>(sql`
      SELECT
        folder,
        COALESCE(SUM(bytes), 0)::text as bytes,
        COUNT(*)::text as count
      FROM media
      WHERE tenant_id = ${ctx.tenantId}
      GROUP BY folder;
    `);
  });

  const breakdownMap: Record<"product_images" | "brand_assets" | "theme_assets" | "other", { bytes: number; count: number }> = {
    product_images: { bytes: 0, count: 0 },
    brand_assets: { bytes: 0, count: 0 },
    theme_assets: { bytes: 0, count: 0 },
    other: { bytes: 0, count: 0 },
  };

  for (const row of rows.rows) {
    const bytes = parseInt(row.bytes ?? "0", 10);
    const count = parseInt(row.count ?? "0", 10);
    if (row.folder === "products") {
      breakdownMap.product_images.bytes += bytes;
      breakdownMap.product_images.count += count;
    } else if (row.folder === "branding") {
      breakdownMap.brand_assets.bytes += bytes;
      breakdownMap.brand_assets.count += count;
    } else if (row.folder === "themes") {
      breakdownMap.theme_assets.bytes += bytes;
      breakdownMap.theme_assets.count += count;
    } else {
      breakdownMap.other.bytes += bytes;
      breakdownMap.other.count += count;
    }
  }

  const breakdown: StorageUsageBreakdownItem[] = [
    { kind: "product_images", ...breakdownMap.product_images },
    { kind: "brand_assets", ...breakdownMap.brand_assets },
    { kind: "theme_assets", ...breakdownMap.theme_assets },
    { kind: "other", ...breakdownMap.other },
  ];

  const usedBytes = breakdown.reduce((acc, curr) => acc + curr.bytes, 0);
  const mediaCount = breakdown.reduce((acc, curr) => acc + curr.count, 0);

  // 2. Resolve quota limits
  const fileQuota = await resolveEffectiveQuota(rt._db.db, ctx.tenantId, "media_file_mb");
  const storageQuota = await resolveEffectiveQuota(rt._db.db, ctx.tenantId, "storage_mb");

  const maxUploadBytes = fileQuota.limit * 1024 * 1024;
  const limitBytes = storageQuota.limit > 0 ? storageQuota.limit * 1024 * 1024 : null;

  let percentUsed: number | null = null;
  let state: "ok" | "warning" | "critical" | "over" = "ok";

  if (limitBytes !== null && limitBytes > 0) {
    const ratio = usedBytes / limitBytes;
    percentUsed = Math.round(ratio * 100);
    if (ratio > 1.0) {
      state = "over";
    } else if (ratio >= 0.95) {
      state = "critical";
    } else if (ratio >= 0.80) {
      state = "warning";
    } else {
      state = "ok";
    }
  }

  const publicMediaConfigured = Boolean(
    process.env.R2_PUBLIC_URL || process.env.CF_IMAGES_DELIVERY_URL,
  );

  return {
    usedBytes,
    limitBytes,
    mediaCount,
    percentUsed,
    state,
    providerLabel: "Platform managed storage",
    publicMediaConfigured,
    maxUploadBytes,
    breakdown,
  };
}
