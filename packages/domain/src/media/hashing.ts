import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { type Db, schema, withTenant } from "@bs/db";
import { resolveDriverForMediaRow, getActiveStorageDriver } from "./connection.ts";

export interface ProcessMediaHashResult {
  hashed: boolean;
  sha256: string | null;
}

/**
 * Worker job handler for media.hash (Phase 4 Plan S4).
 * Streams or downloads media file, computes complete SHA-256 hash,
 * and updates media.sha256 in the database.
 *
 * Runs under withTenant isolation with strict tenant safety.
 */
export async function processMediaHash(
  db: Db,
  params: { tenantId: string; mediaId: string },
): Promise<ProcessMediaHashResult> {
  if (!params.tenantId || !params.mediaId) {
    return { hashed: false, sha256: null };
  }

  return await withTenant(db, params.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        id: schema.media.id,
        tenantId: schema.media.tenantId,
        storageKey: schema.media.storageKey,
        storageConnectionId: schema.media.storageConnectionId,
        sha256: schema.media.sha256,
        status: schema.media.status,
      })
      .from(schema.media)
      .where(and(eq(schema.media.id, params.mediaId), eq(schema.media.tenantId, params.tenantId)))
      .limit(1);

    if (!row || row.status !== "ready") {
      return { hashed: false, sha256: null };
    }

    if (row.sha256) {
      return { hashed: false, sha256: row.sha256 };
    }

    let driver = await resolveDriverForMediaRow(db, row.storageConnectionId, "public_media");
    if (!driver) {
      const active = await getActiveStorageDriver(db, "public_media");
      driver = active.driver;
    }
    if (!driver) {
      return { hashed: false, sha256: null };
    }

    const fileBytes = await driver.get(row.storageKey);
    if (!fileBytes || fileBytes.length === 0) {
      return { hashed: false, sha256: null };
    }

    const hash = crypto.createHash("sha256").update(fileBytes).digest("hex");

    await tx
      .update(schema.media)
      .set({
        sha256: hash,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.media.id, row.id), eq(schema.media.tenantId, params.tenantId)));

    return { hashed: true, sha256: hash };
  });
}

/**
 * Backfills missing SHA-256 hashes (Plan S4).
 * Each run handles one page of rows per tenant (ordered by id, resuming after `afterId`) and re-enqueues a
 * continuation when a tenant has more. Rows that cannot be hashed (missing file) are skipped by the cursor, so
 * a few unreadable rows can never starve the rest or make the chain loop. Runs under withTenant as app_rw.
 */
export async function backfillMediaHashes(
  db: Db,
  batchSize = 100,
  tenantId?: string,
  options?: {
    afterId?: string | undefined;
    jobs?: { send: (queue: string, data: object, options?: { startAfter?: number }) => Promise<unknown> } | null | undefined;
  },
): Promise<{ processed: number; errors: number }> {
  let processed = 0;
  let errors = 0;

  const targetTenantIds: string[] = tenantId
    ? [tenantId]
    : (await db.select({ id: schema.tenants.id }).from(schema.tenants)).map((t) => t.id);

  for (const tId of targetTenantIds) {
    const rows = await withTenant(db, tId, async (tx) => {
      return await tx
        .select({ id: schema.media.id })
        .from(schema.media)
        .where(
          and(
            eq(schema.media.tenantId, tId),
            sql`${schema.media.sha256} IS NULL`,
            eq(schema.media.status, "ready"),
            ...(options?.afterId ? [sql`${schema.media.id} > ${options.afterId}`] : []),
          ),
        )
        .orderBy(schema.media.id)
        .limit(batchSize + 1);
    });

    const page = rows.slice(0, batchSize);
    for (const r of page) {
      try {
        const res = await processMediaHash(db, { tenantId: tId, mediaId: r.id });
        if (res.hashed) processed++;
      } catch {
        errors++;
      }
    }

    const last = page[page.length - 1];
    if (rows.length > batchSize && last && options?.jobs) {
      await options.jobs.send(
        "media.backfill_hashes",
        { tenantId: tId, afterId: last.id, batchSize },
        { startAfter: 30 },
      );
    }
  }

  return { processed, errors };
}
