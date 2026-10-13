import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema, withTenant } from "@bs/db";
import { sql } from "drizzle-orm";
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
  uploadMediaDirect,
  trashMedia,
  restoreMedia,
  deleteMediaPermanent,
  runMediaTrashSweep,
  attachProductMedia,
} from "../src/media-services.ts";
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

    // Run sweep (worker / platform level bypasses RLS)
    const sweepRes = await runMediaTrashSweep(rtPlatform._db.db, tenantId);
    expect(sweepRes.deletedCount).toBe(1);

    // Old unused item is gone, recent item is still in trash
    const trashList = await listMedia(rt, ctx, { trash: true });
    expect(trashList.items.some((i) => i.id === mOldUnused.id)).toBe(false);
    expect(trashList.items.some((i) => i.id === mRecentUnused.id)).toBe(true);

    // Clean up recent
    await deleteMediaPermanent(rt, ctx, { ids: [mRecentUnused.id] });
  });
});
