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
  attachProductMedia,
  detachProductMedia,
  reorderProductMedia,
  updateProductMedia,
} from "../src/media-services.ts";
import { createProduct } from "../src/catalog-services.ts";

describe("Product Media Gallery Integration Test Suite (S3)", () => {
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

  // Minimal valid MP4 header (ftyp isom)
  const MP4_BYTES = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, // length 24, "ftyp"
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00, // major brand "isom", minor version
    0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32, // compatible brands
  ]);

  beforeAll(async () => {
    env = await startTestDb();
    rt = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 10 });
    rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 10 });

    tempStorageDir = path.join(os.tmpdir(), `bsec-media-gallery-test-${Date.now()}`);
    fs.mkdirSync(tempStorageDir, { recursive: true });
    process.env.STORAGE_LOCAL_DIR = tempStorageDir;

    const tenant = await provisionTenant(rtPlatform, {
      storeName: "Media Gallery Test Store",
      slug: `media-gallery-${Date.now()}`,
      owner: { email: `owner-${Date.now()}@gallery-test.com`, name: "Gallery Owner" },
      planCode: "starter",
      source: "platform_admin",
    });
    tenantId = tenant.tenantId;

    const staff = await seedPlatformStaff(rtPlatform._db.db, {
      email: `gallery-admin-${Date.now()}@platform.test`,
      role: "platform_admin",
    });

    const conn = await createPlatformStorageConnection(rtPlatform, staff.userId, {
      name: "Test Gallery Local Storage",
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
      requestId: "test-req-gallery",
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

  it("enforces image at position 0, video at non-zero positions, reordering invariant, and promotions on detach", async () => {
    // 1. Upload two images and one video to library
    const img1 = await uploadMediaDirect(rt, ctx, {
      filename: "product-img-1.png",
      mime: "image/png",
      fileBytes: PNG_1X1,
      title: "Product Image 1",
      alt: "Global Alt 1",
    });

    const img2 = await uploadMediaDirect(rt, ctx, {
      filename: "product-img-2.png",
      mime: "image/png",
      fileBytes: PNG_1X1,
      title: "Product Image 2",
      alt: "Global Alt 2",
    });

    const vid1 = await uploadMediaDirect(rt, ctx, {
      filename: "product-video-1.mp4",
      mime: "video/mp4",
      fileBytes: MP4_BYTES,
      title: "Product Video",
    });

    // 2. Create product
    const product = await createProduct(rt, ctx, {
      title: "Test Gallery Product",
      slug: `gallery-product-${Date.now()}`,
      status: "draft",
    });

    // 3. Attach video at position 0 on empty product must fail (primary must be image)
    await expect(
      attachProductMedia(rt, ctx, {
        productId: product.id,
        mediaId: vid1.id,
      }),
    ).rejects.toThrow(/A product must have at least one image before adding a video/);

    // 4. Attach image at position 0 succeeds, isPrimary = true
    const attachedImg1 = await attachProductMedia(rt, ctx, {
      productId: product.id,
      mediaId: img1.id,
      alt: "Specific Alt 1",
    });
    expect(attachedImg1.isPrimary).toBe(true);
    expect(attachedImg1.position).toBe(0);

    // 5. Attach video at position 1 succeeds, isPrimary = false
    const attachedVid1 = await attachProductMedia(rt, ctx, {
      productId: product.id,
      mediaId: vid1.id,
    });
    expect(attachedVid1.isPrimary).toBe(false);
    expect(attachedVid1.position).toBe(1);

    // 6. Attach image 2 at position 2
    const attachedImg2 = await attachProductMedia(rt, ctx, {
      productId: product.id,
      mediaId: img2.id,
    });
    expect(attachedImg2.isPrimary).toBe(false);
    expect(attachedImg2.position).toBe(2);

    // 7. Reorder putting video at position 0 fails (primary-must-be-image invariant)
    await expect(
      reorderProductMedia(rt, ctx, {
        id: product.id,
        order: [attachedVid1.id, attachedImg1.id, attachedImg2.id],
      }),
    ).rejects.toThrow(/The primary media \(position 0\) must be an image/);

    // 8. Reorder maintaining image at position 0 succeeds
    const reorderRes = await reorderProductMedia(rt, ctx, {
      id: product.id,
      order: [attachedImg2.id, attachedVid1.id, attachedImg1.id],
    });
    expect(reorderRes.success).toBe(true);

    // Verify order in DB
    const dbRows = await withTenant(rt._db.db, ctx.tenantId, (tx) =>
      tx
        .select({ id: schema.productMedia.id, position: schema.productMedia.position })
        .from(schema.productMedia)
        .where(eq(schema.productMedia.productId, product.id))
        .orderBy(schema.productMedia.position),
    );

    expect(dbRows.map((r) => r.id)).toEqual([attachedImg2.id, attachedVid1.id, attachedImg1.id]);

    // 9. updateProductMedia alters alt on the join row without touching media.alt
    const updateRes = await updateProductMedia(rt, ctx, {
      id: product.id,
      productMediaId: attachedImg2.id,
      alt: "Product-Specific Alt for Image 2",
    });
    expect(updateRes.success).toBe(true);

    // Check productMedia row has updated alt
    const [pmRow] = await withTenant(rt._db.db, ctx.tenantId, (tx) =>
      tx
        .select({ alt: schema.productMedia.alt })
        .from(schema.productMedia)
        .where(eq(schema.productMedia.id, attachedImg2.id)),
    );
    expect(pmRow?.alt).toBe("Product-Specific Alt for Image 2");

    // Check media row still has its original alt
    const mediaRow = await getMedia(rt, ctx, { id: img2.id });
    expect(mediaRow.alt).toBe("Global Alt 2");

    // 10. Detach position 0 (attachedImg2)
    // Remaining items before promotion: attachedVid1 (pos 1), attachedImg1 (pos 2)
    // S3 requires: if position 0 is not an image, promote next image to position 0
    // So attachedImg1 must be promoted to position 0, and attachedVid1 becomes position 1
    const detachRes = await detachProductMedia(rt, ctx, {
      productId: product.id,
      productMediaId: attachedImg2.id,
    });
    expect(detachRes.success).toBe(true);

    const postDetachRows = await withTenant(rt._db.db, ctx.tenantId, (tx) =>
      tx
        .select({
          id: schema.productMedia.id,
          mediaId: schema.productMedia.mediaId,
          position: schema.productMedia.position,
        })
        .from(schema.productMedia)
        .where(eq(schema.productMedia.productId, product.id))
        .orderBy(schema.productMedia.position),
    );

    expect(postDetachRows.length).toBe(2);
    // attachedImg1 was promoted to position 0
    expect(postDetachRows[0]?.id).toBe(attachedImg1.id);
    expect(postDetachRows[0]?.position).toBe(0);
    // attachedVid1 is now position 1
    expect(postDetachRows[1]?.id).toBe(attachedVid1.id);
    expect(postDetachRows[1]?.position).toBe(1);
  });
});
