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
