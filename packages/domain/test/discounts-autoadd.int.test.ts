import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { primaryCategory } from "./helpers/primary-category.ts";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  adjustInventory,
  applyCartDiscount,
  createAdminDiscount,
  createProduct,
  createRuntime,
  getStorefrontProductOffers,
  listInventoryLevels,
  placeOrder,
  provisionTenant,
  removeCartItem,
  updateCartItemQuantity,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { addToCart, getOrCreateCart } from "../src/storefront/cart.ts";

/**
 * Free items added to the cart by themselves (buy X get Y with "add the free items automatically"): the third unit of
 * "buy 2 get 1 free", and a free gift when the cart passes a spend. Real database.
 */
let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let ctx: TenantContext;
let pickleVariant: string;
let pickleProduct: string;
let mugVariant: string;
let mugProduct: string;
let rareVariant: string;
let rareProduct: string;
let n = 0;

const errorOf = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e))?.message ?? null;
const ALL = { type: "all" } as const;

const buyer = (cartToken: string, phone: string) => ({
  cartToken,
  idempotencyKey: `idem_${cartToken}`,
  email: `buyer${phone}@autoadd.example`,
  phone,
  fullName: "Test Buyer",
  addressLine1: "1 Test Street",
  city: "Testville",
  state: "Karnataka",
  pincode: "560001",
  paymentMethod: "cod" as const,
});

const newCart = async () => (await getOrCreateCart(rtWeb, ctx, `tok-aa-${++n}`)).token;
const lineOf = (cart: Awaited<ReturnType<typeof getOrCreateCart>>, variantId: string) => cart.items.find((i) => i.variantId === variantId);

/** Switches off every discount so each test sees only what it creates. */
async function clearDiscounts() {
  await rt._db.db.execute(sql`update discounts set status = 'disabled' where tenant_id = ${ctx.tenantId}::uuid`);
}

async function productOf(variantId: string) {
  return (await rt._db.db.select({ id: schema.variants.productId }).from(schema.variants).where(eq(schema.variants.id, variantId)))[0]!.id;
}

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const t = await provisionTenant(rt, { storeName: "aa-a", slug: "aa-a", owner: { email: "owner@aa-a.test", name: "A" }, planCode: "growth", source: "platform_admin" });
  ctx = {
    tenantId: t.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: t.ownerId },
    roles: ["store_owner"],
    permissions: ["products.read", "products.write", "orders.read", "orders.write", "discounts.write", "settings.write"],
    requestId: "req-autoadd",
  };
  const cat = await primaryCategory(rtWeb, ctx);
  await createProduct(rtWeb, ctx, { title: "Pickle", status: "active", primaryCategoryId: cat, variants: [{ sku: "AA-PICKLE", title: "Default", price: 10000 }] });
  await createProduct(rtWeb, ctx, { title: "Mug", status: "active", primaryCategoryId: cat, variants: [{ sku: "AA-MUG", title: "Default", price: 5000 }] });
  await createProduct(rtWeb, ctx, { title: "Rare", status: "active", primaryCategoryId: cat, variants: [{ sku: "AA-RARE", title: "Default", price: 7000 }] });
  const levels = (await listInventoryLevels(rtWeb, ctx, {})).items;
  const idOf = (sku: string) => levels.find((l) => l.variantSku === sku)!;
  pickleVariant = idOf("AA-PICKLE").variantId;
  mugVariant = idOf("AA-MUG").variantId;
  rareVariant = idOf("AA-RARE").variantId;
  const locationId = idOf("AA-PICKLE").locationId;
  await adjustInventory(rtWeb, ctx, { variantId: pickleVariant, locationId, quantityDelta: 100, reason: "received" });
  await adjustInventory(rtWeb, ctx, { variantId: mugVariant, locationId, quantityDelta: 100, reason: "received" });
  // "Rare" is deliberately left with no stock.
  pickleProduct = await productOf(pickleVariant);
  mugProduct = await productOf(mugVariant);
  rareProduct = await productOf(rareVariant);
}, 240_000);

