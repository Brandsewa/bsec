/**
 * Regression tests for audit findings A3-01 and A3-02 (docs/audit/2026-11-A3-checkout-money.md), written first as
 * failing probes and now passing since checkout re-checks every cart line against the catalog (AGENTS.md rule 12).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { primaryCategory } from "./helpers/primary-category.ts";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  adjustInventory,
  createProduct,
  createRuntime,
  listInventoryLevels,
  placeOrder,
  provisionTenant,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { addToCart, getOrCreateCart } from "../src/storefront/cart.ts";

let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let ctx: TenantContext;
let n = 0;

const buyer = (cartToken: string) => ({
  cartToken,
  idempotencyKey: `idem_${cartToken}`,
  email: `buyer-${cartToken}@audit-probe.example`,
  phone: `98765${String(10000 + n).slice(-5)}`,
  fullName: "Audit Probe",
  addressLine1: "1 Test Street",
  city: "Testville",
  state: "Karnataka",
  pincode: "560001",
  paymentMethod: "cod" as const,
});

/** A new published product with one variant at `price` and stock; returns its ids. */
async function product(title: string, price: number) {
  const sku = `PROBE-${++n}`;
  await createProduct(rtWeb, ctx, { title, status: "active", primaryCategoryId: await primaryCategory(rtWeb, ctx), variants: [{ sku, title: "Default", price }] });
  const [v] = await rt._db.db.select({ id: schema.variants.id, productId: schema.variants.productId }).from(schema.variants).where(eq(schema.variants.sku, sku));
  if (!v) throw new Error(`probe setup: variant ${sku} was not created`);
  const row = (await listInventoryLevels(rtWeb, ctx, {})).items.find((i) => i.variantId === v.id);
  if (!row) throw new Error(`probe setup: no inventory level for ${sku}`);
  await adjustInventory(rtWeb, ctx, { variantId: v.id, locationId: row.locationId, quantityDelta: 50, reason: "received" });
  return { variantId: v.id, productId: v.productId };
}

async function cartWith(variantId: string, quantity: number) {
  const cart = await getOrCreateCart(rtWeb, ctx, `tok-probe-${++n}`);
  await addToCart(rtWeb, ctx, { token: cart.token, variantId, quantity });
  return cart.token;
}

const errorOf = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e))?.message ?? null;

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const t = await provisionTenant(rt, { storeName: "audit-probe", slug: "audit-probe", owner: { email: "owner@audit-probe.test", name: "A" }, planCode: "starter", source: "platform_admin" });
  ctx = {
    tenantId: t.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: t.ownerId },
    roles: ["store_owner"],
    permissions: ["products.read", "products.write", "orders.read", "orders.write", "settings.write"],
    requestId: "req-audit-probe",
  };
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("audit A3: checkout recomputes from the catalog, not from the cart's saved price", () => {
  // A3-01 (fixed): a stale price is corrected and the shopper is asked to review before paying the new price.
  it("a price raised after the item went into the cart is refused once, then charged at the current price", async () => {
    const p = await product("Mispriced", 1000);
    const token = await cartWith(p.variantId, 2);
    await rt._db.db.update(schema.variants).set({ price: 100000n }).where(eq(schema.variants.id, p.variantId));
    expect(await errorOf(placeOrder(rtWeb, ctx, buyer(token)))).toMatch(/price of an item in your cart has changed/);
    const placed = await placeOrder(rtWeb, ctx, buyer(token));
    expect(placed.subtotal).toBe(200000);
  });

  // A3-02 (fixed)
  it("a product taken off sale after it went into the cart is taken out and the order refused", async () => {
    const p = await product("Withdrawn", 5000);
    const token = await cartWith(p.variantId, 1);
    await rt._db.db.update(schema.products).set({ status: "draft" }).where(eq(schema.products.id, p.productId));
    expect(await errorOf(placeOrder(rtWeb, ctx, buyer(token)))).toMatch(/Withdrawn is no longer available/);
    expect(await errorOf(placeOrder(rtWeb, ctx, buyer(token)))).toMatch(/empty cart/);
  });

  // A3-02 (fixed)
  it("a deleted product that is still in a cart cannot be ordered", async () => {
    const p = await product("Deleted", 5000);
    const token = await cartWith(p.variantId, 1);
    await rt._db.db.update(schema.products).set({ deletedAt: new Date() }).where(eq(schema.products.id, p.productId));
    expect(await errorOf(placeOrder(rtWeb, ctx, buyer(token)))).toMatch(/Deleted is no longer available/);
  });

  it("an unchanged cart is charged the catalog price", async () => {
    const p = await product("Control", 2500);
    const placed = await placeOrder(rtWeb, ctx, buyer(await cartWith(p.variantId, 3)));
    expect(placed.subtotal).toBe(7500);
  });
});
