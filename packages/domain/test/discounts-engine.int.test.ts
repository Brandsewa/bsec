import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { primaryCategory } from "./helpers/primary-category.ts";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  adjustInventory,
  applyCartDiscount,
  createAdminDiscount,
  createCollection,
  createMarket,
  getStorefrontCoupons,
  createProduct,
  createRuntime,
  listInventoryLevels,
  placeOrder,
  provisionTenant,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { addToCart, getOrCreateCart } from "../src/storefront/cart.ts";

/**
 * Discount engine, phase 0 (ADR-045): automatic discounts, per-customer limits, the base-currency rule, the audit row
 * on create, and the per-order record of what each discount did. Real database.
 */
let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let ctx: TenantContext;
let variantId: string;
let mugVariantId: string;
let pickleProductId: string;
let mugProductId: string;
let picklesCollectionId: string;
let n = 0;

const errorOf = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e))?.message ?? null;

const buyer = (cartToken: string, phone = "9876543210") => ({
  cartToken,
  idempotencyKey: `idem_${cartToken}`,
  email: `buyer${phone}@engine-test.example`,
  phone,
  fullName: "Test Buyer",
  addressLine1: "1 Test Street",
  city: "Testville",
  state: "Karnataka",
  pincode: "560001",
  paymentMethod: "cod" as const,
});

async function cartWith(qty: number, marketId?: string) {
  const cart = await getOrCreateCart(rtWeb, ctx, `tok-eng-${++n}`, undefined, marketId);
  await addToCart(rtWeb, ctx, { token: cart.token, variantId, quantity: qty });
  return cart.token;
}

/** A cart with `pickles` jars of the 100.00 pickle and `mugs` of the 50.00 mug. */
async function mixedCart(pickles: number, mugs: number) {
  const cart = await getOrCreateCart(rtWeb, ctx, `tok-eng-${++n}`);
  if (pickles > 0) await addToCart(rtWeb, ctx, { token: cart.token, variantId, quantity: pickles });
  if (mugs > 0) await addToCart(rtWeb, ctx, { token: cart.token, variantId: mugVariantId, quantity: mugs });
  return cart.token;
}

/** Switches every automatic discount off so a test sees only what it creates. */
async function clearAutomatic() {
  await rt._db.db.execute(sql`update discounts set status = 'disabled' where tenant_id = ${ctx.tenantId}::uuid and code is null`);
}

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const t = await provisionTenant(rt, { storeName: "eng-a", slug: "eng-a", owner: { email: "owner@eng-a.test", name: "A" }, planCode: "growth", source: "platform_admin" });
  ctx = {
    tenantId: t.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: t.ownerId },
    roles: ["store_owner"],
    permissions: ["products.read", "products.write", "orders.read", "orders.write", "discounts.write", "settings.write", "markets.write"],
    requestId: "req-engine",
  };
  await createProduct(rtWeb, ctx, { title: "Pickle", status: "active", primaryCategoryId: await primaryCategory(rtWeb, ctx), variants: [{ sku: "ENG-1", title: "Default", price: 10000 }] });
  const row = (await listInventoryLevels(rtWeb, ctx, {})).items[0]!;
  variantId = row.variantId;
  await adjustInventory(rtWeb, ctx, { variantId, locationId: row.locationId, quantityDelta: 200, reason: "received" });

  await createProduct(rtWeb, ctx, { title: "Mug", status: "active", primaryCategoryId: await primaryCategory(rtWeb, ctx), variants: [{ sku: "ENG-MUG", title: "Default", price: 5000 }] });
  const levels = (await listInventoryLevels(rtWeb, ctx, {})).items;
  mugVariantId = levels.find((l) => l.variantId !== variantId)!.variantId;
  await adjustInventory(rtWeb, ctx, { variantId: mugVariantId, locationId: row.locationId, quantityDelta: 200, reason: "received" });
  const productOf = async (vid: string) => (await rt._db.db.select({ id: schema.variants.productId }).from(schema.variants).where(eq(schema.variants.id, vid)))[0]!.id;
  pickleProductId = await productOf(variantId);
  mugProductId = await productOf(mugVariantId);
  const col = await createCollection(rtWeb, ctx, { title: "Pickles", type: "manual", productIds: [pickleProductId] });
  picklesCollectionId = col.id;
}, 240_000);

