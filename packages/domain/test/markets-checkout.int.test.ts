/**
 * Integration: a store with a second market sells in that market's currency (ADR-040): market prices, zones, gateways, tax,
 * order snapshot, PayPal payment and settlement checks, all against a real Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { STORE_PERMISSIONS } from "@bs/auth";
import {
  acknowledgeMarketCompliance,
  addToCart,
  confirmHostedReturn,
  createMarket,
  createRuntime,
  getOrCreateCart,
  placeOrder,
  provisionTenant,
  savePayPalCredentials,
  setMarketPaymentMethods,
  setMarketPolicy,
  setMarketStatus,
  setMarketTaxRules,
  setPaymentProviderActive,
  startHostedPayment,
  testPaymentProviderConnection,
  updateMarket,
  updatePlatformPaymentProvider,
  type PlaceOrderInput,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

let env: TestDb;
let rtPlatform: Runtime;
let rtWeb: Runtime;
let ctx: TenantContext;
let usId = "";
let variantId = "";
let pg: import("pg").Client;

const paypalFetch = (opts: { captureCurrency?: string; captureValue?: string } = {}): typeof fetch =>
  (async (url: string) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/v1/oauth2/token")) return json({ access_token: "tok", expires_in: 3600 });
    if (url.endsWith("/v2/checkout/orders")) return json({ id: "PPORDER1", status: "PAYER_ACTION_REQUIRED", links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=PPORDER1" }] });
    if (url.endsWith("/capture")) {
      return json({
        status: "COMPLETED",
        purchase_units: [{ payments: { captures: [{ id: "CAP1", status: "COMPLETED", amount: { currency_code: opts.captureCurrency ?? "USD", value: opts.captureValue ?? "48.58" } }] } }],
      });
    }
    return json({ message: "no route" }, 404);
  }) as unknown as typeof fetch;

const usOrder = (cartToken: string, over: Partial<PlaceOrderInput> = {}): PlaceOrderInput => ({
  cartToken,
  email: "buyer@example.com",
  phone: "415-555-2671",
  fullName: "Sam Buyer",
  addressLine1: "1 Market St",
  city: "San Francisco",
  state: "CA",
  pincode: "94103",
  country: "US",
  paymentMethod: "paypal",
  ...over,
});

async function readOrder(orderId: string) {
  return withTenant(rtWeb._db.db, ctx.tenantId, async (tx) => (await tx.select().from(schema.orders).where(and(eq(schema.orders.tenantId, ctx.tenantId), eq(schema.orders.id, orderId))))[0]);
}

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 8 });
  const adminId = (await seedPlatformStaff(rtPlatform._db.db, { email: "mm-admin@platform.test", role: "platform_admin" })).userId;
  const t = await provisionTenant(rtPlatform, {
    storeName: "Multi Market Store",
    slug: "mm-store",
    owner: { email: "owner@mm.test", name: "Owner" },
    planCode: "growth",
    source: "platform_admin",
  });
  ctx = { tenantId: t.tenantId, storeStatus: "live", actor: { type: "staff", userId: t.ownerId }, roles: ["store_owner"], permissions: [...STORE_PERMISSIONS], requestId: "req-mm" };

  const PG = (await import("pg")).default;
  pg = new PG.Client({ connectionString: env.superUrl });
  await pg.connect();
  const productId = crypto.randomUUID();
  variantId = crypto.randomUUID();
  const [loc] = (await pg.query(`select id from locations where tenant_id = $1 limit 1`, [ctx.tenantId])).rows as { id: string }[];
  await pg.query(`insert into products (id, tenant_id, title, slug, status) values ($1, $2, 'Desk Lamp', 'desk-lamp', 'published')`, [productId, ctx.tenantId]);
  await pg.query(`insert into variants (id, tenant_id, product_id, sku, title, price) values ($1, $2, $3, 'LAMP', 'Default', 149900)`, [variantId, ctx.tenantId, productId]);
  await pg.query(`insert into inventory_levels (tenant_id, variant_id, location_id, on_hand, reserved) values ($1, $2, $3, 50, 0)`, [ctx.tenantId, variantId, loc!.id]);

  // PayPal: platform switch on (sandbox only), the store's own app connected, tested and activated.
  await updatePlatformPaymentProvider(rtPlatform, adminId, { provider: "paypal", enabled: true });
  await savePayPalCredentials(rtWeb, ctx, { clientId: "AclientIdForTests1234567890", clientSecret: "EsecretForTests1234567890", webhookId: "WH1234567890AB", mode: "test" });
  await testPaymentProviderConnection(rtWeb, ctx, "paypal", { fetchFn: paypalFetch() });
  await setPaymentProviderActive(rtWeb, ctx, "paypal", true);

  // A USD market: merchant rate 0.012, taxed like California, one US shipping rate, PayPal only.
  const us = await createMarket(rtWeb, ctx, { name: "United States", currency: "USD", countries: ["US"], fxRate: 0.012, taxDisplay: "exclusive" });
  usId = us.id;
  await setMarketPaymentMethods(rtWeb, ctx, usId, [{ provider: "paypal", enabled: true }]);
  const [zone] = (await pg.query(`insert into shipping_zones (tenant_id, name, countries, market_id, is_default) values ($1, 'United States', ARRAY['US'], $2, false) returning id`, [ctx.tenantId, usId])).rows as { id: string }[];
  await pg.query(`insert into shipping_rates (tenant_id, zone_id, name, method, rate_type, price_paise) values ($1, $2, 'Standard', 'standard', 'flat', 999)`, [ctx.tenantId, zone!.id]);
  await setMarketPolicy(rtWeb, ctx, usId, { returnSettings: null, cancellation: null, policyText: "30 day returns." });
  await updateMarket(rtWeb, ctx, usId, { taxCollect: true });
  await setMarketTaxRules(rtWeb, ctx, usId, [{ country: "US", region: "CA", taxName: "Sales tax", rateBps: 725 }]);
  await acknowledgeMarketCompliance(rtWeb, ctx, usId);
  await setMarketStatus(rtWeb, ctx, usId, "active");
}, 240_000);

afterAll(async () => {
  await pg?.end();
  await rtPlatform?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("a cart in a second market", () => {
  it("is created in the market's currency and priced from the market's prices", async () => {
    const cart = await getOrCreateCart(rtWeb, ctx, undefined, undefined, usId);
    expect(cart).toMatchObject({ currency: "USD", marketId: usId });
    const withItem = await addToCart(rtWeb, ctx, { token: cart.token, variantId, quantity: 2 });
    // 1,499.00 INR x 0.012 = 17.988 -> 17.99 USD each
    expect(withItem.items[0]!.unitPriceSnapshot).toBe(1799);
    expect(withItem.subtotal).toBe(3598);
  });

  it("reprices a base-market cart when the shopper switches market, and drops lines the market cannot sell", async () => {
    const base = await getOrCreateCart(rtWeb, ctx);
    expect(base.currency).toBe("INR");
    await addToCart(rtWeb, ctx, { token: base.token, variantId, quantity: 1 });
    const moved = await getOrCreateCart(rtWeb, ctx, base.token, undefined, usId);
    expect(moved).toMatchObject({ currency: "USD", marketId: usId });
    expect(moved.items[0]!.unitPriceSnapshot).toBe(1799);
    await pg.query(`delete from market_prices where tenant_id = $1 and market_id = $2 and variant_id = $3`, [ctx.tenantId, usId, variantId]);
    const moved2 = await getOrCreateCart(rtWeb, ctx, base.token, undefined, (await getBaseMarketId()));
    expect(moved2.currency).toBe("INR");
    await expect(getOrCreateCart(rtWeb, ctx, base.token, undefined, usId).then((c) => c.items.length)).resolves.toBe(0);
    // restore the derived price for the following tests
    await withTenant(rtWeb._db.db, ctx.tenantId, async () => undefined);
    await updateMarket(rtWeb, ctx, usId, { fxRate: 0.012 });
  });
});

async function getBaseMarketId(): Promise<string> {
  return ((await pg.query(`select id from markets where tenant_id = $1 and is_base`, [ctx.tenantId])).rows[0] as { id: string }).id;
}

describe("placing an order in the second market", () => {
  let orderId = "";
  let orderToken = "";

  it("charges market prices, market shipping and the merchant's tax in USD, and snapshots the market on the order", async () => {
    const cart = await getOrCreateCart(rtWeb, ctx, undefined, undefined, usId);
    await addToCart(rtWeb, ctx, { token: cart.token, variantId, quantity: 2 });
    const res = await placeOrder(rtWeb, ctx, usOrder(cart.token));
    orderId = res.orderId;
    orderToken = res.orderToken;
    // goods 2 x 17.99 = 35.98, shipping 9.99, California tax 7.25% of 35.98 = 2.61 (shipping not taxed) -> 48.58
    expect(res).toMatchObject({ currency: "USD", subtotal: 3598, shippingTotal: 999, grandTotal: 4858 });
    const o = await readOrder(orderId);
    expect(o).toMatchObject({ currency: "USD", marketId: usId, baseCurrency: "INR", taxTotal: 261, grandTotal: 4858 });
    expect(Number(o!.fxRate)).toBe(0.012);
    expect(o!.baseGrandTotal).toBe(Math.round((48.58 / 0.012) * 100));
    expect(o!.taxBreakdown).toEqual([{ name: "Sales tax", rateBps: 725, amount: 261 }]);
    expect(o!.policySnapshot).toMatchObject({ market: "united-states", text: "30 day returns." });
    const intents = await withTenant(rtWeb._db.db, ctx.tenantId, (tx) => tx.select().from(schema.paymentIntents).where(eq(schema.paymentIntents.orderId, orderId)));
    expect(intents[0]).toMatchObject({ provider: "paypal", currency: "USD", amount: 4858 });
  });

  it("refuses a gateway the market does not offer, and a country outside the market", async () => {
    const cart = await getOrCreateCart(rtWeb, ctx, undefined, undefined, usId);
    await addToCart(rtWeb, ctx, { token: cart.token, variantId, quantity: 1 });
    await expect(placeOrder(rtWeb, ctx, usOrder(cart.token, { paymentMethod: "cod" }))).rejects.toThrow(/not available in your region/);
    await expect(placeOrder(rtWeb, ctx, usOrder(cart.token, { country: "IN", state: "Karnataka", pincode: "560001", phone: "9876543210" }))).rejects.toThrow(/cannot be shipped to IN/);
    await expect(placeOrder(rtWeb, ctx, usOrder(cart.token, { pincode: "941" }))).rejects.toThrow(/ZIP/);
  });

  it("starts the PayPal payment with the server-side total and returns the hosted payment page", async () => {
    const started = await startHostedPayment(rtWeb, ctx.tenantId, orderId, "paypal", { baseUrl: "https://shop.example", orderToken }, { fetchFn: paypalFetch() });
    expect(started.checkoutUrl).toContain("paypal.com/checkoutnow");
    const intents = await withTenant(rtWeb._db.db, ctx.tenantId, (tx) => tx.select().from(schema.paymentIntents).where(eq(schema.paymentIntents.orderId, orderId)));
    expect(intents[0]!.providerOrderId).toBe("PPORDER1");
  });

  it("never settles a payment in the wrong currency or for the wrong amount", async () => {
    expect(await confirmHostedReturn(rtWeb, ctx.tenantId, "paypal", { orderToken, paypalOrderId: "PPORDER1" }, { fetchFn: paypalFetch({ captureCurrency: "CAD" }) })).toBe("ignored");
    expect(await confirmHostedReturn(rtWeb, ctx.tenantId, "paypal", { orderToken, paypalOrderId: "PPORDER1" }, { fetchFn: paypalFetch({ captureValue: "1.00" }) })).toBe("ignored");
    expect((await readOrder(orderId))!.paymentStatus).toBe("pending");
    const events = await withTenant(rtWeb._db.db, ctx.tenantId, (tx) => tx.select().from(schema.orderEvents).where(eq(schema.orderEvents.orderId, orderId)));
    expect(events.filter((e) => e.type === "payment.amount_mismatch")).toHaveLength(2);
  });

  it("refuses another order's PayPal approval, then settles once for the right amount and currency", async () => {
    await expect(confirmHostedReturn(rtWeb, ctx.tenantId, "paypal", { orderToken, paypalOrderId: "SOMEONE-ELSES" }, { fetchFn: paypalFetch() })).rejects.toThrow(/does not belong/);
    expect(await confirmHostedReturn(rtWeb, ctx.tenantId, "paypal", { orderToken, paypalOrderId: "PPORDER1" }, { fetchFn: paypalFetch() })).toBe("paid");
    expect(await confirmHostedReturn(rtWeb, ctx.tenantId, "paypal", { orderToken, paypalOrderId: "PPORDER1" }, { fetchFn: paypalFetch() })).toBe("already_paid");
    const o = await readOrder(orderId);
    expect(o).toMatchObject({ paymentStatus: "paid", status: "confirmed" });
  });
});

describe("the base market keeps working", () => {
  it("places an India COD order in INR with no market tax engine and the old GST path", async () => {
    const baseId = await getBaseMarketId();
    const cart = await getOrCreateCart(rtWeb, ctx, undefined, undefined, baseId);
    await addToCart(rtWeb, ctx, { token: cart.token, variantId, quantity: 1 });
    const res = await placeOrder(rtWeb, ctx, {
      cartToken: cart.token,
      email: "in@example.com",
      phone: "9876543210",
      fullName: "Asha",
      addressLine1: "5 Park Road",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560001",
      paymentMethod: "cod",
    });
    expect(res.currency).toBe("INR");
    const o = await readOrder(res.orderId);
    expect(o).toMatchObject({ currency: "INR", marketId: baseId, baseCurrency: "INR" });
    expect(o!.fxRate).toBeNull();
    expect(o!.baseGrandTotal).toBe(o!.grandTotal);
  });
});