afterAll(async () => {
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

/** "Buy 2 get 1 free" on the pickle. */
const buy2get1 = (extra: Record<string, unknown> = {}) => ({
  title: "Buy 2 Pickle get 1 free",
  type: "buy_x_get_y" as const,
  value: 0,
  rules: {
    bxgy: {
      buy: { trigger: "quantity" as const, value: 2, appliesTo: { type: "products" as const, productIds: [pickleProduct] } },
      get: { quantity: 1, appliesTo: { type: "products" as const, productIds: [pickleProduct] }, effect: "free" as const },
      ...extra,
    },
  },
});

describe("buy 2 get 1 free adds the third item by itself", () => {
  it("two in the cart become three, the third shown free, and it follows the shopper's changes", async () => {
    await clearDiscounts();
    await createAdminDiscount(rtWeb, ctx, buy2get1());
    const token = await newCart();

    const one = await addToCart(rtWeb, ctx, { token, variantId: pickleVariant, quantity: 1 });
    expect(lineOf(one, pickleVariant)).toMatchObject({ quantity: 1, autoFreeQty: 0 });
    expect(one.discounts).toEqual([]);

    const two = await addToCart(rtWeb, ctx, { token, variantId: pickleVariant, quantity: 1 });
    expect(lineOf(two, pickleVariant)).toMatchObject({ quantity: 3, autoFreeQty: 1 });
    expect(two.discount).toMatchObject({ amount: 10000, automatic: true, discountClass: "product" });
    expect(two.subtotal).toBe(30000);

    // One more of their own: three paid, one free.
    const item = lineOf(two, pickleVariant)!;
    const more = await updateCartItemQuantity(rtWeb, ctx, { token, itemId: item.id, quantity: 4 });
    expect(lineOf(more, pickleVariant)).toMatchObject({ quantity: 4, autoFreeQty: 1 });
    // Four of their own: two free.
    const four = await updateCartItemQuantity(rtWeb, ctx, { token, itemId: item.id, quantity: 5 });
    expect(lineOf(four, pickleVariant)).toMatchObject({ quantity: 6, autoFreeQty: 2 });
    expect(four.discount?.amount).toBe(20000);

    // Back to one: the free item goes.
    const back = await updateCartItemQuantity(rtWeb, ctx, { token, itemId: item.id, quantity: 1 });
    expect(lineOf(back, pickleVariant)).toMatchObject({ quantity: 1, autoFreeQty: 0 });
    expect(back.discounts).toEqual([]);
  });

  it("the free item is charged as free at checkout and reserved from stock", async () => {
    const token = await newCart();
    await addToCart(rtWeb, ctx, { token, variantId: pickleVariant, quantity: 2 });
    const placed = await placeOrder(rtWeb, ctx, buyer(token, "9400000001"));
    expect(placed).toMatchObject({ subtotal: 30000, discountTotal: 10000 }); // three units, one free
    const items = await rt._db.db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, placed.orderId));
    expect(items.map((i) => [i.sku, i.quantity, i.discountAmount])).toEqual([["AA-PICKLE", 3, 10000]]);
  });

  it("removing the line removes the free item with it, and it does not come back on its own", async () => {
    const token = await newCart();
    const cart = await addToCart(rtWeb, ctx, { token, variantId: pickleVariant, quantity: 2 });
    const gone = await removeCartItem(rtWeb, ctx, { token, itemId: lineOf(cart, pickleVariant)!.id });
    expect(gone.items).toEqual([]);
  });

  it("an offer that was turned on after the shopper filled the cart still gives the item when the cart is opened", async () => {
    await clearDiscounts();
    const token = await newCart();
    await addToCart(rtWeb, ctx, { token, variantId: pickleVariant, quantity: 2 });
    await createAdminDiscount(rtWeb, ctx, buy2get1());
    expect(lineOf(await getOrCreateCart(rtWeb, ctx, token), pickleVariant)).toMatchObject({ quantity: 3, autoFreeQty: 1 });
  });

  it("an offer switched off takes the free item out again", async () => {
    const token = await newCart();
    await addToCart(rtWeb, ctx, { token, variantId: pickleVariant, quantity: 2 });
    await clearDiscounts();
    expect(lineOf(await getOrCreateCart(rtWeb, ctx, token), pickleVariant)).toMatchObject({ quantity: 2, autoFreeQty: 0 });
  });

  it("an offer set not to add items leaves the cart as the shopper made it", async () => {
    await clearDiscounts();
    await createAdminDiscount(rtWeb, ctx, buy2get1({ autoAdd: false }));
    const token = await newCart();
    const cart = await addToCart(rtWeb, ctx, { token, variantId: pickleVariant, quantity: 2 });
    expect(lineOf(cart, pickleVariant)).toMatchObject({ quantity: 2, autoFreeQty: 0 });
    expect(cart.discounts).toEqual([]);
  });

  it("a code for the offer adds the free item when it is applied", async () => {
    await clearDiscounts();
    await createAdminDiscount(rtWeb, ctx, { ...buy2get1(), code: "PICKLE3" });
    const token = await newCart();
    await addToCart(rtWeb, ctx, { token, variantId: pickleVariant, quantity: 2 });
    const applied = await applyCartDiscount(rtWeb, ctx, { token, code: "pickle3" });
    expect(lineOf(applied, pickleVariant)).toMatchObject({ quantity: 3, autoFreeQty: 1 });
    expect(applied.discount).toMatchObject({ code: "PICKLE3", amount: 10000 });
    // not enough in the cart: refused and nothing changes
    const short = await newCart();
    await addToCart(rtWeb, ctx, { token: short, variantId: pickleVariant, quantity: 1 });
    expect(await errorOf(applyCartDiscount(rtWeb, ctx, { token: short, code: "PICKLE3" }))).toMatch(/Add the items this offer needs/);
    expect(lineOf(await getOrCreateCart(rtWeb, ctx, short), pickleVariant)).toMatchObject({ quantity: 1, autoFreeQty: 0 });
  });
});