afterAll(async () => {
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("automatic discounts", () => {
  it("apply on the cart with no code, are charged, and are recorded on the order", async () => {
    await createAdminDiscount(rtWeb, ctx, { title: "Welcome 10%", type: "percent", value: 10 });
    const token = await cartWith(1);

    const cart = await getOrCreateCart(rtWeb, ctx, token);
    expect(cart.discounts).toHaveLength(1);
    expect(cart.discount).toMatchObject({ title: "Welcome 10%", amount: 1000, automatic: true });

    const placed = await placeOrder(rtWeb, ctx, buyer(token));
    expect(placed).toMatchObject({ subtotal: 10000, discountTotal: 1000, grandTotal: 18900 });

    const apps = await rt._db.db.select().from(schema.orderDiscountApplications).where(eq(schema.orderDiscountApplications.orderId, placed.orderId));
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ code: null, title: "Welcome 10%", discountClass: "order", type: "percent", amount: 1000, shippingAmount: 0 });
    const reds = await rt._db.db.select().from(schema.discountRedemptions).where(eq(schema.discountRedemptions.orderId, placed.orderId));
    expect(reds.map((r) => r.amount)).toEqual([1000]);
    await clearAutomatic();
  });

  it("lose to a code the shopper types, which is recorded with its code", async () => {
    await createAdminDiscount(rtWeb, ctx, { title: "Auto 30%", type: "percent", value: 30 });
    await createAdminDiscount(rtWeb, ctx, { code: "FIVE", title: "5% code", type: "percent", value: 5 });
    const token = await cartWith(1);
    const cart = await applyCartDiscount(rtWeb, ctx, { token, code: "five" });
    expect(cart.discounts).toHaveLength(1);
    expect(cart.discount).toMatchObject({ code: "FIVE", amount: 500, automatic: false });

    const placed = await placeOrder(rtWeb, ctx, buyer(token, "9876543211"));
    const apps = await rt._db.db.select().from(schema.orderDiscountApplications).where(eq(schema.orderDiscountApplications.orderId, placed.orderId));
    expect(apps.map((a) => [a.code, a.amount])).toEqual([["FIVE", 500]]);
    await clearAutomatic();
  });

  it("stack with a free-shipping code when both opt in, and record both", async () => {
    await createAdminDiscount(rtWeb, ctx, { title: "Auto 10% stackable", type: "percent", value: 10, combinable: true });
    await createAdminDiscount(rtWeb, ctx, { code: "SHIPSTACK", title: "Free shipping", type: "free_shipping", value: 0, combinable: true });
    const token = await cartWith(1);
    const cart = await applyCartDiscount(rtWeb, ctx, { token, code: "SHIPSTACK" });
    expect(cart.discounts?.map((d) => d.title).sort()).toEqual(["Auto 10% stackable", "Free shipping"]);

    const placed = await placeOrder(rtWeb, ctx, buyer(token, "9876543212"));
    expect(placed).toMatchObject({ discountTotal: 1000, shippingTotal: 0, grandTotal: 9000 });
    const apps = await rt._db.db.select().from(schema.orderDiscountApplications).where(eq(schema.orderDiscountApplications.orderId, placed.orderId));
    expect(apps.map((a) => [a.discountClass, a.amount, a.shippingAmount]).sort()).toEqual([
      ["order", 1000, 0],
      ["shipping", 0, 9900],
    ]);
    await clearAutomatic();
  });
});

