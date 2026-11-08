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
  generateDiscountCodes,
  getAdminDiscountStats,
  listDiscountCodes,
  removeCartDiscount,
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

describe("buy X get Y and bundles (phase 3)", () => {
  it("buy 2 get 1 free: the cheapest item is free on the order and on its line", async () => {
    await createAdminDiscount(rtWeb, ctx, {
      code: "B2G1",
      title: "Buy 2 get 1 free",
      type: "buy_x_get_y",
      value: 0,
      // These tests are about the discount itself: adding the free items by itself is tested in discounts-autoadd.int.test.ts.
      rules: { bxgy: { autoAdd: false, buy: { trigger: "quantity", value: 2, appliesTo: { type: "all" } }, get: { quantity: 1, appliesTo: { type: "all" }, effect: "free" } } },
    });
    const token = await mixedCart(2, 1); // 2 pickles at 100.00 and a mug at 50.00
    const cart = await applyCartDiscount(rtWeb, ctx, { token, code: "b2g1" });
    expect(cart.discount).toMatchObject({ code: "B2G1", amount: 5000, discountClass: "product" });

    const placed = await placeOrder(rtWeb, ctx, buyer(token, "9000000021"));
    expect(placed).toMatchObject({ subtotal: 25000, discountTotal: 5000 });
    const items = await rt._db.db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, placed.orderId));
    expect(items.map((i) => [i.sku, i.discountAmount]).sort()).toEqual([["ENG-1", 0], ["ENG-MUG", 5000]]);
  });

  it("is refused with a reason while the cart is short of the offer", async () => {
    const token = await mixedCart(1, 1);
    expect(await errorOf(applyCartDiscount(rtWeb, ctx, { token, code: "B2G1" }))).toMatch(/Add the items this offer needs/);
  });

  it("a bundle price: any 2 mugs for 70.00", async () => {
    await createAdminDiscount(rtWeb, ctx, {
      code: "MUGPAIR",
      title: "2 mugs for 70",
      type: "bundle",
      value: 0,
      rules: { bundle: { quantity: 2, price: 7000, appliesTo: { type: "products", productIds: [mugProductId] } } },
    });
    const token = await mixedCart(0, 3); // 3 mugs at 50.00: one pair for 70.00, one at full price
    const cart = await applyCartDiscount(rtWeb, ctx, { token, code: "mugpair" });
    expect(cart.discount?.amount).toBe(3000);
    const placed = await placeOrder(rtWeb, ctx, buyer(token, "9000000022"));
    expect(placed).toMatchObject({ subtotal: 15000, discountTotal: 3000 });
  });

  it("a free gift: the gift product is free once the rest of the cart reaches the amount", async () => {
    await createAdminDiscount(rtWeb, ctx, {
      title: "Free mug over 200",
      type: "buy_x_get_y",
      value: 0,
      rules: { bxgy: { autoAdd: false, buy: { trigger: "amount", value: 20000, appliesTo: { type: "all" } }, get: { quantity: 1, appliesTo: { type: "products", productIds: [mugProductId] }, effect: "free" } } },
    });
    const short = await getOrCreateCart(rtWeb, ctx, await mixedCart(1, 1)); // 100.00 of pickles + the mug
    expect(short.discounts).toEqual([]);
    const enough = await getOrCreateCart(rtWeb, ctx, await mixedCart(2, 1)); // 200.00 of pickles + the mug
    expect(enough.discount).toMatchObject({ amount: 5000, automatic: true });
    await clearAutomatic();
  });

  it("is checked on the server when it is saved", async () => {
    const bad = (p: Promise<unknown>) => errorOf(p);
    expect(await bad(createAdminDiscount(rtWeb, ctx, { title: "No rules", type: "bundle", value: 0 }))).toMatch(/set how many items and the bundle price/);
    expect(await bad(createAdminDiscount(rtWeb, ctx, { title: "Percent without value", type: "buy_x_get_y", value: 0, rules: { bxgy: { buy: { trigger: "quantity", value: 1, appliesTo: { type: "all" } }, get: { quantity: 1, appliesTo: { type: "all" }, effect: "percent" } } } }))).toMatch(/percentage off must be between 1 and 100/);
    expect(await bad(createAdminDiscount(rtWeb, ctx, { title: "Ghost get", type: "buy_x_get_y", value: 0, rules: { bxgy: { buy: { trigger: "quantity", value: 1, appliesTo: { type: "all" } }, get: { quantity: 1, appliesTo: { type: "products", productIds: ["00000000-0000-4000-8000-00000000dead"] }, effect: "free" } } } }))).toMatch(/no longer exists/);
    expect(await bad(createAdminDiscount(rtWeb, ctx, { title: "Stray rules", type: "percent", value: 10, rules: { bundle: { quantity: 2, price: 100, appliesTo: { type: "all" } } } }))).toMatch(/only apply to a bundle/);
  });
});

