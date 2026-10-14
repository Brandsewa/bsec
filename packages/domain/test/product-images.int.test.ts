import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import {
  attachProductMedia,
  createMediaRecord,
  createRuntime,
  detachProductMedia,
  getProduct,
  getStorefrontFeaturedProducts,
  getStorefrontProduct,
  isMediaStorageConfigured,
  listMedia,
  provisionTenant,
  publicMediaUrl,
  requestMediaUpload,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import {
  createPlatformStorageConnection,
  activatePlatformStorageConnection,
} from "../src/platform/storage-connections.ts";
import { invalidateStorageConnectionCache } from "../src/media/connection.ts";

import { createActiveProduct } from "./helpers/factories.ts";

let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let ctx: TenantContext;
let other: TenantContext;
let productId: string;
let tempStorageDir: string;

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const saved = { ...process.env };
const mk = (s: { tenantId: string; ownerId: string }): TenantContext => ({
  tenantId: s.tenantId,
  storeStatus: "live",
  actor: { type: "staff", userId: s.ownerId },
  roles: ["store_owner"],
  permissions: ["products.read", "products.write", "content.write", "settings.write"],
  requestId: "req-test",
});
const errorOf = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e))?.message ?? null;

beforeAll(async () => {
  process.env.TENANT_SECRETS_KEY = "test-secret-key-32-chars-long-abc!!";
  process.env.R2_PUBLIC_URL = "https://media.example.test/";
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });

  tempStorageDir = path.join(os.tmpdir(), `bsec-prod-img-test-${Date.now()}`);
  fs.mkdirSync(tempStorageDir, { recursive: true });
  process.env.STORAGE_LOCAL_DIR = tempStorageDir;

  // Don't activate storage connection yet so 'uploads need storage to be set up' tests can verify unconfigured state!
  const a = await provisionTenant(rt, { storeName: "img-a", slug: "img-a", owner: { email: "owner@img-a.test", name: "A" }, planCode: "starter", source: "platform_admin" });
  const b = await provisionTenant(rt, { storeName: "img-b", slug: "img-b", owner: { email: "owner@img-b.test", name: "B" }, planCode: "starter", source: "platform_admin" });
  ctx = mk(a);
  other = mk(b);
  const p = await createActiveProduct(rtWeb, ctx, { title: "Pickle", sku: "IMG-1", price: 10000 });
  productId = p.productId;
}, 180_000);