describe("per-customer limit", () => {
  it("refuses a second order from the same customer and rolls it back", async () => {
    await createAdminDiscount(rtWeb, ctx, { code: "ONEEACH", title: "One each", type: "percent", value: 10, perCustomerLimit: 1 });
    const first = await cartWith(1);
    await applyCartDiscount(rtWeb, ctx, { token: first, code: "ONEEACH" });
    await placeOrder(rtWeb, ctx, buyer(first, "9123456780"));

    // The same phone number is the same customer: the code is no longer theirs to use.
    const second = await cartWith(1);
    await applyCartDiscount(rtWeb, ctx, { token: second, code: "ONEEACH" });
    expect(await errorOf(placeOrder(rtWeb, ctx, buyer(second, "9123456780")))).toMatch(/already used this code/);

    const [d] = await rt._db.db.select().from(schema.discounts).where(eq(schema.discounts.code, "ONEEACH"));
    expect(d?.usedCount).toBe(1);
    const orders = await rt._db.db.select().from(schema.orders).where(eq(schema.orders.cartId, (await getOrCreateCart(rtWeb, ctx, second)).id));
    expect(orders).toHaveLength(0);

    // Someone else can still use it.
    const third = await cartWith(1);
    await applyCartDiscount(rtWeb, ctx, { token: third, code: "ONEEACH" });
    await expect(placeOrder(rtWeb, ctx, buyer(third, "9123456781"))).resolves.toMatchObject({ discountTotal: 1000 });
  });
});

describe("audit", () => {
  it("creating a discount writes an audit row", async () => {
    const created = await createAdminDiscount(rtWeb, ctx, { code: "AUDITME", title: "Audited", type: "percent", value: 7 });
    const rows = await rt._db.db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.tenantId, ctx.tenantId), eq(schema.auditLogs.targetId, created.id)));
    expect(rows.map((r) => r.action)).toEqual(["discount.create"]);
    expect(rows[0]?.diff).toMatchObject({ code: "AUDITME", type: "percent", value: 7 });
  });
});

describe("fixed amounts in another currency", () => {
  it("are refused on a cart in a second market, while percent codes still work", async () => {
    const market = await createMarket(rtWeb, ctx, { name: "United States", currency: "USD", countries: ["US"], fxRate: 0.012, taxDisplay: "exclusive" });
    // Readiness (payments, shipping, policy) is the markets feature's own concern; this test only needs an active market.
    await rt._db.db.execute(sql`update markets set status = 'active' where id = ${market.id}::uuid`);

    await createAdminDiscount(rtWeb, ctx, { code: "FLAT50", title: "Flat 50", type: "fixed", value: 5000 });
    await createAdminDiscount(rtWeb, ctx, { code: "PCT10", title: "10%", type: "percent", value: 10 });
    const token = await cartWith(1, market.id);
    expect((await getOrCreateCart(rtWeb, ctx, token)).currency).toBe("USD");

    expect(await errorOf(applyCartDiscount(rtWeb, ctx, { token, code: "FLAT50" }))).toMatch(/only works on orders in INR/);
    const cart = await applyCartDiscount(rtWeb, ctx, { token, code: "PCT10" });
    expect(cart.discount).toMatchObject({ code: "PCT10", automatic: false });
    expect(cart.discount!.amount).toBeGreaterThan(0);
  });
});

