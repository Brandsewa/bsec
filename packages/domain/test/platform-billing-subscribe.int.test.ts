import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { STORE_PERMISSIONS } from "@bs/auth";
import {
  cancelPlanSubscription,
  createRuntime,
  financialYearSeries,
  grantPromotion,
  handlePlatformBillingWebhook,
  listBillingPlans,
  provisionTenant,
  RazorpaySubscriptionProvider,
  subscribeToPlan,
  syncBillingPlans,
  updatePlatformBillingSettings,
  createPromotion,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

let env: TestDb;
let rt: Runtime;
let owner: string;
let seq = 0;

const errorOf = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e))?.message ?? null;
const WEBHOOK_SECRET = "whsec_b4_test_secret_12345";
const provider = new RazorpaySubscriptionProvider({ webhookSecret: WEBHOOK_SECRET });
const sign = (raw: string) => createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");

interface Call {
  url: string;
  body: Record<string, unknown>;
}
let calls: Call[] = [];

/** Fakes Razorpay: plans and subscriptions are created, cancels succeed. */
function fakeRazorpay(opts: { failPlanFor?: string } = {}) {
  calls = [];
  return vi.spyOn(globalThis, "fetch").mockImplementation((async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ url, body });
    if (url.endsWith("/v1/plans")) {
      const name = String((body.item as { name: string }).name);
      if (opts.failPlanFor && name.startsWith(opts.failPlanFor)) return new Response("bad", { status: 400 });
      return new Response(JSON.stringify({ id: `plan_${++seq}` }), { status: 200 });
    }
    if (url.endsWith("/v1/subscriptions")) return new Response(JSON.stringify({ id: `sub_${++seq}`, short_url: "https://rzp.io/i/test", status: "created" }), { status: 200 });
    if (url.endsWith("/cancel")) return new Response(JSON.stringify({ status: "cancelled" }), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch);
}

async function makeStore(planCode: "starter" | "growth" = "starter") {
  const slug = `bill-store-${++seq}`;
  const r = await provisionTenant(rt, { storeName: slug, slug, planCode, owner: { email: `owner-${slug}@test.com`, name: "Owner One" }, source: "platform_admin" });
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

async function enableBilling() {
  await updatePlatformBillingSettings(rt, owner, { enabled: true, test: { keyId: "rzp_test_b3", keySecret: "b3_secret_value" } });
}

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  owner = (await seedPlatformStaff(rt._db.db, { email: "b3-owner@platform.test", role: "platform_owner" })).userId;
  delete process.env.RAZORPAY_PLATFORM_KEY_ID;
  delete process.env.RAZORPAY_PLATFORM_KEY_SECRET;
}, 180_000);

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await rt?.close();
  await env?.stop();
});

describe("B2 sync plans to Razorpay", () => {
  it("needs billing configured, then creates a plan per price once and only again when a price changes", async () => {
    expect(await errorOf(syncBillingPlans(rt, owner))).toMatch(/billing is not configured/);
    await enableBilling();

    fakeRazorpay();
    const first = await syncBillingPlans(rt, owner);
    const priced = (await rt._db.db.select().from(schema.plans)).flatMap((p) => [p.priceMonthlyPaise, p.priceYearlyPaise]).filter((n) => n > 0).length;
    expect(first).toMatchObject({ mode: "test", created: priced, unchanged: 0, failed: [] });
    expect(calls[0]!.url).toBe("https://api.razorpay.com/v1/plans");
    expect(calls[0]!.body).toMatchObject({ period: "monthly", interval: 1, item: { currency: "INR" } });

    vi.restoreAllMocks();
    fakeRazorpay();
    const second = await syncBillingPlans(rt, owner);
    expect(second).toMatchObject({ created: 0, unchanged: priced });
    expect(calls).toHaveLength(0);

    const view = await listBillingPlans(rt, owner);
    expect(view.canSync).toBe(true);
    expect(view.plans.every((p) => p.monthly.inSync)).toBe(true);

    // A price change creates a new Razorpay plan; the old one stays for current subscribers.
    await rt._db.db.update(schema.plans).set({ priceMonthlyPaise: 123400 }).where(eq(schema.plans.code, "starter"));
    vi.restoreAllMocks();
    fakeRazorpay();
    const third = await syncBillingPlans(rt, owner);
    expect(third.created).toBe(1);
    expect((await listBillingPlans(rt, owner)).plans.find((p) => p.code === "starter")!.monthly.inSync).toBe(true);
    const rows = await rt._db.db.select().from(schema.platformRazorpayPlans);
    expect(rows.filter((r) => r.interval === "monthly" && r.amountPaise === 123400)).toHaveLength(1);
    await rt._db.db.update(schema.plans).set({ priceMonthlyPaise: 99900 }).where(eq(schema.plans.code, "starter"));
  });

  it("reports a failing plan without stopping the others", async () => {
    await rt._db.db.update(schema.plans).set({ priceMonthlyPaise: 77700 }).where(eq(schema.plans.code, "growth"));
    fakeRazorpay({ failPlanFor: "Growth" });
    const res = await syncBillingPlans(rt, owner);
    expect(res.failed.length).toBe(1);
    expect(res.failed[0]).toMatchObject({ plan: "growth", interval: "monthly" });
    expect((await listBillingPlans(rt, owner)).plans.find((p) => p.code === "growth")!.monthly.inSync).toBe(false);
    await rt._db.db.update(schema.plans).set({ priceMonthlyPaise: 249900 }).where(eq(schema.plans.code, "growth"));
  });
});

