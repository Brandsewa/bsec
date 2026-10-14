import crypto from "node:crypto";
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
  getActiveStorageDriver,
  invalidateStorageConnectionCache,
} from "../src/media/connection.ts";
import {
  uploadMediaDirect,
  getMedia,
  replaceMedia,
  attachProductMedia,
} from "../src/media-services.ts";
import { createProduct } from "../src/catalog-services.ts";
import { getTenantMediaUsageStats } from "../src/system/quotas.ts";

describe("Media Replace Integration Test Suite (Real Postgres & Storage)", () => {
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

  // Valid 2x2 PNG for replacement
  const PNG_2X2 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR42mNk+M9QzwAEAAMfAYEc8V2xAAAAAElFTkSuQmCC",
    "base64",
  );

  // Minimal valid MP4 header (ftyp isom)
  const MP4_SAMPLE = Buffer.from([
    0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
    0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
    0x61, 0x76, 0x63, 0x31, 0x6d, 0x70, 0x34, 0x31,
  ]);

  beforeAll(async () => {
    env = await startTestDb();
    rt = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 10 });
    rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 10 });

    tempStorageDir = path.join(os.tmpdir(), `bsec-media-replace-test-${Date.now()}`);
    fs.mkdirSync(tempStorageDir, { recursive: true });
    process.env.STORAGE_LOCAL_DIR = tempStorageDir;

    const tenant = await provisionTenant(rtPlatform, {
      storeName: "Media Replace Test Store",
      slug: `media-replace-${Date.now()}`,
      owner: { email: `owner-${Date.now()}@replace-test.com`, name: "Replace Owner" },
      planCode: "starter",
      source: "platform_admin",
    });
    tenantId = tenant.tenantId;

    const staff = await seedPlatformStaff(rtPlatform._db.db, {
      email: `replace-admin-${Date.now()}@platform.test`,
      role: "platform_admin",
    });

    const conn = await createPlatformStorageConnection(rtPlatform, staff.userId, {
      name: "Test Replace Local Storage",
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
      requestId: "test-req-replace",
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

  it("successfully replaces an image with another image and purges old storage object", async () => {
    const { driver } = await getActiveStorageDriver(rt._db.db, "public_media");

    // 1. Initial upload
    const initial = await uploadMediaDirect(rt, ctx, {
      filename: "old-hero.png",
      mime: "image/png",
      fileBytes: PNG_1X1,
      title: "Hero banner",
      alt: "Initial alt",
      caption: "Initial caption",
    });
    const oldKey = initial.storageKey;
    if (!oldKey) throw new Error("expected storageKey on initial upload");
    const oldHead = await driver.head(oldKey);
    expect(oldHead.exists).toBe(true);

    // 2. Put new replacement bytes into storage
    const newKey = `${ctx.tenantId}/products/${crypto.randomUUID()}.png`;
    await driver.put({ key: newKey, body: PNG_2X2, contentType: "image/png" });

    // 3. Replace
    const replaced = await replaceMedia(rt, ctx, {
      id: initial.id,
      storageKey: newKey,
      mime: "image/png",
      filename: "new-hero.png",
      bytes: PNG_2X2.length,
    });

    // 4. Verification
    expect(replaced.id).toBe(initial.id);
    expect(replaced.filename).toBe("new-hero.png");
    expect(replaced.width).toBe(2);
    expect(replaced.height).toBe(2);
    expect(replaced.bytes).toBe(PNG_2X2.length);
    // Preserves title, alt, caption when not provided in replacement call
    expect(replaced.title).toBe("Hero banner");
    expect(replaced.alt).toBe("Initial alt");
    expect(replaced.caption).toBe("Initial caption");

    // 5. Old storage key must be physically purged
    const oldHeadAfter = await driver.head(oldKey);
    expect(oldHeadAfter.exists).toBe(false);

    // 6. New storage key exists
    const newHeadAfter = await driver.head(newKey);
    expect(newHeadAfter.exists).toBe(true);
  });

  it("refuses replacement with mismatched kind (e.g. image with video)", async () => {
    const { driver } = await getActiveStorageDriver(rt._db.db, "public_media");

    const img = await uploadMediaDirect(rt, ctx, {
      filename: "photo.png",
      mime: "image/png",
      fileBytes: PNG_1X1,
    });

    const videoKey = `${ctx.tenantId}/products/${crypto.randomUUID()}.mp4`;
    await driver.put({ key: videoKey, body: MP4_SAMPLE, contentType: "video/mp4" });

    await expect(
      replaceMedia(rt, ctx, {
        id: img.id,
        storageKey: videoKey,
        mime: "video/mp4",
        filename: "video.mp4",
        bytes: MP4_SAMPLE.length,
      }),
    ).rejects.toThrow(/Replacement file must be of the same type/i);

    // Image record should still have its original key and image kind
    const current = await getMedia(rt, ctx, { id: img.id });
    expect(current.kind).toBe("image");
    expect(current.storageKey).toBe(img.storageKey);
  });

  it("refuses a replacement image that cannot be decoded, keeps the original and purges the upload", async () => {
    const { driver } = await getActiveStorageDriver(rt._db.db, "public_media");

    const img = await uploadMediaDirect(rt, ctx, {
      filename: "intact.png",
      mime: "image/png",
      fileBytes: PNG_1X1,
    });

    // PNG signature followed by garbage: passes the magic-byte check, fails to decode
    const brokenKey = `${ctx.tenantId}/products/${crypto.randomUUID()}.png`;
    const broken = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
    await driver.put({ key: brokenKey, body: broken, contentType: "image/png" });

    await expect(
      replaceMedia(rt, ctx, {
        id: img.id,
        storageKey: brokenKey,
        mime: "image/png",
        filename: "broken.png",
        bytes: broken.length,
      }),
    ).rejects.toThrow(/corrupted or invalid image/i);

    const current = await getMedia(rt, ctx, { id: img.id });
    expect(current.storageKey).toBe(img.storageKey);
    expect((await driver.head(brokenKey)).exists).toBe(false);
  });

  it("calculates net quota delta and preserves used-in references", async () => {
    const { driver } = await getActiveStorageDriver(rt._db.db, "public_media");

    // Upload an image and attach it to a product
    const initial = await uploadMediaDirect(rt, ctx, {
      filename: "product-image.png",
      mime: "image/png",
      fileBytes: PNG_1X1,
    });

    const prod = await createProduct(rt, ctx, {
      title: "Replaceable Product",
      variants: [{ title: "Standard", sku: `SKU-REP-${Date.now()}`, price: 150 }],
    });
    await attachProductMedia(rt, ctx, { productId: prod.id, mediaId: initial.id });

    const statsBefore = await getTenantMediaUsageStats(rt._db.db, ctx.tenantId);

    // Replace with PNG_2X2 (larger bytes)
    const newKey = `${ctx.tenantId}/products/${crypto.randomUUID()}.png`;
    await driver.put({ key: newKey, body: PNG_2X2, contentType: "image/png" });

    const replaced = await replaceMedia(rt, ctx, {
      id: initial.id,
      storageKey: newKey,
      mime: "image/png",
      filename: "product-image-v2.png",
      bytes: PNG_2X2.length,
    });

    // Check usage count maintained
    expect(replaced.usageCount).toBe(1);
    const detail = await getMedia(rt, ctx, { id: initial.id });
    expect(detail.usageCount).toBe(1);
    expect(detail.usages.length).toBe(1);
    expect(detail.usages[0]?.ownerType).toBe("product");

    // Check storage stats reflects difference
    const statsAfter = await getTenantMediaUsageStats(rt._db.db, ctx.tenantId);
    const expectedDiff = PNG_2X2.length - PNG_1X1.length;
    expect(statsAfter.usedBytes - statsBefore.usedBytes).toBe(expectedDiff);
  });
});