describe("discounts on chosen products and collections (phase 1)", () => {
  it("a collection discount takes money off only that collection's lines, on the order and its items", async () => {
    await createAdminDiscount(rtWeb, ctx, { code: "PICKLES20", title: "20% off pickles", type: "percent", value: 20, appliesTo: { type: "collections", collectionIds: [picklesCollectionId] } });
    const token = await mixedCart(1, 1); // pickle 10000 + mug 5000
    const cart = await applyCartDiscount(rtWeb, ctx, { token, code: "pickles20" });
    expect(cart.discount).toMatchObject({ code: "PICKLES20", amount: 2000, discountClass: "product" });

    const placed = await placeOrder(rtWeb, ctx, buyer(token, "9000000001"));
    expect(placed).toMatchObject({ subtotal: 15000, discountTotal: 2000 });
    const items = await rt._db.db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, placed.orderId));
    expect(items.map((i) => [i.sku, i.discountAmount]).sort()).toEqual([["ENG-1", 2000], ["ENG-MUG", 0]]);
    const apps = await rt._db.db.select().from(schema.orderDiscountApplications).where(eq(schema.orderDiscountApplications.orderId, placed.orderId));
    expect(apps[0]).toMatchObject({ code: "PICKLES20", discountClass: "product", amount: 2000 });
  });

  it("a product discount with a cap never takes off more than the cap", async () => {
    await createAdminDiscount(rtWeb, ctx, { code: "UPTO50", title: "50% off the mug, up to 30", type: "percent", value: 50, appliesTo: { type: "products", productIds: [mugProductId] }, rules: { maxDiscount: 3000 } });
    const token = await mixedCart(0, 4); // 4 mugs = 20000, 50% = 10000, capped at 3000
    const cart = await applyCartDiscount(rtWeb, ctx, { token, code: "UPTO50" });
    expect(cart.discount?.amount).toBe(3000);
    const placed = await placeOrder(rtWeb, ctx, buyer(token, "9000000002"));
    expect(placed.discountTotal).toBe(3000);
  });

  it("refuses a product discount when nothing in the cart matches, with a reason", async () => {
    const token = await mixedCart(0, 1); // only a mug, the collection holds pickles
    expect(await errorOf(applyCartDiscount(rtWeb, ctx, { token, code: "PICKLES20" }))).toMatch(/doesn't apply to anything in your cart/);
  });

  it("a product-scoped automatic discount appears with no code, only when it matches", async () => {
    await createAdminDiscount(rtWeb, ctx, { title: "Mug deal", type: "fixed", value: 1000, appliesTo: { type: "products", productIds: [mugProductId] } });
    const withMugs = await getOrCreateCart(rtWeb, ctx, await mixedCart(1, 3)); // fixed 10.00 per mug x 3
    expect(withMugs.discount).toMatchObject({ title: "Mug deal", amount: 3000, automatic: true });
    const noMug = await getOrCreateCart(rtWeb, ctx, await mixedCart(2, 0));
    expect(noMug.discounts).toEqual([]);
    await clearAutomatic();
  });

  it("is checked on the server whatever the form sent", async () => {
    const bad = (p: Promise<unknown>) => errorOf(p);
    expect(await bad(createAdminDiscount(rtWeb, ctx, { title: "Too much", type: "percent", value: 150 }))).toMatch(/between 1 and 100/);
    expect(await bad(createAdminDiscount(rtWeb, ctx, { title: "Ghost", type: "percent", value: 10, appliesTo: { type: "products", productIds: ["00000000-0000-4000-8000-00000000dead"] } }))).toMatch(/no longer exists/);
    expect(await bad(createAdminDiscount(rtWeb, ctx, { title: "Cap on fixed", type: "fixed", value: 500, rules: { maxDiscount: 100 } }))).toMatch(/only applies to a percentage/);
    expect(await bad(createAdminDiscount(rtWeb, ctx, { title: "Scoped shipping", type: "free_shipping", value: 0, appliesTo: { type: "products", productIds: [mugProductId] } }))).toMatch(/only a percentage or a fixed amount/);
  });

  it("a coupon shown on the storefront appears only on the products it applies to", async () => {
    await createAdminDiscount(rtWeb, ctx, { code: "SHOWPICKLE", title: "Pickle coupon", type: "percent", value: 15, showOnStorefront: true, appliesTo: { type: "collections", collectionIds: [picklesCollectionId] } });
    await createAdminDiscount(rtWeb, ctx, { code: "SHOWALL", title: "Everything", type: "percent", value: 5, showOnStorefront: true });
    const onPickle = (await getStorefrontCoupons(rtWeb, ctx, "INR", pickleProductId)).map((c) => c.code);
    const onMug = (await getStorefrontCoupons(rtWeb, ctx, "INR", mugProductId)).map((c) => c.code);
    expect(onPickle).toEqual(expect.arrayContaining(["SHOWPICKLE", "SHOWALL"]));
    expect(onMug).toContain("SHOWALL");
    expect(onMug).not.toContain("SHOWPICKLE");
  });
});

