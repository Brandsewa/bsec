import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Transporter } from "nodemailer";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import {
  createRuntime,
  getPlatformBillingSettings,
  handlePlatformBillingWebhook,
  loadInvoicePdfData,
  provisionTenant,
  RazorpaySubscriptionProvider,
  renderDunningEmail,
  renderPlatformInvoicePdf,
  runBillingDunningSweep,
  taxSplit,
  pdfMoney,
  updatePlatformBillingSettings,
  updatePlatformEmailSettings,
  type Runtime,
} from "../src/index.ts";
import { setPlatformEmailTransportFactory } from "../src/system/platform-mailer.ts";

let env: TestDb;
let rt: Runtime;
let owner: string;
let seq = 0;
const sent: Array<{ to: string; subject: string }> = [];
const DAY = 24 * 3600 * 1000;
const WEBHOOK_SECRET = "whsec_dunning_test_secret_1";
const provider = new RazorpaySubscriptionProvider({ webhookSecret: WEBHOOK_SECRET });
const errorOf = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e))?.message ?? null;

/** CI runs every test file against one shared database: leave no billing or email state behind and start from none. */
async function reset() {
  await rt._db.db.execute(sql`DELETE FROM platform_razorpay_plans`);
  await rt._db.db.execute(sql`DELETE FROM platform_billing_settings`);
  await rt._db.db.execute(sql`DELETE FROM platform_email_settings`);
}

async function enableEmail() {
  await updatePlatformEmailSettings(rt, owner, {
    provider: "zoho_zeptomail",
    host: "smtp.example.test",
    port: 587,
    secureMode: "starttls",
    username: "emailapikey",
    password: "dunning-test-password",
    fromEmail: "no-reply@example.test",
    fromName: "Brand Sewa",
    enabled: true,
  });
}

async function payingStore(email: string) {
  const slug = `dun-store-${++seq}`;
  const r = await provisionTenant(rt, { storeName: `Dun Store ${seq}`, slug, planCode: "starter", owner: { email, name: "Owner" }, source: "platform_admin" });
  const subId = `sub_dun_${seq}`;
  await rt._db.db.update(schema.subscriptions).set({ status: "active", providerSubscriptionId: subId }).where(eq(schema.subscriptions.tenantId, r.tenantId));
  return { ...r, subId };
}

const send = (event: Record<string, unknown>, id: string) => {
  const raw = JSON.stringify(event);
  return handlePlatformBillingWebhook(rt, { rawBody: raw, signature: createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex"), provider, eventId: id });
};
const charged = (subId: string, tenantId: string, paymentId: string) => ({
  event: "subscription.charged",
  payload: {
    subscription: { entity: { id: subId, current_start: 1_790_000_000, current_end: 1_792_600_000, notes: { tenant_id: tenantId, plan_code: "starter" } } },
    payment: { entity: { id: paymentId, amount: 99900 } },
  },
});

async function subOf(tenantId: string) {
  const [s] = await rt._db.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, tenantId));
  return s!;
}

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  owner = (await seedPlatformStaff(rt._db.db, { email: "dunning-owner@platform.test", role: "platform_owner" })).userId;
  await reset();
}, 180_000);

beforeEach(() => {
  sent.length = 0;
  setPlatformEmailTransportFactory(() => ({
    sendMail: async (opts: { to: string; subject: string }) => {
      sent.push({ to: String(opts.to), subject: String(opts.subject) });
      return { messageId: `msg_${sent.length}` };
    },
  }) as unknown as Transporter);
});

afterAll(async () => {
  setPlatformEmailTransportFactory(null);
  await reset();
  await rt?.close();
  await env?.stop();
});

