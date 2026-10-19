import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { desc, eq, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { STORE_PERMISSIONS } from "@bs/auth";
import {
  cancelPlanSubscription,
  createRuntime,
  endDueCashfreeCancellations,
  getPlatformBillingSettings,
  handleCashfreeBillingWebhook,
  handlePlatformBillingWebhook,
  provisionTenant,
  subscribeToPlan,
  testPlatformBillingConnection,
  updatePlatformBillingSettings,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

/** ADR-037: Cashfree as the second platform billing gateway. Real database; Cashfree is faked at fetch. */

let env: TestDb;
let rt: Runtime;
let owner: string;
let seq = 0;

const CF_SECRET = "cfsk_ma_test_platform_secret_12345";
const errorOf = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e))?.message ?? null;

async function resetBilling() {
  await rt._db.db.execute(sql`DELETE FROM platform_razorpay_plans`);
  await rt._db.db.execute(sql`DELETE FROM platform_billing_settings`);
}

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}
let calls: Call[] = [];

function fakeCashfree() {
  calls = [];
  return vi.spyOn(globalThis, "fetch").mockImplementation((async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, body });
    if (url.endsWith("/pg/subscriptions")) {
      return new Response(JSON.stringify({ subscription_id: body.subscription_id, subscription_session_id: `sess_${++seq}`, subscription_status: "INITIALIZED" }), { status: 200 });
    }
    if (url.endsWith("/manage")) return new Response(JSON.stringify({ subscription_status: "CANCELLED" }), { status: 200 });
    if (url.includes("/orders/bs_connection_probe")) return new Response(JSON.stringify({ message: "order not found", code: "order_not_found" }), { status: 404 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch);
}

async function makeStore() {
  const slug = `cf-store-${++seq}`;
  const r = await provisionTenant(rt, { storeName: slug, slug, planCode: "starter", owner: { email: `owner-${slug}@test.com`, name: "Owner One" }, source: "platform_admin" });
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

const enableCashfree = () =>
  updatePlatformBillingSettings(rt, owner, { provider: "cashfree", enabled: true, cashfree: { test: { clientId: "TEST10000001", clientSecret: CF_SECRET } } });

const stamp = "1700000000";
const post = (payload: unknown, opts: { secret?: string } = {}) => {
  const rawBody = JSON.stringify(payload);
  const signature = createHmac("sha256", opts.secret ?? CF_SECRET).update(`${stamp}${rawBody}`).digest("base64");
  return { rawBody, signature, timestamp: stamp };
};

async function latestSub(tenantId: string) {
  const [s] = await rt._db.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, tenantId)).orderBy(desc(schema.subscriptions.createdAt)).limit(1);
  return s!;
}

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  owner = (await seedPlatformStaff(rt._db.db, { email: "cf-owner@platform.test", role: "platform_owner" })).userId;
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

describe("C1 Cashfree credentials in Super Admin", () => {
  it("saves keys encrypted and masked, never leaks the secret, and audits field names only", async () => {
    await updatePlatformBillingSettings(rt, owner, { cashfree: { test: { clientId: "TEST10000001", clientSecret: CF_SECRET } } });
    const v = await getPlatformBillingSettings(rt, owner);
    expect(v.provider).toBe("razorpay"); // saving keys does not switch the gateway
    expect(v.cashfree.test).toEqual({ keyId: "TEST10000001", secretConfigured: true, secretLastFour: "2345", webhookSecretConfigured: true });
    expect(v.cashfree.live.secretConfigured).toBe(false);
    expect(v.cashfreeWebhookUrl).toMatch(/\/api\/webhooks\/platform-billing\/cashfree$/);
    expect(JSON.stringify(v)).not.toContain(CF_SECRET);

    const audits = await rt._db.db.select().from(schema.platformAuditLogs).where(eq(schema.platformAuditLogs.action, "platform_billing.updated"));
    expect(JSON.stringify(audits)).not.toContain(CF_SECRET);
    expect(JSON.stringify(audits)).toContain("cashfree.test.clientSecret");
  });

  it("refuses a secret of the wrong mode, and switching to Cashfree without keys", async () => {
    expect(await errorOf(updatePlatformBillingSettings(rt, owner, { cashfree: { live: { clientId: "APP1", clientSecret: "cfsk_ma_test_oops_1234" } } }))).toMatch(/test secret/);
    await resetBilling();
    expect(await errorOf(updatePlatformBillingSettings(rt, owner, { provider: "cashfree" }))).toMatch(/save the Cashfree test App ID and secret/);
  });

  it("switches the active gateway and tests the connection read-only against the sandbox", async () => {
    await enableCashfree();
    fakeCashfree();
    const r = await testPlatformBillingConnection(rt, owner, {});
    expect(r).toEqual({ ok: true, mode: "test", provider: "cashfree" });
    expect(calls[0]!.url).toBe("https://sandbox.cashfree.com/pg/orders/bs_connection_probe");
    expect(calls[0]!.headers["x-client-id"]).toBe("TEST10000001");
    expect((await getPlatformBillingSettings(rt, owner)).provider).toBe("cashfree");

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    const bad = await testPlatformBillingConnection(rt, owner, {});
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/rejected/);
  });
});

