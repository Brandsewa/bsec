/**
 * Audit A3-03 (docs/audit/2026-11-A3-checkout-money.md): a store that turned guest checkout off must still let its
 * signed-in customers order. The place-order route now passes the customer behind the session cookie to placeOrder;
 * this tests the domain side of that contract against a real database.
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
  updateCheckoutSettings,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { addToCart, getOrCreateCart } from "../src/storefront/cart.ts";

let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let ctx: TenantContext;
let variantId: string;
let n = 0;

const errorOf = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e))?.message ?? null;

const buyer = (cartToken: string, extra: { customerId?: string } = {}) => ({
  cartToken,
  idempotencyKey: `idem_${cartToken}`,
  email: "buyer@guest-off.example",
  phone: "9876543210",
  fullName: "Guest Off Buyer",
  addressLine1: "1 Test Street",
  city: "Testville",
  state: "Karnataka",
  pincode: "560001",
  paymentMethod: "cod" as const,
  ...extra,
});

async function cart() {
  const c = await getOrCreateCart(rtWeb, ctx, `tok-guestoff-${++n}`);
  await addToCart(rtWeb, ctx, { token: c.token, variantId, quantity: 1 });
  return c.token;
}

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const t = await provisionTenant(rt, { storeName: "guest-off", slug: "guest-off", owner: { email: "owner@guest-off.test", name: "A" }, planCode: "starter", source: "platform_admin" });
  ctx = {
    tenantId: t.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: t.ownerId },
    roles: ["store_owner"],
    permissions: ["products.read", "products.write", "orders.read", "orders.write", "settings.write", "checkout.manage"],
    requestId: "req-guest-off",
  };
  await createProduct(rtWeb, ctx, { title: "Tea", status: "active", primaryCategoryId: await primaryCategory(rtWeb, ctx), variants: [{ sku: "GO-1", title: "Default", price: 10000 }] });
  const row = (await listInventoryLevels(rtWeb, ctx, {})).items[0]!;
  variantId = row.variantId;
  await adjustInventory(rtWeb, ctx, { variantId, locationId: row.locationId, quantityDelta: 50, reason: "received" });
  await updateCheckoutSettings(rtWeb, ctx, { guestCheckout: false });
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("audit A3-03: guest checkout off", () => {
  it("refuses an order that has no signed-in customer", async () => {
    expect(await errorOf(placeOrder(rtWeb, ctx, buyer(await cart())))).toMatch(/Guest checkout is not permitted/);
  });

  it("accepts the order of a signed-in customer and links it to that account", async () => {
    const [cust] = await rt._db.db
      .insert(schema.customers)
      .values({ tenantId: ctx.tenantId, email: "member@guest-off.example", phone: "9123456780", name: "Member", isGuest: false, emailVerified: true })
      .returning({ id: schema.customers.id });
    const placed = await placeOrder(rtWeb, ctx, buyer(await cart(), { customerId: cust!.id }));
    const [row] = await rt._db.db.select({ customerId: schema.orders.customerId }).from(schema.orders).where(eq(schema.orders.id, placed.orderId));
    expect(row?.customerId).toBe(cust!.id);
  });
});
