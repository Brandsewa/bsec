/**
 * Integration: storefront reads in a market (ADR-040): product pages, collection listings, price sort and filter, and the
 * catalog a market sells, all scoped by the transaction-local market so no query needs rewriting.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client as PgClient } from "pg";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { STORE_PERMISSIONS } from "@bs/auth";
import {
  createMarket,
  createRuntime,
  getStorefrontCollection,
  getStorefrontProduct,
  provisionTenant,
  setFixedMarketPrices,
  setMarketProductVisibility,
  updateMarket,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

let env: TestDb;
let rtPlatform: Runtime;
let rtWeb: Runtime;
let admin: TenantContext;
let usId = "";
let baseId = "";
let pg: PgClient;
const ids = { cheap: "", pricey: "", cheapVariant: "", priceyVariant: "" };

const shopper = (marketId?: string | null): TenantContext => ({
  tenantId: admin.tenantId,
  storeStatus: "live",
  actor: { type: "system" },
  roles: [],
  permissions: ["products.read"],
  requestId: "req-shop",
  marketId: marketId ?? null,
});

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 8 });
  const t = await provisionTenant(rtPlatform, { storeName: "Scope Store", slug: "scope-store", owner: { email: "owner@scope.test", name: "O" }, planCode: "growth", source: "platform_admin" });
  admin = { tenantId: t.tenantId, storeStatus: "live", actor: { type: "staff", userId: t.ownerId }, roles: ["store_owner"], permissions: [...STORE_PERMISSIONS], requestId: "req-scope" };

  const PG = (await import("pg")).default;
  pg = new PG.Client({ connectionString: env.superUrl });
  await pg.connect();
  baseId = ((await pg.query(`select id from markets where tenant_id = $1 and is_base`, [admin.tenantId])).rows[0] as { id: string }).id;
  const mk = async (slug: string, title: string, price: number, compare: number | null) => {
    const productId = crypto.randomUUID();
    const variantId = crypto.randomUUID();
    await pg.query(`insert into products (id, tenant_id, title, slug, status) values ($1, $2, $3, $4, 'published')`, [productId, admin.tenantId, title, slug]);
    await pg.query(`insert into variants (id, tenant_id, product_id, sku, title, price, compare_at_price) values ($1, $2, $3, $4, 'Default', $5, $6)`, [variantId, admin.tenantId, productId, slug.toUpperCase(), price, compare]);
    return { productId, variantId };
  };
  const cheap = await mk("cheap-lamp", "Cheap Lamp", 50000, 60000);
  const pricey = await mk("pricey-lamp", "Pricey Lamp", 500000, null);
  Object.assign(ids, { cheap: cheap.productId, pricey: pricey.productId, cheapVariant: cheap.variantId, priceyVariant: pricey.variantId });
  const [col] = (await pg.query(`insert into collections (tenant_id, title, slug, type) values ($1, 'Lamps', 'lamps', 'manual') returning id`, [admin.tenantId])).rows as { id: string }[];
  for (const [i, p] of [cheap.productId, pricey.productId].entries()) {
    await pg.query(`insert into collection_products (tenant_id, collection_id, product_id, position) values ($1, $2, $3, $4)`, [admin.tenantId, col!.id, p, i]);
  }
  const us = await createMarket(rtWeb, admin, { name: "United States", currency: "USD", countries: ["US"], fxRate: 0.012, taxDisplay: "exclusive" });
  usId = us.id;
}, 240_000);

afterAll(async () => {
  await pg?.end();
  await rtPlatform?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("a product page in a market", () => {
  it("shows the base price in the base market and the market's price in the other", async () => {
    const base = await getStorefrontProduct(rtWeb, shopper(baseId), "cheap-lamp");
    expect(base!.variants[0]).toMatchObject({ price: 50000, compareAtPrice: 60000 });
    const noMarket = await getStorefrontProduct(rtWeb, shopper(null), "cheap-lamp");
    expect(noMarket!.variants[0]!.price).toBe(50000);
    const us = await getStorefrontProduct(rtWeb, shopper(usId), "cheap-lamp");
    // 500.00 x 0.012 = 6.00 USD, compare-at 600.00 x 0.012 = 7.20
    expect(us!.variants[0]).toMatchObject({ price: 600, compareAtPrice: 720 });
  });

  it("prefers a fixed price over the derived one", async () => {
    await setFixedMarketPrices(rtWeb, admin, { marketId: usId, items: [{ variantId: ids.cheapVariant, price: 699, compareAtPrice: 999 }] });
    const us = await getStorefrontProduct(rtWeb, shopper(usId), "cheap-lamp");
    expect(us!.variants[0]).toMatchObject({ price: 699, compareAtPrice: 999 });
    const base = await getStorefrontProduct(rtWeb, shopper(baseId), "cheap-lamp");
    expect(base!.variants[0]!.price).toBe(50000);
  });

  it("is not found in a market whose catalog hides it, and still found in the base market", async () => {
    await setMarketProductVisibility(rtWeb, admin, usId, [{ productId: ids.pricey, published: false }]);
    expect(await getStorefrontProduct(rtWeb, shopper(usId), "pricey-lamp")).toBeNull();
    expect(await getStorefrontProduct(rtWeb, shopper(baseId), "pricey-lamp")).not.toBeNull();
    expect(await getStorefrontProduct(rtWeb, shopper(usId), "cheap-lamp")).not.toBeNull();
  });

  it("only sells in a 'selected' catalog what the merchant published", async () => {
    await updateMarket(rtWeb, admin, usId, { catalogMode: "selected" });
    expect(await getStorefrontProduct(rtWeb, shopper(usId), "cheap-lamp")).toBeNull();
    await setMarketProductVisibility(rtWeb, admin, usId, [{ productId: ids.cheap, published: true }, { productId: ids.pricey, published: true }]);
    expect(await getStorefrontProduct(rtWeb, shopper(usId), "cheap-lamp")).not.toBeNull();
    expect(await getStorefrontProduct(rtWeb, shopper(usId), "pricey-lamp")).not.toBeNull();
    await updateMarket(rtWeb, admin, usId, { catalogMode: "all" });
  });
});

describe("a collection listing in a market", () => {
  it("lists market prices and sorts and filters by them", async () => {
    const us = await getStorefrontCollection(rtWeb, shopper(usId), "lamps", { sort: "price_desc" });
    const rows = us!.products.items.map((p) => [p.slug, p.priceMin]);
    // pricey 5,000.00 x 0.012 = 60.00 USD; cheap fixed 6.99
    expect(rows).toEqual([["pricey-lamp", 6000], ["cheap-lamp", 699]]);
    const base = await getStorefrontCollection(rtWeb, shopper(baseId), "lamps", { sort: "price_asc" });
    expect(base!.products.items.map((p) => [p.slug, p.priceMin])).toEqual([["cheap-lamp", 50000], ["pricey-lamp", 500000]]);
  });

  it("filters by a price range expressed in the market's own currency", async () => {
    const us = await getStorefrontCollection(rtWeb, shopper(usId), "lamps", { filters: { price: "1000-10000" } });
    expect(us!.products.items.map((p) => p.slug)).toEqual(["pricey-lamp"]);
  });

  it("leaves out a product the market hides", async () => {
    await setMarketProductVisibility(rtWeb, admin, usId, [{ productId: ids.pricey, published: false }]);
    const us = await getStorefrontCollection(rtWeb, shopper(usId), "lamps");
    expect(us!.products.items.map((p) => p.slug)).toEqual(["cheap-lamp"]);
    const base = await getStorefrontCollection(rtWeb, shopper(baseId), "lamps");
    expect(base!.products.items.map((p) => p.slug).sort()).toEqual(["cheap-lamp", "pricey-lamp"]);
  });
});