afterAll(async () => {
  if (tempStorageDir && fs.existsSync(tempStorageDir)) {
    fs.rmSync(tempStorageDir, { recursive: true, force: true });
  }
  delete process.env.STORAGE_LOCAL_DIR;
  invalidateStorageConnectionCache();
  process.env = saved;
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("public image address", () => {
  it("joins the configured public base and the stored key, and is undefined when nothing is configured", () => {
    expect(publicMediaUrl("t1/products/a.png")).toBe("https://media.example.test/t1/products/a.png");
    expect(publicMediaUrl("/t1/products/a.png")).toBe("https://media.example.test/t1/products/a.png");
    expect(publicMediaUrl(null)).toBeUndefined();
    const base = process.env.R2_PUBLIC_URL;
    delete process.env.R2_PUBLIC_URL;
    try {
      expect(publicMediaUrl("a.png")).toBeUndefined();
    } finally {
      process.env.R2_PUBLIC_URL = base;
    }
  });
});

describe("uploads need storage to be set up", () => {
  it("refuses with a clear message instead of handing out a signed URL that Cloudflare would reject", async () => {
    expect(isMediaStorageConfigured()).toBe(false);
    const msg = await errorOf(requestMediaUpload(rtWeb, ctx, { filename: "a.png", mime: "image/png", bytes: 1000 }));
    expect(msg).toMatch(/^Precondition: Image storage is not set up yet/);
  });

  it("issues a signed upload once storage credentials exist", async () => {
    process.env.R2_ACCESS_KEY_ID = "test-key";
    process.env.R2_SECRET_ACCESS_KEY = "test-secret";
    try {
      expect(isMediaStorageConfigured()).toBe(true);
      const d = await requestMediaUpload(rtWeb, ctx, { filename: "a.png", mime: "image/png", bytes: 1000 });
      expect(d.uploadUrl).toContain("X-Amz-Credential=test-key");
      expect(d.storageKey).toContain(`${ctx.tenantId}/products/`);
    } finally {
      delete process.env.R2_ACCESS_KEY_ID;
      delete process.env.R2_SECRET_ACCESS_KEY;
    }
  });

  it("still rejects a file that is not an image", async () => {
    expect(await errorOf(requestMediaUpload(rtWeb, ctx, { filename: "a.exe", mime: "application/x-msdownload", bytes: 1000 }))).toBeTruthy();
  });
});

describe("a product's images", () => {
  let mediaA: string;
  let mediaB: string;
  let linkA: string;

  beforeAll(async () => {
    const staff = await seedPlatformStaff(rt._db.db, {
      email: `storage-admin-${Date.now()}@platform.test`,
      role: "platform_admin",
    });
    const conn = await createPlatformStorageConnection(rt, staff.userId, {
      name: "Test Storage",
      driver: "local",
      purpose: "public_media",
      localDir: tempStorageDir,
      publicBaseUrl: "https://media.example.test",
    });
    await activatePlatformStorageConnection(rt, staff.userId, conn.id);
    invalidateStorageConnectionCache();
  });

  it("an uploaded image can be attached: the first is the main image, and it has a public url", async () => {
    const keyA = `${ctx.tenantId}/products/a.png`;
    const keyB = `${ctx.tenantId}/products/b.png`;
    fs.mkdirSync(path.join(tempStorageDir, ctx.tenantId, "products"), { recursive: true });
    fs.writeFileSync(path.join(tempStorageDir, keyA), PNG_1X1);
    fs.writeFileSync(path.join(tempStorageDir, keyB), PNG_1X1);

    mediaA = (await createMediaRecord(rtWeb, ctx, { storageKey: keyA, mime: "image/png", bytes: PNG_1X1.length })).id;
    mediaB = (await createMediaRecord(rtWeb, ctx, { storageKey: keyB, mime: "image/png", bytes: PNG_1X1.length })).id;

    const first = await attachProductMedia(rtWeb, ctx, { productId, mediaId: mediaA, alt: "Pickle jar" });
    linkA = first.id;
    expect(first).toMatchObject({ position: 0, isPrimary: true, url: `https://media.example.test/${ctx.tenantId}/products/a.png` });
    const second = await attachProductMedia(rtWeb, ctx, { productId, mediaId: mediaB });
    expect(second).toMatchObject({ position: 1, isPrimary: false });
  });

  it("attaching the same image twice does not duplicate it", async () => {
    const again = await attachProductMedia(rtWeb, ctx, { productId, mediaId: mediaA });
    expect(again.id).toBe(linkA);
    const detail = await getProduct(rtWeb, ctx, { id: productId });
    expect(detail.media).toHaveLength(2);
  });

  it("the admin sees urls on the product and in the media library", async () => {
    const detail = await getProduct(rtWeb, ctx, { id: productId });
    expect(detail.media.map((m) => m.url)).toEqual([
      `https://media.example.test/${ctx.tenantId}/products/a.png`,
      `https://media.example.test/${ctx.tenantId}/products/b.png`,
    ]);
    const lib = await listMedia(rtWeb, ctx, {});
    expect(lib.items.every((i) => i.url?.startsWith("https://media.example.test/"))).toBe(true);
  });

  it("the storefront shows the main image on the listing and all images on the product page", async () => {
    const grid = await getStorefrontFeaturedProducts(rtWeb, ctx, {});
    expect(grid[0]?.primaryImage?.url).toBe(`https://media.example.test/${ctx.tenantId}/products/a.png`);
    const page = await getStorefrontProduct(rtWeb, ctx, "pickle");
    expect(page?.media.map((m) => m.url)).toEqual([
      `https://media.example.test/${ctx.tenantId}/products/a.png`,
      `https://media.example.test/${ctx.tenantId}/products/b.png`,
    ]);
  });

  it("removing the main image promotes the next one, and the file stays in the library", async () => {
    await detachProductMedia(rtWeb, ctx, { productId, productMediaId: linkA });
    const detail = await getProduct(rtWeb, ctx, { id: productId });
    expect(detail.media).toHaveLength(1);
    expect(detail.media[0]).toMatchObject({ mediaId: mediaB, position: 0, isPrimary: true });
    expect((await listMedia(rtWeb, ctx, {})).items.map((i) => i.id)).toContain(mediaA);
  });

  it("another store can neither attach nor remove this store's images", async () => {
    expect(await errorOf(attachProductMedia(rtWeb, other, { productId, mediaId: mediaB }))).toMatch(/Not Found/);
    const detail = await getProduct(rtWeb, ctx, { id: productId });
    expect(await errorOf(detachProductMedia(rtWeb, other, { productId, productMediaId: detail.media[0]!.id }))).toMatch(/Not Found/);
    expect((await getProduct(rtWeb, ctx, { id: productId })).media).toHaveLength(1);
  });

  it("needs the products.write permission", async () => {
    const viewer = { ...ctx, permissions: ["products.read"] };
    expect(await errorOf(attachProductMedia(rtWeb, viewer, { productId, mediaId: mediaB }))).toMatch(/Forbidden/);
  });
});
