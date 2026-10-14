import { and, eq, inArray } from "drizzle-orm";
import { type Db, schema, withTenant } from "@bs/db";
import { isMediaKey, isUuid } from "@bs/blocks";
import { PRIVATE_MEDIA_FOLDERS } from "./types.ts";

export type TenantContextRef = { tenantId: string };

export interface ExtractedMediaRef {
  field: string;
  id: string;
  expectedKind: "image" | "video" | "document";
}

/**
 * Classifies the expected media kind based on property key and block type.
 */
function classifyExpectedKind(
  key: string,
  blockType: string | null,
): "image" | "video" | "document" {
  const lowerKey = key.toLowerCase();
  const lowerBlock = (blockType ?? "").toLowerCase();

  if (
    (lowerBlock === "video" && lowerKey === "mediaid") ||
    lowerKey.includes("video")
  ) {
    return "video";
  }

  if (
    (lowerBlock.includes("file") && lowerKey === "mediaid") ||
    lowerKey.includes("file") ||
    lowerKey.includes("doc")
  ) {
    return "document";
  }

  return "image";
}

/**
 * Extracts and validates media references from a block document or theme token object.
 * Throws a Bad Request error if a non-empty value in a media field is not a valid UUID string.
 */
export function extractMediaReferences(
  document: unknown,
  ownerType: "page" | "theme" = "page",
): ExtractedMediaRef[] {
  const refs: ExtractedMediaRef[] = [];
  if (!document || typeof document !== "object") return refs;

  const visited = new WeakSet<object>();

  function walk(node: unknown, currentBlockType: string | null): void {
    if (!node || typeof node !== "object") return;
    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        if (item && typeof item === "object") {
          walk(item, currentBlockType);
        }
      }
      return;
    }

    const obj = node as Record<string, unknown>;
    let blockType = currentBlockType;
    if (typeof obj.type === "string") {
      blockType = obj.type;
    }

    for (const [key, val] of Object.entries(obj)) {
      if (val === null || val === undefined || val === "") continue;

      if (isMediaKey(key)) {
        const fieldName = blockType ? `${blockType}.${key}` : key;
        const expectedKind = classifyExpectedKind(key, blockType);

        if (Array.isArray(val)) {
          for (const item of val) {
            if (item === null || item === undefined || item === "") continue;
            if (typeof item === "string") {
              const trimmed = item.trim();
              if (!isUuid(trimmed)) {
                throw new Error(
                  `Bad Request: Invalid media ID in field "${fieldName}": "${item}"`,
                );
              }
              refs.push({ field: fieldName, id: trimmed, expectedKind });
            } else if (typeof item === "object") {
              walk(item, blockType);
            } else {
              throw new Error(
                `Bad Request: Invalid media ID in field "${fieldName}": "${String(item)}"`,
              );
            }
          }
        } else if (typeof val === "string") {
          const trimmed = val.trim();
          if (!isUuid(trimmed)) {
            throw new Error(
              `Bad Request: Invalid media ID in field "${fieldName}": "${val}"`,
            );
          }
          refs.push({ field: fieldName, id: trimmed, expectedKind });
        } else if (typeof val === "object") {
          walk(val, blockType);
        } else {
          throw new Error(
            `Bad Request: Invalid media ID in field "${fieldName}": "${String(val)}"`,
          );
        }
      } else if (val && typeof val === "object") {
        walk(val, blockType);
      }
    }
  }

  walk(document, ownerType === "page" ? null : "theme");
  return refs;
}

export interface SyncDocumentMediaUsagesParams {
  ownerType: "page" | "theme";
  ownerId: string;
  field: "draft" | "published" | "tokens";
  document: unknown;
}

export interface SyncDocumentMediaUsagesOptions {
  tolerant?: boolean;
}

/**
 * Synchronizes media_usages for a page document (draft/published) or theme tokens.
 * Computes extracted media IDs, diffs against existing rows for (owner, field),
 * and surgically writes only changes (insert missing, delete stale).
 *
 * Validates newly added media IDs (must exist in tenant library, outside private folders,
 * not trashed, matching expected kind). Previously existing IDs are tolerated.
 */
