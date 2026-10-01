import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  createProduct,
  createRuntime,
  getStorefrontFeaturedProducts,
  provisionTenant,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let storeA: { tenantId: string; ownerId: string };
let storeB: { tenantId: string; ownerId: string };

const ctxFor = (s: { tenantId: string; ownerId: string }): TenantContext => ({
  tenantId: s.tenantId,
  storeStatus: "live",
  actor: { type: "staff", userId: s.ownerId },
  roles: ["store_owner"],
  permissions: ["products.read", "products.write", "settings.write"],
  requestId: "req-test",
});

async function mkStore(slug: string) {
  const r = await provisionTenant(rt, { storeName: slug, slug, owner: { email: `owner@${slug}.test`, name: "Owner" }, planCode: "starter", source: "platform_admin" });
  return { tenantId: r.tenantId, ownerId: r.ownerId };
}

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  storeA = await mkStore("feat-a");
  storeB = await mkStore("feat-b");
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("storefront home page product grid", () => {
  it("is empty for a store with no visible products (drafts do not show)", async () => {
    await createProduct(rtWeb, ctxFor(storeA), { title: "Hidden draft", status: "draft", variants: [{ sku: "FEAT-DRAFT", title: "One", price: 10000 }] });
    expect(await getStorefrontFeaturedProducts(rtWeb, ctxFor(storeA), {})).toEqual([]);
  });

  it("lists active products with their price, featured first, newest next, and honours the limit", async () => {
    const c = ctxFor(storeA);
    await createProduct(rtWeb, c, { title: "Plain tea", status: "active", variants: [{ sku: "FEAT-1", title: "One", price: 25000 }] });
    await createProduct(rtWeb, c, { title: "Star tea", status: "active", isFeatured: true, variants: [{ sku: "FEAT-2", title: "A", price: 30000 }, { sku: "FEAT-3", title: "B", price: 50000 }] });
    await createProduct(rtWeb, c, { title: "Newest tea", status: "active", variants: [{ sku: "FEAT-4", title: "One", price: 15000 }] });

    const all = await getStorefrontFeaturedProducts(rtWeb, c, { limit: 8 });
    expect(all.map((p) => p.title)).toEqual(["Star tea", "Newest tea", "Plain tea"]);
    expect(all[0]).toMatchObject({ priceMin: 30000, priceMax: 50000, isFeatured: true });

    const one = await getStorefrontFeaturedProducts(rtWeb, c, { limit: 1 });
    expect(one.map((p) => p.title)).toEqual(["Star tea"]);
  });

  it("never shows another store's products", async () => {
    expect(await getStorefrontFeaturedProducts(rtWeb, ctxFor(storeB), {})).toEqual([]);
  });

  it("an unknown collection gives an empty grid, not an error", async () => {
    expect(await getStorefrontFeaturedProducts(rtWeb, ctxFor(storeA), { collectionSlug: "does-not-exist" })).toEqual([]);
  });
});
