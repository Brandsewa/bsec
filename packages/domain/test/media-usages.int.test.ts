import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema, withTenant } from "@bs/db";
import { eq } from "drizzle-orm";
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
  getMedia,
  trashMedia,
  deleteMediaPermanent,
  attachProductMedia,
  detachProductMedia,
  findUntrackedReferences,
} from "../src/media-services.ts";
import {
  createProduct,
  updateVariant,
  createCollection,
  updateCollection,
  createCategory,
  updateCategory,
  createBrand,
  updateBrand,
} from "../src/catalog-services.ts";
import { updateBrandSettings } from "../src/brand-services.ts";
import { updateStoreStatus } from "../src/storefront/lifecycle.ts";

describe("Media Usages Integration Test Suite (Real Postgres & Storage)", () => {
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

    tempStorageDir = path.join(os.tmpdir(), `bsec-media-usages-test-${Date.now()}`);
    fs.mkdirSync(tempStorageDir, { recursive: true });
    process.env.STORAGE_LOCAL_DIR = tempStorageDir;

    const tenant = await provisionTenant(rtPlatform, {
      storeName: "Media Usages Test Store",
      slug: `media-usages-${Date.now()}`,
      owner: { email: `owner-${Date.now()}@usages-test.com`, name: "Usages Owner" },
      planCode: "starter",
      source: "platform_admin",
    });
    tenantId = tenant.tenantId;

    const staff = await seedPlatformStaff(rtPlatform._db.db, {
      email: `usages-admin-${Date.now()}@platform.test`,
      role: "platform_admin",
    });

    const conn = await createPlatformStorageConnection(rtPlatform, staff.userId, {
      name: "Test Usages Local Storage",
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
      requestId: "test-req-usages",
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

  it("accurately tracks usages across catalog, branding, and status fields", async () => {
    // 1. Upload media files for each slot
    const mCol = await uploadMediaDirect(rt, ctx, { filename: "col.png", mime: "image/png", fileBytes: PNG_1X1 });
    const mCat = await uploadMediaDirect(rt, ctx, { filename: "cat.png", mime: "image/png", fileBytes: PNG_1X1 });
    const mBrand = await uploadMediaDirect(rt, ctx, { filename: "brand.png", mime: "image/png", fileBytes: PNG_1X1 });
    const mProd = await uploadMediaDirect(rt, ctx, { filename: "prod.png", mime: "image/png", fileBytes: PNG_1X1 });
    const mVar = await uploadMediaDirect(rt, ctx, { filename: "var.png", mime: "image/png", fileBytes: PNG_1X1 });

    const mLogoLight = await uploadMediaDirect(rt, ctx, { filename: "logo-light.png", mime: "image/png", fileBytes: PNG_1X1 });
    const mLogoDark = await uploadMediaDirect(rt, ctx, { filename: "logo-dark.png", mime: "image/png", fileBytes: PNG_1X1 });
    const mFavicon = await uploadMediaDirect(rt, ctx, { filename: "favicon.png", mime: "image/png", fileBytes: PNG_1X1 });
    const mApple = await uploadMediaDirect(rt, ctx, { filename: "apple.png", mime: "image/png", fileBytes: PNG_1X1 });
    const mSocial = await uploadMediaDirect(rt, ctx, { filename: "social.png", mime: "image/png", fileBytes: PNG_1X1 });
    const mStatus = await uploadMediaDirect(rt, ctx, { filename: "status.png", mime: "image/png", fileBytes: PNG_1X1 });

    // 2. Wire collection
    const col = await createCollection(rt, ctx, { title: "Summer Line", imageMediaId: mCol.id });
    const colUsage = await getMedia(rt, ctx, { id: mCol.id });
    expect(colUsage.usages.length).toBe(1);
    expect(colUsage.usages[0]).toMatchObject({
      ownerType: "collection",
      ownerId: col.id,
      field: "image",
      adminPath: `/collections/${col.id}`,
    });

    // 3. Wire category
    const cat = await createCategory(rt, ctx, { name: "Outerwear", imageMediaId: mCat.id });
    const catUsage = await getMedia(rt, ctx, { id: mCat.id });
    expect(catUsage.usages.length).toBe(1);
    expect(catUsage.usages[0]).toMatchObject({
      ownerType: "category",
      ownerId: cat.id,
      field: "image",
      adminPath: `/categories/${cat.id}`,
    });

    // 4. Wire brand
    const brand = await createBrand(rt, ctx, { name: "Apex Goods", logoMediaId: mBrand.id });
    const brandUsage = await getMedia(rt, ctx, { id: mBrand.id });
    expect(brandUsage.usages.length).toBe(1);
    expect(brandUsage.usages[0]).toMatchObject({
      ownerType: "brand",
      ownerId: brand.id,
      field: "logo",
      adminPath: "/brands",
    });

    // 5. Wire product gallery and variant
    const prod = await createProduct(rt, ctx, {
      title: "Apex Parka",
      variants: [{ title: "Medium", sku: `SKU-APEX-${Date.now()}`, price: 1000 }],
    });
    const attached = await attachProductMedia(rt, ctx, { productId: prod.id, mediaId: mProd.id, alt: "Front parka" });
    const prodUsage = await getMedia(rt, ctx, { id: mProd.id });
    expect(prodUsage.usages.length).toBe(1);
    expect(prodUsage.usages[0]).toMatchObject({
      ownerType: "product",
      ownerId: prod.id,
      field: "gallery",
      adminPath: `/products/${prod.id}`,
    });

    const variantId = prod.variants[0]?.id;
    if (!variantId) throw new Error("Variant not found");
    await updateVariant(rt, ctx, { id: variantId, imageMediaId: mVar.id });
    const varUsage = await getMedia(rt, ctx, { id: mVar.id });
    expect(varUsage.usages.length).toBe(1);
    expect(varUsage.usages[0]).toMatchObject({
      ownerType: "variant",
      ownerId: variantId,
      field: "image",
      adminPath: `/products/${prod.id}`,
    });

    // 6. Wire branding (all 5 slots)
    await updateBrandSettings(rt, ctx, {
      logoLightMediaId: mLogoLight.id,
      logoDarkMediaId: mLogoDark.id,
      faviconMediaId: mFavicon.id,
      appleTouchIconMediaId: mApple.id,
      socialImageMediaId: mSocial.id,
    });

    const brandingSlots = [
      { id: mLogoLight.id, field: "logo", label: "Store branding (Logo)" },
      { id: mLogoDark.id, field: "logo_dark", label: "Store branding (Dark Logo)" },
      { id: mFavicon.id, field: "favicon", label: "Store branding (Favicon)" },
      { id: mApple.id, field: "apple_touch_icon", label: "Store branding (Apple Touch Icon)" },
      { id: mSocial.id, field: "social_image", label: "Store branding (Social Image)" },
    ];
    for (const slot of brandingSlots) {
      const itemUsage = await getMedia(rt, ctx, { id: slot.id });
      expect(itemUsage.usages.length).toBe(1);
      expect(itemUsage.usages[0]).toMatchObject({
        ownerType: "store_branding",
        field: slot.field,
        label: slot.label,
        adminPath: "/settings/branding",
      });
    }

    // 7. Wire storefront status background
    await updateStoreStatus(rt, ctx, {
      mode: "coming_soon",
      backgroundMediaId: mStatus.id,
    });
    const statusUsage = await getMedia(rt, ctx, { id: mStatus.id });
    expect(statusUsage.usages.length).toBe(1);
    expect(statusUsage.usages[0]).toMatchObject({
      ownerType: "store_branding",
      field: "status_background",
      label: "Store status (Background image)",
      adminPath: "/settings/storefront",
    });

    // 8. Test findUntrackedReferences matches
    const allIds = [
      mCol.id,
      mCat.id,
      mBrand.id,
      mProd.id,
      mVar.id,
      mLogoLight.id,
      mLogoDark.id,
      mFavicon.id,
      mApple.id,
      mSocial.id,
      mStatus.id,
    ];
    const untracked = await withTenant(rt._db.db, ctx.tenantId, (tx) =>
      findUntrackedReferences(tx, ctx.tenantId, allIds),
    );
    expect(untracked.has(mLogoLight.id)).toBe(true);
    expect(untracked.has(mLogoDark.id)).toBe(true);
    expect(untracked.has(mFavicon.id)).toBe(true);
    expect(untracked.has(mApple.id)).toBe(true);
    expect(untracked.has(mSocial.id)).toBe(true);
    expect(untracked.has(mStatus.id)).toBe(true);

    // 9. Clearing fields removes usages
    await updateCollection(rt, ctx, { id: col.id, imageMediaId: null });
    const colCleared = await getMedia(rt, ctx, { id: mCol.id });
    expect(colCleared.usages.length).toBe(0);

    await updateCategory(rt, ctx, { id: cat.id, imageMediaId: null });
    const catCleared = await getMedia(rt, ctx, { id: mCat.id });
    expect(catCleared.usages.length).toBe(0);

    await updateBrand(rt, ctx, { id: brand.id, logoMediaId: null });
    const brandCleared = await getMedia(rt, ctx, { id: mBrand.id });
    expect(brandCleared.usages.length).toBe(0);

    await updateVariant(rt, ctx, { id: variantId, imageMediaId: null });
    const varCleared = await getMedia(rt, ctx, { id: mVar.id });
    expect(varCleared.usages.length).toBe(0);

    await detachProductMedia(rt, ctx, { productId: prod.id, productMediaId: attached.id });
    const prodCleared = await getMedia(rt, ctx, { id: mProd.id });
    expect(prodCleared.usages.length).toBe(0);
  });

  it("refuses permanent deletion of used files and reports usage details", async () => {
    const mUsed = await uploadMediaDirect(rt, ctx, { filename: "active-logo.png", mime: "image/png", fileBytes: PNG_1X1 });
    await updateBrandSettings(rt, ctx, { logoLightMediaId: mUsed.id });

    // Trashing should succeed but report used status
    const trashRes = await trashMedia(rt, ctx, { ids: [mUsed.id] });
    expect(trashRes.trashed).toBe(1);
    expect(trashRes.used.length).toBe(1);
    expect(trashRes.used[0]?.id).toBe(mUsed.id);

    // Permanent delete MUST be blocked
    const delRes = await deleteMediaPermanent(rt, ctx, { ids: [mUsed.id] });
    expect(delRes.deleted).toBe(0);
    expect(delRes.blocked.length).toBe(1);
    expect(delRes.blocked[0]?.id).toBe(mUsed.id);
    expect(delRes.blocked[0]?.usages.length).toBeGreaterThanOrEqual(1);

    // Ensure media row still exists in DB
    const checkRow = await withTenant(rt._db.db, ctx.tenantId, (tx) =>
      tx
        .select({ id: schema.media.id })
        .from(schema.media)
        .where(eq(schema.media.id, mUsed.id)),
    );
    expect(checkRow.length).toBe(1);
  });
});
