/**
 * Platform audit probes for checkout (docs/PLATFORM-AUDIT-PLAN.md section A3, findings in docs/audit/2026-11-A3-checkout-money.md).
 *
 * Each `it.fails` is an open finding: the assertion states the behaviour AGENTS.md rule 12 asks for ("prices and totals
 * are recomputed on the server at checkout") and fails today. When the defect is fixed the test starts passing, vitest
 * reports the `it.fails` as an error, and the fixer turns it into a plain `it`.
 *
 * `it.fails` passes on ANY error, a broken setup included. Each probe was therefore also run once as a plain `it`
 * (2026-11-15) and failed on its own assertion: "expected 2000 to be 200000" and "expected null not to be null" (twice).
 * The control test at the bottom uses the same helpers and must stay green.
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
  // A3-01
  it.fails("a price raised after the item went into the cart is the price charged", async () => {
    const p = await product("Mispriced", 1000);
    const token = await cartWith(p.variantId, 2);
    // The merchant corrects a pricing mistake (10.00 instead of 1000.00) while the item sits in a shopper's cart.
    await rt._db.db.update(schema.variants).set({ price: 100000n }).where(eq(schema.variants.id, p.variantId));
    const placed = await placeOrder(rtWeb, ctx, buyer(token));
    expect(placed.subtotal).toBe(200000);
  });

  // A3-02
  it.fails("a product taken off sale after it went into the cart cannot be ordered", async () => {
    const p = await product("Withdrawn", 5000);
    const token = await cartWith(p.variantId, 1);
    await rt._db.db.update(schema.products).set({ status: "draft" }).where(eq(schema.products.id, p.productId));
    expect(await errorOf(placeOrder(rtWeb, ctx, buyer(token)))).not.toBeNull();
  });

  // A3-02
  it.fails("a deleted product that is still in a cart cannot be ordered", async () => {
    const p = await product("Deleted", 5000);
    const token = await cartWith(p.variantId, 1);
    await rt._db.db.update(schema.products).set({ deletedAt: new Date() }).where(eq(schema.products.id, p.productId));
    expect(await errorOf(placeOrder(rtWeb, ctx, buyer(token)))).not.toBeNull();
  });

  // Control: the same flow with nothing changed places the order at the catalog price.
  it("an unchanged cart is charged the catalog price", async () => {
    const p = await product("Control", 2500);
    const placed = await placeOrder(rtWeb, ctx, buyer(await cartWith(p.variantId, 3)));
    expect(placed.subtotal).toBe(7500);
  });
});