describe("C2 subscribe, charge and cancel through Cashfree", () => {
  it("creates an inline-plan subscription that waits for the trial to end, needs a phone, and tags the store", async () => {
    await resetBilling();
    await enableCashfree();
    const store = await makeStore();
    fakeCashfree();

    expect(await errorOf(subscribeToPlan(rt, store.ctx, { planCode: "starter", interval: "monthly" }))).toMatch(/phone number/);
    expect(calls).toHaveLength(0);

    const res = await subscribeToPlan(rt, store.ctx, { planCode: "starter", interval: "monthly", phone: "+91 98765-43210", returnUrl: "https://evil.example.com/x" });
    expect(res.checkoutUrl).toBeNull();
    expect(res.checkoutSession).toMatchObject({ gateway: "cashfree", mode: "test" });
    expect(res.firstChargeAt).not.toBeNull(); // the 14-day trial is respected

    const call = calls.find((c) => c.url.endsWith("/pg/subscriptions"))!;
    const [starter] = await rt._db.db.select().from(schema.plans).where(eq(schema.plans.code, "starter"));
    expect(call.body).toMatchObject({
      customer_details: { customer_email: expect.stringContaining("@test.com"), customer_phone: "9876543210" },
      plan_details: { plan_type: "PERIODIC", plan_amount: starter!.priceMonthlyPaise / 100, plan_interval_type: "MONTH", plan_intervals: 1 },
      subscription_tags: { tenant_id: store.tenantId, plan_code: "starter" },
    });
    expect(call.body.subscription_first_charge_time).toBeTruthy();
    expect((call.body.subscription_meta as Record<string, unknown>).return_url).toBeUndefined(); // foreign return URLs are dropped
    const sub = await latestSub(store.tenantId);
    expect(sub).toMatchObject({ provider: "cashfree", status: "trialing", providerSubscriptionId: call.body.subscription_id });
  });

  it("verifies the signature, ignores the refunded authorisation payment, then activates and invoices once per payment", async () => {
    const store = await makeStore();
    fakeCashfree();
    await subscribeToPlan(rt, store.ctx, { planCode: "starter", interval: "yearly", phone: "9876543210" });
    const sub = await latestSub(store.tenantId);
    const subId = sub.providerSubscriptionId!;
    const [starter] = await rt._db.db.select().from(schema.plans).where(eq(schema.plans.code, "starter"));

    const wrong = post({ type: "SUBSCRIPTION_PAYMENT_SUCCESS", data: {} }, { secret: "other-secret" });
    expect(await errorOf(handleCashfreeBillingWebhook(rt, wrong))).toMatch(/Invalid platform billing webhook signature/);

    const auth = await handleCashfreeBillingWebhook(rt, post({ type: "SUBSCRIPTION_PAYMENT_SUCCESS", data: { subscription_id: subId, payment_type: "AUTH", cf_payment_id: 1, payment_amount: 1 } }));
    expect(auth.actionTaken).toBe("authorisation_payment_noted");
    expect((await latestSub(store.tenantId)).status).toBe("trialing");

    const charge = post({ type: "SUBSCRIPTION_PAYMENT_SUCCESS", data: { subscription_id: subId, payment_type: "CHARGE", cf_payment_id: 555001, payment_amount: starter!.priceYearlyPaise / 100 } });
    const first = await handleCashfreeBillingWebhook(rt, charge);
    expect(first.actionTaken).toBe("subscription_activated_and_invoiced");
    const dup = await handleCashfreeBillingWebhook(rt, charge);
    expect(dup.duplicate).toBe(true);

    const after = await latestSub(store.tenantId);
    expect(after.status).toBe("active");
    expect(after.currentPeriodEnd!.getUTCFullYear()).toBe(after.currentPeriodStart!.getUTCFullYear() + 1); // a yearly plan
    const invoices = await rt._db.db.select().from(schema.platformInvoices).where(eq(schema.platformInvoices.tenantId, store.tenantId));
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ amountPaise: starter!.priceYearlyPaise, providerPaymentId: "555001", status: "paid" });

    // The same payment arriving as a different event never makes a second invoice.
    await handleCashfreeBillingWebhook(rt, post({ type: "SUBSCRIPTION_PAYMENT_SUCCESS", data: { subscription_id: subId, payment_type: "CHARGE", cf_payment_id: 555001, payment_amount: starter!.priceYearlyPaise / 100, payment_remarks: "retry" } }));
    expect(await rt._db.db.select().from(schema.platformInvoices).where(eq(schema.platformInvoices.tenantId, store.tenantId))).toHaveLength(1);
  });

  it("marks a failed charge past due, and an authorised mandate does not activate the plan early", async () => {
    const store = await makeStore();
    fakeCashfree();
    await subscribeToPlan(rt, store.ctx, { planCode: "starter", interval: "monthly", phone: "9876543210" });
    const subId = (await latestSub(store.tenantId)).providerSubscriptionId!;

    const authorised = await handleCashfreeBillingWebhook(rt, post({ type: "SUBSCRIPTION_STATUS_CHANGED", data: { subscription_details: { subscription_id: subId, subscription_status: "ACTIVE" } } }));
    expect(authorised.actionTaken).toBe("subscription_authorised_noted");
    expect((await latestSub(store.tenantId)).status).toBe("trialing");

    await handleCashfreeBillingWebhook(rt, post({ type: "SUBSCRIPTION_PAYMENT_FAILED", data: { subscription_id: subId, payment_type: "CHARGE", cf_payment_id: 9, payment_amount: 100 } }));
    const failed = await latestSub(store.tenantId);
    expect(failed.status).toBe("past_due");
    expect(failed.pastDueSince).not.toBeNull();
  });

  it("cancels at Cashfree at once but keeps the paid plan until the period ends, then a sweep ends it", async () => {
    const store = await makeStore();
    fakeCashfree();
    await subscribeToPlan(rt, store.ctx, { planCode: "starter", interval: "monthly", phone: "9876543210" });
    const subId = (await latestSub(store.tenantId)).providerSubscriptionId!;
    await handleCashfreeBillingWebhook(rt, post({ type: "SUBSCRIPTION_PAYMENT_SUCCESS", data: { subscription_id: subId, payment_type: "CHARGE", cf_payment_id: 700001, payment_amount: 999 } }));
    const active = await latestSub(store.tenantId);
    expect(active.status).toBe("active");

    const res = await cancelPlanSubscription(rt, store.ctx);
    const manage = calls.find((c) => c.url.endsWith(`/subscriptions/${subId}/manage`))!;
    expect(manage.body).toMatchObject({ subscription_id: subId, action: "CANCEL" });
    expect(res.cancelAt).toBe(active.currentPeriodEnd!.toISOString());

    // Cashfree's own "cancelled" event arrives straight away; the merchant paid for the month, so the plan stays.
    const ev = await handleCashfreeBillingWebhook(rt, post({ type: "SUBSCRIPTION_STATUS_CHANGED", data: { subscription_details: { subscription_id: subId, subscription_status: "CANCELLED" } } }));
    expect(ev.actionTaken).toBe("subscription_cancel_scheduled");
    expect((await latestSub(store.tenantId)).status).toBe("active");

    expect((await endDueCashfreeCancellations(rt)).ended).toBe(0);
    const later = new Date(active.currentPeriodEnd!.getTime() + 60_000);
    expect((await endDueCashfreeCancellations(rt, later)).ended).toBeGreaterThanOrEqual(1);
    expect((await latestSub(store.tenantId)).status).toBe("cancelled");
    const [tier] = await rt._db.db.select().from(schema.tenantSizeTiers).where(eq(schema.tenantSizeTiers.tenantId, store.tenantId));
    expect(tier!.tier).toBe("XS");
  });
});

describe("C3 both gateways side by side", () => {
  it("still verifies Razorpay webhooks for existing subscriptions while Cashfree is the active gateway", async () => {
    await resetBilling();
    await updatePlatformBillingSettings(rt, owner, { test: { keyId: "rzp_test_both", keySecret: "rzp_secret_both", webhookSecret: "rzp_whsec_both" } });
    await updatePlatformBillingSettings(rt, owner, { provider: "cashfree", enabled: true, cashfree: { test: { clientId: "TEST10000001", clientSecret: CF_SECRET } } });
    expect((await getPlatformBillingSettings(rt, owner)).provider).toBe("cashfree");

    const raw = JSON.stringify({ event: "payment.failed", payload: {} });
    const sig = createHmac("sha256", "rzp_whsec_both").update(raw).digest("hex");
    const res = await handlePlatformBillingWebhook(rt, { rawBody: raw, signature: sig });
    expect(res.actionTaken).toBe("payment_failed_noted");
    expect(await errorOf(handlePlatformBillingWebhook(rt, { rawBody: raw, signature: "0".repeat(64) }))).toMatch(/Invalid platform billing webhook signature/);
  });
});