export async function syncDocumentMediaUsages(
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  ctx: TenantContextRef,
  params: SyncDocumentMediaUsagesParams,
  options?: SyncDocumentMediaUsagesOptions,
): Promise<{ added: string[]; removed: string[] }> {
  const extracted = extractMediaReferences(params.document, params.ownerType);
  const targetIdSet = new Set(extracted.map((r) => r.id));

  // 1. Fetch current media_usages for this (owner, field)
  const existingRows = await tx
    .select({
      id: schema.mediaUsages.id,
      mediaId: schema.mediaUsages.mediaId,
    })
    .from(schema.mediaUsages)
    .where(
      and(
        eq(schema.mediaUsages.tenantId, ctx.tenantId),
        eq(schema.mediaUsages.ownerType, params.ownerType),
        eq(schema.mediaUsages.ownerId, params.ownerId),
        eq(schema.mediaUsages.field, params.field),
      ),
    );

  const existingMediaIdSet = new Set(existingRows.map((r) => r.mediaId));

  // 2. Diff
  const addedRefs = extracted.filter((r) => !existingMediaIdSet.has(r.id));
  const addedIds = Array.from(new Set(addedRefs.map((r) => r.id)));
  const removedRows = existingRows.filter((r) => !targetIdSet.has(r.mediaId));
  const removedRowIds = removedRows.map((r) => r.id);
  const removedIds = Array.from(new Set(removedRows.map((r) => r.mediaId)));

  // 3. Validate newly added IDs unless in tolerant mode (e.g. backfill)
  if (!options?.tolerant && addedIds.length > 0) {
    const mediaRecords = await tx
      .select({
        id: schema.media.id,
        kind: schema.media.kind,
        folder: schema.media.folder,
        status: schema.media.status,
      })
      .from(schema.media)
      .where(
        and(
          eq(schema.media.tenantId, ctx.tenantId),
          inArray(schema.media.id, addedIds),
        ),
      );

    const recordMap = new Map(mediaRecords.map((m) => [m.id, m]));

    for (const ref of addedRefs) {
      const rec = recordMap.get(ref.id);
      if (!rec) {
        throw new Error(
          `Bad Request: Media not found in field "${ref.field}": "${ref.id}"`,
        );
      }
      if (rec.folder && (PRIVATE_MEDIA_FOLDERS as readonly string[]).includes(rec.folder)) {
        throw new Error(
          `Bad Request: Cannot use private media in field "${ref.field}"`,
        );
      }
      if (rec.status === "trashed") {
        throw new Error(
          `Bad Request: Cannot use trashed media in field "${ref.field}"`,
        );
      }
      if (ref.expectedKind && rec.kind !== ref.expectedKind) {
        throw new Error(
          `Bad Request: Expected ${ref.expectedKind} media in field "${ref.field}", got ${rec.kind}`,
        );
      }
    }
  }

  // 4. Apply changes surgically
  if (removedRowIds.length > 0) {
    await tx
      .delete(schema.mediaUsages)
      .where(
        and(
          eq(schema.mediaUsages.tenantId, ctx.tenantId),
          inArray(schema.mediaUsages.id, removedRowIds),
        ),
      );
  }

  if (addedIds.length > 0) {
    let idsToInsert = addedIds;
    if (options?.tolerant) {
      // In tolerant mode, only insert IDs that actually exist in media table to satisfy FK
      const validMedia = await tx
        .select({ id: schema.media.id })
        .from(schema.media)
        .where(
          and(
            eq(schema.media.tenantId, ctx.tenantId),
            inArray(schema.media.id, addedIds),
          ),
        );
      idsToInsert = validMedia.map((m) => m.id);
    }

    if (idsToInsert.length > 0) {
      await tx.insert(schema.mediaUsages).values(
        idsToInsert.map((mediaId) => ({
          tenantId: ctx.tenantId,
          mediaId,
          ownerType: params.ownerType,
          ownerId: params.ownerId,
          field: params.field,
        })),
      );
    }
  }

  return { added: addedIds, removed: removedIds };
}

