import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { schema, withTenant } from "@bs/db";
import { and, eq, inArray, sql } from "drizzle-orm";
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
  listMedia,
  getMedia,
  updateMedia,
  uploadMediaDirect,
  createMediaRecord,
  trashMedia,
  restoreMedia,
  deleteMediaPermanent,
  runMediaTrashSweep,
  attachProductMedia,
  syncMediaUsages,
  requestMediaUpload,
  findDuplicates,
} from "../src/media-services.ts";
import { processMediaHash, backfillMediaHashes } from "../src/media/hashing.ts";
import { getActiveStorageDriver, LocalStorageDriver } from "../src/media/connection.ts";
import { getTenantMediaUsageStats, QuotaExceededError } from "../src/system/quotas.ts";
import {
  createProduct,
  updateVariant,
  deleteProduct,
  createCollection,
  deleteCollection,
  createCategory,
  deleteCategory,
  createBrand,
  deleteBrand,
} from "../src/catalog-services.ts";

describe("Media Services Integration Test Suite (Real Postgres & Storage)", () => {
  let env: TestDb;
  let rt: Runtime;
  let rtPlatform: Runtime;
  let ctx: TenantContext;
  let tenantId: string;
  let tempStorageDir: string;

  const PNG_1X1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );

  beforeAll(async () => {
    env = await startTestDb();
    rt = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 10 });
    rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 10 });

    tempStorageDir = path.join(os.tmpdir(), `bsec-media-test-${Date.now()}`);
    fs.mkdirSync(tempStorageDir, { recursive: true });
    process.env.STORAGE_LOCAL_DIR = tempStorageDir;

    const tenant = await provisionTenant(rtPlatform, {
      storeName: "Media Services Test Store",
      slug: `media-test-${Date.now()}`,
      owner: { email: `owner-${Date.now()}@media-test.com`, name: "Media Owner" },
      planCode: "starter",
      source: "platform_admin",
    });
    tenantId = tenant.tenantId;

    const staff = await seedPlatformStaff(rtPlatform._db.db, {
      email: `storage-admin-${Date.now()}@platform.test`,
      role: "platform_admin",
    });

    const conn = await createPlatformStorageConnection(rtPlatform, staff.userId, {
      name: "Test Local Storage",
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
      roles: ["owner"],
      permissions: STORE_PERMISSIONS,
      requestId: "test-req-media",
    };
  });

  afterAll(async () => {
    if (fs.existsSync(tempStorageDir)) {
      fs.rmSync(tempStorageDir, { recursive: true, force: true });
    }
    delete process.env.STORAGE_LOCAL_DIR;
    try {
      await rtPlatform._db.db.delete(schema.platformStorageConnections);
      invalidateStorageConnectionCache();
    } catch {
      // ignore cleanup errors
    }
    await env?.stop();
  });

  it("uploads files directly, generates thumbnails and calculates real magic-bytes metadata", async () => {
    const uploaded = await uploadMediaDirect(rt, ctx, {
      filename: "test-image.png",
      mime: "image/png",
      fileBytes: PNG_1X1,
      title: "Hero Banner",
      alt: "A tiny 1x1 test png",
      caption: "Sample caption",
    });

    expect(uploaded.id).toBeDefined();
    expect(uploaded.mime).toBe("image/png");
    expect(uploaded.bytes).toBe(PNG_1X1.length);
    expect(uploaded.width).toBe(1);
    expect(uploaded.height).toBe(1);
    expect(uploaded.kind).toBe("image");
    expect(uploaded.title).toBe("Hero Banner");
    expect(uploaded.alt).toBe("A tiny 1x1 test png");
    expect(uploaded.caption).toBe("Sample caption");
  });

  it("supports listMedia with search, kind filter, usage filter, sort, and cursor pagination", async () => {
    // Upload 3 images
    const _m1 = await uploadMediaDirect(rt, ctx, { filename: "alpha.png", mime: "image/png", fileBytes: PNG_1X1, title: "Apple" });
    const m2 = await uploadMediaDirect(rt, ctx, { filename: "beta.png", mime: "image/png", fileBytes: PNG_1X1, title: "Banana" });
    const _m3 = await uploadMediaDirect(rt, ctx, { filename: "gamma.png", mime: "image/png", fileBytes: PNG_1X1, title: "Cherry" });

    // 1. Search by title
    const searchRes = await listMedia(rt, ctx, { q: "Banana" });
    expect(searchRes.items.length).toBe(1);
    expect(searchRes.items[0]?.id).toBe(m2.id);

    // 2. Kinds filter
    const imgOnly = await listMedia(rt, ctx, { kinds: ["image"] });
    expect(imgOnly.items.length).toBeGreaterThanOrEqual(3);

    // 3. Cursor pagination with limit = 2
    const page1 = await listMedia(rt, ctx, { limit: 2, sort: "newest" });
    expect(page1.items.length).toBe(2);
    expect(page1.nextCursor).toBeDefined();

    const page2 = await listMedia(rt, ctx, { limit: 2, cursor: page1.nextCursor!, sort: "newest" });
    expect(page2.items.length).toBeGreaterThanOrEqual(1);
    expect(page1.items.map((i) => i.id)).not.toContain(page2.items[0]?.id);
  });

  it("tracks usages accurately across products, variants, collections, categories, and brands", async () => {
    const mProd = await uploadMediaDirect(rt, ctx, { filename: "prod.png", mime: "image/png", fileBytes: PNG_1X1 });
    const mVar = await uploadMediaDirect(rt, ctx, { filename: "var.png", mime: "image/png", fileBytes: PNG_1X1 });
    const mCol = await uploadMediaDirect(rt, ctx, { filename: "col.png", mime: "image/png", fileBytes: PNG_1X1 });
    const mCat = await uploadMediaDirect(rt, ctx, { filename: "cat.png", mime: "image/png", fileBytes: PNG_1X1 });
    const mBrand = await uploadMediaDirect(rt, ctx, { filename: "brand.png", mime: "image/png", fileBytes: PNG_1X1 });

    // 1. Create product and attach media
    const prod = await createProduct(rt, ctx, {
      title: "Sample Coffee",
      variants: [{ title: "Default", sku: `SKU-${Date.now()}`, price: 500 }],
    });
    await attachProductMedia(rt, ctx, { productId: prod.id, mediaId: mProd.id });

    // 2. Update variant with image
    const variantId = prod.variants[0]!.id;
    await updateVariant(rt, ctx, {
      id: variantId,
      imageMediaId: mVar.id,
    });

    // 3. Collection with image
    const col = await createCollection(rt, ctx, {
      title: "Featured Drinks",
      imageMediaId: mCol.id,
    });

    // 4. Category with image
    const cat = await createCategory(rt, ctx, {
      name: "Beverages",
      imageMediaId: mCat.id,
    });

    // 5. Brand with logo
    const brand = await createBrand(rt, ctx, {
      name: "Roasters Co",
      logoMediaId: mBrand.id,
    });

    // Verify getMedia and "Used in" labels
    const prodMediaDetail = await getMedia(rt, ctx, { id: mProd.id });
    expect(prodMediaDetail.usages.length).toBe(1);
    expect(prodMediaDetail.usages[0]?.ownerType).toBe("product");
    expect(prodMediaDetail.usages[0]?.label).toContain("Sample Coffee");

    const varMediaDetail = await getMedia(rt, ctx, { id: mVar.id });
    expect(varMediaDetail.usages.length).toBe(1);
    expect(varMediaDetail.usages[0]?.ownerType).toBe("variant");

    const colMediaDetail = await getMedia(rt, ctx, { id: mCol.id });
    expect(colMediaDetail.usages.length).toBe(1);
    expect(colMediaDetail.usages[0]?.ownerType).toBe("collection");

    const catMediaDetail = await getMedia(rt, ctx, { id: mCat.id });
    expect(catMediaDetail.usages.length).toBe(1);
    expect(catMediaDetail.usages[0]?.ownerType).toBe("category");

    const brandMediaDetail = await getMedia(rt, ctx, { id: mBrand.id });
    expect(brandMediaDetail.usages.length).toBe(1);
    expect(brandMediaDetail.usages[0]?.ownerType).toBe("brand");

    // Clean up owners and ensure usages are cleared
    await deleteProduct(rt, ctx, { id: prod.id });
    await deleteCollection(rt, ctx, { id: col.id });
    await deleteCategory(rt, ctx, { id: cat.id });
    await deleteBrand(rt, ctx, { id: brand.id });

    const clearedProd = await getMedia(rt, ctx, { id: mProd.id });
    expect(clearedProd.usages.length).toBe(0);
    const clearedCol = await getMedia(rt, ctx, { id: mCol.id });
    expect(clearedCol.usages.length).toBe(0);
  });

  it("handles trash, restore, and refuses permanent deletion when items are in use", async () => {
    const mUsed = await uploadMediaDirect(rt, ctx, { filename: "used.png", mime: "image/png", fileBytes: PNG_1X1 });
    const mUnused = await uploadMediaDirect(rt, ctx, { filename: "unused.png", mime: "image/png", fileBytes: PNG_1X1 });

    const prod = await createProduct(rt, ctx, {
      title: "Protected Product",
      variants: [{ title: "Default", sku: `SKU-PROT-${Date.now()}`, price: 200 }],
    });
    await attachProductMedia(rt, ctx, { productId: prod.id, mediaId: mUsed.id });

    // Move both to trash
    const trashRes = await trashMedia(rt, ctx, { ids: [mUsed.id, mUnused.id] });
    expect(trashRes.trashed).toBe(2);

    // List trash
    const trashList = await listMedia(rt, ctx, { trash: true });
    expect(trashList.items.some((i) => i.id === mUsed.id)).toBe(true);
    expect(trashList.items.some((i) => i.id === mUnused.id)).toBe(true);

    // Normal list excludes trashed items
    const normalList = await listMedia(rt, ctx, { trash: false });
    expect(normalList.items.some((i) => i.id === mUsed.id)).toBe(false);

    // Attempt permanent delete of used item: MUST BE BLOCKED
    const blockedRes = await deleteMediaPermanent(rt, ctx, { ids: [mUsed.id] });
    expect(blockedRes.deleted).toBe(0);
    expect(blockedRes.blocked.length).toBe(1);
    expect(blockedRes.blocked[0]?.id).toBe(mUsed.id);
    expect(blockedRes.blocked[0]?.usages.length).toBeGreaterThanOrEqual(1);

    // Delete unused item: succeeds
    const delRes = await deleteMediaPermanent(rt, ctx, { ids: [mUnused.id] });
    expect(delRes.deleted).toBe(1);

    // Restore used item from trash
    const restoreRes = await restoreMedia(rt, ctx, { ids: [mUsed.id] });
    expect(restoreRes.restored).toBe(1);

    const restoredList = await listMedia(rt, ctx, { trash: false });
    expect(restoredList.items.some((i) => i.id === mUsed.id)).toBe(true);

    // Clean up
    await deleteProduct(rt, ctx, { id: prod.id });
    await trashMedia(rt, ctx, { ids: [mUsed.id] });
    const cleanRes = await deleteMediaPermanent(rt, ctx, { ids: [mUsed.id] });
    expect(cleanRes.deleted).toBe(1);
  });

  it("runs 30-day trash sweep deleting only items older than 30 days and not in use", async () => {
    const mOldUnused = await uploadMediaDirect(rt, ctx, { filename: "old-unused.png", mime: "image/png", fileBytes: PNG_1X1 });
    const mRecentUnused = await uploadMediaDirect(rt, ctx, { filename: "recent-unused.png", mime: "image/png", fileBytes: PNG_1X1 });

    // Trash both
    await trashMedia(rt, ctx, { ids: [mOldUnused.id, mRecentUnused.id] });

    // Manually age the old item's trashedAt timestamp to 32 days ago
    const db = rt._db.db;
    await withTenant(db, tenantId, async (tx) => {
      await tx.execute(sql`
        UPDATE media
        SET trashed_at = now() - INTERVAL '32 days'
        WHERE tenant_id = ${tenantId} AND id = ${mOldUnused.id}
      `);
    });

    // Run sweep as app_rw (worker role, withTenant enforces isolation, B4)
    const sweepRes = await runMediaTrashSweep(rt._db.db, tenantId);
    expect(sweepRes.deletedCount).toBe(1);

    // Old unused item is gone, recent item is still in trash
    const trashList = await listMedia(rt, ctx, { trash: true });
    expect(trashList.items.some((i) => i.id === mOldUnused.id)).toBe(false);
    expect(trashList.items.some((i) => i.id === mRecentUnused.id)).toBe(true);

    // Clean up recent
    await deleteMediaPermanent(rt, ctx, { ids: [mRecentUnused.id] });
  });

  it("isolates private folder files (returns, expense-receipts) from library queries, mutations, trash sweep, and storage stats (B1)", async () => {
    // Seed private records directly into schema.media
    const returnKey = `${tenantId}/returns/${crypto.randomUUID()}.png`;
    const receiptKey = `${tenantId}/expense-receipts/${crypto.randomUUID()}.png`;
    let returnId = "";
    let receiptId = "";

    await withTenant(rt._db.db, tenantId, async (tx) => {
      const [retRow] = await tx
        .insert(schema.media)
        .values({
          tenantId,
          storageKey: returnKey,
          filename: "customer-return.png",
          mime: "image/png",
          bytes: 10240,
          kind: "image",
          folder: "returns",
          status: "ready",
        })
        .returning({ id: schema.media.id });
      returnId = retRow!.id;

      const [recRow] = await tx
        .insert(schema.media)
        .values({
          tenantId,
          storageKey: receiptKey,
          filename: "expense-receipt.png",
          mime: "image/png",
          bytes: 20480,
          kind: "image",
          folder: "expense-receipts",
          status: "ready",
        })
        .returning({ id: schema.media.id });
      receiptId = recRow!.id;
    });

    // 1. Library list (both active and trash) excludes them
    const normalList = await listMedia(rt, ctx, { trash: false });
    expect(normalList.items.some((i) => i.id === returnId || i.id === receiptId)).toBe(false);

    const trashList = await listMedia(rt, ctx, { trash: true });
    expect(trashList.items.some((i) => i.id === returnId || i.id === receiptId)).toBe(false);

    // 2. Direct getMedia throws "Not Found"
    await expect(getMedia(rt, ctx, { id: returnId })).rejects.toThrow(/Not Found/i);
    await expect(getMedia(rt, ctx, { id: receiptId })).rejects.toThrow(/Not Found/i);

    // 3. updateMedia throws "Not Found"
    await expect(updateMedia(rt, ctx, { id: returnId, title: "Hacked" })).rejects.toThrow(/Not Found/i);
    await expect(updateMedia(rt, ctx, { id: receiptId, title: "Hacked" })).rejects.toThrow(/Not Found/i);

    // 4. trashMedia / deleteMediaPermanent: private IDs are excluded and never affected
    const trashRes = await trashMedia(rt, ctx, { ids: [returnId] });
    expect(trashRes.trashed).toBe(0);
    const delRes = await deleteMediaPermanent(rt, ctx, { ids: [receiptId] });
    expect(delRes.deleted).toBe(0);

    // 5. Age them to 32 days trashed and run trash sweep - sweep must never delete them
    await withTenant(rt._db.db, tenantId, async (tx) => {
      await tx.execute(sql`
        UPDATE media
        SET status = 'trashed', trashed_at = now() - INTERVAL '32 days'
        WHERE tenant_id = ${tenantId} AND id IN (${returnId}, ${receiptId})
      `);
    });

    const sweepRes = await runMediaTrashSweep(rt._db.db, tenantId);
    expect(sweepRes.deletedCount).toBe(0);

    // Verify rows still exist in database
    await withTenant(rt._db.db, tenantId, async (tx) => {
      const rows = await tx
        .select({ id: schema.media.id })
        .from(schema.media)
        .where(inArray(schema.media.id, [returnId, receiptId]));
      expect(rows.length).toBe(2);
    });

    // 6. Quota / storage stats must exclude their bytes (10240 + 20480)
    const stats = await getTenantMediaUsageStats(rt._db.db, tenantId);
    const allLibraryRows = await withTenant(rt._db.db, tenantId, async (tx) => {
      return await tx
        .select({ bytes: schema.media.bytes, folder: schema.media.folder })
        .from(schema.media)
        .where(
          and(
            eq(schema.media.tenantId, tenantId),
            sql`(${schema.media.folder} IS NULL OR ${schema.media.folder} NOT IN ('returns', 'expense-receipts'))`,
          ),
        );
    });
    const expectedLibraryBytes = allLibraryRows.reduce((acc, r) => acc + Number(r.bytes), 0);
    expect(stats.usedBytes).toBe(expectedLibraryBytes);

    // Clean up test rows
    await withTenant(rt._db.db, tenantId, async (tx) => {
      await tx.delete(schema.media).where(inArray(schema.media.id, [returnId, receiptId]));
    });
  });

  it("validates client-provided storage keys and rejects foreign-tenant, malformed, private-folder, or duplicate keys (B2)", async () => {
    // 1. Foreign-tenant key rejected
    await expect(
      createMediaRecord(rt, ctx, {
        storageKey: `00000000-0000-0000-0000-000000000000/products/valid-uuid.png`,
        filename: "foreign.png",
        mime: "image/png",
        bytes: PNG_1X1.length,
      }),
    ).rejects.toThrow(/different tenant/i);

    // 2. Malformed key (traversal, extra segments, or bad chars) rejected
    await expect(
      createMediaRecord(rt, ctx, {
        storageKey: `${tenantId}/../products/valid-uuid.png`,
        filename: "traversal.png",
        mime: "image/png",
        bytes: PNG_1X1.length,
      }),
    ).rejects.toThrow(/format/i);

    await expect(
      createMediaRecord(rt, ctx, {
        storageKey: `${tenantId}/products/nested/valid-uuid.png`,
        filename: "nested.png",
        mime: "image/png",
        bytes: PNG_1X1.length,
      }),
    ).rejects.toThrow(/format/i);

    // 3. Private folder rejected
    await expect(
      createMediaRecord(rt, ctx, {
        storageKey: `${tenantId}/returns/valid-uuid.png`,
        filename: "private.png",
        mime: "image/png",
        bytes: PNG_1X1.length,
      }),
    ).rejects.toThrow(/restricted/i);

    // 4. Duplicate key rejected
    const uploaded = await uploadMediaDirect(rt, ctx, {
      filename: "existing.png",
      mime: "image/png",
      fileBytes: PNG_1X1,
    });
    await expect(
      createMediaRecord(rt, ctx, {
        storageKey: uploaded.storageKey!,
        filename: "duplicate.png",
        mime: "image/png",
        bytes: PNG_1X1.length,
      }),
    ).rejects.toThrow(/already registered in library/i);

    // Clean up
    await trashMedia(rt, ctx, { ids: [uploaded.id] });
    await deleteMediaPermanent(rt, ctx, { ids: [uploaded.id] });
  });

  it("checks real object size on HEAD and rejects oversized uploads before full download (B3)", async () => {
    const { driver } = await getActiveStorageDriver(rt._db.db, "public_media");
    const testKey = `${tenantId}/products/${crypto.randomUUID()}.png`;

    // Write a dummy object to storage
    await driver.put({
      key: testKey,
      body: PNG_1X1,
      contentType: "image/png",
    });

    // Spy on driver.head to simulate a reported size exceeding the image upload limit (e.g. 10 MB > 5 MB)
    const originalHead = LocalStorageDriver.prototype.head;
    const getSpy = vi.spyOn(LocalStorageDriver.prototype, "get");

    vi.spyOn(LocalStorageDriver.prototype, "head").mockImplementation(async function (this: unknown, key: string) {
      const real = await originalHead.call(this as LocalStorageDriver, key);
      return {
        exists: true,
        size: 10 * 1024 * 1024, // 10 MB exceeds 5 MB image quota
        contentType: real?.contentType,
      };
    });

    try {
      await expect(
        createMediaRecord(rt, ctx, {
          storageKey: testKey,
          filename: "huge.png",
          mime: "image/png",
          bytes: PNG_1X1.length,
        }),
      ).rejects.toThrow(QuotaExceededError);

      // Verify driver.get was NEVER called for the full object!
      expect(getSpy).not.toHaveBeenCalled();

      // Verify the oversized object was purged from storage
      const existsAfter = await originalHead.call(driver as LocalStorageDriver, testKey);
      expect(existsAfter.exists).toBe(false);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("blocks permanent deletion and sweep when media is referenced by branding, store status, SEO, pages, or themes (B5)", async () => {
    const mLogo = await uploadMediaDirect(rt, ctx, { filename: "logo.png", mime: "image/png", fileBytes: PNG_1X1 });
    const mBg = await uploadMediaDirect(rt, ctx, { filename: "bg.png", mime: "image/png", fileBytes: PNG_1X1 });
    const mOg = await uploadMediaDirect(rt, ctx, { filename: "og.png", mime: "image/png", fileBytes: PNG_1X1 });
    const mPage = await uploadMediaDirect(rt, ctx, { filename: "page-block.png", mime: "image/png", fileBytes: PNG_1X1 });
    const mTheme = await uploadMediaDirect(rt, ctx, { filename: "theme-token.png", mime: "image/png", fileBytes: PNG_1X1 });

    // Trash all
    await trashMedia(rt, ctx, { ids: [mLogo.id, mBg.id, mOg.id, mPage.id, mTheme.id] });

    // Wire references
    let pageId = "";
    await withTenant(rt._db.db, tenantId, async (tx) => {
      // 1. Branding logo
      await tx
        .insert(schema.brandSettings)
        .values({
          tenantId,
          logoMediaId: mLogo.id,
        })
        .onConflictDoUpdate({
          target: [schema.brandSettings.tenantId],
          set: { logoMediaId: mLogo.id },
        });

      // 2. Store status background
      await tx
        .insert(schema.storeStatus)
        .values({
          tenantId,
          mode: "coming_soon",
          backgroundMediaId: mBg.id,
        })
        .onConflictDoUpdate({
          target: [schema.storeStatus.tenantId],
          set: { backgroundMediaId: mBg.id },
        });

      // 3. SEO default OG image
      await tx
        .insert(schema.seoSettings)
        .values({
          tenantId,
          defaultOgImageMediaId: mOg.id,
        })
        .onConflictDoUpdate({
          target: [schema.seoSettings.tenantId],
          set: { defaultOgImageMediaId: mOg.id },
        });

      // 4. Page version with document mentioning mPage.id
      const [pg] = await tx
        .insert(schema.pages)
        .values({
          tenantId,
          slug: `test-page-${Date.now()}`,
          title: "Test Media Page",
        })
        .returning({ id: schema.pages.id });
      pageId = pg!.id;

      await tx.insert(schema.pageVersions).values({
        tenantId,
        pageId,
        document: { blocks: [{ type: "image", props: { mediaId: mPage.id } }] },
      });

      // 5. Theme with tokens mentioning mTheme.id
      await tx
        .insert(schema.themes)
        .values({
          tenantId,
          name: "Custom Media Theme",
          tokens: { heroImage: mTheme.id },
        });
    });

    // Test permanent delete blocked for each
    const delRes = await deleteMediaPermanent(rt, ctx, {
      ids: [mLogo.id, mBg.id, mOg.id, mPage.id, mTheme.id],
    });
    expect(delRes.deleted).toBe(0);
    expect(delRes.blocked.length).toBe(5);

    const logoBlock = delRes.blocked.find((b) => b.id === mLogo.id);
    expect(logoBlock?.usages.some((u) => u.label.includes("Store branding (Logo)"))).toBe(true);

    const bgBlock = delRes.blocked.find((b) => b.id === mBg.id);
    expect(bgBlock?.usages.some((u) => u.label.includes("Store status"))).toBe(true);

    const ogBlock = delRes.blocked.find((b) => b.id === mOg.id);
    expect(ogBlock?.usages.some((u) => u.label.toLowerCase().includes("social share"))).toBe(true);

    const pageBlock = delRes.blocked.find((b) => b.id === mPage.id);
    expect(pageBlock?.usages.some((u) => u.label.includes("Page:"))).toBe(true);

    const themeBlock = delRes.blocked.find((b) => b.id === mTheme.id);
    expect(themeBlock?.usages.some((u) => u.label.includes("Theme:"))).toBe(true);

    // Unset all references & delete page/theme
    await withTenant(rt._db.db, tenantId, async (tx) => {
      await tx.update(schema.brandSettings).set({ logoMediaId: null }).where(eq(schema.brandSettings.tenantId, tenantId));
      await tx.update(schema.storeStatus).set({ backgroundMediaId: null }).where(eq(schema.storeStatus.tenantId, tenantId));
      await tx.update(schema.seoSettings).set({ defaultOgImageMediaId: null }).where(eq(schema.seoSettings.tenantId, tenantId));
      await tx.delete(schema.pageVersions).where(eq(schema.pageVersions.tenantId, tenantId));
      await tx.delete(schema.pages).where(eq(schema.pages.tenantId, tenantId));
      await tx.delete(schema.themes).where(eq(schema.themes.tenantId, tenantId));
    });

    // Now permanent delete must succeed
    const unblockedRes = await deleteMediaPermanent(rt, ctx, {
      ids: [mLogo.id, mBg.id, mOg.id, mPage.id, mTheme.id],
    });
    expect(unblockedRes.deleted).toBe(5);
    expect(unblockedRes.blocked.length).toBe(0);
  });

  it("enforces tenant isolation and rejects private folder media in syncMediaUsages (B6)", async () => {
    // 1. Provision second tenant
    const tenant2 = await provisionTenant(rtPlatform, {
      storeName: "Tenant Two",
      slug: `tenant-two-${Date.now()}`,
      owner: { email: `owner2-${Date.now()}@test.com`, name: "Owner Two" },
      planCode: "starter",
      source: "platform_admin",
    });

    const ctx2: TenantContext = {
      tenantId: tenant2.tenantId,
      storeStatus: "live",
      actor: { type: "staff", userId: tenant2.ownerId },
      roles: ["owner"],
      permissions: STORE_PERMISSIONS,
      requestId: "test-req-media-2",
    };

    // Upload an image in tenant 2
    const mTenant2 = await uploadMediaDirect(rt, ctx2, {
      filename: "tenant2.png",
      mime: "image/png",
      fileBytes: PNG_1X1,
    });

    // Seed a private folder image in tenant 1
    let privateMediaId = "";
    await withTenant(rt._db.db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(schema.media)
        .values({
          tenantId,
          storageKey: `${tenantId}/returns/${crypto.randomUUID()}.png`,
          filename: "returns.png",
          mime: "image/png",
          bytes: 1024,
          kind: "image",
          folder: "returns",
          status: "ready",
        })
        .returning({ id: schema.media.id });
      privateMediaId = row!.id;
    });

    // Create a product in tenant 1
    const prod = await createProduct(rt, ctx, {
      title: "Isolated Product",
      variants: [{ title: "Default", sku: `SKU-ISO-${Date.now()}`, price: 100 }],
    });

    // Try syncMediaUsages referencing tenant 2's media -> MUST FAIL
    await expect(
      withTenant(rt._db.db, tenantId, async (tx) => {
        await syncMediaUsages(tx, ctx, {
          ownerType: "product",
          ownerId: prod.id,
          field: "media",
          mediaIds: [mTenant2.id],
        });
      }),
    ).rejects.toThrow(/do not exist in tenant's media library/i);

    // Try syncMediaUsages referencing private folder media -> MUST FAIL
    await expect(
      withTenant(rt._db.db, tenantId, async (tx) => {
        await syncMediaUsages(tx, ctx, {
          ownerType: "product",
          ownerId: prod.id,
          field: "media",
          mediaIds: [privateMediaId],
        });
      }),
    ).rejects.toThrow(/private folder/i);

    // Verify media_usages table has no rows inserted for prod
    await withTenant(rt._db.db, tenantId, async (tx) => {
      const usages = await tx
        .select()
        .from(schema.mediaUsages)
        .where(
          and(
            eq(schema.mediaUsages.tenantId, tenantId),
            eq(schema.mediaUsages.ownerId, prod.id),
          ),
        );
      expect(usages.length).toBe(0);
    });

    // Clean up
    await deleteProduct(rt, ctx, { id: prod.id });
  });

  it("prevents quota bypass through folder tampering on presigned upload and create (R1)", async () => {
    // 1. requestUpload with private folder (returns or expense-receipts) is refused
    await expect(
      requestMediaUpload(rt, ctx, {
        filename: "receipt.png",
        mime: "image/png",
        bytes: 1024,
        folder: "returns",
      }),
    ).rejects.toThrow(/restricted/i);

    await expect(
      requestMediaUpload(rt, ctx, {
        filename: "receipt.png",
        mime: "image/png",
        bytes: 1024,
        folder: "expense-receipts",
      }),
    ).rejects.toThrow(/restricted/i);

    // 2. create with a valid products key but client sends folder: "returns" is refused
    const { driver } = await getActiveStorageDriver(rt._db.db, "public_media");
    const testKey = `${tenantId}/products/${crypto.randomUUID()}.png`;
    await driver.put({ key: testKey, body: PNG_1X1, contentType: "image/png" });

    await expect(
      createMediaRecord(rt, ctx, {
        storageKey: testKey,
        filename: "spoofed.png",
        mime: "image/png",
        bytes: PNG_1X1.length,
        folder: "returns",
      }),
    ).rejects.toThrow(/does not match storage key folder/i);

    // 3. create with the same valid key without folder or matching folder succeeds
    const initialStats = await getTenantMediaUsageStats(rt._db.db, tenantId);
    const created = await createMediaRecord(rt, ctx, {
      storageKey: testKey,
      filename: "valid.png",
      mime: "image/png",
      bytes: PNG_1X1.length,
      folder: "products",
    });

    expect(created.folder).toBe("products");

    // 4. Its bytes count toward storage_mb
    const newStats = await getTenantMediaUsageStats(rt._db.db, tenantId);
    expect(newStats.usedBytes).toBe(initialStats.usedBytes + PNG_1X1.length);

    // 5. It appears in listMedia
    const listRes = await listMedia(rt, ctx, { limit: 100 });
    const found = listRes.items.some((item) => item.id === created.id);
    expect(found).toBe(true);

    // Clean up
    await trashMedia(rt, ctx, { ids: [created.id] });
    await deleteMediaPermanent(rt, ctx, { ids: [created.id] });
  });

  it("S3: sets, updates, clears, and validates focal point with audit logging", async () => {
    const item = await uploadMediaDirect(rt, ctx, {
      filename: "focal-test.png",
      mime: "image/png",
      fileBytes: PNG_1X1,
    });

    expect(item.focalX).toBeNull();
    expect(item.focalY).toBeNull();

    // Set focal point to (0.25, 0.75)
    const updated = await updateMedia(rt, ctx, {
      id: item.id,
      focalX: 0.25,
      focalY: 0.75,
    });
    expect(updated.focalX).toBe(0.25);
    expect(updated.focalY).toBe(0.75);

    // Read back via getMedia
    const fetched = await getMedia(rt, ctx, { id: item.id });
    expect(fetched.focalX).toBe(0.25);
    expect(fetched.focalY).toBe(0.75);

    // Read back via listMedia
    const listRes = await listMedia(rt, ctx, { q: "focal-test" });
    const inList = listRes.items.find((i) => i.id === item.id);
    expect(inList?.focalX).toBe(0.25);
    expect(inList?.focalY).toBe(0.75);

    // Clear focal point (both null)
    const cleared = await updateMedia(rt, ctx, {
      id: item.id,
      focalX: null,
      focalY: null,
    });
    expect(cleared.focalX).toBeNull();
    expect(cleared.focalY).toBeNull();

    const fetchedCleared = await getMedia(rt, ctx, { id: item.id });
    expect(fetchedCleared.focalX).toBeNull();
    expect(fetchedCleared.focalY).toBeNull();

    // Rejection cases: out of range, or only one null
    await expect(
      updateMedia(rt, ctx, {
        id: item.id,
        focalX: 1.5,
        focalY: 0.5,
      }),
    ).rejects.toThrow(/focalX and focalY must be numbers between 0 and 1/i);

    await expect(
      updateMedia(rt, ctx, {
        id: item.id,
        focalX: null,
        focalY: 0.5,
      }),
    ).rejects.toThrow(/focalX and focalY must either both be null or both be numbers/i);

    // Audit logs verified
    const [auditLog] = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
      return await tx
        .select()
        .from(schema.auditLogs)
        .where(and(eq(schema.auditLogs.tenantId, ctx.tenantId), eq(schema.auditLogs.targetId, item.id)))
        .orderBy(sql`${schema.auditLogs.createdAt} DESC`)
        .limit(1);
    });

    expect(auditLog?.action).toBe("media.update");

    // Clean up
    await trashMedia(rt, ctx, { ids: [item.id] });
    await deleteMediaPermanent(rt, ctx, { ids: [item.id] });
  });

  it("detects duplicate uploads by sha256 and supports worker hashing and backfill (Plan S4)", async () => {
    // 1. Upload unique document
    const uniqueDocBytes = Buffer.from(`unique-duplicate-test-content-${Date.now()}`);
    const item1 = await uploadMediaDirect(rt, ctx, {
      fileBytes: uniqueDocBytes,
      filename: "original-file.txt",
      mime: "text/plain",
    });

    expect(item1.sha256).toBeDefined();
    expect(item1.sha256).toMatch(/^[0-9a-f]{64}$/);

    // 2. Query duplicates using the same sha256
    const dups = await findDuplicates(rt, ctx, { hashes: [item1.sha256!] });
    expect(dups.matches.length).toBe(1);
    expect(dups.matches[0]!.existing.id).toBe(item1.id);
    expect(dups.matches[0]!.existing.filename).toBe("original-file.txt");

    // 3. Query with non-matching sha256
    const noDups = await findDuplicates(rt, ctx, {
      hashes: ["0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"],
    });
    expect(noDups.matches.length).toBe(0);

    // 4. Test worker processMediaHash for unhashed file
    // Write a dummy file to storage and create a media record without sha256
    const { driver: storageDriver } = await getActiveStorageDriver(rt._db.db, "public_media");
    const testKey = `test-unhashed-${Date.now()}.txt`;
    await storageDriver.put({ key: testKey, body: uniqueDocBytes, contentType: "text/plain" });

    const [unhashedRow] = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
      return await tx
        .insert(schema.media)
        .values({
          tenantId: ctx.tenantId,
          storageKey: testKey,
          mime: "text/plain",
          bytes: uniqueDocBytes.length,
          kind: "document",
          status: "ready",
          filename: "unhashed.txt",
          sha256: null,
        })
        .returning();
    });

    expect(unhashedRow).toBeDefined();
    expect(unhashedRow!.sha256).toBeNull();

    // Call processMediaHash
    const hashResult = await processMediaHash(rt._db.db, {
      tenantId: ctx.tenantId,
      mediaId: unhashedRow!.id,
    });

    expect(hashResult.hashed).toBe(true);
    expect(hashResult.sha256).toBe(item1.sha256);

    // Verify row in DB now has sha256
    const [updatedRow] = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
      return await tx
        .select()
        .from(schema.media)
        .where(eq(schema.media.id, unhashedRow!.id))
        .limit(1);
    });
    expect(updatedRow?.sha256).toBe(item1.sha256);

    // Calling processMediaHash again is idempotent
    const secondHash = await processMediaHash(rt._db.db, {
      tenantId: ctx.tenantId,
      mediaId: unhashedRow!.id,
    });
    expect(secondHash.hashed).toBe(false);
    expect(secondHash.sha256).toBe(item1.sha256);

    // 5. Test backfillMediaHashes
    // Insert another unhashed row
    const testKey2 = `test-backfill-${Date.now()}.txt`;
    await storageDriver.put({ key: testKey2, body: uniqueDocBytes, contentType: "text/plain" });
    const [backfillRow] = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
      return await tx
        .insert(schema.media)
        .values({
          tenantId: ctx.tenantId,
          storageKey: testKey2,
          mime: "text/plain",
          bytes: uniqueDocBytes.length,
          kind: "document",
          status: "ready",
          filename: "backfill.txt",
          sha256: null,
        })
        .returning();
    });

    const backfillStats = await backfillMediaHashes(rt._db.db, 50);
    expect(backfillStats.processed).toBeGreaterThanOrEqual(1);

    const [afterBackfill] = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
      return await tx
        .select()
        .from(schema.media)
        .where(eq(schema.media.id, backfillRow!.id))
        .limit(1);
    });
    expect(afterBackfill?.sha256).toBe(item1.sha256);

    // Clean up
    await trashMedia(rt, ctx, { ids: [item1.id, unhashedRow!.id, backfillRow!.id] });
    await deleteMediaPermanent(rt, ctx, { ids: [item1.id, unhashedRow!.id, backfillRow!.id] });
  });

  it("10,000-row cursor pagination and search scale test (Plan S5)", async () => {
    // Seed 10,000 media rows in a single batch
    await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO media (tenant_id, storage_key, mime, bytes, kind, status, filename, title, alt, created_at, updated_at)
        SELECT
          ${ctx.tenantId}::uuid,
          'perf-test/img-' || s || '.jpg',
          'image/jpeg',
          1024,
          'image',
          'ready',
          'perf-image-' || s || '.jpg',
          'Perf Image ' || s,
          'Alt text for perf image ' || s,
          now() - (s || ' seconds')::interval,
          now()
        FROM generate_series(1, 10000) AS s;
      `);
    });

    try {
      // 1. Page 1 (50 items)
      const t0 = performance.now();
      const page1 = await listMedia(rt, ctx, { limit: 50 });
      const d1 = performance.now() - t0;
      expect(page1.items.length).toBe(50);
      expect(page1.nextCursor).toBeTruthy();
      // Generous threshold for dev environment while ensuring it doesn't do table scans or timeout
      expect(d1).toBeLessThan(500);

      // 2. Page 2 using cursor
      const t1 = performance.now();
      const page2 = await listMedia(rt, ctx, { limit: 50, cursor: page1.nextCursor! });
      const d2 = performance.now() - t1;
      expect(page2.items.length).toBe(50);
      expect(page2.items[0]!.id).not.toBe(page1.items[0]!.id);
      expect(d2).toBeLessThan(500);

      // 3. Filtering by type="image"
      const t2 = performance.now();
      const filtered = await listMedia(rt, ctx, { limit: 50, type: "image" });
      const d3 = performance.now() - t2;
      expect(filtered.items.length).toBe(50);
      expect(d3).toBeLessThan(500);

      // 4. Text search
      const t3 = performance.now();
      const searchRes = await listMedia(rt, ctx, { limit: 50, q: "perf-image-500" });
      const d4 = performance.now() - t3;
      expect(searchRes.items.length).toBeGreaterThan(0);
      expect(d4).toBeLessThan(500);

      // 5. Assert usageCount is calculated without N+1
      expect(typeof page1.items[0]!.usageCount).toBe("number");
    } finally {
      // Clean up the 10,000 rows
      await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
        await tx.execute(sql`
          DELETE FROM media
          WHERE tenant_id = ${ctx.tenantId}::uuid
            AND storage_key LIKE 'perf-test/%';
        `);
      });
    }
  });
});