describe("who a discount is for (phase 4)", () => {
  it("a new-customer code works for a first order and is refused for the same customer's next one", async () => {
    await createAdminDiscount(rtWeb, ctx, { code: "WELCOME15", title: "Welcome", type: "percent", value: 15, customerEligibility: { type: "new_customers" } });
    const first = await cartWith(1);
    await applyCartDiscount(rtWeb, ctx, { token: first, code: "welcome15" });
    await expect(placeOrder(rtWeb, ctx, buyer(first, "9100000001"))).resolves.toMatchObject({ discountTotal: 1500 });

    const again = await cartWith(1);
    await applyCartDiscount(rtWeb, ctx, { token: again, code: "welcome15" }); // a guest cannot be told apart while browsing
    expect(await errorOf(placeOrder(rtWeb, ctx, buyer(again, "9100000001")))).toMatch(/only for new customers/);

    const stranger = await cartWith(1);
    await applyCartDiscount(rtWeb, ctx, { token: stranger, code: "welcome15" });
    await expect(placeOrder(rtWeb, ctx, buyer(stranger, "9100000002"))).resolves.toMatchObject({ discountTotal: 1500 });
  });

  it("a code for tagged customers is refused for a customer without the tag and for a stranger", async () => {
    await createAdminDiscount(rtWeb, ctx, { code: "VIPONLY", title: "VIP", type: "percent", value: 20, customerEligibility: { type: "tags", tags: ["vip"] } });
    // a customer from an earlier order (the guest record made at checkout)
    const [known] = await rt._db.db.select({ id: schema.customers.id }).from(schema.customers).where(and(eq(schema.customers.tenantId, ctx.tenantId), eq(schema.customers.phone, "9100000001")));
    const withCode = async () => {
      const t = await cartWith(1);
      await applyCartDiscount(rtWeb, ctx, { token: t, code: "viponly" });
      return t;
    };
    expect(await errorOf(placeOrder(rtWeb, ctx, buyer(await withCode(), "9100000001")))).toMatch(/isn't available for your account/);
    expect(await errorOf(placeOrder(rtWeb, ctx, buyer(await withCode(), "9100000077")))).toMatch(/isn't available for your account/); // matches nobody

    await rt._db.db.execute(sql`update customers set tags = ARRAY['vip']::text[] where id = ${known!.id}::uuid`);
    await expect(placeOrder(rtWeb, ctx, buyer(await withCode(), "9100000001"))).resolves.toMatchObject({ discountTotal: 2000 });
  });

  it("only a code can be for some customers, and the customers must be the store's own", async () => {
    const bad = (p: Promise<unknown>) => errorOf(p);
    expect(await bad(createAdminDiscount(rtWeb, ctx, { title: "Auto for new", type: "percent", value: 10, customerEligibility: { type: "new_customers" } }))).toMatch(/needs a code/);
    expect(await bad(createAdminDiscount(rtWeb, ctx, { code: "GHOSTS", title: "Ghost customers", type: "percent", value: 10, customerEligibility: { type: "customers", customerIds: ["00000000-0000-4000-8000-00000000dead"] } }))).toMatch(/no longer exists/);
  });
});

describe("several codes on one cart (phase 4)", () => {
  it("stack when both allow it, one can be removed, and a code that cannot stack replaces them", async () => {
    await createAdminDiscount(rtWeb, ctx, { code: "STACKGOODS", title: "5% stack", type: "percent", value: 5, combinable: true });
    await createAdminDiscount(rtWeb, ctx, { code: "STACKSHIP", title: "Ship stack", type: "free_shipping", value: 0, combinable: true });
    await createAdminDiscount(rtWeb, ctx, { code: "LONER", title: "Loner 30%", type: "percent", value: 30 });
    const token = await cartWith(1);
    await applyCartDiscount(rtWeb, ctx, { token, code: "stackgoods" });
    const both = await applyCartDiscount(rtWeb, ctx, { token, code: "stackship" });
    expect(both.discounts?.map((d) => d.code).sort()).toEqual(["STACKGOODS", "STACKSHIP"]);

    const oneLeft = await removeCartDiscount(rtWeb, ctx, { token, code: "stackship" });
    expect(oneLeft.discounts?.map((d) => d.code)).toEqual(["STACKGOODS"]);

    await applyCartDiscount(rtWeb, ctx, { token, code: "stackship" });
    const replaced = await applyCartDiscount(rtWeb, ctx, { token, code: "loner" }); // cannot sit beside them: it takes their place
    expect(replaced.discounts?.map((d) => d.code)).toEqual(["LONER"]);
    expect((await removeCartDiscount(rtWeb, ctx, { token })).discounts).toEqual([]);
  });

  it("allows at most five codes", async () => {
    for (let i = 1; i <= 6; i++) await createAdminDiscount(rtWeb, ctx, { code: `MANY${i}`, title: `Many ${i}`, type: "percent", value: 1, combinable: true });
    const token = await mixedCart(1, 1);
    // goods codes cannot stack with each other, so each new one replaces: the limit is on what is stored, so fill the cart directly
    await rt._db.db.execute(sql`update carts set discount_codes = ARRAY['MANY1','MANY2','MANY3','MANY4','MANY5']::text[] where token = ${token}`);
    expect(await errorOf(applyCartDiscount(rtWeb, ctx, { token, code: "MANY6" }))).toMatch(/up to 5 codes/);
  });

  it("a shared link can leave a code on a cart that is still empty", async () => {
    await createAdminDiscount(rtWeb, ctx, { code: "LINKED", title: "Linked", type: "percent", value: 10 });
    const empty = await getOrCreateCart(rtWeb, ctx, `tok-eng-${++n}`);
    expect(await errorOf(applyCartDiscount(rtWeb, ctx, { token: empty.token, code: "linked" }))).toMatch(/add something to your cart first/);
    await applyCartDiscount(rtWeb, ctx, { token: empty.token, code: "linked", allowEmpty: true });
    await addToCart(rtWeb, ctx, { token: empty.token, variantId, quantity: 1 });
    expect((await getOrCreateCart(rtWeb, ctx, empty.token)).discount).toMatchObject({ code: "LINKED", amount: 1000 });
    expect(await errorOf(applyCartDiscount(rtWeb, ctx, { token: empty.token, code: "NOSUCHCODE", allowEmpty: true }))).toMatch(/not found/i);
  });
});

describe("generated single-use codes (phase 4)", () => {
  let listId: string;

  it("generates unique codes, lists them, and the discount never applies by itself", async () => {
    const created = await createAdminDiscount(rtWeb, ctx, { title: "Diwali influencers", type: "percent", value: 25, usesCodeList: true });
    listId = created.id;
    expect(await generateDiscountCodes(rtWeb, ctx, { id: listId, count: 20, prefix: "diwali-" })).toEqual({ created: 20 });
    const listed = await listDiscountCodes(rtWeb, ctx, { id: listId, limit: 100 });
    expect(listed).toMatchObject({ total: 20, codeCount: 20, usedCount: 0 });
    expect(new Set(listed.items.map((i) => i.code)).size).toBe(20);
    expect(listed.items.every((i) => /^DIWALI-[A-Z2-9]{8}$/.test(i.code))).toBe(true);
    expect((await getOrCreateCart(rtWeb, ctx, await cartWith(1))).discounts?.some((d) => d.title === "Diwali influencers")).toBe(false);
  });

  it("a code works once, then is refused with its own message", async () => {
    const [one, two] = (await listDiscountCodes(rtWeb, ctx, { id: listId, limit: 2 })).items;
    const token = await cartWith(1);
    const cart = await applyCartDiscount(rtWeb, ctx, { token, code: one!.code.toLowerCase() });
    expect(cart.discount).toMatchObject({ code: one!.code, amount: 2500 });
    const placed = await placeOrder(rtWeb, ctx, buyer(token, "9200000001"));
    expect(placed.discountTotal).toBe(2500);
    expect((await listDiscountCodes(rtWeb, ctx, { id: listId, filter: "used" })).items.map((i) => i.code)).toEqual([one!.code]);

    const again = await cartWith(1);
    expect(await errorOf(applyCartDiscount(rtWeb, ctx, { token: again, code: one!.code }))).toMatch(/already been used/);
    await expect(applyCartDiscount(rtWeb, ctx, { token: again, code: two!.code })).resolves.toMatchObject({ discount: { amount: 2500 } });
  });

  it("two orders racing for the same code: exactly one gets it", async () => {
    const code = (await listDiscountCodes(rtWeb, ctx, { id: listId, filter: "unused", limit: 1 })).items[0]!.code;
    const a = await cartWith(1);
    const b = await cartWith(1);
    await applyCartDiscount(rtWeb, ctx, { token: a, code });
    await applyCartDiscount(rtWeb, ctx, { token: b, code });
    const results = await Promise.allSettled([placeOrder(rtWeb, ctx, buyer(a, "9200000011")), placeOrder(rtWeb, ctx, buyer(b, "9200000012"))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(lost.reason)).toMatch(/already been used|no longer available/);
    expect((await listDiscountCodes(rtWeb, ctx, { id: listId, filter: "used" })).usedCount).toBe(2);
  });

  it("is checked on the server", async () => {
    const bad = (p: Promise<unknown>) => errorOf(p);
    expect(await bad(createAdminDiscount(rtWeb, ctx, { code: "BOTH", title: "Both", type: "percent", value: 10, usesCodeList: true }))).toMatch(/no single code/);
    expect(await bad(generateDiscountCodes(rtWeb, ctx, { id: listId, count: 1, prefix: "bad prefix!" }))).toMatch(/prefix/);
    expect(await bad(generateDiscountCodes(rtWeb, ctx, { id: listId, count: 20_000 }))).toMatch(/up to 10000 codes/);
    const plain = await createAdminDiscount(rtWeb, ctx, { code: "PLAINONE", title: "Plain", type: "percent", value: 10 });
    expect(await bad(generateDiscountCodes(rtWeb, ctx, { id: plain.id, count: 1 }))).toMatch(/does not use a list of codes/);
    // a generated code cannot be reused as an ordinary discount code
    const some = (await listDiscountCodes(rtWeb, ctx, { id: listId, limit: 1 })).items[0]!.code;
    expect(await bad(createAdminDiscount(rtWeb, ctx, { code: some, title: "Clash", type: "percent", value: 5 }))).toMatch(/already one of your generated codes/);
  });
});

describe("nudges and reporting (phase 5)", () => {
  it("the cart says how much more unlocks the nearest automatic offer, and stops once it is reached", async () => {
    await createAdminDiscount(rtWeb, ctx, { title: "Spend 500 get 15%", type: "percent", value: 15, minSubtotal: 50000 });
    const one = await getOrCreateCart(rtWeb, ctx, await cartWith(1)); // 100.00
    expect(one.discountNudge).toEqual({ remaining: 40000, threshold: 50000, benefit: "15% off" });
    expect(one.discounts).toEqual([]);
    const five = await getOrCreateCart(rtWeb, ctx, await cartWith(5)); // 500.00 reached
    expect(five.discountNudge).toBeNull();
    expect(five.discount).toMatchObject({ amount: 7500, automatic: true });
    await clearAutomatic();
  });

  it("an empty cart has nothing to nudge", async () => {
    await createAdminDiscount(rtWeb, ctx, { title: "Spend 500", type: "percent", value: 15, minSubtotal: 50000 });
    const empty = await getOrCreateCart(rtWeb, ctx, `tok-eng-${++n}`);
    expect(empty.discountNudge).toBeNull();
    await clearAutomatic();
  });

  it("reports uses, what was given away and what the orders were worth", async () => {
    const d = await createAdminDiscount(rtWeb, ctx, { code: "STATS10", title: "Stats", type: "percent", value: 10 });
    for (const [phone, qty] of [["9300000001", 1], ["9300000002", 2]] as const) {
      const token = await cartWith(qty);
      await applyCartDiscount(rtWeb, ctx, { token, code: "STATS10" });
      await placeOrder(rtWeb, ctx, buyer(token, phone));
    }
    const stats = await getAdminDiscountStats(rtWeb, ctx, { id: d.id });
    // 10.00 + 20.00 given away; each order also pays 99.00 shipping: 189.00 + 279.00
    expect(stats).toMatchObject({ uses: 2, customers: 2, totalGivenAway: 3000, revenue: 46800, averageOrderValue: 23400, otherCurrencyUses: 0 });
    expect(stats.byDay).toHaveLength(1);
    expect(stats.byDay[0]).toMatchObject({ uses: 2, amount: 3000 });
  });

  it("a discount nobody used reports zeros, and another store's discount is not found", async () => {
    const d = await createAdminDiscount(rtWeb, ctx, { code: "NOBODY", title: "Unused", type: "percent", value: 5 });
    expect(await getAdminDiscountStats(rtWeb, ctx, { id: d.id })).toMatchObject({ uses: 0, totalGivenAway: 0, revenue: 0, averageOrderValue: 0, byDay: [] });
    expect(await errorOf(getAdminDiscountStats(rtWeb, ctx, { id: "00000000-0000-4000-8000-00000000dead" }))).toMatch(/not found/i);
  });
});