describe("B3 subscribe and cancel", () => {
  it("is owner only and needs billing to be available", async () => {
    const s = await makeStore();
    expect(await errorOf(subscribeToPlan(rt, { ...s.ctx, roles: ["store_admin"] }, { planCode: "starter", interval: "monthly" }))).toMatch(/store owner/);
    expect(await errorOf(cancelPlanSubscription(rt, { ...s.ctx, roles: ["store_admin"] }))).toMatch(/store owner/);
  });

  it("creates the Razorpay subscription with the synced plan, and the first charge waits for the trial to end", async () => {
    await enableBilling();
    const s = await makeStore();
    fakeRazorpay();
    const res = await subscribeToPlan(rt, s.ctx, { planCode: "starter", interval: "monthly" });
    expect(res).toMatchObject({ checkoutUrl: "https://rzp.io/i/test", testMode: true });
    expect(res.firstChargeAt).toBeTruthy();

    const call = calls.find((c) => c.url.endsWith("/v1/subscriptions"))!;
    const [synced] = await rt._db.db.select().from(schema.platformRazorpayPlans).where(eq(schema.platformRazorpayPlans.amountPaise, 99900));
    expect(call.body.plan_id).toBe(synced!.razorpayPlanId);
    const [sub] = await rt._db.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, s.tenantId));
    expect(call.body.start_at).toBe(Math.floor(sub!.currentPeriodEnd!.getTime() / 1000));
    expect(sub!.providerSubscriptionId).toMatch(/^sub_/);
    expect(sub!.status).toBe("trialing"); // the plan only changes after the payment webhook

    const audits = await rt._db.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.tenantId, s.tenantId));
    expect(audits.some((a) => a.action === "subscription.started")).toBe(true);
  });

  it("pushes the first charge past a free-months promotion", async () => {
    await enableBilling();
    const s = await makeStore();
    const promo = await createPromotion(rt, owner, { code: "B3FREE", name: "Free", kind: "free_months", durationMonths: 3 });
    await grantPromotion(rt, owner, { tenantId: s.tenantId, promotionId: promo.id, termMonths: 12 });
    fakeRazorpay();
    await subscribeToPlan(rt, s.ctx, { planCode: "starter", interval: "monthly" });
    const call = calls.find((c) => c.url.endsWith("/v1/subscriptions"))!;
    const [grant] = await rt._db.db.select().from(schema.tenantPromotions).where(eq(schema.tenantPromotions.tenantId, s.tenantId));
    expect(call.body.start_at).toBe(Math.floor(grant!.endsAt.getTime() / 1000));
  });

  it("refuses a second subscription while one is active, and cancels at the end of the paid period", async () => {
    await enableBilling();
    const s = await makeStore();
    const periodEnd = new Date(Date.now() + 20 * 24 * 3600 * 1000);
    await rt._db.db.update(schema.subscriptions).set({ status: "active", providerSubscriptionId: "sub_active_1", currentPeriodEnd: periodEnd }).where(eq(schema.subscriptions.tenantId, s.tenantId));
    expect(await errorOf(subscribeToPlan(rt, s.ctx, { planCode: "growth", interval: "monthly" }))).toMatch(/already has an active subscription/);

    fakeRazorpay();
    const res = await cancelPlanSubscription(rt, s.ctx);
    expect(calls[0]!.url).toContain("/sub_active_1/cancel");
    expect(calls[0]!.body).toEqual({ cancel_at_cycle_end: 1 });
    expect(res.cancelAt).toBe(periodEnd.toISOString());
  });
});

