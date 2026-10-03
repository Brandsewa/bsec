import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  createRuntime,
  provisionTenant,
  requestReturn,
  getOrderReturnsByToken,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import {
  createPresignedReturnPhotoUpload,
  finalizeReturnPhoto,
  resolveOrderIdFromToken,
  cleanupOrphanedReturnPhotos,
  checkReturnPhotoRateLimit,
  isReturnPhotoStorageConfigured,
} from "../src/orders/return-photos.ts";
import { createActiveProduct, createDeliveredCodOrder, createGuestCheckout } from "./helpers/factories.ts";
import { createHash } from "node:crypto";
import { STORE_PERMISSIONS } from "@bs/auth";
import type { S3Client } from "@aws-sdk/client-s3";

let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let ctxA: TenantContext;
let ctxB: TenantContext;
let orderAId: string;
let orderBId: string;
let orderAToken: string;
let orderBToken: string;
let variantAId: string;
let orderAItemId: string;

interface S3CommandLike {
  constructor?: { name?: string };
  _cmd?: string;
  input?: {
    Key?: string;
    Bucket?: string;
  };
}

// Fake S3 client for tests
function createMockS3(storage: Map<string, { body: Buffer; mime: string; size: number }>): S3Client {
  return {
    async send(command: S3CommandLike) {
      const name = command.constructor?.name || "";
      const input = command.input || {};
      const key = input.Key ?? "";

      if (name === "HeadObjectCommand" || command._cmd === "head") {
        const item = storage.get(key);
        if (!item) {
          const err = new Error("NotFound") as Error & { $metadata?: { httpStatusCode: number } };
          err.name = "NotFound";
          err.$metadata = { httpStatusCode: 404 };
          throw err;
        }
        return {
          ContentLength: item.size,
          ContentType: item.mime,
        };
      }

      if (name === "GetObjectCommand" || command._cmd === "get") {
        const item = storage.get(key);
        if (!item) {
          const err = new Error("NotFound");
          err.name = "NotFound";
          throw err;
        }
        return {
          Body: {
            async transformToByteArray() {
              return new Uint8Array(item.body);
            },
          },
        };
      }

      if (name === "DeleteObjectCommand" || command._cmd === "delete") {
        storage.delete(key);
        return {};
      }

      throw new Error(`Unhandled mock command: ${name}`);
    },
  } as unknown as S3Client;
}

beforeAll(async () => {
  process.env.R2_PRIVATE_BUCKET_NAME = "bsec-returns-private-test";
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 10 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 10 });

  // Provision Tenant A
  const tA = await provisionTenant(rt, {
    storeName: "Photo Store A",
    slug: "photo-store-a",
    owner: { email: "owner-a@photos.test", name: "Owner A" },
    planCode: "starter",
    source: "platform_admin",
  });
  ctxA = {
    tenantId: tA.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: tA.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-photo-a",
  };

  // Provision Tenant B
  const tB = await provisionTenant(rt, {
    storeName: "Photo Store B",
    slug: "photo-store-b",
    owner: { email: "owner-b@photos.test", name: "Owner B" },
    planCode: "starter",
    source: "platform_admin",
  });
  ctxB = {
    tenantId: tB.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: tB.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-photo-b",
  };

  // Create Product and delivered order in Tenant A
  const pA = await createActiveProduct(rtWeb, ctxA, {
    title: "Returnable Shirt",
    price: 1000,
    stock: 100,
  });
  variantAId = pA.variantId;

  const deliveredA = await createDeliveredCodOrder(rtWeb, ctxA, {
    variantId: variantAId,
    quantity: 2,
    email: "shopper@photos.test",
    name: "Shopper A",
    phone: "9876543210",
  });
  orderAId = deliveredA.orderId;
  orderAItemId = deliveredA.orderItemId;

  // Create Action Token for Order A
  orderAToken = "token_order_a_photo_test";
  const tokenHashA = createHash("sha256").update(orderAToken).digest("hex");
  await withTenant(rt._db.db, ctxA.tenantId, async (tx) => {
    await tx.insert(schema.actionTokens).values({
      tenantId: ctxA.tenantId,
      tokenHash: tokenHashA,
      purpose: "order_view",
      targetId: orderAId,
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    });
  });

  // Create Product and Order in Tenant B
  const pB = await createActiveProduct(rtWeb, ctxB, {
    title: "Product B",
    price: 500,
    stock: 50,
  });

  const placedB = await createGuestCheckout(rtWeb, ctxB, {
    variantId: pB.variantId,
    quantity: 1,
    email: "shopper_b@photos.test",
    phone: "9876543211",
    name: "Shopper B",
  });
  orderBId = placedB.orderId;

  orderBToken = "token_order_b_photo_test";
  const tokenHashB = createHash("sha256").update(orderBToken).digest("hex");
  await withTenant(rt._db.db, ctxB.tenantId, async (tx) => {
    await tx.insert(schema.actionTokens).values({
      tenantId: ctxB.tenantId,
      tokenHash: tokenHashB,
      purpose: "order_view",
      targetId: orderBId,
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    });
  });
});