/**
 * Clears media usages for a specific owner and field (e.g. on unpublish).
 */
export async function clearDocumentMediaUsages(
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  ctx: TenantContextRef,
  params: {
    ownerType: "page" | "theme";
    ownerId: string;
    field: "draft" | "published" | "tokens";
  },
): Promise<number> {
  const deleted = await tx
    .delete(schema.mediaUsages)
    .where(
      and(
        eq(schema.mediaUsages.tenantId, ctx.tenantId),
        eq(schema.mediaUsages.ownerType, params.ownerType),
        eq(schema.mediaUsages.ownerId, params.ownerId),
        eq(schema.mediaUsages.field, params.field),
      ),
    )
    .returning({ id: schema.mediaUsages.id });
  return deleted.length;
}

/**
 * Idempotent domain helper to backfill media usages for pages and themes.
 * Runs per tenant under withTenant as app_rw (MEDIA-LIBRARY-PLAN §8, S4).
 */
export async function backfillDocumentMediaUsages(
  db: Db,
  tenantId?: string,
): Promise<{ syncedTenants: number; syncedPages: number; syncedThemes: number }> {
  const targetTenantIds: string[] = tenantId
    ? [tenantId]
    : (await db.select({ id: schema.tenants.id }).from(schema.tenants)).map((t) => t.id);

  let syncedTenants = 0;
  let syncedPages = 0;
  let syncedThemes = 0;

  for (const tId of targetTenantIds) {
    await withTenant(db, tId, async (tx) => {
      const tenantCtx: TenantContextRef = { tenantId: tId };

      // 1. Backfill pages
      const pageList = await tx
        .select({
          id: schema.pages.id,
          draftVersionId: schema.pages.draftVersionId,
          publishedVersionId: schema.pages.publishedVersionId,
        })
        .from(schema.pages)
        .where(eq(schema.pages.tenantId, tId));

      const versionIdsToFetch = Array.from(
        new Set(
          pageList
            .flatMap((p) => [p.draftVersionId, p.publishedVersionId])
            .filter((id): id is string => Boolean(id)),
        ),
      );

      const versionMap = new Map<string, unknown>();
      if (versionIdsToFetch.length > 0) {
        const versions = await tx
          .select({
            id: schema.pageVersions.id,
            document: schema.pageVersions.document,
          })
          .from(schema.pageVersions)
          .where(
            and(
              eq(schema.pageVersions.tenantId, tId),
              inArray(schema.pageVersions.id, versionIdsToFetch),
            ),
          );
        for (const v of versions) {
          versionMap.set(v.id, v.document);
        }
      }

      for (const p of pageList) {
        if (p.draftVersionId) {
          const doc = versionMap.get(p.draftVersionId);
          if (doc) {
            await syncDocumentMediaUsages(
              tx,
              tenantCtx,
              {
                ownerType: "page",
                ownerId: p.id,
                field: "draft",
                document: doc,
              },
              { tolerant: true },
            );
            syncedPages++;
          }
        }
        if (p.publishedVersionId) {
          const doc = versionMap.get(p.publishedVersionId);
          if (doc) {
            await syncDocumentMediaUsages(
              tx,
              tenantCtx,
              {
                ownerType: "page",
                ownerId: p.id,
                field: "published",
                document: doc,
              },
              { tolerant: true },
            );
            syncedPages++;
          }
        }
      }

      // 2. Backfill themes
      const themeList = await tx
        .select({
          id: schema.themes.id,
          tokens: schema.themes.tokens,
        })
        .from(schema.themes)
        .where(eq(schema.themes.tenantId, tId));

      for (const t of themeList) {
        if (t.tokens) {
          await syncDocumentMediaUsages(
            tx,
            tenantCtx,
            {
              ownerType: "theme",
              ownerId: t.id,
              field: "tokens",
              document: t.tokens,
            },
            { tolerant: true },
          );
          syncedThemes++;
        }
      }

      syncedTenants++;
    });
  }

  return { syncedTenants, syncedPages, syncedThemes };
}
