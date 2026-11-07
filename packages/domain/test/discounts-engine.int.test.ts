import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { primaryCategory } from "./helpers/primary-category.ts";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  adjustInventory,
  applyCartDiscount,
  createAdminDiscount,
  createMarket,
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
