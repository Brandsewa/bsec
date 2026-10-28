import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { desc, eq, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { STORE_PERMISSIONS } from "@bs/auth";
import {
  createRuntime,
  getPlanAndBilling,
  getPlatformBillingSettings,
  handlePayPalBillingWebhook,
  listAvailablePlans,
  provisionTenant,
  subscribeToPlan,
  testPlatformBillingConnection,
  updatePlatformBillingSettings,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { runBillingDunningSweep } from "../src/saas/dunning.ts";
import { enforceExtraMarketsQuota } from "../src/markets/service.ts";

/**
 * ADR-040 WP-5: PayPal platform billing for global merchants (Orders v2 link fallback).
 * Real database; PayPal API calls faked at fetch.
 */

let env: TestDb;
let rt: Runtime;
let owner: string;
let seq = 0;

const PAYPAL_SECRET = "mock_paypal_platform_secret";
const PAYPAL_CLIENT_ID = "mock_paypal_client_id";
const PAYPAL_WEBHOOK_ID = "mock_webhook_id";

async function resetBilling() {
  await rt._db.db.execute(sql`DELETE FROM platform_billing_settings`);
}

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}
let calls: Call[] = [];

function fakePayPal() {
  calls = [];
  return vi.spyOn(globalThis, "fetch").mockImplementation((async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    let body: Record<string, unknown> = {};
    if (init?.body && typeof init.body === "string") {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        body = { raw: init.body };
      }
    }
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, body });

    // OAuth token endpoint
    if (url.includes("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "mock_paypal_access_token", token_type: "Bearer", expires_in: 3600 }), { status: 200 });
    }

    // Orders v2 create endpoint
    if (url.includes("/v2/checkout/orders") && init?.method === "POST") {
      const orderId = `ORDER-PAYPAL-${++seq}`;
      return new Response(
        JSON.stringify({
          id: orderId,
          status: "CREATED",
          links: [
            { rel: "self", href: `https://api.sandbox.paypal.com/v2/checkout/orders/${orderId}` },
            { rel: "approve", href: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}` },
          ],
        }),
        { status: 201 },
      );
    }

    // Webhook signature verify
    if (url.includes("/v1/notifications/verify-webhook-signature")) {
      return new Response(JSON.stringify({ verification_status: "SUCCESS" }), { status: 200 });
    }

    return new Response("{}", { status: 200 });
  }) as typeof fetch);
}

/** The PayPal order id the subscription row stored when the checkout link was made. */
async function storedOrderId(tenantId: string): Promise<string> {
  const [row] = await rt._db.db.select({ id: schema.subscriptions.providerSubscriptionId }).from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, tenantId));
  if (!row?.id) throw new Error("the subscription has no provider order id");
  return row.id;
}

async function makeStore(country = "US") {
  const slug = `pp-store-${++seq}`;
  const r = await provisionTenant(rt, {
    storeName: slug,
    slug,
    planCode: "starter",
    owner: { email: `owner-${slug}@test.com`, name: "Owner Global" },
    source: "platform_admin",
  });

  // Set country
  await rt._db.db.update(schema.tenants).set({ country }).where(eq(schema.tenants.id, r.tenantId));

  const ctx: TenantContext = {
    tenantId: r.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: r.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: `req-${slug}`,
  };
  return { ...r, ctx };
}

const enablePayPal = () =>
  updatePlatformBillingSettings(rt, owner, {
    provider: "paypal",
    enabled: true,
    paypal: {
      test: {
        clientId: PAYPAL_CLIENT_ID,
        clientSecret: PAYPAL_SECRET,
        webhookId: PAYPAL_WEBHOOK_ID,
      },
    },
  });

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  owner = (await seedPlatformStaff(rt._db.db, { email: "pp-owner@platform.test", role: "platform_owner" })).userId;
  await resetBilling();
}, 180_000);

afterAll(async () => {
  await env?.stop();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WP-5: PayPal platform billing for global merchants", () => {
  it("tests platform paypal connection and updates credentials", async () => {
    fakePayPal();
    // First save credentials
    await enablePayPal();
    const settings = await getPlatformBillingSettings(rt, owner);
    expect(settings.provider).toBe("paypal");
    expect(settings.paypal?.test?.secretConfigured).toBe(true);
    expect(settings.paypal?.test?.keyId).toBe(PAYPAL_CLIENT_ID);

    const connResult = await testPlatformBillingConnection(rt, owner, {
      provider: "paypal",
      mode: "test",
    }, undefined, fetch);
    expect(connResult.ok).toBe(true);
  });

  it("global merchant sees USD pricing and subscribes via PayPal Orders v2", async () => {
    fakePayPal();
    await enablePayPal();

    const store = await makeStore("US");
    const view = await getPlanAndBilling(rt, store.ctx);

    expect(view.billing.provider).toBe("paypal");
    expect(view.billing.currency).toBe("USD");

    const plans = await listAvailablePlans(rt, store.ctx);
    expect(plans.find((p) => p.code === "starter")?.priceMonthlyUsdCents).toBeDefined();

    // Subscribe to starter plan
    const subResult = await subscribeToPlan(rt, store.ctx, {
      planCode: "starter",
      interval: "monthly",
    });

    expect(subResult.checkoutUrl).toContain("https://www.sandbox.paypal.com/checkoutnow?token=");
  });

  it("Indian merchant retains INR pricing and does not get PayPal provider", async () => {
    fakePayPal();
    // Configure cashfree or razorpay as platform default
    await updatePlatformBillingSettings(rt, owner, {
      provider: "cashfree",
      enabled: true,
      cashfree: { test: { clientId: "TEST1000", clientSecret: "cf_secret_123" } },
    });

    const store = await makeStore("IN");
    const view = await getPlanAndBilling(rt, store.ctx);

    expect(view.billing.currency).toBe("INR");
    // Even if global merchants use PayPal, IN merchants stay on Cashfree / Razorpay
    expect(view.billing.provider).toBe("cashfree");
  });

  it("processes PAYMENT.CAPTURE.COMPLETED webhook and activates subscription", async () => {
    fakePayPal();
    await enablePayPal();

    const store = await makeStore("US");
    await subscribeToPlan(rt, store.ctx, {
      planCode: "starter",
      interval: "monthly",
    });

    const webhookPayload = {
      id: `WH-EVENT-${++seq}`,
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: {
        id: `CAPTURE-${seq}`,
        status: "COMPLETED",
        amount: {
          value: "29.00",
          currency_code: "USD",
        },
        custom_id: JSON.stringify({ tenant_id: store.tenantId, plan_code: "starter" }),
        supplementary_data: {
          related_ids: {
            order_id: await storedOrderId(store.tenantId),
          },
        },
      },
    };

    const res = await handlePayPalBillingWebhook(
      rt,
      {
        headers: {
          "paypal-auth-algo": "SHA256withRSA",
          "paypal-cert-url": "https://api.sandbox.paypal.com/cert",
          "paypal-transmission-id": "trans-1",
          "paypal-transmission-sig": "sig-1",
          "paypal-transmission-time": new Date().toISOString(),
        },
        rawBody: JSON.stringify(webhookPayload),
        verifySignatureFn: async () => true,
    },
    );

    expect(res.actionTaken).toBe("subscription_activated_and_invoiced");

    // Subscription should now be active
    const [subRow] = await rt._db.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.tenantId, store.tenantId))
      .orderBy(desc(schema.subscriptions.createdAt))
      .limit(1);
    expect(subRow?.status).toBe("active");
  });

  it("handles failed payment / capture decline and dunning limiting suspends store and disables extra markets", async () => {
    fakePayPal();
    await enablePayPal();

    const store = await makeStore("US");
    await subscribeToPlan(rt, store.ctx, {
      planCode: "starter",
      interval: "monthly",
    });

    // 1. PAYMENT.CAPTURE.DECLINED webhook
    const declinePayload = {
      id: `WH-EVENT-DECLINE-${++seq}`,
      event_type: "PAYMENT.CAPTURE.DECLINED",
      resource: {
        id: `CAPTURE-DECLINE-${seq}`,
        status: "DECLINED",
        supplementary_data: {
          related_ids: {
            order_id: await storedOrderId(store.tenantId),
          },
        },
      },
    };

    const res = await handlePayPalBillingWebhook(
      rt,
      {
        headers: {},
        rawBody: JSON.stringify(declinePayload),
        verifySignatureFn: async () => true,
    },
    );

    expect(res.actionTaken).toBe("subscription_past_due");
    const [after] = await rt._db.db.select({ status: schema.subscriptions.status }).from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, store.tenantId));
    expect(after?.status).toBe("past_due");

    // 2. Add extra markets for this store to test quota downgrade enforcement
    const [m1] = await rt._db.db
      .insert(schema.markets)
      .values({
        tenantId: store.tenantId,
        handle: "ca",
        name: "Canada",
        currency: "CAD",
        isBase: false,
        status: "active",
      })
      .returning();

    const [m2] = await rt._db.db
      .insert(schema.markets)
      .values({
        tenantId: store.tenantId,
        handle: "uk",
        name: "United Kingdom",
        currency: "GBP",
        isBase: false,
        status: "active",
      })
      .returning();

    expect(m1?.status).toBe("active");
    expect(m2?.status).toBe("active");

    // Set subscription past due and trigger dunning to stage 3 (limited)
    await rt._db.db
      .update(schema.subscriptions)
      .set({
        status: "past_due",
        pastDueSince: new Date(Date.now() - 10 * 86400_000), // 10 days ago (past 7-day grace period)
        providerSubscriptionId: "ORDER-PAYPAL-DECLINED-1",
        dunningStage: 2,
      })
      .where(eq(schema.subscriptions.tenantId, store.tenantId));

    const sweepResult = await runBillingDunningSweep(rt);
    expect(sweepResult.limited).toBeGreaterThanOrEqual(1);

    // Verify markets: extra markets should have been disabled (maxAllowed = 0 when limited)
    const markets = await rt._db.db
      .select()
      .from(schema.markets)
      .where(eq(schema.markets.tenantId, store.tenantId));

    const extraMarkets = markets.filter((m) => !m.isBase);
    expect(extraMarkets.every((m) => m.status === "disabled")).toBe(true);
  });

  it("enforces extra markets quota newest-first when downgrading", async () => {
    const store = await makeStore("US");

    // Insert 3 extra markets with distinct creation times
    const [older] = await rt._db.db
      .insert(schema.markets)
      .values({
        tenantId: store.tenantId,
        handle: "de",
        name: "Germany",
        currency: "EUR",
        isBase: false,
        status: "active",
        createdAt: new Date(Date.now() - 100_000),
      })
      .returning();

    const [newer] = await rt._db.db
      .insert(schema.markets)
      .values({
        tenantId: store.tenantId,
        handle: "fr",
        name: "France",
        currency: "EUR",
        isBase: false,
        status: "active",
        createdAt: new Date(Date.now() - 50_000),
      })
      .returning();

    const [newest] = await rt._db.db
      .insert(schema.markets)
      .values({
        tenantId: store.tenantId,
        handle: "jp",
        name: "Japan",
        currency: "JPY",
        isBase: false,
        status: "active",
        createdAt: new Date(),
      })
      .returning();

    // Now enforce quota of 1 extra market
    await rt._db.db.transaction(async (tx) => {
      await enforceExtraMarketsQuota(tx, store.tenantId, 1);
    });

    const refreshed = await rt._db.db
      .select()
      .from(schema.markets)
      .where(eq(schema.markets.tenantId, store.tenantId));

    const deMarket = refreshed.find((m) => m.id === older!.id);
    const frMarket = refreshed.find((m) => m.id === newer!.id);
    const jpMarket = refreshed.find((m) => m.id === newest!.id);

    // Oldest active extra market remains active
    expect(deMarket?.status).toBe("active");
    // Newer extra markets disabled newest first
    expect(frMarket?.status).toBe("disabled");
    expect(jpMarket?.status).toBe("disabled");
  });
});
