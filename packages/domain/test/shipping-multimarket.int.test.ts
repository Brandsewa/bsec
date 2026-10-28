import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { loadEmailOrder } from "../src/system/email-context.ts";
import {
  createRuntime,
  getAdminShippingSettings,
  saveAdminShippingZones,
  previewShippingRate,
  provisionTenant,
  syncVariantMarketPrices,
  type Runtime,
  type TenantContext,
  createMarket,
  setMarketStatus,
  getOrCreateCart,
  addToCart,
  placeOrder,
  setMarketPolicy,
  getOrderByActionToken,
  renderEmail,
  getOrderReturnsByToken,
  setMarketPaymentMethods,
  setMarketTaxRules,
  acknowledgeMarketCompliance,
  updatePlatformPaymentProvider,
  savePayPalCredentials,
  testPaymentProviderConnection,
  setPaymentProviderActive,
} from "../src/index.ts";
import { schema } from "@bs/db";
import { eq, and } from "drizzle-orm";

let env: TestDb;
let rt: Runtime;
let ctx: TenantContext;
let tenantId: string;
let ownerId: string;
let usMarketId: string;
let inMarketId: string;
let variantId: string;

const ctxFor = (tId: string, oId: string): TenantContext => ({
  tenantId: tId,
  storeStatus: "live",
  actor: { type: "staff", userId: oId },
  roles: ["store_owner"],
  permissions: ["settings.read", "shipping.manage", "markets.manage", "orders.read", "orders.manage", "returns.manage", "payments.manage"],
  requestId: "req_mm_wp3_test",
});

const paypalFetch = (): typeof fetch =>
  (async (url: string) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/v1/oauth2/token")) return json({ access_token: "tok", expires_in: 3600 });
    return json({ ok: true });
  }) as typeof fetch;

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  const adminId = (await seedPlatformStaff(rt._db.db, { email: "mm-wp3-admin@platform.test", role: "platform_admin" })).userId;

  const prov = await provisionTenant(rt, {
    storeName: "mm-ship-test",
    slug: "mm-ship-test",
    owner: { email: "owner-mm-ship@test.com", name: "Ship Owner" },
    planCode: "starter",
    source: "platform_admin",
  });
  tenantId = prov.tenantId;
  ownerId = prov.ownerId;
  ctx = ctxFor(tenantId, ownerId);

  // Read base market
  const baseMarkets = await rt._db.db
    .select()
    .from(schema.markets)
    .where(and(eq(schema.markets.tenantId, tenantId), eq(schema.markets.isBase, true)))
    .limit(1);
  inMarketId = baseMarkets[0]!.id;

  // Set up PayPal gateway for USD market testing
  await updatePlatformPaymentProvider(rt, adminId, { provider: "paypal", enabled: true });
  await savePayPalCredentials(rt, ctx, { clientId: "TestClientId1234567890", clientSecret: "TestSecret1234567890", webhookId: "WH1234567890AB", mode: "test" });
  await testPaymentProviderConnection(rt, ctx, "paypal", { fetchFn: paypalFetch() });
  await setPaymentProviderActive(rt, ctx, "paypal", true);

  // Create US Market (USD, imperial)
  const usMarket = await createMarket(rt, ctx, {
    name: "United States",
    currency: "USD",
    fxRate: 0.012,
    priceAdjustBps: 0,
    rounding: "none",
    taxDisplay: "exclusive",
    countries: ["US"],
    unitSystem: "imperial",
  });
  usMarketId = usMarket.id;

  // Satisfy readiness checks for activating US Market
  await setMarketPaymentMethods(rt, ctx, usMarketId, [{ provider: "paypal", enabled: true }]);
  await setMarketPolicy(rt, ctx, usMarketId, {
    policyText: "Original 30-day US returns policy text.",
    returnSettings: { returnWindowDays: 30, acceptReturns: true },
    cancellation: { allowCancellation: true, windowHours: 24 },
  });
  await setMarketTaxRules(rt, ctx, usMarketId, [{ country: "US", region: "NY", taxName: "Sales Tax", rateBps: 800 }]);
  await acknowledgeMarketCompliance(rt, ctx, usMarketId);

  // Add initial shipping zone for US market so readiness check passes
  const [usZone] = await rt._db.db
    .insert(schema.shippingZones)
    .values({
      tenantId,
      name: "United States Setup",
      marketId: usMarketId,
      countries: ["US"],
      isDefault: false,
    })
    .returning();
  await rt._db.db.insert(schema.shippingRates).values({
    tenantId,
    zoneId: usZone!.id,
    name: "Standard US",
    method: "standard",
    rateType: "flat",
    pricePaise: 999,
  });

  // Now activate US market
  await setMarketStatus(rt, ctx, usMarketId, "active");

  // Create product & variant in store
  const [loc] = await rt._db.db
    .select({ id: schema.locations.id })
    .from(schema.locations)
    .where(eq(schema.locations.tenantId, tenantId))
    .limit(1);

  const [product] = await rt._db.db
    .insert(schema.products)
    .values({
      tenantId,
      title: "Test T-Shirt",
      slug: "test-t-shirt",
      status: "published",
    })
    .returning();

  const [v] = await rt._db.db
    .insert(schema.variants)
    .values({
      tenantId,
      productId: product!.id,
      title: "Default",
      sku: "TSHIRT-DEF",
      price: 2000n, // 2000 cents = $20.00
      weightGrams: 454, // 1 lb
    })
    .returning();
  variantId = v!.id;

  if (loc) {
    await rt._db.db.insert(schema.inventoryLevels).values({
      tenantId,
      variantId,
      locationId: loc.id,
      onHand: 50,
      reserved: 0,
    });
  }

  // Sync market prices so the US market has prices derived for variantId
  await syncVariantMarketPrices(rt._db.db, tenantId, [variantId]);
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await env?.stop();
});

