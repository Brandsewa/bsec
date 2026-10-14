import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@bs/db";
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
import {
  invalidateStorageConnectionCache,
  getActiveStorageDriver,
} from "../src/media/connection.ts";
import {
  uploadMediaDirect,
  updateMedia,
  replaceMedia,
  attachProductMedia,
  updateProductMedia,
} from "../src/media-services.ts";
import {
  createProduct,
  createCollection,
  createCategory,
  createBrand,
} from "../src/catalog-services.ts";
import { updateBrandSettings } from "../src/brand-services.ts";
import { updateStoreStatus } from "../src/storefront/lifecycle.ts";
import { tenantTag } from "../src/cache-tags.ts";

describe("Media Cache Fan-Out Integration Test Suite (S4, Real Postgres)", () => {
  let env: TestDb;
  let rt: Runtime;
  let rtPlatform: Runtime;
  let ctx: TenantContext;
  let tenantId: string;
  let tempStorageDir: string;
  let capturedTags: string[] = [];

  const PNG_1X1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );

  beforeAll(async () => {
    env = await startTestDb();
    rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 10 });

    rt = createRuntime({
      service: "web",
      databaseUrl: env.as("app_rw"),
      poolMax: 10,
      revalidateTags: (tags) => {
        capturedTags.push(...tags);
      },
    });

    tempStorageDir = path.join(os.tmpdir(), `bsec-media-fanout-test-${Date.now()}`);
    fs.mkdirSync(tempStorageDir, { recursive: true });
    process.env.STORAGE_LOCAL_DIR = tempStorageDir;

    const tenant = await provisionTenant(rtPlatform, {
      storeName: "Media Fanout Test Store",
      slug: `media-fanout-${Date.now()}`,
      owner: { email: `owner-${Date.now()}@fanout-test.com`, name: "Fanout Owner" },
      planCode: "starter",
      source: "platform_admin",
    });
    tenantId = tenant.tenantId;

    const staff = await seedPlatformStaff(rtPlatform._db.db, {
      email: `fanout-admin-${Date.now()}@platform.test`,
      role: "platform_admin",
    });

    const conn = await createPlatformStorageConnection(rtPlatform, staff.userId, {
      name: "Test Fanout Local Storage",
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
      requestId: "test-req-fanout",
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

  it("fans out cache invalidation when media is updated or replaced across owners", async () => {
    // 1. Upload media items
    const mProd = await uploadMediaDirect(rt, ctx, { filename: "prod.png", mime: "image/png", fileBytes: PNG_1X1 });
    const mCol = await uploadMediaDirect(rt, ctx, { filename: "col.png", mime: "image/png", fileBytes: PNG_1X1 });
    const mCat = await uploadMediaDirect(rt, ctx, { filename: "cat.png", mime: "image/png", fileBytes: PNG_1X1 });
    const mBrand = await uploadMediaDirect(rt, ctx, { filename: "brand.png", mime: "image/png", fileBytes: PNG_1X1 });
    const mLogo = await uploadMediaDirect(rt, ctx, { filename: "logo.png", mime: "image/png", fileBytes: PNG_1X1 });
    const mStatus = await uploadMediaDirect(rt, ctx, { filename: "status.png", mime: "image/png", fileBytes: PNG_1X1 });

    // 2. Setup entities using these media items
    const product = await createProduct(rt, ctx, {
      title: "Fanout Product",
      slug: `fanout-prod-${Date.now()}`,
      status: "draft",
    });
    const attachRes = await attachProductMedia(rt, ctx, {
      productId: product.id,
      mediaId: mProd.id,
    });

    const collection = await createCollection(rt, ctx, {
      title: "Fanout Collection",
      slug: `fanout-col-${Date.now()}`,
      imageMediaId: mCol.id,
    });

    const category = await createCategory(rt, ctx, {
      name: "Fanout Category",
      slug: `fanout-cat-${Date.now()}`,
      imageMediaId: mCat.id,
    });

    await createBrand(rt, ctx, {
      name: "Fanout Brand",
      slug: `fanout-brand-${Date.now()}`,
      logoMediaId: mBrand.id,
    });

    await updateBrandSettings(rt, ctx, {
      logoLightMediaId: mLogo.id,
    });

    await updateStoreStatus(rt, ctx, {
      mode: "coming_soon",
      backgroundMediaId: mStatus.id,
    });

    // 3. Test updateMedia on product image fans out to product cache tags
    capturedTags = [];
    await updateMedia(rt, ctx, {
      id: mProd.id,
      alt: "Updated product image alt text",
    });

    expect(capturedTags).toContain(tenantTag(tenantId, "product", product.id));
    expect(capturedTags).toContain(tenantTag(tenantId, "product"));
    expect(capturedTags).toContain(tenantTag(tenantId, "storage"));

    // 4. Test updateProductMedia on gallery row invalidates product tags
    capturedTags = [];
    await updateProductMedia(rt, ctx, {
      id: product.id,
      productMediaId: attachRes.id,
      alt: "Updated gallery-specific alt text",
    });

    expect(capturedTags).toContain(tenantTag(tenantId, "product", product.id));
    expect(capturedTags).toContain(tenantTag(tenantId, "product"));

    const { driver } = await getActiveStorageDriver(rt._db.db, "public_media");

    // 5. Test replaceMedia fans out to owner tags for collection
    capturedTags = [];
    const kCol = `${ctx.tenantId}/collections/${crypto.randomUUID()}.png`;
    await driver.put({ key: kCol, body: PNG_1X1, contentType: "image/png" });
    await replaceMedia(rt, ctx, {
      id: mCol.id,
      storageKey: kCol,
      filename: "col-replaced.png",
      mime: "image/png",
    });

    expect(capturedTags).toContain(tenantTag(tenantId, "collection", collection.id));
    expect(capturedTags).toContain(tenantTag(tenantId, "collection"));
    expect(capturedTags).toContain(tenantTag(tenantId, "storage"));

    // 6. Test replaceMedia fans out to owner tags for category
    capturedTags = [];
    const kCat = `${ctx.tenantId}/categories/${crypto.randomUUID()}.png`;
    await driver.put({ key: kCat, body: PNG_1X1, contentType: "image/png" });
    await replaceMedia(rt, ctx, {
      id: mCat.id,
      storageKey: kCat,
      filename: "cat-replaced.png",
      mime: "image/png",
    });

    expect(capturedTags).toContain(tenantTag(tenantId, "category", category.id));
    expect(capturedTags).toContain(tenantTag(tenantId, "category"));
    expect(capturedTags).toContain(tenantTag(tenantId, "nav"));

    // 7. Test replaceMedia fans out to owner tags for brand
    capturedTags = [];
    const kBrand = `${ctx.tenantId}/brands/${crypto.randomUUID()}.png`;
    await driver.put({ key: kBrand, body: PNG_1X1, contentType: "image/png" });
    await replaceMedia(rt, ctx, {
      id: mBrand.id,
      storageKey: kBrand,
      filename: "brand-replaced.png",
      mime: "image/png",
    });

    expect(capturedTags).toContain(tenantTag(tenantId, "nav"));

    // 8. Test replaceMedia fans out to store-shell, seo, theme for store branding
    capturedTags = [];
    const kLogo = `${ctx.tenantId}/branding/${crypto.randomUUID()}.png`;
    await driver.put({ key: kLogo, body: PNG_1X1, contentType: "image/png" });
    await replaceMedia(rt, ctx, {
      id: mLogo.id,
      storageKey: kLogo,
      filename: "logo-replaced.png",
      mime: "image/png",
    });

    expect(capturedTags).toContain(tenantTag(tenantId, "store-shell"));
    expect(capturedTags).toContain(tenantTag(tenantId, "seo"));
    expect(capturedTags).toContain(tenantTag(tenantId, "theme"));

    // 9. Test replaceMedia fans out to store-shell, seo for storefront status background
    capturedTags = [];
    const kStatus = `${ctx.tenantId}/storefront/${crypto.randomUUID()}.png`;
    await driver.put({ key: kStatus, body: PNG_1X1, contentType: "image/png" });
    await replaceMedia(rt, ctx, {
      id: mStatus.id,
      storageKey: kStatus,
      filename: "status-replaced.png",
      mime: "image/png",
    });

    expect(capturedTags).toContain(tenantTag(tenantId, "store-shell"));
    expect(capturedTags).toContain(tenantTag(tenantId, "seo"));
  });
});
