import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { primaryCategory } from "./helpers/primary-category.ts";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  adjustInventory,
  applyCartDiscount,
  createAdminDiscount,
  createProduct,
  createRuntime,
  listInventoryLevels,
  placeOrder,
  provisionTenant,
  removeCartDiscount,
  removeCartItem,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { addToCart, getOrCreateCart } from "../src/storefront/cart.ts";

let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let ctx: TenantContext;
let variantId: string;
let locationId: string;
let n = 0;

const errorOf = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e))?.message ?? null;

const buyer = (cartToken: string) => ({
  cartToken,
  idempotencyKey: `idem_${cartToken}`,
  email: "buyer@discount-test.example",
  phone: "9876543210",
  fullName: "Test Buyer",
  addressLine1: "1 Test Street",
  city: "Testville",
  state: "Karnataka",
  pincode: "560001",
  paymentMethod: "cod" as const,
});

/** A cart with `qty` of the product (price 10000 each). */
async function cartWith(qty: number) {
  const cart = await getOrCreateCart(rtWeb, ctx, `tok-disc-${++n}`);
  await addToCart(rtWeb, ctx, { token: cart.token, variantId, quantity: qty });
  return cart.token;
}

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const t = await provisionTenant(rt, { storeName: "disc-a", slug: "disc-a", owner: { email: "owner@disc-a.test", name: "A" }, planCode: "starter", source: "platform_admin" });
  ctx = {
    tenantId: t.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: t.ownerId },
    roles: ["store_owner"],
    permissions: ["products.read", "products.write", "orders.read", "orders.write", "discounts.write", "settings.write"],
    requestId: "req-test",
  };
  await createProduct(rtWeb, ctx, { title: "Pickle", status: "active", primaryCategoryId: await primaryCategory(rtWeb, ctx), variants: [{ sku: "DISC-1", title: "Default", price: 10000 }] });
  const row = (await listInventoryLevels(rtWeb, ctx, {})).items[0]!;
  variantId = row.variantId;
  locationId = row.locationId;
  await adjustInventory(rtWeb, ctx, { variantId, locationId, quantityDelta: 100, reason: "received" });
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

const order = async (token: string) => (await rt._db.db.select().from(schema.orders).where(eq(schema.orders.cartId, (await getOrCreateCart(rtWeb, ctx, token)).id)))[0];

