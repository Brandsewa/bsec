import { createHmac } from "node:crypto";
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
  handlePlatformBillingWebhook,
  listBillingPlans,
  provisionTenant,
  RazorpaySubscriptionProvider,
  resolveBillingGateways,
  subscribeToPlan,
  syncBillingPlans,
  updatePlatformBillingSettings,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

/**
 * Region defaults and backups (docs/EMBEDDED-CHECKOUT-PLAN.md 5.2): India Razorpay then Cashfree, outside India PayPal then
 * Razorpay (USD). Real database; the gateways' APIs are faked at fetch.
 */
let env: TestDb;
let rt: Runtime;
let owner: string;
let seq = 0;

const WEBHOOK_SECRET = "whsec_gateways_test_secret_1";
const provider = new RazorpaySubscriptionProvider({ webhookSecret: WEBHOOK_SECRET });
const sign = (raw: string) => createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");

async function resetBilling() {
  await rt._db.db.execute(sql`DELETE FROM platform_razorpay_plans`);
  await rt._db.db.execute(sql`DELETE FROM platform_billing_settings`);
}

interface Call {
  url: string;
  body: Record<string, unknown>;
}
let calls: Call[] = [];

/** Fakes Razorpay and PayPal. `failPayPal` makes PayPal refuse to create an order. */
function fakeGateways(opts: { failPayPal?: boolean; failRazorpaySubscription?: boolean } = {}) {
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
    calls.push({ url, body });
    if (url.endsWith("/v1/plans")) return new Response(JSON.stringify({ id: `plan_${++seq}` }), { status: 200 });
    if (url.endsWith("/v1/subscriptions")) {
      if (opts.failRazorpaySubscription) return new Response("nope", { status: 400 });
      return new Response(JSON.stringify({ id: `sub_${++seq}`, short_url: "https://rzp.io/i/test", status: "created" }), { status: 200 });
    }
    if (url.includes("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "tok", token_type: "Bearer", expires_in: 3600 }), { status: 200 });
    if (url.includes("/v2/checkout/orders") && init?.method === "POST") {
      if (opts.failPayPal) return new Response(JSON.stringify({ message: "boom" }), { status: 500 });
      const id = `ORDER-${++seq}`;
      return new Response(JSON.stringify({ id, status: "CREATED", links: [{ rel: "approve", href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }] }), { status: 201 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch);
}

async function makeStore(country: string) {
  const slug = `gw-store-${++seq}`;
  const r = await provisionTenant(rt, { storeName: slug, slug, planCode: "starter", owner: { email: `owner-${slug}@test.com`, name: "Owner" }, source: "platform_admin" });
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

/** Razorpay keys, PayPal keys and billing on; INR and USD plans synced. */
async function enableAll(extra: Parameters<typeof updatePlatformBillingSettings>[2] = {}) {
  await updatePlatformBillingSettings(rt, owner, {
    enabled: true,
    paypalEnabled: true,
    test: { keyId: "rzp_test_gw1", keySecret: "gw_secret_value" },
    paypal: { test: { clientId: "paypal_client_id_gw", clientSecret: "paypal_secret_gw", webhookId: "WH-GW" } },
    ...extra,
  });
  fakeGateways();
  await syncBillingPlans(rt, owner);
  await syncBillingPlans(rt, owner, undefined, undefined, { currency: "USD" });
  vi.restoreAllMocks();
}

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  owner = (await seedPlatformStaff(rt._db.db, { email: "gw-owner@platform.test", role: "platform_owner" })).userId;
  delete process.env.RAZORPAY_PLATFORM_KEY_ID;
  delete process.env.RAZORPAY_PLATFORM_KEY_SECRET;
  await resetBilling();
}, 180_000);

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await resetBilling();
  await rt?.close();
  await env?.stop();
});

describe("region gateway order", () => {
  it("defaults to Razorpay then Cashfree for India and PayPal then Razorpay outside India", async () => {
    await resetBilling();
    await enableAll();
    const s = await getPlatformBillingSettings(rt, owner);
    expect(s).toMatchObject({ provider: "razorpay", internationalProvider: "paypal", nationalBackupEnabled: true, internationalBackupEnabled: true });
    // Cashfree has no keys, so India has only Razorpay to try; outside India both are usable.
    expect(await resolveBillingGateways(rt._db.db, "national")).toEqual(["razorpay"]);
    expect(await resolveBillingGateways(rt._db.db, "international")).toEqual(["paypal", "razorpay"]);
  });

  it("the backup switch removes the backup, and the primary can be switched", async () => {
    await resetBilling();
    await enableAll();
    await updatePlatformBillingSettings(rt, owner, { internationalBackupEnabled: false });
    expect(await resolveBillingGateways(rt._db.db, "international")).toEqual(["paypal"]);
    await updatePlatformBillingSettings(rt, owner, { internationalBackupEnabled: true, internationalProvider: "razorpay" });
    expect(await resolveBillingGateways(rt._db.db, "international")).toEqual(["razorpay", "paypal"]);
  });

  it("refuses Razorpay as the international primary until Razorpay keys are saved", async () => {
    await resetBilling();
    await expect(updatePlatformBillingSettings(rt, owner, { internationalProvider: "razorpay" })).rejects.toThrow(/Razorpay test key id and secret/);
  });

  it("PayPal off leaves Razorpay as the only international gateway, and with the backup off there is none", async () => {
    await resetBilling();
    await enableAll();
    await updatePlatformBillingSettings(rt, owner, { paypalEnabled: false });
    expect(await resolveBillingGateways(rt._db.db, "international")).toEqual(["razorpay"]);
    await updatePlatformBillingSettings(rt, owner, { internationalBackupEnabled: false });
    expect(await resolveBillingGateways(rt._db.db, "international")).toEqual([]);
  });
});

describe("USD plans", () => {
  it("are synced separately from INR plans, in USD cents, and only when asked", async () => {
    await resetBilling();
    await updatePlatformBillingSettings(rt, owner, { enabled: true, test: { keyId: "rzp_test_gw1", keySecret: "gw_secret_value" } });
    fakeGateways();
    const inr = await syncBillingPlans(rt, owner);
    expect(inr.created).toBeGreaterThan(0);
    expect(calls.filter((c) => c.url.endsWith("/v1/plans")).every((c) => (c.body.item as { currency: string }).currency === "INR")).toBe(true);
    expect((await listBillingPlans(rt, owner)).plans.every((p) => !p.monthlyUsd.inSync || p.monthlyUsd.pricePaise <= 0)).toBe(true);

    calls = [];
    const usd = await syncBillingPlans(rt, owner, undefined, undefined, { currency: "USD" });
    expect(usd.created).toBeGreaterThan(0);
    const created = calls.filter((c) => c.url.endsWith("/v1/plans")).map((c) => c.body.item as { currency: string; amount: number });
    expect(created.every((i) => i.currency === "USD")).toBe(true);
    const starter = (await listBillingPlans(rt, owner)).plans.find((p) => p.code === "starter")!;
    expect(starter.monthlyUsd.inSync).toBe(true);
    expect(starter.monthly.inSync).toBe(true);
    // A second USD sync changes nothing.
    expect((await syncBillingPlans(rt, owner, undefined, undefined, { currency: "USD" })).created).toBe(0);
  });
});

describe("subscribing with a primary and a backup", () => {
  it("a store outside India goes to PayPal first, and the Razorpay USD plan is not touched", async () => {
    await resetBilling();
    await enableAll();
    const s = await makeStore("US");
    const view = await getPlanAndBilling(rt, s.ctx);
    expect(view.billing).toMatchObject({ provider: "paypal", currency: "USD", available: true });
    fakeGateways();
    const res = await subscribeToPlan(rt, s.ctx, { planCode: "starter", interval: "monthly" });
    expect(res.checkoutUrl).toContain("paypal.com/checkoutnow");
    expect(res.razorpayCheckout).toBeNull();
    expect(calls.some((c) => c.url.endsWith("/v1/subscriptions"))).toBe(false);
    const [sub] = await rt._db.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, s.tenantId)).orderBy(desc(schema.subscriptions.createdAt));
    expect(sub?.provider).toBe("paypal");
  });

  it("when PayPal cannot create the payment, Razorpay bills the store in USD and holds the only subscription", async () => {
    await resetBilling();
    await enableAll();
    const s = await makeStore("GB");
    fakeGateways({ failPayPal: true });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await subscribeToPlan(rt, s.ctx, { planCode: "starter", interval: "monthly" });
    expect(res.razorpayCheckout).toMatchObject({ subscriptionId: expect.stringMatching(/^sub_/), keyId: "rzp_test_gw1" });
    const sub = calls.find((c) => c.url.endsWith("/v1/subscriptions"))!;
    expect((sub.body.notes as Record<string, string>).currency).toBe("USD");
    const usdPlan = (await rt._db.db.select().from(schema.platformRazorpayPlans)).find((p) => p.currency === "USD" && p.razorpayPlanId === sub.body.plan_id);
    expect(usdPlan).toBeTruthy();
    const rows = await rt._db.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, s.tenantId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "razorpay", providerSubscriptionId: res.razorpayCheckout?.subscriptionId });
  });

  it("with Razorpay as the international primary a store outside India gets Razorpay first", async () => {
    await resetBilling();
    await enableAll({ internationalProvider: "razorpay" });
    const s = await makeStore("AE");
    fakeGateways();
    const res = await subscribeToPlan(rt, s.ctx, { planCode: "starter", interval: "yearly" });
    expect(res.razorpayCheckout).not.toBeNull();
    expect(calls.some((c) => c.url.includes("paypal"))).toBe(false);
  });

  it("with no USD plan synced, Razorpay refuses and the backup (PayPal) takes the store", async () => {
    await resetBilling();
    await updatePlatformBillingSettings(rt, owner, {
      enabled: true,
      paypalEnabled: true,
      internationalProvider: "razorpay",
      test: { keyId: "rzp_test_gw1", keySecret: "gw_secret_value" },
      paypal: { test: { clientId: "paypal_client_id_gw", clientSecret: "paypal_secret_gw", webhookId: "WH-GW" } },
    });
    const s = await makeStore("CA");
    fakeGateways();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await subscribeToPlan(rt, s.ctx, { planCode: "starter", interval: "monthly" });
    expect(res.razorpayCheckout).toBeNull();
    expect(res.checkoutUrl).toContain("paypal.com/checkoutnow");
  });

  it("with the backup off the primary's failure is reported and nothing is created", async () => {
    await resetBilling();
    await enableAll({ internationalBackupEnabled: false });
    const s = await makeStore("DE");
    fakeGateways({ failPayPal: true });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(subscribeToPlan(rt, s.ctx, { planCode: "starter", interval: "monthly" })).rejects.toThrow();
    expect(calls.some((c) => c.url.endsWith("/v1/subscriptions"))).toBe(false);
    expect(await rt._db.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, s.tenantId)).then((r) => r.filter((x) => x.providerSubscriptionId))).toHaveLength(0);
  });

  it("an Indian store stays on INR Razorpay", async () => {
    await resetBilling();
    await enableAll();
    const s = await makeStore("IN");
    fakeGateways();
    const res = await subscribeToPlan(rt, s.ctx, { planCode: "starter", interval: "monthly" });
    expect(res.razorpayCheckout).not.toBeNull();
    const sub = calls.find((c) => c.url.endsWith("/v1/subscriptions"))!;
    expect(sub.body.notes as Record<string, string>).not.toHaveProperty("currency");
    const plan = (await rt._db.db.select().from(schema.platformRazorpayPlans)).find((p) => p.razorpayPlanId === sub.body.plan_id);
    expect(plan?.currency).toBe("INR");
  });
});

