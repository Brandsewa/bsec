/**
 * Integration: Apps framework and State Pricing on a real Postgres (ADR-043, ADR-044): visibility, install lifecycle,
 * Super Admin suspension, per-state prices, the SQL price function, tenant isolation and cart repricing.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { STORE_PERMISSIONS } from "@bs/auth";
import {
  addToCart,
  getOrCreateCart,
  getProductStatePricing,
  installApp,
  isAppActive,
  listPlatformApps,
  listStoreApps,
  provisionTenant,
  setAppStatus,
  setTenantAppSuspended,
  setVariantStatePrices,
  uninstallApp,
  updateAppSettings,
  updatePlatformApp,
  createRuntime,
  loadStatePriceMap,
  setAppPinned,
  listStatePricingGrid,
  setStatePricesBulk,
  lookupVariantsBySku,
  importPincodeDirectory,
  lookupStateByPincode,
  STATE_PRICING_APP,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

let env: TestDb;
let rtPlatform: Runtime;
let rtWeb: Runtime;
let adminId: string;
let ctxA: TenantContext;
let ctxB: TenantContext;
let variantA: string;
let productA: string;

function ctxFor(t: { tenantId: string; ownerId: string }, label: string, permissions: readonly string[] = STORE_PERMISSIONS): TenantContext {
  return { tenantId: t.tenantId, storeStatus: "live", actor: { type: "staff", userId: t.ownerId }, roles: ["store_owner"], permissions: [...permissions], requestId: `req-sp-${label}` };
}

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  adminId = (await seedPlatformStaff(rtPlatform._db.db, { email: "sp-admin@platform.test", role: "platform_admin" })).userId;
  const a = await provisionTenant(rtPlatform, { storeName: "SP A", slug: "sp-store-a", planCode: "starter", owner: { email: "sp-a@test.com", name: "A" }, source: "platform_admin" });
  const b = await provisionTenant(rtPlatform, { storeName: "SP B", slug: "sp-store-b", planCode: "starter", owner: { email: "sp-b@test.com", name: "B" }, source: "platform_admin" });
  ctxA = ctxFor(a, "a");
  ctxB = ctxFor(b, "b");
  const db = rtPlatform._db.db;
  const [p] = await db.insert(schema.products).values({ tenantId: a.tenantId, title: "Desk Lamp", slug: "desk-lamp", status: "published" }).returning();
  productA = p!.id;
  const [v] = await db.insert(schema.variants).values({ tenantId: a.tenantId, productId: productA, sku: "LAMP-1", title: "Default", price: 100000n }).returning();
  variantA = v!.id;
}, 240_000);

afterAll(async () => {
  await rtWeb?.close();
  await rtPlatform?.close();
  await env?.stop();
});

describe("catalog visibility", () => {
  it("hides a private app from stores that are not on its list, and refuses the install", async () => {
    expect((await listStoreApps(rtWeb, ctxA)).map((x) => x.key)).not.toContain(STATE_PRICING_APP);
    await expect(installApp(rtWeb, ctxA, STATE_PRICING_APP)).rejects.toThrow(/Not Found/);
  });

  it("refuses callers without apps.manage", async () => {
    await expect(listStoreApps(rtWeb, ctxFor({ tenantId: ctxA.tenantId, ownerId: adminId }, "ro", ["products.read"]))).rejects.toThrow(/Forbidden/);
  });

  it("shows the app to a store once Super Admin allows it, and only to that store", async () => {
    await updatePlatformApp(rtPlatform, adminId, STATE_PRICING_APP, { allowedTenantIds: [ctxA.tenantId] });
    expect((await listStoreApps(rtWeb, ctxA)).map((x) => x.key)).toContain(STATE_PRICING_APP);
    expect((await listStoreApps(rtWeb, ctxB)).map((x) => x.key)).not.toContain(STATE_PRICING_APP);
    const audit = await rtPlatform._db.db.select().from(schema.platformAuditLogs).where(eq(schema.platformAuditLogs.action, "marketplace.app.update"));
    expect(audit.length).toBeGreaterThan(0);
  });
});

describe("install lifecycle", () => {
  it("is inactive until installed, then active with the default mode", async () => {
    expect(await isAppActive(rtWeb, ctxA.tenantId, STATE_PRICING_APP)).toBe(false);
    const app = await installApp(rtWeb, ctxA, STATE_PRICING_APP);
    expect(app).toMatchObject({ installed: true, status: "installed", settings: { mode: "auto" } });
    expect(await isAppActive(rtWeb, ctxA.tenantId, STATE_PRICING_APP)).toBe(true);
  });

  it("validates settings and keeps a version", async () => {
    await expect(updateAppSettings(rtWeb, ctxA, STATE_PRICING_APP, { mode: "nonsense" })).rejects.toThrow(/Bad Request/);
    const app = await updateAppSettings(rtWeb, ctxA, STATE_PRICING_APP, { mode: "manual" });
    expect(app.settings).toEqual({ mode: "manual" });
    const rows = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) => tx.select().from(schema.tenantApps));
    expect(rows[0]?.settingsVersion).toBe(2);
    await updateAppSettings(rtWeb, ctxA, STATE_PRICING_APP, { mode: "auto" });
  });

  it("goes inert when disabled by the store, and when the platform kill switch is off", async () => {
    await setAppStatus(rtWeb, ctxA, STATE_PRICING_APP, "disabled");
    expect(await isAppActive(rtWeb, ctxA.tenantId, STATE_PRICING_APP)).toBe(false);
    await setAppStatus(rtWeb, ctxA, STATE_PRICING_APP, "installed");
    expect(await isAppActive(rtWeb, ctxA.tenantId, STATE_PRICING_APP)).toBe(true);
    await updatePlatformApp(rtPlatform, adminId, STATE_PRICING_APP, { enabled: false });
    expect(await isAppActive(rtWeb, ctxA.tenantId, STATE_PRICING_APP)).toBe(false);
    await updatePlatformApp(rtPlatform, adminId, STATE_PRICING_APP, { enabled: true });
    expect(await isAppActive(rtWeb, ctxA.tenantId, STATE_PRICING_APP)).toBe(true);
  });

  it("lets Super Admin suspend one store, and the store cannot undo it", async () => {
    await setTenantAppSuspended(rtPlatform, adminId, ctxA.tenantId, STATE_PRICING_APP, true);
    expect(await isAppActive(rtWeb, ctxA.tenantId, STATE_PRICING_APP)).toBe(false);
    await expect(setAppStatus(rtWeb, ctxA, STATE_PRICING_APP, "installed")).rejects.toThrow(/turned off/);
    await expect(uninstallApp(rtWeb, ctxA, STATE_PRICING_APP)).rejects.toThrow(/turned off/);
    const listed = (await listPlatformApps(rtPlatform, adminId)).find((x) => x.key === STATE_PRICING_APP)!;
    expect(listed.installs.find((i) => i.tenantId === ctxA.tenantId)?.suspended).toBe(true);
    await setTenantAppSuspended(rtPlatform, adminId, ctxA.tenantId, STATE_PRICING_APP, false);
    expect(await isAppActive(rtWeb, ctxA.tenantId, STATE_PRICING_APP)).toBe(true);
  });

  it("refuses platform changes from support staff", async () => {
    const support = (await seedPlatformStaff(rtPlatform._db.db, { email: "sp-support@platform.test", role: "platform_support" })).userId;
    await expect(updatePlatformApp(rtPlatform, support, STATE_PRICING_APP, { enabled: false })).rejects.toThrow(/Forbidden|requires/i);
  });
});

describe("state prices", () => {
  it("saves, reads back and removes a state price, with audit", async () => {
    const r = await setVariantStatePrices(rtWeb, ctxA, { variantId: variantA, prices: [{ state: "MH", price: 90000 }, { state: "KA", price: 95000, compareAtPrice: 110000 }] });
    expect(r).toEqual({ saved: 2, removed: 0 });
    const view = await getProductStatePricing(rtWeb, ctxA, productA);
    expect(view.variants[0]).toMatchObject({ basePrice: 100000, prices: { MH: { price: 90000, compareAtPrice: null }, KA: { price: 95000, compareAtPrice: 110000 } } });
    const removed = await setVariantStatePrices(rtWeb, ctxA, { variantId: variantA, prices: [{ state: "KA", price: null }] });
    expect(removed).toEqual({ saved: 0, removed: 1 });
    const audit = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) => tx.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "state_prices.set")));
    expect(audit.length).toBe(2);
  });

  it("rejects an unknown state, a duplicate state and a non-positive price", async () => {
    await expect(setVariantStatePrices(rtWeb, ctxA, { variantId: variantA, prices: [{ state: "ZZ", price: 100 }] })).rejects.toThrow(/Unknown state/);
    await expect(setVariantStatePrices(rtWeb, ctxA, { variantId: variantA, prices: [{ state: "MH", price: 100 }, { state: "MH", price: 200 }] })).rejects.toThrow(/twice/);
    await expect(setVariantStatePrices(rtWeb, ctxA, { variantId: variantA, prices: [{ state: "MH", price: 0 }] })).rejects.toThrow(/positive/);
  });

  it("will not touch another store's variant", async () => {
    await installApp(rtWeb, ctxB, STATE_PRICING_APP).catch(() => undefined);
    await expect(setVariantStatePrices(rtWeb, ctxB, { variantId: variantA, prices: [{ state: "MH", price: 100 }] })).rejects.toThrow(/Conflict|Not Found/);
    const rows = await withTenant(rtWeb._db.db, ctxB.tenantId, (tx) => tx.select().from(schema.statePrices));
    expect(rows).toHaveLength(0);
  });

  it("maps state prices for a variant list", async () => {
    const map = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) => loadStatePriceMap(tx, ctxA.tenantId, "MH", [variantA]));
    expect(map.get(variantA)).toEqual({ price: 90000, compareAtPrice: null });
    const none = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) => loadStatePriceMap(tx, ctxA.tenantId, "TN", [variantA]));
    expect(none.size).toBe(0);
  });
});

describe("market_variant_price (SQL)", () => {
  const price = (region: string | null) =>
    withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      if (region) await tx.execute(sql`select set_config('app.price_region', ${region}, true)`);
      const res = await tx.execute<{ p: string }>(sql`select market_variant_price(${ctxA.tenantId}::uuid, ${variantA}::uuid, 100000::bigint) as p`);
      return Number(res.rows[0]!.p);
    });

  it("returns the default price with no region, an unlisted region, and the state price for a listed one", async () => {
    expect(await price(null)).toBe(100000);
    expect(await price("TN")).toBe(100000);
    expect(await price("MH")).toBe(90000);
  });
});

describe("cart", () => {
  it("prices a new line in the shopper's state, and reprices when the state changes", async () => {
    const mh = { ...ctxA, actor: { type: "system" as const }, priceRegion: "MH" };
    const cart = await getOrCreateCart(rtWeb, mh);
    expect(cart.priceRegion).toBe("MH");
    const withItem = await addToCart(rtWeb, mh, { token: cart.token, variantId: variantA, quantity: 1 });
    expect(withItem.items[0]?.unitPriceSnapshot).toBe(90000);

    const tn = await getOrCreateCart(rtWeb, { ...mh, priceRegion: "TN" }, cart.token);
    expect(tn.priceRegion).toBe("TN");
    expect(tn.items[0]?.unitPriceSnapshot).toBe(100000);

    const unset = await getOrCreateCart(rtWeb, { ...mh, priceRegion: undefined }, cart.token);
    expect(unset.priceRegion).toBe("TN");
    const back = await getOrCreateCart(rtWeb, { ...mh, priceRegion: null }, cart.token);
    expect(back.priceRegion).toBeNull();
  });
});

describe("pincode directory", () => {
  it("returns null before the directory is loaded, then the state after an import", async () => {
    expect(await lookupStateByPincode(rtWeb, "400001")).toBeNull();
    await importPincodeDirectory(rtPlatform, [{ pincode: "400001", stateCode: "MH" }, { pincode: "560001", stateCode: "KA" }]);
    expect(await lookupStateByPincode(rtWeb, "400001")).toBe("MH");
    expect(await lookupStateByPincode(rtWeb, "560001")).toBe("KA");
    expect(await lookupStateByPincode(rtWeb, "999999")).toBeNull();
    expect(await lookupStateByPincode(rtWeb, "not-a-pin")).toBeNull();
  });

  it("is read-only for the store runtime", async () => {
    await expect(rtWeb._db.db.insert(schema.platformInPincodes).values({ pincode: "110001", stateCode: "DL" })).rejects.toThrow();
  });
});

describe("pinning, the bulk grid and SKU lookup", () => {
  let zedA = "";
  let zedB = "";

  it("pins an installed app, and refuses when it is suspended or not installed", async () => {
    const pinned = await setAppPinned(rtWeb, ctxA, STATE_PRICING_APP, true);
    expect(pinned.pinned).toBe(true);
    expect((await listStoreApps(rtWeb, ctxA)).find((a) => a.key === STATE_PRICING_APP)?.pinned).toBe(true);
    expect((await setAppPinned(rtWeb, ctxA, STATE_PRICING_APP, false)).pinned).toBe(false);
    await expect(setAppPinned(rtWeb, { ...ctxB, tenantId: "00000000-0000-7000-8000-000000000001" }, STATE_PRICING_APP, true)).rejects.toThrow(/Install the app first/);
    await setTenantAppSuspended(rtPlatform, adminId, ctxA.tenantId, STATE_PRICING_APP, true);
    await expect(setAppPinned(rtWeb, ctxA, STATE_PRICING_APP, true)).rejects.toThrow(/turned off/);
    await setTenantAppSuspended(rtPlatform, adminId, ctxA.tenantId, STATE_PRICING_APP, false);
  });

  it("pages products with their variants, searches by title or SKU, and lists the states in use", async () => {
    const db = rtPlatform._db.db;
    const [p] = await db.insert(schema.products).values({ tenantId: ctxA.tenantId, title: "Zed Bottle", slug: "zed-bottle", status: "active" }).returning();
    const [v1] = await db.insert(schema.variants).values({ tenantId: ctxA.tenantId, productId: p!.id, sku: "ZB-360", title: "360ml", price: 13000n, position: 0 }).returning();
    const [v2] = await db.insert(schema.variants).values({ tenantId: ctxA.tenantId, productId: p!.id, sku: "ZB-660", title: "660ml", price: 20000n, position: 1 }).returning();
    zedA = v1!.id;
    zedB = v2!.id;

    const first = await listStatePricingGrid(rtWeb, ctxA, { limit: 1, offset: 0 });
    expect(first.total).toBe(2);
    expect(first.rows.map((r) => r.productTitle)).toEqual(["Desk Lamp"]);
    expect(first.usedStates).toContain("MH");
    const second = await listStatePricingGrid(rtWeb, ctxA, { limit: 1, offset: 1 });
    expect(second.rows[0]?.productTitle).toBe("Zed Bottle");
    expect(second.rows[0]?.variants.map((v) => v.sku)).toEqual(["ZB-360", "ZB-660"]);
    const bySku = await listStatePricingGrid(rtWeb, ctxA, { search: "zb-66", limit: 25, offset: 0 });
    expect(bySku.rows.map((r) => r.productTitle)).toEqual(["Zed Bottle"]);
    const byTitle = await listStatePricingGrid(rtWeb, ctxA, { search: "lamp", limit: 25, offset: 0 });
    expect(byTitle.total).toBe(1);
    expect((await listStatePricingGrid(rtWeb, ctxB, { limit: 25, offset: 0 })).total).toBe(0);
  });

  it("saves and removes many state prices at once, with one audit row, all or nothing", async () => {
    const res = await setStatePricesBulk(rtWeb, ctxA, [
      { variantId: zedA, state: "MH", price: 12000 },
      { variantId: zedA, state: "TN", price: 12500 },
      { variantId: zedB, state: "MH", price: 19000 },
      { variantId: variantA, state: "MH", price: null },
    ]);
    expect(res).toEqual({ saved: 3, removed: 1 });
    const grid = await listStatePricingGrid(rtWeb, ctxA, { search: "zed", limit: 25, offset: 0 });
    expect(grid.rows[0]?.variants[0]?.prices).toMatchObject({ MH: { price: 12000 }, TN: { price: 12500 } });
    expect(grid.rows[0]?.variants[1]?.prices).toMatchObject({ MH: { price: 19000 } });
    const lamp = await listStatePricingGrid(rtWeb, ctxA, { search: "lamp", limit: 25, offset: 0 });
    expect(lamp.rows[0]?.variants[0]?.prices.MH).toBeUndefined();
    const audit = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) => tx.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "state_prices.bulk")));
    expect(audit).toHaveLength(1);

    await expect(setStatePricesBulk(rtWeb, ctxA, [{ variantId: zedA, state: "KA", price: 100 }, { variantId: "00000000-0000-7000-8000-0000000000ff", state: "KA", price: 100 }])).rejects.toThrow(/not found/);
    expect((await listStatePricingGrid(rtWeb, ctxA, { search: "zed", limit: 25, offset: 0 })).rows[0]?.variants[0]?.prices.KA).toBeUndefined();
    await expect(setStatePricesBulk(rtWeb, ctxA, [{ variantId: zedA, state: "KA", price: 100 }, { variantId: zedA, state: "KA", price: 200 }])).rejects.toThrow(/twice/);
    await expect(setStatePricesBulk(rtWeb, ctxA, [{ variantId: zedA, state: "ZZ", price: 100 }])).rejects.toThrow(/Unknown state/);
    await expect(setStatePricesBulk(rtWeb, ctxB, [{ variantId: zedA, state: "KA", price: 100 }])).rejects.toThrow(/Conflict|Not Found/);
  });

  it("finds variants by SKU for the store only", async () => {
    const found = await lookupVariantsBySku(rtWeb, ctxA, ["ZB-360", "LAMP-1", "NOPE", " ZB-660 "]);
    expect(found.map((f) => f.sku).sort()).toEqual(["LAMP-1", "ZB-360", "ZB-660"]);
    expect(found.find((f) => f.sku === "ZB-360")).toMatchObject({ productTitle: "Zed Bottle", variantTitle: "360ml", basePrice: 13000 });
    expect(await lookupVariantsBySku(rtWeb, ctxB, ["ZB-360", "LAMP-1"])).toEqual([]);
    expect(await lookupVariantsBySku(rtWeb, ctxA, [])).toEqual([]);
  });
});