describe("a free gift when the cart is over an amount", () => {
  // Spend 200.00 on anything, get a mug free.
  const gift = (extra: Record<string, unknown> = {}, giftProduct = () => mugProduct) => ({
    title: "Free mug over 200",
    type: "buy_x_get_y" as const,
    value: 0,
    rules: {
      bxgy: {
        buy: { trigger: "amount" as const, value: 20000, appliesTo: ALL },
        get: { quantity: 1, appliesTo: { type: "products" as const, productIds: [giftProduct()] }, effect: "free" as const },
        ...extra,
      },
    },
  });

  it("the gift appears once the cart passes the amount, and goes when it drops below", async () => {
    await clearDiscounts();
    await createAdminDiscount(rtWeb, ctx, gift());
    const token = await newCart();

    const under = await addToCart(rtWeb, ctx, { token, variantId: pickleVariant, quantity: 1 }); // 100.00
    expect(lineOf(under, mugVariant)).toBeUndefined();

    const over = await addToCart(rtWeb, ctx, { token, variantId: pickleVariant, quantity: 1 }); // 200.00
    expect(lineOf(over, mugVariant)).toMatchObject({ quantity: 1, autoFreeQty: 1 });
    expect(over.discount).toMatchObject({ amount: 5000, automatic: true });
    expect(over.subtotal).toBe(25000); // two pickles and the mug

    const pickles = lineOf(over, pickleVariant)!;
    const dropped = await updateCartItemQuantity(rtWeb, ctx, { token, itemId: pickles.id, quantity: 1 });
    expect(lineOf(dropped, mugVariant)).toBeUndefined();
    expect(dropped.discounts).toEqual([]);
  });

  it("is free at checkout: the shopper pays for the pickles only", async () => {
    const token = await newCart();
    await addToCart(rtWeb, ctx, { token, variantId: pickleVariant, quantity: 2 });
    const placed = await placeOrder(rtWeb, ctx, buyer(token, "9400000002"));
    expect(placed).toMatchObject({ subtotal: 25000, discountTotal: 5000 });
    const items = await rt._db.db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, placed.orderId));
    expect(items.map((i) => [i.sku, i.quantity, i.discountAmount]).sort()).toEqual([["AA-MUG", 1, 5000], ["AA-PICKLE", 2, 0]]);
  });

  it("when the shopper already has the gift product, it becomes one more of it, free", async () => {
    const token = await newCart();
    await addToCart(rtWeb, ctx, { token, variantId: mugVariant, quantity: 1 }); // their own mug
    const cart = await addToCart(rtWeb, ctx, { token, variantId: pickleVariant, quantity: 2 });
    expect(lineOf(cart, mugVariant)).toMatchObject({ quantity: 2, autoFreeQty: 1 });
  });

  it("is not added when the gift is out of stock", async () => {
    await clearDiscounts();
    await createAdminDiscount(rtWeb, ctx, gift({}, () => rareProduct));
    const token = await newCart();
    const cart = await addToCart(rtWeb, ctx, { token, variantId: pickleVariant, quantity: 2 });
    expect(lineOf(cart, rareVariant)).toBeUndefined();
    expect(cart.discounts).toEqual([]);
  });

  it("is checked when it is saved: only a free offer can add items", async () => {
    const bad = (p: Promise<unknown>) => errorOf(p);
    expect(
      await bad(
        createAdminDiscount(rtWeb, ctx, {
          title: "Half price add",
          type: "buy_x_get_y",
          value: 0,
          rules: { bxgy: { autoAdd: true, buy: { trigger: "quantity", value: 1, appliesTo: ALL }, get: { quantity: 1, appliesTo: ALL, effect: "percent", value: 50 } } },
        }),
      ),
    ).toMatch(/only a free offer can add items/);
  });
});