describe("a USD Razorpay charge", () => {
  it("is invoiced in USD with no GST", async () => {
    await resetBilling();
    await enableAll();
    const s = await makeStore("US");
    fakeGateways({ failPayPal: true });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await subscribeToPlan(rt, s.ctx, { planCode: "starter", interval: "monthly" });
    const subId = res.razorpayCheckout!.subscriptionId;
    vi.restoreAllMocks();

    const raw = JSON.stringify({
      event: "subscription.charged",
      event_id: `evt_usd_${++seq}`,
      payload: {
        subscription: { entity: { id: subId, current_start: Math.floor(Date.now() / 1000), current_end: Math.floor(Date.now() / 1000) + 30 * 86400, notes: { tenant_id: s.tenantId, plan_code: "starter" } } },
        payment: { entity: { id: `pay_usd_${seq}`, amount: 1200, currency: "USD", notes: { tenant_id: s.tenantId } } },
      },
    });
    await handlePlatformBillingWebhook(rt, { rawBody: raw, signature: sign(raw), provider });
    const [inv] = await rt._db.db.select().from(schema.platformInvoices).where(eq(schema.platformInvoices.tenantId, s.tenantId));
    expect(inv).toMatchObject({ currency: "USD", amountPaise: 1200, taxPaise: 0 });
  });
});