describe("WP-3: Multi-Market Shipping & Policy Surfaces Integration", () => {
  it("saves a US zone with a USD rate and weight tier in lb, and prices a US order", async () => {
    // 1. Get current shipping settings
    const currentSettings = await getAdminShippingSettings(rt, ctx);
    const defaultZone = currentSettings.zones.find((z) => z.isDefault)!;

    // 2. Save zones: Base India Zone + US Zone
    // US Zone: $9.99 flat (999 cents) under 2 lb (907 g), $14.99 (1499 cents) above 2 lb
    const saveRes = await saveAdminShippingZones(rt, ctx, {
      zones: [
        {
          id: defaultZone.id,
          name: "Domestic India",
          marketId: inMarketId,
          countries: ["IN"],
          states: [],
          isDefault: true,
          rates: [
            {
              name: "Standard Indian Delivery",
              method: "standard",
              rateType: "flat",
              pricePaise: 5000, // ₹50
              minDays: 3,
              maxDays: 5,
            },
          ],
        },
        {
          name: "United States Zone",
          marketId: usMarketId,
          countries: ["US"],
          states: [],
          isDefault: false,
          rates: [
            {
              name: "US Ground Standard",
              method: "standard",
              rateType: "weight_tier",
              minWeightGrams: 0,
              maxWeightGrams: 908, // ~2 lb
              pricePaise: 999, // $9.99
              minDays: 5,
              maxDays: 8,
            },
            {
              name: "US Heavy Standard",
              method: "standard",
              rateType: "weight_tier",
              minWeightGrams: 908, // 2 lb
              maxWeightGrams: null,
              pricePaise: 1499, // $14.99
              minDays: 5,
              maxDays: 8,
            },
          ],
        },
      ],
    });
    expect(saveRes.success).toBe(true);

    // 3. Preview rate for US order (weight 1 lb = 454 g)
    const previewLight = await previewShippingRate(rt, ctx, {
      marketId: usMarketId,
      destinationCountry: "US",
      subtotalPaise: 2000,
      weightGrams: 454,
    });
    expect(previewLight.zoneName).toBe("United States Zone");
    expect(previewLight.rates).toHaveLength(1);
    expect(previewLight.rates[0]!.title).toBe("US Ground Standard");
    expect(previewLight.rates[0]!.amountPaise).toBe(999);
    expect(previewLight.rates[0]!.trace).toContain("$9.99");

    // 4. Preview rate for heavier US order (weight 3 lb = 1361 g)
    const previewHeavy = await previewShippingRate(rt, ctx, {
      marketId: usMarketId,
      destinationCountry: "US",
      subtotalPaise: 4000,
      weightGrams: 1361,
    });
    expect(previewHeavy.rates[0]!.title).toBe("US Heavy Standard");
    expect(previewHeavy.rates[0]!.amountPaise).toBe(1499);
    expect(previewHeavy.rates[0]!.trace).toContain("$14.99");

    // 5. Verify domestic India single-market behavior remains unchanged
    const previewIn = await previewShippingRate(rt, ctx, {
      marketId: inMarketId,
      destinationCountry: "IN",
      subtotalPaise: 10000,
    });
    expect(previewIn.zoneName).toBe("Domestic India");
    expect(previewIn.rates[0]!.amountPaise).toBe(5000);
    expect(previewIn.rates[0]!.trace).toContain("₹50");
  });

  it("preserves order policy snapshot after merchant edits market policy", async () => {
    // 1. Create a cart in US Market and add the variant
    const cart = await getOrCreateCart(rt, ctx, undefined, undefined, usMarketId);
    await addToCart(rt, ctx, { token: cart.token, variantId, quantity: 1 });

    // 2. Place an order in US Market with the current policy snapshot
    const placed = await placeOrder(rt, ctx, {
      cartToken: cart.token,
      email: "shopper-us@test.com",
      phone: "415-555-2671",
      fullName: "US Shopper",
      addressLine1: "123 Broadway",
      city: "New York",
      state: "NY",
      country: "US",
      pincode: "10001",
      paymentMethod: "paypal",
    });
    expect(placed.orderId).toBeDefined();

    // 3. Verify order read-back includes the snapshotted policy text
    const orderBefore = await getOrderByActionToken(rt._db.db, ctx.tenantId, placed.orderToken);
    expect(orderBefore?.policySnapshot).toBeDefined();
    expect(orderBefore?.policySnapshot?.text).toBe("Original 30-day US returns policy text.");
    expect(orderBefore?.policySnapshot?.marketName).toBe("United States");

    // 4. Verify order email rendering includes the snapshot policy text
    const emailOrder = await loadEmailOrder(rt._db.db, ctx.tenantId, placed.orderId);
    expect(emailOrder?.policyText).toBe("Original 30-day US returns policy text.");
    const rendered = renderEmail(
      "order_confirmation",
      { storeName: "Test Store", baseUrl: "https://example.com" },
      { order: emailOrder! },
      "Your Order Confirmation",
    );
    expect(rendered.html).toContain("Original 30-day US returns policy text.");
    expect(rendered.text).toContain("Original 30-day US returns policy text.");

    // 5. Merchant updates market policy to a new 14-day policy
    await setMarketPolicy(rt, ctx, usMarketId, {
      policyText: "Updated 14-day US returns policy text with restocking fee.",
      returnSettings: { returnWindowDays: 14, acceptReturns: true },
      cancellation: { allowCancellation: false },
    });

    // 6. Old order's policy snapshot MUST remain unchanged!
    const orderAfter = await getOrderByActionToken(rt._db.db, ctx.tenantId, placed.orderToken);
    expect(orderAfter?.policySnapshot?.text).toBe("Original 30-day US returns policy text.");

    // 7. Email rendering of old order still uses the snapshot
    const emailOrderAfter = await loadEmailOrder(rt._db.db, ctx.tenantId, placed.orderId);
    expect(emailOrderAfter?.policyText).toBe("Original 30-day US returns policy text.");

    // 8. Return request flow verifies returns settings from the order's policy snapshot
    const returnsView = await getOrderReturnsByToken(rt, ctx.tenantId, placed.orderToken);
    expect(returnsView).not.toBeNull();
    expect(returnsView!.orderId).toBe(placed.orderId);
  });
});
