import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema, withTenant } from "@bs/db";
import { and, eq } from "drizzle-orm";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { STORE_PERMISSIONS } from "@bs/auth";
import {
  createRuntime,
  provisionTenant,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import {
  createPlatformStorageConnection,
  activatePlatformStorageConnection,
} from "../src/platform/storage-connections.ts";
import { invalidateStorageConnectionCache } from "../src/media/connection.ts";
import {
  uploadMediaDirect,
  trashMedia,
  deleteMediaPermanent,
  updateMedia,
} from "../src/media-services.ts";
import {
  createPage,
  getPage,
  savePageDraft,
  publishPage,
  rollbackPage,
  unpublishPage,
  duplicatePage,
  deletePage,
  updateTheme,
} from "../src/content-services.ts";
import {
  backfillDocumentMediaUsages,
  extractMediaReferences,
} from "../src/media/document-usages.ts";
import { tenantTag } from "../src/cache-tags.ts";

describe("Media Document Usages Integration Test Suite (S4, S5, Real Postgres)", () => {
  let env: TestDb;
  let rt: Runtime;
  let rtPlatform: Runtime;
  let ctx: TenantContext;
  let foreignCtx: TenantContext;
  let tenantId: string;
  let foreignTenantId: string;
  let tempStorageDir: string;
  let capturedTags: string[] = [];

  const PNG_1X1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );

  // 16-byte valid MP4 buffer: starts with 4-byte length, 'ftyp', then 'isom'
  const MP4_VALID = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00,
  ]);
  const PDF_VALID = Buffer.from("%PDF-1.4 test dummy document");

  beforeAll(async () => {
    env = await startTestDb();
    rtPlatform = createRuntime({
      service: "platform",
      databaseUrl: env.as("app_platform"),
      poolMax: 10,
    });

    rt = createRuntime({
      service: "web",
      databaseUrl: env.as("app_rw"),
      poolMax: 10,
      revalidateTags: (tags) => {
        capturedTags.push(...tags);
      },
    });

    tempStorageDir = path.join(os.tmpdir(), `bsec-media-doc-usages-test-${Date.now()}`);
    fs.mkdirSync(tempStorageDir, { recursive: true });
    process.env.STORAGE_LOCAL_DIR = tempStorageDir;

    const tenant = await provisionTenant(rtPlatform, {
      storeName: "Doc Usages Store",
      slug: `doc-usages-${Date.now()}`,
      owner: { email: `owner-${Date.now()}@doc-usages.test`, name: "Doc Owner" },
      planCode: "starter",
      source: "platform_admin",
    });
    tenantId = tenant.tenantId;

    const foreignTenant = await provisionTenant(rtPlatform, {
      storeName: "Foreign Store",
      slug: `foreign-usages-${Date.now()}`,
      owner: { email: `foreign-${Date.now()}@doc-usages.test`, name: "Foreign Owner" },
      planCode: "starter",
      source: "platform_admin",
    });
    foreignTenantId = foreignTenant.tenantId;

    const staff = await seedPlatformStaff(rtPlatform._db.db, {
      email: `doc-usages-admin-${Date.now()}@platform.test`,
      role: "platform_admin",
    });

    const conn = await createPlatformStorageConnection(rtPlatform, staff.userId, {
      name: "Test Doc Usages Local Storage",
      driver: "local",
      purpose: "public_media",
      localDir: tempStorageDir,
    });
    await activatePlatformStorageConnection(rtPlatform, staff.userId, conn.id);
    invalidateStorageConnectionCache();

    ctx = {
      tenantId,
      storeStatus: "live",
      actor: { type: "staff", userId: tenant.ownerId },
      roles: ["owner", "store_owner"],
      permissions: STORE_PERMISSIONS,
      requestId: "test-req-doc-usages",
    };

    foreignCtx = {
      tenantId: foreignTenantId,
      storeStatus: "live",
      actor: { type: "staff", userId: foreignTenant.ownerId },
      roles: ["owner", "store_owner"],
      permissions: STORE_PERMISSIONS,
      requestId: "test-req-foreign-usages",
    };
  });

  afterAll(async () => {
    if (fs.existsSync(tempStorageDir)) {
      fs.rmSync(tempStorageDir, { recursive: true, force: true });
    }
    delete process.env.STORAGE_LOCAL_DIR;
    await env?.stop();
  });

  it("extracts media references correctly with kinds", () => {
    const dummyImageId = "00000000-0000-0000-0000-000000000001";
    const dummyVideoId = "00000000-0000-0000-0000-000000000002";
    const dummyFileId = "00000000-0000-0000-0000-000000000003";

    const doc = {
      sections: [
        {
          id: "sec-1",
          type: "Hero",
          props: {
            backgroundMediaId: dummyImageId,
          },
        },
        {
          id: "sec-2",
          type: "Video",
          props: {
            mediaId: dummyVideoId,
            posterMediaId: dummyImageId,
          },
        },
        {
          id: "sec-3",
          type: "FileDownload",
          props: {
            mediaId: dummyFileId,
          },
        },
      ],
    };

    const refs = extractMediaReferences(doc);
    expect(refs).toEqual(
      expect.arrayContaining([
        { id: dummyImageId, field: "Hero.backgroundMediaId", expectedKind: "image" },
        { id: dummyVideoId, field: "Video.mediaId", expectedKind: "video" },
        { id: dummyImageId, field: "Video.posterMediaId", expectedKind: "image" },
        { id: dummyFileId, field: "FileDownload.mediaId", expectedKind: "document" },
      ]),
    );
  });

  it("tracks media usages through the full page lifecycle (create, draft, publish, rollback, unpublish, duplicate, delete)", async () => {
    // 1. Upload test media
    const img1 = await uploadMediaDirect(rt, ctx, {
      filename: "page-hero.png",
      mime: "image/png",
      fileBytes: PNG_1X1,
    });

    const vid1 = await uploadMediaDirect(rt, ctx, {
      filename: "page-promo.mp4",
      mime: "video/mp4",
      fileBytes: MP4_VALID,
    });

    const file1 = await uploadMediaDirect(rt, ctx, {
      filename: "spec.pdf",
      mime: "application/pdf",
      fileBytes: PDF_VALID,
    });

    // 2. Create Page
    const page = await createPage(rt, ctx, {
      title: "Lifecycle Test Page",
      slug: `lifecycle-${Date.now()}`,
    });

    // 3. Save Draft with initial image
    await savePageDraft(rt, ctx, {
      id: page.id,
      blocks: [
        {
          id: "b-hero",
          type: "Hero",
          props: { title: "Welcome Hero", backgroundMediaId: img1.id },
        },
      ],
    });

    // Check draft usage recorded
    const usagesAfterCreate = await withTenant(rt._db.db, tenantId, async (tx) =>
      tx
        .select()
        .from(schema.mediaUsages)
        .where(
          and(
            eq(schema.mediaUsages.tenantId, tenantId),
            eq(schema.mediaUsages.ownerType, "page"),
            eq(schema.mediaUsages.ownerId, page.id),
          ),
        ),
    );
    expect(usagesAfterCreate).toHaveLength(1);
    expect(usagesAfterCreate[0]?.mediaId).toBe(img1.id);
    expect(usagesAfterCreate[0]?.field).toBe("draft");

    // 4. Save Draft with added video and file
    await savePageDraft(rt, ctx, {
      id: page.id,
      blocks: [
        {
          id: "b-hero",
          type: "Hero",
          props: { title: "Welcome Hero", backgroundMediaId: img1.id },
        },
        {
          id: "b-vid",
          type: "Video",
          props: { mediaId: vid1.id },
        },
        {
          id: "b-file",
          type: "FileDownload",
          props: { label: "User Manual", mediaId: file1.id },
        },
      ],
    });

    const usagesAfterDraft = await withTenant(rt._db.db, tenantId, async (tx) =>
      tx
        .select()
        .from(schema.mediaUsages)
        .where(
          and(
            eq(schema.mediaUsages.tenantId, tenantId),
            eq(schema.mediaUsages.ownerType, "page"),
            eq(schema.mediaUsages.ownerId, page.id),
          ),
        ),
    );
    expect(usagesAfterDraft).toHaveLength(3);
    const draftMediaIds = usagesAfterDraft.map((u) => u.mediaId).sort();
    expect(draftMediaIds).toEqual([img1.id, vid1.id, file1.id].sort());
    expect(usagesAfterDraft.every((u) => u.field === "draft")).toBe(true);

    // 5. Publish Page
    await publishPage(rt, ctx, { id: page.id });

    const usagesAfterPublish = await withTenant(rt._db.db, tenantId, async (tx) =>
      tx
        .select()
        .from(schema.mediaUsages)
        .where(
          and(
            eq(schema.mediaUsages.tenantId, tenantId),
            eq(schema.mediaUsages.ownerType, "page"),
            eq(schema.mediaUsages.ownerId, page.id),
          ),
        ),
    );
    // Should have 3 draft + 3 published = 6 usages
    expect(usagesAfterPublish).toHaveLength(6);
    const publishedUsages = usagesAfterPublish.filter((u) => u.field === "published");
    expect(publishedUsages).toHaveLength(3);
    expect(publishedUsages.map((u) => u.mediaId).sort()).toEqual([img1.id, vid1.id, file1.id].sort());

    // 6. Save Draft without video (simulate draft edit while published retains video)
    await savePageDraft(rt, ctx, {
      id: page.id,
      blocks: [
        {
          id: "b-hero",
          type: "Hero",
          props: { title: "Welcome Hero", backgroundMediaId: img1.id },
        },
      ],
    });

    const usagesAfterDraftEdit = await withTenant(rt._db.db, tenantId, async (tx) =>
      tx
        .select()
        .from(schema.mediaUsages)
        .where(
          and(
            eq(schema.mediaUsages.tenantId, tenantId),
            eq(schema.mediaUsages.ownerType, "page"),
            eq(schema.mediaUsages.ownerId, page.id),
          ),
        ),
    );
    const draftAfterEdit = usagesAfterDraftEdit.filter((u) => u.field === "draft");
    const publishedAfterEdit = usagesAfterDraftEdit.filter((u) => u.field === "published");
    expect(draftAfterEdit).toHaveLength(1);
    expect(draftAfterEdit[0]?.mediaId).toBe(img1.id);
    expect(publishedAfterEdit).toHaveLength(3);

    // 7. Rollback to published version
    const pageBeforeRollback = await getPage(rt, ctx, { id: page.id });
    const pubVerId = pageBeforeRollback?.publishedVersionId;
    if (!pubVerId) throw new Error("Missing published version id");

    await rollbackPage(rt, ctx, { id: page.id, targetVersionId: pubVerId });

    const usagesAfterRollback = await withTenant(rt._db.db, tenantId, async (tx) =>
      tx
        .select()
        .from(schema.mediaUsages)
        .where(
          and(
            eq(schema.mediaUsages.tenantId, tenantId),
            eq(schema.mediaUsages.ownerType, "page"),
            eq(schema.mediaUsages.ownerId, page.id),
          ),
        ),
    );
    const draftAfterRollback = usagesAfterRollback.filter((u) => u.field === "draft");
    expect(draftAfterRollback).toHaveLength(3);

    // 8. Duplicate page
    const duplicate = await duplicatePage(rt, ctx, { id: page.id });

    const usagesForClone = await withTenant(rt._db.db, tenantId, async (tx) =>
      tx
        .select()
        .from(schema.mediaUsages)
        .where(
          and(
            eq(schema.mediaUsages.tenantId, tenantId),
            eq(schema.mediaUsages.ownerType, "page"),
            eq(schema.mediaUsages.ownerId, duplicate.id),
          ),
        ),
    );
    expect(usagesForClone).toHaveLength(3);
    expect(usagesForClone.every((u) => u.field === "draft")).toBe(true);

    // 9. Unpublish page
    await unpublishPage(rt, ctx, { id: page.id });

    const usagesAfterUnpublish = await withTenant(rt._db.db, tenantId, async (tx) =>
      tx
        .select()
        .from(schema.mediaUsages)
        .where(
          and(
            eq(schema.mediaUsages.tenantId, tenantId),
            eq(schema.mediaUsages.ownerType, "page"),
            eq(schema.mediaUsages.ownerId, page.id),
          ),
        ),
    );
    expect(usagesAfterUnpublish.filter((u) => u.field === "published")).toHaveLength(0);
    expect(usagesAfterUnpublish.filter((u) => u.field === "draft")).toHaveLength(3);

    // 10. Permanent delete of media in use is BLOCKED
    await trashMedia(rt, ctx, { ids: [img1.id] });
    const deleteResult = await deleteMediaPermanent(rt, ctx, { ids: [img1.id] });
    expect(deleteResult.deleted).toBe(0);
    expect(deleteResult.blocked).toHaveLength(1);
    expect(deleteResult.blocked[0]?.id).toBe(img1.id);

    // 11. Delete page clears all usages
    await deletePage(rt, ctx, { id: page.id });
    const usagesAfterDelete = await withTenant(rt._db.db, tenantId, async (tx) =>
      tx
        .select()
        .from(schema.mediaUsages)
        .where(
          and(
            eq(schema.mediaUsages.tenantId, tenantId),
            eq(schema.mediaUsages.ownerType, "page"),
            eq(schema.mediaUsages.ownerId, page.id),
          ),
        ),
    );
    expect(usagesAfterDelete).toHaveLength(0);
  });

  it("validates newly added media references (rejects foreign tenant, wrong kind, trashed, invalid UUID)", async () => {
    // Media from foreign tenant
    const foreignMedia = await uploadMediaDirect(rt, foreignCtx, {
      filename: "foreign.png",
      mime: "image/png",
      fileBytes: PNG_1X1,
    });

    // Trashed media
    const trashedMedia = await uploadMediaDirect(rt, ctx, {
      filename: "trashed.png",
      mime: "image/png",
      fileBytes: PNG_1X1,
    });
    await trashMedia(rt, ctx, { ids: [trashedMedia.id] });

    // Image media
    const imgMedia = await uploadMediaDirect(rt, ctx, {
      filename: "real-image.png",
      mime: "image/png",
      fileBytes: PNG_1X1,
    });

    const page = await createPage(rt, ctx, {
      title: "Validation Test Page",
      slug: `val-${Date.now()}`,
    });

    // 1. Foreign tenant rejected
    await expect(
      savePageDraft(rt, ctx, {
        id: page.id,
        blocks: [
          {
            id: "b-1",
            type: "Hero",
            props: { title: "Title", backgroundMediaId: foreignMedia.id },
          },
        ],
      }),
    ).rejects.toThrow(/not found|not belong to store/i);

    // 2. Trashed media rejected on addition
    await expect(
      savePageDraft(rt, ctx, {
        id: page.id,
        blocks: [
          {
            id: "b-2",
            type: "Hero",
            props: { title: "Title", backgroundMediaId: trashedMedia.id },
          },
        ],
      }),
    ).rejects.toThrow(/trashed/i);

    // 3. Wrong kind rejected (image used where video is expected)
    await expect(
      savePageDraft(rt, ctx, {
        id: page.id,
        blocks: [
          {
            id: "b-3",
            type: "Video",
            props: { mediaId: imgMedia.id }, // Image passed for Video.mediaId
          },
        ],
      }),
    ).rejects.toThrow(/expected video/i);

    // 4. Invalid non-UUID rejected with descriptive error
    await expect(
      savePageDraft(rt, ctx, {
        id: page.id,
        blocks: [
          {
            id: "b-4",
            type: "Hero",
            props: { title: "Title", backgroundMediaId: "not-a-uuid" },
          },
        ],
      }),
    ).rejects.toThrow(/invalid media id/i);
  });

  it("tolerates existing media references that are later trashed when updating unrelated fields", async () => {
    const validImg = await uploadMediaDirect(rt, ctx, {
      filename: "will-be-trashed.png",
      mime: "image/png",
      fileBytes: PNG_1X1,
    });

    const page = await createPage(rt, ctx, {
      title: "Tolerant Test Page",
      slug: `tolerant-${Date.now()}`,
    });

    await savePageDraft(rt, ctx, {
      id: page.id,
      blocks: [
        {
          id: "b-1",
          type: "Hero",
          props: { title: "Initial Title", backgroundMediaId: validImg.id },
        },
      ],
    });

    // Trash the image after it was already linked
    await trashMedia(rt, ctx, { ids: [validImg.id] });

    // Updating unrelated text in the same draft should NOT be blocked by the existing trashed media
    await expect(
      savePageDraft(rt, ctx, {
        id: page.id,
        blocks: [
          {
            id: "b-1",
            type: "Hero",
            props: { title: "Updated Title", backgroundMediaId: validImg.id },
          },
        ],
      }),
    ).resolves.not.toThrow();
  });

  it("tracks theme token media usages and handles backfill idempotently", async () => {
    const themeLogo = await uploadMediaDirect(rt, ctx, {
      filename: "theme-logo.png",
      mime: "image/png",
      fileBytes: PNG_1X1,
    });

    const themeRows = await withTenant(rt._db.db, tenantId, async (tx) =>
      tx
        .select()
        .from(schema.themes)
        .where(eq(schema.themes.tenantId, tenantId))
        .limit(1),
    );

    expect(themeRows.length).toBeGreaterThan(0);
    const themeId = themeRows[0]?.id;
    if (!themeId) throw new Error("No theme found for tenant");

    await updateTheme(rt, ctx, {
      themeId,
      tokens: {
        brand: {
          logoMediaId: themeLogo.id,
        },
      },
    });

    const themeUsages = await withTenant(rt._db.db, tenantId, async (tx) =>
      tx
        .select()
        .from(schema.mediaUsages)
        .where(
          and(
            eq(schema.mediaUsages.tenantId, tenantId),
            eq(schema.mediaUsages.ownerType, "theme"),
            eq(schema.mediaUsages.ownerId, themeId),
          ),
        ),
    );
    expect(themeUsages).toHaveLength(1);
    expect(themeUsages[0]?.mediaId).toBe(themeLogo.id);
    expect(themeUsages[0]?.field).toBe("tokens");

    // Test backfillDocumentMediaUsages
    const backfillResult = await backfillDocumentMediaUsages(rt._db.db, tenantId);
    expect(backfillResult.syncedPages).toBeGreaterThan(0);
    expect(backfillResult.syncedThemes).toBeGreaterThan(0);

    // Idempotent second run
    const backfillResult2 = await backfillDocumentMediaUsages(rt._db.db, tenantId);
    expect(backfillResult2.syncedPages).toBe(backfillResult.syncedPages);
    expect(backfillResult2.syncedThemes).toBe(backfillResult.syncedThemes);
  });

  it("fans out cache tags when media used in pages and templates is updated", async () => {
    capturedTags = [];

    const fanoutImg = await uploadMediaDirect(rt, ctx, {
      filename: "fanout-test.png",
      mime: "image/png",
      fileBytes: PNG_1X1,
    });

    const pageSlug = `fanout-page-${Date.now()}`;
    const page = await createPage(rt, ctx, {
      title: "Fanout Page",
      slug: pageSlug,
    });

    await savePageDraft(rt, ctx, {
      id: page.id,
      blocks: [
        {
          id: "b-1",
          type: "Hero",
          props: { title: "Fanout Hero", backgroundMediaId: fanoutImg.id },
        },
      ],
    });

    // Publish so it becomes a live storefront usage
    await publishPage(rt, ctx, { id: page.id });

    // Update the media alt/name to trigger cache invalidation
    capturedTags = [];
    await updateMedia(rt, ctx, { id: fanoutImg.id, alt: "New Alt Text" });

    // Verify tag page:<slug> was invalidated
    expect(capturedTags).toContain(tenantTag(ctx, "page", pageSlug));
  });
});