describe("B5 dunning", () => {
  it("stamps past_due_since on the first failed charge and keeps it on later ones", async () => {
    const s = await payingStore("dun-a@test.com");
    await send({ event: "subscription.pending", payload: { subscription: { entity: { id: s.subId } } } }, "evt_dun_p1");
    const first = (await subOf(s.tenantId)).pastDueSince!;
    expect(first).toBeInstanceOf(Date);
    await send({ event: "subscription.halted", payload: { subscription: { entity: { id: s.subId } } } }, "evt_dun_p2");
    expect((await subOf(s.tenantId)).pastDueSince!.getTime()).toBe(first.getTime());
    // The sweep is global, so put this store back before the next test runs it.
    await rt._db.db.update(schema.subscriptions).set({ status: "active", pastDueSince: null, dunningStage: 0 }).where(eq(schema.subscriptions.tenantId, s.tenantId));
  });

  it("sends the failure notice, then the reminder, then limits the store after the grace period, one step per sweep", async () => {
    await enableEmail();
    await updatePlatformBillingSettings(rt, owner, { graceDays: 7 });
    const s = await payingStore("dun-b@test.com");
    const since = new Date(Date.now() - 1000);
    await rt._db.db.update(schema.subscriptions).set({ status: "past_due", pastDueSince: since, dunningStage: 0 }).where(eq(schema.subscriptions.tenantId, s.tenantId));

    expect(await runBillingDunningSweep(rt, new Date(since.getTime() + 1000))).toMatchObject({ notified: 1, reminded: 0, limited: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "dun-b@test.com" });
    expect(sent[0]!.subject).toMatch(/Payment failed/);
    expect((await subOf(s.tenantId)).dunningStage).toBe(1);

    // Nothing more until the last two days.
    sent.length = 0;
    expect(await runBillingDunningSweep(rt, new Date(since.getTime() + 3 * DAY))).toMatchObject({ notified: 0, reminded: 0, limited: 0 });
    expect(sent).toHaveLength(0);

    expect(await runBillingDunningSweep(rt, new Date(since.getTime() + 5.5 * DAY))).toMatchObject({ reminded: 1 });
    expect(sent[0]!.subject).toMatch(/will be limited/);
    expect((await subOf(s.tenantId)).dunningStage).toBe(2);

    sent.length = 0;
    expect(await runBillingDunningSweep(rt, new Date(since.getTime() + 7 * DAY + 1000))).toMatchObject({ limited: 1 });
    expect(sent[0]!.subject).toMatch(/restricted plan/);
    expect((await subOf(s.tenantId)).dunningStage).toBe(3);
    const [tier] = await rt._db.db.select().from(schema.tenantSizeTiers).where(eq(schema.tenantSizeTiers.tenantId, s.tenantId));
    expect(tier!.tier).toBe("XS");
    const audits = await rt._db.db.select().from(schema.platformAuditLogs).where(eq(schema.platformAuditLogs.action, "billing.store_limited"));
    expect(audits.some((a) => a.tenantId === s.tenantId)).toBe(true);

    // Done: later sweeps do nothing for this store.
    sent.length = 0;
    expect(await runBillingDunningSweep(rt, new Date(since.getTime() + 30 * DAY))).toMatchObject({ notified: 0, reminded: 0, limited: 0 });
    expect(sent).toHaveLength(0);
  });

  it("paying restores the plan: past due cleared, status active, tier restored", async () => {
    const s = await payingStore("dun-c@test.com");
    await rt._db.db.update(schema.subscriptions).set({ status: "past_due", pastDueSince: new Date(Date.now() - 8 * DAY), dunningStage: 3 }).where(eq(schema.subscriptions.tenantId, s.tenantId));
    await rt._db.db.insert(schema.tenantSizeTiers).values({ tenantId: s.tenantId, tier: "XS" }).onConflictDoUpdate({ target: schema.tenantSizeTiers.tenantId, set: { tier: "XS" } });

    await send(charged(s.subId, s.tenantId, "pay_dun_c"), "evt_dun_c1");
    const sub = await subOf(s.tenantId);
    expect(sub).toMatchObject({ status: "active", pastDueSince: null, dunningStage: 0 });
    const [tier] = await rt._db.db.select().from(schema.tenantSizeTiers).where(eq(schema.tenantSizeTiers.tenantId, s.tenantId));
    expect(tier!.tier).not.toBe("XS");
  });

  it("limits the store even when email is switched off (the notice is skipped, not the limit)", async () => {
    await rt._db.db.execute(sql`DELETE FROM platform_email_settings`);
    await updatePlatformBillingSettings(rt, owner, { graceDays: 1 });
    const s = await payingStore("dun-d@test.com");
    const since = new Date(Date.now() - 2 * DAY);
    await rt._db.db.update(schema.subscriptions).set({ status: "past_due", pastDueSince: since }).where(eq(schema.subscriptions.tenantId, s.tenantId));
    expect(await runBillingDunningSweep(rt)).toMatchObject({ limited: 1 });
    expect(sent).toHaveLength(0);
    expect((await subOf(s.tenantId)).dunningStage).toBe(3);
  });

  it("ignores lapsed trials and stores that were never subscribed (those are limited by the trial sweep)", async () => {
    const slug = `dun-trial-${++seq}`;
    const r = await provisionTenant(rt, { storeName: slug, slug, planCode: "starter", owner: { email: "dun-e@test.com", name: "Owner" }, source: "platform_admin" });
    await rt._db.db.update(schema.subscriptions).set({ status: "past_due" }).where(eq(schema.subscriptions.tenantId, r.tenantId));
    expect(await runBillingDunningSweep(rt, new Date(Date.now() + 60 * DAY))).toMatchObject({ limited: 0 });
    expect((await subOf(r.tenantId)).dunningStage).toBe(0);
  });

  it("renders plain, escaped emails", () => {
    const mail = renderDunningEmail("failed", { storeName: "<b>Shop</b>", limitDate: new Date("2026-10-30T00:00:00Z"), billingUrl: "https://admin.example.test/x" });
    expect(mail.html).not.toContain("<b>Shop</b>");
    expect(mail.subject).toContain("<b>Shop</b>"); // subject is plain text, escaped only in html
    expect(mail.text).toContain("https://admin.example.test/x");
  });
});