describe("B4 webhook lifecycle and gapless invoices", () => {
  async function activeStore() {
    const s = await makeStore();
    const subId = `sub_hook_${++seq}`;
    await rt._db.db.update(schema.subscriptions).set({ providerSubscriptionId: subId }).where(eq(schema.subscriptions.tenantId, s.tenantId));
    return { ...s, subId };
  }
  const send = (event: Record<string, unknown>, id: string) => {
    const raw = JSON.stringify(event);
    return handlePlatformBillingWebhook(rt, { rawBody: raw, signature: sign(raw), provider, eventId: id });
  };
  const charged = (subId: string, tenantId: string, paymentId: string, amount = 99900) => ({
    event: "subscription.charged",
    payload: {
      subscription: { entity: { id: subId, current_start: 1_790_000_000, current_end: 1_792_600_000, notes: { tenant_id: tenantId, plan_code: "starter" } } },
      payment: { entity: { id: paymentId, amount } },
    },
  });

  it("numbers invoices in a gapless financial-year series", async () => {
    expect(financialYearSeries(new Date("2026-10-18T00:00:00Z"))).toBe("26-27");
    expect(financialYearSeries(new Date("2027-03-31T10:00:00Z"))).toBe("26-27");
    expect(financialYearSeries(new Date("2027-04-01T00:00:00Z"))).toBe("27-28");

    const a = await activeStore();
    const b = await activeStore();
    await send(charged(a.subId, a.tenantId, "pay_a1"), "evt_a1");
    await send(charged(b.subId, b.tenantId, "pay_b1"), "evt_b1");
    const invoices = await rt._db.db.select().from(schema.platformInvoices);
    const numbers = invoices.map((i) => i.number).sort();
    const fy = financialYearSeries(new Date());
    expect(numbers.every((n) => new RegExp(`^BS/${fy}/\\d{5}$`).test(n))).toBe(true);
    const seqs = numbers.map((n) => Number(n.slice(-5)));
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => seqs[0]! + i)); // consecutive
  });

  it("invoices one provider payment only once, even if it arrives in two events", async () => {
    const s = await activeStore();
    await send(charged(s.subId, s.tenantId, "pay_dup"), "evt_dup_1");
    await send(charged(s.subId, s.tenantId, "pay_dup"), "evt_dup_2");
    const mine = await rt._db.db.select().from(schema.platformInvoices).where(eq(schema.platformInvoices.tenantId, s.tenantId));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.providerPaymentId).toBe("pay_dup");
    const [sub] = await rt._db.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, s.tenantId));
    expect(sub!.status).toBe("active");
  });

  it("links the provider id on authentication without changing the status", async () => {
    const s = await makeStore();
    const res = await send({ event: "subscription.authenticated", payload: { subscription: { entity: { id: "sub_auth_1", notes: { tenant_id: s.tenantId } } } } }, "evt_auth_1");
    expect(res.actionTaken).toBe("subscription_authenticated");
    const [sub] = await rt._db.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, s.tenantId));
    expect(sub).toMatchObject({ providerSubscriptionId: "sub_auth_1", status: "trialing" });
  });

  it("marks a failed charge past due, and an ended subscription cancelled with the restricted tier", async () => {
    const s = await activeStore();
    await send(charged(s.subId, s.tenantId, "pay_life_1"), "evt_life_1");
    expect((await send({ event: "subscription.pending", payload: { subscription: { entity: { id: s.subId } } } }, "evt_life_2")).actionTaken).toBe("subscription_past_due");
    let [sub] = await rt._db.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, s.tenantId));
    expect(sub!.status).toBe("past_due");

    expect((await send({ event: "payment.failed", payload: {} }, "evt_life_3")).actionTaken).toBe("payment_failed_noted");

    expect((await send({ event: "subscription.cancelled", payload: { subscription: { entity: { id: s.subId } } } }, "evt_life_4")).actionTaken).toBe("subscription_cancelled");
    [sub] = await rt._db.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, s.tenantId));
    expect(sub!.status).toBe("cancelled");
    const [tier] = await rt._db.db.select().from(schema.tenantSizeTiers).where(eq(schema.tenantSizeTiers.tenantId, s.tenantId));
    expect(tier!.tier).toBe("XS");
  });
});