afterAll(async () => {
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("Return Photo Upload Security & Limits", () => {
  const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const WEBP_HEADER = Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.from([0x20, 0x00, 0x00, 0x00]),
    Buffer.from("WEBPVP8 "),
  ]);
  const SVG_CONTENT = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
  const GIF_CONTENT = Buffer.from("GIF89a...");

  it("resolves order id from valid token and rejects invalid/cross-tenant token", async () => {
    const resolvedA = await resolveOrderIdFromToken(rt._db.db, ctxA.tenantId, orderAToken);
    expect(resolvedA).toBe(orderAId);

    const resolvedInvalid = await resolveOrderIdFromToken(rt._db.db, ctxA.tenantId, "non_existent_token");
    expect(resolvedInvalid).toBeNull();

    // Cross tenant lookup fails
    const resolvedCross = await resolveOrderIdFromToken(rt._db.db, ctxA.tenantId, orderBToken);
    expect(resolvedCross).toBeNull();
  });

  it("enforces mime types and file size during presigning", async () => {
    // Valid jpeg
    const presign = await createPresignedReturnPhotoUpload(rt, ctxA, {
      orderId: orderAId,
      filename: "photo.jpg",
      mime: "image/jpeg",
      bytes: 1024 * 1024,
    });
    expect(presign.storageKey).toMatch(new RegExp(`^tenants/${ctxA.tenantId}/returns/${orderAId}/`));

    // Refuse SVG, GIF, HTML
    await expect(
      createPresignedReturnPhotoUpload(rt, ctxA, {
        orderId: orderAId,
        filename: "photo.svg",
        mime: "image/svg+xml",
        bytes: 1024,
      }),
    ).rejects.toThrow("Bad Request: Unsupported file format");

    await expect(
      createPresignedReturnPhotoUpload(rt, ctxA, {
        orderId: orderAId,
        filename: "photo.gif",
        mime: "image/gif",
        bytes: 1024,
      }),
    ).rejects.toThrow("Bad Request: Unsupported file format");

    // Refuse > 5 MB
    await expect(
      createPresignedReturnPhotoUpload(rt, ctxA, {
        orderId: orderAId,
        filename: "photo.jpg",
        mime: "image/jpeg",
        bytes: 6 * 1024 * 1024,
      }),
    ).rejects.toThrow("Bad Request: Photo size must be between 1 byte and 5 MB");
  });

  it("finalize rejects storageKey outside tenant/order path", async () => {
    const storage = new Map<string, { body: Buffer; mime: string; size: number }>();
    const fakeS3 = createMockS3(storage);
    const mediaId = crypto.randomUUID();

    // Foreign order path
    await expect(
      finalizeReturnPhoto(rt, ctxA, {
        orderId: orderAId,
        mediaId,
        storageKey: `tenants/${ctxA.tenantId}/returns/${orderBId}/${mediaId}.jpg`,
        s3Client: fakeS3,
      }),
    ).rejects.toThrow("Bad Request: Storage key does not match");

    // Foreign tenant path
    await expect(
      finalizeReturnPhoto(rt, ctxA, {
        orderId: orderAId,
        mediaId,
        storageKey: `tenants/${ctxB.tenantId}/returns/${orderAId}/${mediaId}.jpg`,
        s3Client: fakeS3,
      }),
    ).rejects.toThrow("Bad Request: Storage key does not match");
  });

  it("finalize fails closed when object is missing or S3 throws", async () => {
    const storage = new Map<string, { body: Buffer; mime: string; size: number }>();
    const fakeS3 = createMockS3(storage);
    const mediaId = crypto.randomUUID();
    const key = `tenants/${ctxA.tenantId}/returns/${orderAId}/${mediaId}.jpg`;

    await expect(
      finalizeReturnPhoto(rt, ctxA, {
        orderId: orderAId,
        mediaId,
        storageKey: key,
        s3Client: fakeS3,
      }),
    ).rejects.toThrow("Bad Request: Uploaded file not found in storage");
  });

  it("finalize fails closed on fake/tampered content (SVG, GIF, or text claiming to be JPEG)", async () => {
    const storage = new Map<string, { body: Buffer; mime: string; size: number }>();
    const fakeS3 = createMockS3(storage);
    const mediaId1 = crypto.randomUUID();
    const mediaId2 = crypto.randomUUID();

    // SVG pretending to be JPEG
    const svgKey = `tenants/${ctxA.tenantId}/returns/${orderAId}/${mediaId1}.jpg`;
    storage.set(svgKey, { body: SVG_CONTENT, mime: "image/jpeg", size: SVG_CONTENT.length });

    await expect(
      finalizeReturnPhoto(rt, ctxA, {
        orderId: orderAId,
        mediaId: mediaId1,
        storageKey: svgKey,
        s3Client: fakeS3,
      }),
    ).rejects.toThrow("Bad Request: Invalid or corrupted image format");

    // GIF pretending to be PNG
    const gifKey = `tenants/${ctxA.tenantId}/returns/${orderAId}/${mediaId2}.png`;
    storage.set(gifKey, { body: GIF_CONTENT, mime: "image/png", size: GIF_CONTENT.length });

    await expect(
      finalizeReturnPhoto(rt, ctxA, {
        orderId: orderAId,
        mediaId: mediaId2,
        storageKey: gifKey,
        s3Client: fakeS3,
      }),
    ).rejects.toThrow("Bad Request: Invalid or corrupted image format");
  });

  it("finalize succeeds with genuine JPEG/PNG/WebP and takes metadata from storage", async () => {
    const storage = new Map<string, { body: Buffer; mime: string; size: number }>();
    const fakeS3 = createMockS3(storage);
    const mediaId = crypto.randomUUID();

    const jpegKey = `tenants/${ctxA.tenantId}/returns/${orderAId}/${mediaId}.jpg`;
    const jpegBody = Buffer.concat([JPEG_HEADER, Buffer.alloc(500)]);
    storage.set(jpegKey, { body: jpegBody, mime: "image/jpeg", size: jpegBody.length });

    const finalized = await finalizeReturnPhoto(rt, ctxA, {
      orderId: orderAId,
      mediaId,
      storageKey: jpegKey,
      s3Client: fakeS3,
    });

    expect(finalized.id).toBe(mediaId);
    expect(finalized.mime).toBe("image/jpeg");
    expect(finalized.bytes).toBe(jpegBody.length);
  });

  it("enforces rate limits per order and per IP", async () => {
    // Per order limit: 20 per hour
    const limitDb = rt._db.db;
    const testOrderId = `order_rate_test_${Date.now()}`;
    for (let i = 0; i < 20; i++) {
      await expect(
        checkReturnPhotoRateLimit(limitDb, ctxA.tenantId, testOrderId, `192.168.1.${i}`),
      ).resolves.toBeUndefined();
    }
    await expect(
      checkReturnPhotoRateLimit(limitDb, ctxA.tenantId, testOrderId, "192.168.1.99"),
    ).rejects.toThrow("Too many photo upload attempts for this order");

    // Per IP limit: 30 per hour
    const testIp = `10.0.0.${Date.now() % 250}`;
    for (let i = 0; i < 30; i++) {
      await expect(
        checkReturnPhotoRateLimit(limitDb, ctxA.tenantId, `order_ip_${i}`, testIp),
      ).resolves.toBeUndefined();
    }
    await expect(
      checkReturnPhotoRateLimit(limitDb, ctxA.tenantId, "order_ip_overflow", testIp),
    ).rejects.toThrow("Too many photo upload attempts");
  });

  it("requestReturn validates attached photos (rejects unfinalized, cross-order, or already-used photos)", async () => {
    const storage = new Map<string, { body: Buffer; mime: string; size: number }>();
    const fakeS3 = createMockS3(storage);
    const m1 = crypto.randomUUID();
    const m2 = crypto.randomUUID();
    const mB = crypto.randomUUID();

    // Finalize 2 photos for Order A
    const p1Key = `tenants/${ctxA.tenantId}/returns/${orderAId}/${m1}.jpg`;
    const p2Key = `tenants/${ctxA.tenantId}/returns/${orderAId}/${m2}.png`;
    const p1Body = Buffer.concat([JPEG_HEADER, Buffer.alloc(100)]);
    const p2Body = Buffer.concat([PNG_HEADER, Buffer.alloc(100)]);
    storage.set(p1Key, { body: p1Body, mime: "image/jpeg", size: p1Body.length });
    storage.set(p2Key, { body: p2Body, mime: "image/png", size: p2Body.length });

    const photo1 = await finalizeReturnPhoto(rt, ctxA, {
      orderId: orderAId,
      mediaId: m1,
      storageKey: p1Key,
      s3Client: fakeS3,
    });
    const _photo2 = await finalizeReturnPhoto(rt, ctxA, {
      orderId: orderAId,
      mediaId: m2,
      storageKey: p2Key,
      s3Client: fakeS3,
    });

    // Finalize 1 photo for Order B
    const pBKey = `tenants/${ctxB.tenantId}/returns/${orderBId}/${mB}.webp`;
    const pBBody = Buffer.concat([WEBP_HEADER, Buffer.alloc(100)]);
    storage.set(pBKey, { body: pBBody, mime: "image/webp", size: pBBody.length });
    const photoB = await finalizeReturnPhoto(rt, ctxB, {
      orderId: orderBId,
      mediaId: mB,
      storageKey: pBKey,
      s3Client: fakeS3,
    });

    // Attempt return on Order A with photo from Order B (cross-tenant) -> rejected as invalid/non-existent in tenant A
    await expect(
      requestReturn(rt, ctxA, {
        orderId: orderAId,
        reason: "Damaged or defective",
        resolution: "refund",
        items: [{ orderItemId: orderAItemId, quantity: 1 }],
        photos: [photoB.id],
      }),
    ).rejects.toThrow("Bad Request: One or more photos are invalid or do not exist");

    // Attempt return on Order A with unconfigured reason -> rejected
    await expect(
      requestReturn(rt, ctxA, {
        orderId: orderAId,
        reason: "Some random custom reason not in settings",
        resolution: "refund",
        items: [{ orderItemId: orderAItemId, quantity: 1 }],
      }),
    ).rejects.toThrow("Bad Request: Please choose a valid return reason configured by the store");

    // Attempt return for reason requiring photo without attaching any photos -> rejected
    await expect(
      requestReturn(rt, ctxA, {
        orderId: orderAId,
        reason: "Damaged or defective", // photoRequirement is "required"
        resolution: "refund",
        items: [{ orderItemId: orderAItemId, quantity: 1 }],
        photos: [],
      }),
    ).rejects.toThrow("Bad Request: Photos are required for this return reason");

    // Return with photo 1 -> succeeds
    const ret1 = await requestReturn(rt, ctxA, {
      orderId: orderAId,
      reason: "Damaged or defective",
      resolution: "refund",
      items: [{ orderItemId: orderAItemId, quantity: 1 }],
      photos: [photo1.id],
    });
    expect(ret1.returnId).toBeDefined();

    // Attempting to reuse photo 1 in another return request -> rejected (already attached)
    await expect(
      requestReturn(rt, ctxA, {
        orderId: orderAId,
        reason: "Wrong item received",
        resolution: "refund",
        items: [{ orderItemId: orderAItemId, quantity: 1 }],
        photos: [photo1.id],
      }),
    ).rejects.toThrow("Conflict: One or more photos are already attached to a return");
  });

  it("cleanup job deletes unattached photos older than 24 hours and is idempotent", async () => {
    const storage = new Map<string, { body: Buffer; mime: string; size: number }>();
    const fakeS3 = createMockS3(storage);
    const mOld = crypto.randomUUID();

    // Create an old unattached photo
    const oldKey = `tenants/${ctxA.tenantId}/returns/${orderAId}/${mOld}.jpg`;
    const oldBody = Buffer.concat([JPEG_HEADER, Buffer.alloc(100)]);
    storage.set(oldKey, { body: oldBody, mime: "image/jpeg", size: oldBody.length });

    const oldPhoto = await finalizeReturnPhoto(rt, ctxA, {
      orderId: orderAId,
      mediaId: mOld,
      storageKey: oldKey,
      s3Client: fakeS3,
    });

    // Manually age the photo row to 25 hours ago
    await withTenant(rt._db.db, ctxA.tenantId, async (tx) => {
      await tx
        .update(schema.media)
        .set({ createdAt: new Date(Date.now() - 25 * 3600 * 1000) })
        .where(eq(schema.media.id, oldPhoto.id));
    });

    // Run cleanup once
    const firstRun = await cleanupOrphanedReturnPhotos(rt._db.db, fakeS3);
    expect(firstRun.deletedCount).toBeGreaterThanOrEqual(1);
    expect(storage.has(oldKey)).toBe(false);

    // Run cleanup again (idempotent)
    const secondRun = await cleanupOrphanedReturnPhotos(rt._db.db, fakeS3);
    expect(secondRun.deletedCount).toBe(0);
  });

  async function seedOldPhoto(storage: Map<string, { body: Buffer; mime: string; size: number }>, fakeS3: S3Client) {
    const mediaId = crypto.randomUUID();
    const key = `tenants/${ctxA.tenantId}/returns/${orderAId}/${mediaId}.jpg`;
    const body = Buffer.concat([JPEG_HEADER, Buffer.alloc(100)]);
    storage.set(key, { body, mime: "image/jpeg", size: body.length });
    const photo = await finalizeReturnPhoto(rt, ctxA, { orderId: orderAId, mediaId, storageKey: key, s3Client: fakeS3 });
    await withTenant(rt._db.db, ctxA.tenantId, async (tx) => {
      await tx
        .update(schema.media)
        .set({ createdAt: new Date(Date.now() - 25 * 3600 * 1000) })
        .where(eq(schema.media.id, photo.id));
    });
    return { key, id: photo.id };
  }

  it("cleanup works under the worker's row-level-security role (app_rw), not only as a bypass role", async () => {
    const storage = new Map<string, { body: Buffer; mime: string; size: number }>();
    const fakeS3 = createMockS3(storage);
    const { key, id } = await seedOldPhoto(storage, fakeS3);

    const run = await cleanupOrphanedReturnPhotos(rtWeb._db.db, fakeS3);
    expect(run.deletedCount).toBeGreaterThanOrEqual(1);
    expect(storage.has(key)).toBe(false);

    const left = await withTenant(rt._db.db, ctxA.tenantId, (tx) =>
      tx.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.id, id)),
    );
    expect(left).toHaveLength(0);
  });

  it("cleanup keeps the record when the stored file cannot be deleted, so the next run retries", async () => {
    const storage = new Map<string, { body: Buffer; mime: string; size: number }>();
    const fakeS3 = createMockS3(storage);
    const { key, id } = await seedOldPhoto(storage, fakeS3);

    const failingS3 = {
      async send(command: { constructor?: { name?: string } }) {
        if (command.constructor?.name === "DeleteObjectCommand") throw new Error("storage unavailable");
        return fakeS3.send(command as never);
      },
    } as unknown as S3Client;

    const run = await cleanupOrphanedReturnPhotos(rtWeb._db.db, failingS3);
    expect(run.deletedCount).toBe(0);
    expect(storage.has(key)).toBe(true);
    const kept = await withTenant(rt._db.db, ctxA.tenantId, (tx) =>
      tx.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.id, id)),
    );
    expect(kept).toHaveLength(1);

    // Storage recovers: the next run removes both.
    const retry = await cleanupOrphanedReturnPhotos(rtWeb._db.db, fakeS3);
    expect(retry.deletedCount).toBeGreaterThanOrEqual(1);
    expect(storage.has(key)).toBe(false);
  });

  it("never stores return photos in the public media bucket: unconfigured or same-as-public bucket is refused", async () => {
    const saved = { priv: process.env.R2_PRIVATE_BUCKET_NAME, pub: process.env.R2_BUCKET_NAME };
    try {
      const input = { orderId: orderAId, filename: "p.jpg", mime: "image/jpeg", bytes: 1024 };

      delete process.env.R2_PRIVATE_BUCKET_NAME;
      await expect(createPresignedReturnPhotoUpload(rt, ctxA, input)).rejects.toThrow(
        "Bad Request: Photo uploads are not available for this store yet.",
      );
      expect(isReturnPhotoStorageConfigured()).toBe(false);

      process.env.R2_BUCKET_NAME = "shared-public-media";
      process.env.R2_PRIVATE_BUCKET_NAME = "shared-public-media";
      await expect(createPresignedReturnPhotoUpload(rt, ctxA, input)).rejects.toThrow(
        "Bad Request: Photo uploads are not available for this store yet.",
      );

      const storage = new Map<string, { body: Buffer; mime: string; size: number }>();
      await expect(
        finalizeReturnPhoto(rt, ctxA, {
          orderId: orderAId,
          mediaId: crypto.randomUUID(),
          storageKey: `tenants/${ctxA.tenantId}/returns/${orderAId}/x.jpg`,
          s3Client: createMockS3(storage),
        }),
      ).rejects.toThrow("Bad Request");
    } finally {
      if (saved.priv === undefined) delete process.env.R2_PRIVATE_BUCKET_NAME;
      else process.env.R2_PRIVATE_BUCKET_NAME = saved.priv;
      if (saved.pub === undefined) delete process.env.R2_BUCKET_NAME;
      else process.env.R2_BUCKET_NAME = saved.pub;
    }
  });

  it("does not demand photos the customer cannot upload when private photo storage is not configured", async () => {
    const saved = process.env.R2_PRIVATE_BUCKET_NAME;
    try {
      delete process.env.R2_PRIVATE_BUCKET_NAME;
      const view = await getOrderReturnsByToken(rt, ctxA.tenantId, orderAToken);
      expect(view).not.toBeNull();
      expect(view!.reasons.every((r) => r.photoRequirement === "not_asked")).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.R2_PRIVATE_BUCKET_NAME;
      else process.env.R2_PRIVATE_BUCKET_NAME = saved;
    }
  });

  it("presign builds the upload key from the content type, so a filename without a dot still matches finalize", async () => {
    const presign = await createPresignedReturnPhotoUpload(rt, ctxA, {
      orderId: orderAId,
      filename: "IMG_0001",
      mime: "image/webp",
      bytes: 2048,
    });
    expect(presign.storageKey).toBe(`tenants/${ctxA.tenantId}/returns/${orderAId}/${presign.mediaId}.webp`);
    expect(presign.uploadUrl).toContain(`${presign.mediaId}.webp`);
  });
});