describe("offers worded for the product page", () => {
  it("lists the automatic offers a product can earn, worded for the shopper", async () => {
    await clearDiscounts();
    await createAdminDiscount(rtWeb, ctx, buy2get1());
    await createAdminDiscount(rtWeb, ctx, {
      title: "Free mug over 200",
      type: "buy_x_get_y",
      value: 0,
      rules: { bxgy: { buy: { trigger: "amount", value: 20000, appliesTo: ALL }, get: { quantity: 1, appliesTo: { type: "products", productIds: [mugProduct] }, effect: "free" } } },
    });
    const onPickle = await getStorefrontProductOffers(rtWeb, ctx, pickleProduct);
    expect(onPickle.map((o) => o.headline)).toEqual(["Buy 2 Get 1 Free", expect.stringMatching(/Spend .*200.* get Mug free/)]);
    expect(onPickle.every((o) => o.autoAdd)).toBe(true);
    // the mug is not one of the items the first offer asks to buy, but the spend offer counts any item
    const onMug = await getStorefrontProductOffers(rtWeb, ctx, mugProduct);
    expect(onMug.map((o) => o.headline)).toEqual([expect.stringMatching(/Spend .*200.* get Mug free/)]);
  });

  it("leaves out offers that need a code, are switched off, or do not add items by themselves is still shown but flagged", async () => {
    await clearDiscounts();
    await createAdminDiscount(rtWeb, ctx, { ...buy2get1(), code: "NEEDSCODE" });
    expect(await getStorefrontProductOffers(rtWeb, ctx, pickleProduct)).toEqual([]);
    await createAdminDiscount(rtWeb, ctx, buy2get1({ autoAdd: false }));
    const shown = await getStorefrontProductOffers(rtWeb, ctx, pickleProduct);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ headline: "Buy 2 Get 1 Free", autoAdd: false });
    await clearDiscounts();
    expect(await getStorefrontProductOffers(rtWeb, ctx, pickleProduct)).toEqual([]);
  });
});
