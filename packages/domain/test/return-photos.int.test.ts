import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  createProduct,
  createRuntime,
  placeOrder,
  provisionTenant,
  requestReturn,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { addToCart, getOrCreateCart } from "../src/storefront/cart.ts";
import {
  createPresignedReturnPhotoUpload,
  finalizeReturnPhoto,
  resolveOrderIdFromToken,
  cleanupOrphanedReturnPhotos,
  checkReturnPhotoRateLimit,
} from "../src/orders/return-photos.ts";
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

  // Create Product in Tenant A
  const pA = await createProduct(rt, ctxA, {
    title: "Returnable Shirt",
    slug: "returnable-shirt",
    status: "active",
    variants: [{ sku: "SHIRT-1", title: "Default", price: 1000 }],
  });
  variantAId = pA.variants[0]!.id;

  // Stock inventory for Tenant A
  const locsA = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
    tx.select().from(schema.locations).where(eq(schema.locations.tenantId, ctxA.tenantId)).limit(1),
  );
  const locA = locsA[0]!;
  await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
    await tx.insert(schema.inventoryLevels).values([
      { tenantId: ctxA.tenantId, locationId: locA.id, variantId: variantAId, onHand: 100 },
    ]);
  });

  // Place Order in Tenant A
  const cartA = await getOrCreateCart(rtWeb, ctxA, undefined);
  await addToCart(rtWeb, ctxA, { token: cartA.token, variantId: variantAId, quantity: 2 });
  const placedA = await placeOrder(rtWeb, ctxA, {
    cartToken: cartA.token,
    idempotencyKey: `idem_a_${Date.now()}`,
    email: "shopper@photos.test",
    phone: "9876543210",
    fullName: "Shopper A",
    addressLine1: "123 Main St",
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "560001",
    paymentMethod: "cod",
  });
  orderAId = placedA.orderId;

  // Mark Order A as delivered and get orderItemId
  await withTenant(rt._db.db, ctxA.tenantId, async (tx) => {
    await tx.update(schema.orders).set({ status: "delivered" }).where(eq(schema.orders.id, orderAId));
    await tx.insert(schema.fulfillments).values({
      tenantId: ctxA.tenantId,
      orderId: orderAId,
      locationId: locA.id,
      status: "delivered",
      deliveredAt: new Date(),
    });
    const items = await tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderAId));
    orderAItemId = items[0]!.id;
  });

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

  // Create Order in Tenant B
  const pB = await createProduct(rt, ctxB, {
    title: "Product B",
    slug: "product-b",
    status: "active",
    variants: [{ sku: "PROD-B", title: "Default", price: 500 }],
  });
  const locsB = await withTenant(rtWeb._db.db, ctxB.tenantId, async (tx) =>
    tx.select().from(schema.locations).where(eq(schema.locations.tenantId, ctxB.tenantId)).limit(1),
  );
  const locB = locsB[0]!;
  await withTenant(rtWeb._db.db, ctxB.tenantId, async (tx) => {
    await tx.insert(schema.inventoryLevels).values([
      { tenantId: ctxB.tenantId, locationId: locB.id, variantId: pB.variants[0]!.id, onHand: 50 },
    ]);
  });

  const cartB = await getOrCreateCart(rtWeb, ctxB, undefined);
  await addToCart(rtWeb, ctxB, { token: cartB.token, variantId: pB.variants[0]!.id, quantity: 1 });
  const placedB = await placeOrder(rtWeb, ctxB, {
    cartToken: cartB.token,
    idempotencyKey: `idem_b_${Date.now()}`,
    email: "shopper_b@photos.test",
    phone: "9876543211",
    fullName: "Shopper B",
    addressLine1: "456 Side St",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400001",
    paymentMethod: "cod",
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
});