describe("discount codes at checkout", () => {
  it("a percent code lowers the goods, is charged, redeemed once, and recorded on the order and its lines", async () => {
    await createAdminDiscount(rtWeb, ctx, { code: "TEN", title: "10% off", type: "percent", value: 10 });
    const token = await cartWith(1);

    const cart = await applyCartDiscount(rtWeb, ctx, { token, code: "ten" }); // typed in lower case
    expect(cart.discount).toMatchObject({ code: "TEN", amount: 1000, freeShipping: false });

    const placed = await placeOrder(rtWeb, ctx, buyer(token));
    // goods 10000 - 1000, shipping 9900 (the store's flat rate), no COD fee
    expect(placed).toMatchObject({ subtotal: 10000, discountTotal: 1000, shippingTotal: 9900, grandTotal: 18900 });

    const [row] = await rt._db.db.select().from(schema.orders).where(eq(schema.orders.id, placed.orderId));
    expect(row).toMatchObject({ discountTotal: 1000, grandTotal: 18900 });
    const [item] = await rt._db.db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, placed.orderId));
    expect(item?.discountAmount).toBe(1000);
    const [d] = await rt._db.db.select().from(schema.discounts).where(eq(schema.discounts.code, "TEN"));
    expect(d?.usedCount).toBe(1);
    const reds = await rt._db.db.select().from(schema.discountRedemptions).where(eq(schema.discountRedemptions.orderId, placed.orderId));
    expect(reds.map((r) => r.amount)).toEqual([1000]);
  });

  it("a fixed code is capped at the goods total", async () => {
    await createAdminDiscount(rtWeb, ctx, { code: "BIG", title: "₹500 off", type: "fixed", value: 50000 });
    const token = await cartWith(1);
    const cart = await applyCartDiscount(rtWeb, ctx, { token, code: "BIG" });
    expect(cart.discount?.amount).toBe(10000);
    const placed = await placeOrder(rtWeb, ctx, buyer(token));
    expect(placed).toMatchObject({ discountTotal: 10000, grandTotal: 9900 }); // only shipping left to pay
  });

  it("a free-shipping code waives shipping and leaves the goods price alone", async () => {
    await createAdminDiscount(rtWeb, ctx, { code: "SHIPFREE", title: "Free shipping", type: "free_shipping", value: 0 });
    const token = await cartWith(1);
    const cart = await applyCartDiscount(rtWeb, ctx, { token, code: "SHIPFREE" });
    expect(cart.discount).toMatchObject({ freeShipping: true, amount: 0 });
    const placed = await placeOrder(rtWeb, ctx, buyer(token));
    expect(placed).toMatchObject({ discountTotal: 0, shippingTotal: 0, grandTotal: 10000 });
    const reds = await rt._db.db.select().from(schema.discountRedemptions).where(eq(schema.discountRedemptions.orderId, placed.orderId));
    expect(reds.map((r) => r.amount)).toEqual([9900]); // what the code was worth: the waived shipping
  });

  it("refuses codes that don't exist, are below their minimum, disabled or expired, with a reason", async () => {
    await createAdminDiscount(rtWeb, ctx, { code: "MIN5", title: "Min", type: "percent", value: 5, minSubtotal: 50000 });
    await createAdminDiscount(rtWeb, ctx, { code: "OLD", title: "Old", type: "percent", value: 5, endsAt: new Date(Date.now() - 86_400_000).toISOString() });
    const token = await cartWith(1);
    expect(await errorOf(applyCartDiscount(rtWeb, ctx, { token, code: "NOPE" }))).toMatch(/not found/i);
    expect(await errorOf(applyCartDiscount(rtWeb, ctx, { token, code: "MIN5" }))).toMatch(/Minimum order subtotal/);
    expect(await errorOf(applyCartDiscount(rtWeb, ctx, { token, code: "OLD" }))).toMatch(/expired/i);
    expect(await errorOf(applyCartDiscount(rtWeb, ctx, { token, code: "  " }))).toMatch(/enter a discount code/);
    // the cart still has no code
    expect((await getOrCreateCart(rtWeb, ctx, token)).discount).toBeNull();
  });

  it("buy-X-get-Y can be created by a merchant but is refused at checkout, honestly", async () => {
    await createAdminDiscount(rtWeb, ctx, { code: "BXGY", title: "Buy 2 get 1", type: "buy_x_get_y", value: 1 });
    const token = await cartWith(3);
    expect(await errorOf(applyCartDiscount(rtWeb, ctx, { token, code: "BXGY" }))).toMatch(/can't be used at checkout yet/);
  });

  it("a code can be removed again, and applying a new one replaces the old one", async () => {
    const token = await cartWith(1);
    await applyCartDiscount(rtWeb, ctx, { token, code: "TEN" });
    const swapped = await applyCartDiscount(rtWeb, ctx, { token, code: "SHIPFREE" });
    expect(swapped.discount?.code).toBe("SHIPFREE");
    const removed = await removeCartDiscount(rtWeb, ctx, { token });
    expect(removed.discount).toBeNull();
    const placed = await placeOrder(rtWeb, ctx, buyer(token));
    expect(placed).toMatchObject({ discountTotal: 0, grandTotal: 19900 });
  });

  it("a code that stops being valid is flagged on the cart and blocks the order instead of silently changing the price", async () => {
    await createAdminDiscount(rtWeb, ctx, { code: "OVER150", title: "Over 150", type: "percent", value: 10, minSubtotal: 15000 });
    const token = await cartWith(2); // 20000
    await applyCartDiscount(rtWeb, ctx, { token, code: "OVER150" });

    const live = await getOrCreateCart(rtWeb, ctx, token);
    await removeCartItem(rtWeb, ctx, { token, itemId: live.items[0]!.id }); // cart is now empty... add one back
    await addToCart(rtWeb, ctx, { token, variantId, quantity: 1 }); // 10000, below the 15000 minimum

    const stale = await getOrCreateCart(rtWeb, ctx, token);
    expect(stale.discount).toBeNull();
    expect(stale.discountNotice).toMatch(/OVER150 can't be used/);
    expect(await errorOf(placeOrder(rtWeb, ctx, buyer(token)))).toMatch(/Remove the code to continue/);
  });

  it("the last redemption goes to one shopper: the other order is refused whole, with no stock held", async () => {
    await createAdminDiscount(rtWeb, ctx, { code: "ONCE", title: "One use", type: "percent", value: 10, usageLimit: 1 });
    const a = await cartWith(1);
    const b = await cartWith(1);
    await applyCartDiscount(rtWeb, ctx, { token: a, code: "ONCE" });
    await applyCartDiscount(rtWeb, ctx, { token: b, code: "ONCE" }); // still valid for both until one is placed

    const reservedBefore = (await listInventoryLevels(rtWeb, ctx, {})).items[0]!.reserved;
    await placeOrder(rtWeb, ctx, buyer(a));
    expect((await listInventoryLevels(rtWeb, ctx, {})).items[0]!.reserved).toBe(reservedBefore + 1);

    // for b the code now shows as used up when the cart is read, so the order is refused before anything is reserved
    expect(await errorOf(placeOrder(rtWeb, ctx, buyer(b)))).toMatch(/usage limit/);
    expect((await listInventoryLevels(rtWeb, ctx, {})).items[0]!.reserved).toBe(reservedBefore + 1);
    const [d] = await rt._db.db.select().from(schema.discounts).where(eq(schema.discounts.code, "ONCE"));
    expect(d?.usedCount).toBe(1);
  });
});

describe("discount codes under concurrency", () => {
  it("two shoppers placing orders at the same moment on a one-use code: exactly one gets it, the other order leaves no trace", async () => {
    await createAdminDiscount(rtWeb, ctx, { code: "RACE", title: "Race", type: "percent", value: 10, usageLimit: 1 });
    const tokens = await Promise.all([cartWith(1), cartWith(1), cartWith(1), cartWith(1)]);
    for (const token of tokens) await applyCartDiscount(rtWeb, ctx, { token, code: "RACE" });

    const reservedBefore = (await listInventoryLevels(rtWeb, ctx, {})).items[0]!.reserved;
    const ordersBefore = (await rt._db.db.select().from(schema.orders)).length;

    const results = await Promise.allSettled(tokens.map((token) => placeOrder(rtWeb, ctx, buyer(token))));
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(3);

    // only the winner reserved stock and created an order; the losers were rolled back whole
    expect((await listInventoryLevels(rtWeb, ctx, {})).items[0]!.reserved).toBe(reservedBefore + 1);
    expect((await rt._db.db.select().from(schema.orders)).length).toBe(ordersBefore + 1);
    const [d] = await rt._db.db.select().from(schema.discounts).where(eq(schema.discounts.code, "RACE"));
    expect(d?.usedCount).toBe(1);
  });
});

void order;