describe("B6 invoice profile and PDF", () => {
  it("saves and validates the invoice issuer details", async () => {
    expect(await errorOf(updatePlatformBillingSettings(rt, owner, { invoice: { gstin: "BADGSTIN" } }))).toMatch(/valid GSTIN/);
    expect(await errorOf(updatePlatformBillingSettings(rt, owner, { invoice: { sac: "12" } }))).toMatch(/SAC/);
    expect(await errorOf(updatePlatformBillingSettings(rt, owner, { invoice: { gstRateBps: 5000 } }))).toMatch(/0% to 28%/);
    await updatePlatformBillingSettings(rt, owner, {
      invoice: { legalName: "Brand Sewa Pvt Ltd", address: "1 Test Road, Mumbai", state: "Maharashtra", gstin: "27aaaaa0000a1z5", sac: "998314", gstRateBps: 1800 },
    });
    const v = await getPlatformBillingSettings(rt, owner);
    expect(v.invoice).toEqual({ legalName: "Brand Sewa Pvt Ltd", address: "1 Test Road, Mumbai", state: "Maharashtra", gstin: "27AAAAA0000A1Z5", sac: "998314", gstRateBps: 1800 });
  });

  it("uses the configured tax rate on new invoices", async () => {
    await updatePlatformBillingSettings(rt, owner, { invoice: { gstRateBps: 500 } });
    const s = await payingStore("dun-f@test.com");
    await send(charged(s.subId, s.tenantId, "pay_rate_1"), "evt_rate_1");
    const [inv] = await rt._db.db.select().from(schema.platformInvoices).where(eq(schema.platformInvoices.tenantId, s.tenantId));
    expect(inv!.taxPaise).toBe(Math.round((99900 * 500) / 10500));
    await updatePlatformBillingSettings(rt, owner, { invoice: { gstRateBps: 1800 } });
  });

  it("splits tax by state and renders a real PDF for the store's own invoice only", async () => {
    expect(taxSplit(1000, "Maharashtra", "maharashtra")).toEqual([{ label: "CGST", paise: 500 }, { label: "SGST", paise: 500 }]);
    expect(taxSplit(1001, "Maharashtra", "Maharashtra").map((t) => t.paise)).toEqual([500, 501]);
    expect(taxSplit(1000, "Maharashtra", "Kerala")).toEqual([{ label: "IGST", paise: 1000 }]);
    expect(taxSplit(1000, null, "Kerala")).toEqual([{ label: "IGST", paise: 1000 }]);
    expect(pdfMoney(123456)).toBe("Rs. 1,234.56");

    const a = await payingStore("dun-g@test.com");
    const b = await payingStore("dun-h@test.com");
    await send(charged(a.subId, a.tenantId, "pay_pdf_a"), "evt_pdf_a");
    const [inv] = await rt._db.db.select().from(schema.platformInvoices).where(eq(schema.platformInvoices.tenantId, a.tenantId));

    const data = await loadInvoicePdfData(rt, a.tenantId, inv!.id);
    expect(data).toMatchObject({ number: inv!.number, amountPaise: 99900, planName: "Starter", seller: { legalName: "Brand Sewa Pvt Ltd", gstin: "27AAAAA0000A1Z5" } });
    const pdf = await renderPlatformInvoicePdf(data!);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1500);

    // Another store can never fetch this invoice.
    expect(await loadInvoicePdfData(rt, b.tenantId, inv!.id)).toBeNull();
  });
});