describe("tiers and shipping limits (phase 2)", () => {
  it("a tiered automatic discount gives the tier the cart reaches, at checkout", async () => {
    await createAdminDiscount(rtWeb, ctx, {
      title: "Spend more save more",
      type: "percent",
      value: 1,
      rules: { tiers: [{ threshold: 10000, value: 10 }, { threshold: 25000, value: 20 }] },
    });
    const small = await getOrCreateCart(rtWeb, ctx, await cartWith(1)); // 100.00 -> first tier
    expect(small.discount).toMatchObject({ amount: 1000, automatic: true });
    const big = await cartWith(3); // 300.00 -> second tier
    const placed = await placeOrder(rtWeb, ctx, buyer(big, "9000000011"));
    expect(placed).toMatchObject({ subtotal: 30000, discountTotal: 6000 });
    await clearAutomatic();
  });

  it("applies nothing below the first tier", async () => {
    await createAdminDiscount(rtWeb, ctx, { title: "Needs 500", type: "percent", value: 1, rules: { tiers: [{ threshold: 50000, value: 10 }] } });
    expect((await getOrCreateCart(rtWeb, ctx, await cartWith(1))).discounts).toEqual([]);
    await clearAutomatic();
  });

  it("free shipping with a cap waives only that much of the store's shipping charge", async () => {
    await createAdminDiscount(rtWeb, ctx, { code: "SHIPUPTO", title: "Shipping up to 50", type: "free_shipping", value: 0, rules: { maxShipping: 5000 } });
    const token = await cartWith(1);
    await applyCartDiscount(rtWeb, ctx, { token, code: "SHIPUPTO" });
    const placed = await placeOrder(rtWeb, ctx, buyer(token, "9000000012"));
    // shipping is 99.00 flat: 50.00 waived, 49.00 left to pay
    expect(placed).toMatchObject({ subtotal: 10000, shippingTotal: 4900, grandTotal: 14900 });
    const apps = await rt._db.db.select().from(schema.orderDiscountApplications).where(eq(schema.orderDiscountApplications.orderId, placed.orderId));
    expect(apps[0]).toMatchObject({ discountClass: "shipping", shippingAmount: 5000 });
  });

  it("free shipping limited to the base market is refused on a cart in another market", async () => {
    const [base] = await rt._db.db.select({ id: schema.markets.id }).from(schema.markets).where(and(eq(schema.markets.tenantId, ctx.tenantId), eq(schema.markets.isBase, true)));
    await createAdminDiscount(rtWeb, ctx, { code: "HOMEONLY", title: "Home only", type: "free_shipping", value: 0, rules: { markets: [base!.id] } });
    const home = await cartWith(1);
    expect((await applyCartDiscount(rtWeb, ctx, { token: home, code: "HOMEONLY" })).discount).toMatchObject({ freeShipping: true });

    const [us] = await rt._db.db.select({ id: schema.markets.id }).from(schema.markets).where(and(eq(schema.markets.tenantId, ctx.tenantId), eq(schema.markets.isBase, false)));
    const abroad = await cartWith(1, us!.id);
    expect(await errorOf(applyCartDiscount(rtWeb, ctx, { token: abroad, code: "HOMEONLY" }))).toMatch(/isn't available in your region/);
  });

  it("validates tiers and shipping limits on the server", async () => {
    const bad = (p: Promise<unknown>) => errorOf(p);
    expect(await bad(createAdminDiscount(rtWeb, ctx, { title: "Tiers backwards", type: "percent", value: 1, rules: { tiers: [{ threshold: 20000, value: 10 }, { threshold: 10000, value: 20 }] } }))).toMatch(/higher than the one before/);
    expect(await bad(createAdminDiscount(rtWeb, ctx, { title: "Tier over 100", type: "percent", value: 1, rules: { tiers: [{ threshold: 10000, value: 150 }] } }))).toMatch(/between 1 and 100/);
    expect(await bad(createAdminDiscount(rtWeb, ctx, { title: "Cap on a percent", type: "percent", value: 10, rules: { maxShipping: 100 } }))).toMatch(/only applies to free shipping/);
    expect(await bad(createAdminDiscount(rtWeb, ctx, { title: "Ghost market", type: "free_shipping", value: 0, rules: { markets: ["00000000-0000-4000-8000-00000000dead"] } }))).toMatch(/no longer exists/);
  });
});
