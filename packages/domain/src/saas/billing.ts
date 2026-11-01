import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { schema, type Db } from "@bs/db";
import { saasDb, type Runtime } from "../runtime.ts";
import { LAPSED_TRIAL_TIER, tierForPlan } from "./plan-tiers.ts";
import { loadInvoiceProfile, loadPlatformBillingCredentials, type BillingProviderId } from "../platform/billing-settings.ts";
import { findRazorpayPlanId } from "../platform/billing-plans.ts";
import { CashfreeApiError, cashfreeRequest, paiseToRupees, verifyCashfreeSignature, type CashfreeMode, PayPalProvider, toPayPalAmount, fromPayPalAmount } from "@bs/payments";
import { enforceExtraMarketsQuota } from "../markets/service.ts";

export interface SubscriptionBillingProvider {
  /** Which gateway this is. Providers written before Cashfree omit it and are Razorpay. */
  readonly name?: BillingProviderId;
  isConfigured?(): boolean;
  createSubscription(params: {
    planCode: string;
    interval: "monthly" | "yearly";
    customerEmail: string;
    customerName?: string;
    tenantId: string;
    planId?: string;
    /** Unix seconds of the first charge (after a trial or a free period). Omit to charge on authorisation. */
    startAt?: number;
    notes?: Record<string, string>;
    /** What the gateway charges each cycle, in paise (Cashfree has no stored plans, so the amount travels with the subscription). */
    amountPaise?: number;
    /** What the gateway charges each cycle, in USD cents (PayPal Orders v2 platform billing for global stores). */
    amountUsdCents?: number;
    customerPhone?: string;
    /** Where the gateway sends the merchant back after authorising (Cashfree). */
    returnUrl?: string;
    /**
     * Nothing is deferred (no trial or free period left): Cashfree takes the first cycle's price when the mandate is authorised and
     * the automatic debits start one cycle later. A debit mandate cannot be debited at once (a day's pre-debit notice is required),
     * so this is how a first payment happens at sign-up.
     */
    chargeFirstCycleNow?: boolean;
    /** With `chargeFirstCycleNow`: what the first payment is, in paise, when a coupon discounts it. Renewals stay at the list price. */
    firstPaymentPaise?: number;
  }): Promise<{
    providerSubscriptionId: string;
    shortUrl?: string;
    /** Cashfree: the merchant authorises in Cashfree's checkout, opened with this session by the admin app. */
    checkoutSession?: { sessionId: string; mode: CashfreeMode };
    status: string;
  }>;
  /** `atCycleEnd` keeps an active subscription running until the paid period ends (Razorpay only allows it when active). */
  cancelSubscription(providerSubscriptionId: string, opts?: { atCycleEnd?: boolean }): Promise<{ status: string }>;
  verifyWebhookSignature(rawBody: string, signature: string, timestamp?: string): boolean;
}

export class RazorpaySubscriptionProvider implements SubscriptionBillingProvider {
  readonly name = "razorpay" as const;
  private keyId: string | null;
  private keySecret: string | null;
  private webhookSecret: string | null;

  constructor(opts?: {
    keyId?: string;
    keySecret?: string;
    webhookSecret?: string;
  }) {
    this.keyId = opts?.keyId ?? process.env.RAZORPAY_PLATFORM_KEY_ID ?? null;
    this.keySecret = opts?.keySecret ?? process.env.RAZORPAY_PLATFORM_KEY_SECRET ?? null;
    this.webhookSecret = opts?.webhookSecret ?? process.env.RAZORPAY_PLATFORM_WEBHOOK_SECRET ?? null;
  }

  isConfigured(): boolean {
    return Boolean(this.keyId && this.keySecret);
  }

  async createSubscription(params: {
    planCode: string;
    interval: "monthly" | "yearly";
    customerEmail: string;
    customerName?: string;
    tenantId: string;
    planId?: string;
    startAt?: number;
    notes?: Record<string, string>;
  }): Promise<{
    providerSubscriptionId: string;
    shortUrl?: string;
    status: string;
  }> {
    if (!this.isConfigured()) {
      throw new Error("Billing is not configured: RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is missing");
    }

    if (!params.planId) {
      throw new Error(`Razorpay plan ID is required to create subscription for '${params.planCode}'`);
    }

    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64");
    const res = await fetch("https://api.razorpay.com/v1/subscriptions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        plan_id: params.planId,
        total_count: params.interval === "yearly" ? 5 : 60,
        customer_notify: 1,
        ...(params.startAt ? { start_at: params.startAt } : {}),
        notes: {
          tenant_id: params.tenantId,
          plan_code: params.planCode,
          ...params.notes,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Razorpay subscription creation failed (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as { id: string; short_url?: string; status: string };
    return {
      providerSubscriptionId: data.id,
      ...(data.short_url ? { shortUrl: data.short_url } : {}),
      status: data.status,
    };
  }

  async cancelSubscription(providerSubscriptionId: string, opts?: { atCycleEnd?: boolean }): Promise<{ status: string }> {
    if (!this.isConfigured()) {
      throw new Error("Billing is not configured: RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is missing");
    }

    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64");
    const res = await fetch(`https://api.razorpay.com/v1/subscriptions/${providerSubscriptionId}/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({ cancel_at_cycle_end: opts?.atCycleEnd ? 1 : 0 }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Razorpay subscription cancellation failed (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as { status: string };
    return { status: data.status };
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const secret = this.webhookSecret;
    if (!secret || typeof signature !== "string") {
      return false;
    }
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    if (signature.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(signature, "utf8"));
  }
}

/** Shows Cashfree's own message to the person who pressed the button instead of a generic failure. */
async function asBadRequest<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof CashfreeApiError) {
      console.error("[billing] Cashfree rejected a request", { status: err.status, code: err.code, message: err.message });
      throw new Error(`Bad Request: Cashfree said: ${err.message}${err.code ? ` (${err.code})` : ""}`, { cause: err });
    }
    throw err;
  }
}

export class CashfreeSubscriptionProvider implements SubscriptionBillingProvider {
  readonly name = "cashfree" as const;
  private readonly clientId: string | null;
  private readonly clientSecret: string | null;
  private readonly mode: CashfreeMode;
  private readonly fetchFn: typeof fetch;

  constructor(opts: { clientId?: string | null; clientSecret?: string | null; mode?: CashfreeMode; fetchFn?: typeof fetch } = {}) {
    this.clientId = opts.clientId ?? null;
    this.clientSecret = opts.clientSecret ?? null;
    this.mode = opts.mode ?? "test";
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
  }

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  private creds() {
    if (!this.clientId || !this.clientSecret) throw new Error("Billing is not configured: Cashfree App ID or secret is missing");
    return { clientId: this.clientId, clientSecret: this.clientSecret, mode: this.mode };
  }

  /**
   * Creates a periodic Cashfree subscription with the plan defined inline (Cashfree needs no stored plan). The merchant then
   * authorises a UPI AutoPay, card or eMandate in Cashfree's checkout; Cashfree debits each cycle itself. A small
   * authorisation amount is taken and refunded automatically. `startAt` defers the first debit past a trial or free period.
   */
  async createSubscription(params: Parameters<SubscriptionBillingProvider["createSubscription"]>[0]) {
    if (!params.amountPaise || params.amountPaise <= 0) throw new Error("Cashfree needs the plan amount to create a subscription");
    if (!params.customerPhone) throw new Error("Bad Request: a phone number is required to set up automatic payment. Add one and try again.");
    const yearly = params.interval === "yearly";
    const amount = paiseToRupees(params.amountPaise);
    const subscriptionId = `bs_${params.tenantId.replace(/-/g, "").slice(0, 16)}_${Date.now().toString(36)}`;
    const expiry = new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000);
    const res = await asBadRequest(() => cashfreeRequest<{ subscription_id: string; subscription_session_id?: string; subscription_status?: string }>(
      this.creds(),
      "POST",
      "/subscriptions",
      {
        subscription_id: subscriptionId,
        customer_details: {
          customer_email: params.customerEmail,
          customer_phone: params.customerPhone,
          ...(params.customerName ? { customer_name: params.customerName.slice(0, 100) } : {}),
        },
        plan_details: {
          plan_name: `${params.planCode} ${params.interval}`.slice(0, 40),
          plan_type: "PERIODIC",
          plan_currency: "INR",
          plan_amount: amount,
          plan_max_amount: amount,
          plan_max_cycles: yearly ? 5 : 60,
          plan_intervals: 1,
          plan_interval_type: yearly ? "YEAR" : "MONTH",
        },
        // UPI AutoPay and cards. eMandate (enach) is left out: Cashfree wants a zero authorisation amount for it, and this one is 1 rupee.
        authorization_details: params.chargeFirstCycleNow
          ? { authorization_amount: params.firstPaymentPaise ? paiseToRupees(params.firstPaymentPaise) : amount, authorization_amount_refund: false, payment_methods: ["upi", "card"] }
          : { authorization_amount: 1, authorization_amount_refund: true, payment_methods: ["upi", "card"] },
        subscription_meta: { ...(params.returnUrl ? { return_url: params.returnUrl } : {}), notification_channel: ["EMAIL"] },
        subscription_expiry_time: expiry.toISOString(),
        ...(params.chargeFirstCycleNow
          ? { subscription_first_charge_time: addInterval(new Date(), params.interval).toISOString() }
          : params.startAt
            ? { subscription_first_charge_time: new Date(params.startAt * 1000).toISOString() }
            : {}),
        subscription_tags: { tenant_id: params.tenantId, plan_code: params.planCode, psp_note: "Brand Sewa plan" },
      },
      this.fetchFn,
      subscriptionId,
    ));
    if (!res.subscription_session_id) throw new Error("Cashfree did not return a subscription session");
    return {
      providerSubscriptionId: res.subscription_id,
      checkoutSession: { sessionId: res.subscription_session_id, mode: this.mode },
      status: (res.subscription_status ?? "INITIALIZED").toLowerCase(),
    };
  }

  /** Where the subscription stands at Cashfree, and the id of its authorisation payment (the payment taken when the mandate was authorised). */
  async getSubscriptionState(providerSubscriptionId: string): Promise<{ status: string; authorizationStatus: string | null; authorizationPaymentId: string | null }> {
    const res = await asBadRequest(() =>
      cashfreeRequest<{ subscription_status?: string; authorisation_details?: { authorization_status?: string; payment_id?: string } }>(
        this.creds(),
        "GET",
        `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`,
        undefined,
        this.fetchFn,
      ),
    );
    return {
      status: res.subscription_status ?? "",
      authorizationStatus: res.authorisation_details?.authorization_status ?? null,
      authorizationPaymentId: res.authorisation_details?.payment_id ?? null,
    };
  }

  /** One payment of a subscription (for example its authorisation payment), as Cashfree recorded it. */
  async getSubscriptionPayment(providerSubscriptionId: string, paymentId: string): Promise<{ id: string | null; status: string; type: string; amountRupees: number }> {
    const r = await asBadRequest(() =>
      cashfreeRequest<Record<string, unknown>>(
        this.creds(),
        "GET",
        `/subscriptions/${encodeURIComponent(providerSubscriptionId)}/payments/${encodeURIComponent(paymentId)}`,
        undefined,
        this.fetchFn,
      ),
    );
    return {
      id: r.cf_payment_id !== undefined && r.cf_payment_id !== null ? String(r.cf_payment_id) : typeof r.payment_id === "string" ? r.payment_id : null,
      status: String(r.payment_status ?? ""),
      type: String(r.payment_type ?? ""),
      amountRupees: Number(r.payment_amount ?? 0),
    };
  }

  /** Cashfree can only cancel at once; "at the end of the period" is kept by the caller (cancelAt) and enforced by a sweep. */
  async cancelSubscription(providerSubscriptionId: string): Promise<{ status: string }> {
    const res = await asBadRequest(() => cashfreeRequest<{ subscription_status?: string }>(
      this.creds(),
      "POST",
      `/subscriptions/${encodeURIComponent(providerSubscriptionId)}/manage`,
      { subscription_id: providerSubscriptionId, action: "CANCEL" },
      this.fetchFn,
    ));
    return { status: (res.subscription_status ?? "CANCELLED").toLowerCase() };
  }

  verifyWebhookSignature(rawBody: string, signature: string, timestamp?: string): boolean {
    return verifyCashfreeSignature(this.clientSecret ?? undefined, timestamp, rawBody, signature);
  }
}

/**
 * PayPal platform billing provider (ADR-040 WP-5).
 * Uses PayPal Orders v2 with CAPTURE intent to generate an approval link for subscription cycles in USD.
 */
export class PayPalBillingSubscriptionProvider implements SubscriptionBillingProvider {
  readonly name = "paypal" as const;
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly webhookId: string | undefined;
  private readonly mode: "sandbox" | "live";
  private readonly fetchFn: typeof fetch;

  constructor(opts: { clientId?: string; clientSecret?: string; webhookId?: string; mode?: "test" | "live"; fetchFn?: typeof fetch } = {}) {
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.webhookId = opts.webhookId;
    this.mode = opts.mode === "live" ? "live" : "sandbox";
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
  }

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  private getPayPalProvider(): PayPalProvider {
    return new PayPalProvider({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      webhookId: this.webhookId,
      mode: this.mode,
      fetchFn: this.fetchFn,
    });
  }

  async createSubscription(params: Parameters<SubscriptionBillingProvider["createSubscription"]>[0]): Promise<{
    providerSubscriptionId: string;
    shortUrl?: string;
    status: string;
  }> {
    if (!this.clientId || !this.clientSecret) {
      throw badRequest("PayPal billing is not configured: missing client ID or secret");
    }

    const _paypal = this.getPayPalProvider();
    // bcom.si is the storefront, which has no /settings page (the merchant saw a 404): the fallback is the admin app.
    const returnUrl = params.returnUrl || `https://${process.env.ADMIN_HOST?.trim() || "admin.bcom.si"}/`;
    const cancelUrl = returnUrl;
    const amountCents = params.amountUsdCents ?? Math.round((params.amountPaise ?? 0) / 80); // USD cents fallback
    const valueStr = toPayPalAmount(amountCents, "USD");

    // Call PayPal Orders v2 directly using PayPalProvider's internal logic or accessToken
    const tokenRes = await this.fetchFn(this.mode === "live" ? "https://api-m.paypal.com/v1/oauth2/token" : "https://api-m.sandbox.paypal.com/v1/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const tokenData = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
    if (!tokenRes.ok || !tokenData.access_token) {
      throw badRequest(`PayPal authentication failed: HTTP ${tokenRes.status}`);
    }

    const orderRes = await this.fetchFn(this.mode === "live" ? "https://api-m.paypal.com/v2/checkout/orders" : "https://api-m.sandbox.paypal.com/v2/checkout/orders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: params.tenantId,
            custom_id: JSON.stringify({ tenant_id: params.tenantId, plan_code: params.planCode }),
            description: `Brand Sewa ${params.planCode} plan (${params.interval})`,
            amount: { currency_code: "USD", value: valueStr },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: "Brand Sewa",
              shipping_preference: "NO_SHIPPING",
              user_action: "PAY_NOW",
              return_url: returnUrl,
              cancel_url: cancelUrl,
            },
          },
        },
      }),
    });

    const orderData = (await orderRes.json().catch(() => ({}))) as { id?: string; status?: string; links?: Array<{ rel: string; href: string }> };
    if (!orderRes.ok || !orderData.id) {
      throw badRequest(`PayPal order creation failed: HTTP ${orderRes.status}`);
    }

    const approveLink = orderData.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
    return {
      providerSubscriptionId: orderData.id,
      ...(approveLink ? { shortUrl: approveLink } : {}),
      status: "created",
    };
  }

  async cancelSubscription(_providerSubscriptionId: string): Promise<{ status: string }> {
    // PayPal Orders v2 that have not been captured or are completed do not require an active recurring mandate cancellation
    return { status: "cancelled" };
  }

  verifyWebhookSignature(_rawBody: string, _signature: string, _timestamp?: string): boolean {
    return true; // Webhook verification for PayPal uses verifyWebhook with headers and API call; handled in handlePayPalBillingWebhook
  }
}

/**
 * The billing provider for the platform's active gateway (Super Admin, ADR-036/037/040), falling back to the legacy Razorpay env
 * vars. With no keys, the provider reports itself unconfigured instead of faking success (ADR-014 point 4). Pass `provider`
 * to get a specific gateway: a webhook is verified by the gateway that sent it, not by whichever one is active now.
 */
export async function resolveBillingProvider(db: Db, provider?: BillingProviderId): Promise<RazorpaySubscriptionProvider | CashfreeSubscriptionProvider | PayPalBillingSubscriptionProvider> {
  const creds = await loadPlatformBillingCredentials(db, provider);
  if (provider === "paypal" || creds?.provider === "paypal") {
    return new PayPalBillingSubscriptionProvider(
      creds
        ? {
            clientId: creds.keyId,
            clientSecret: creds.keySecret,
            mode: creds.mode,
            ...(creds.webhookSecret ? { webhookId: creds.webhookSecret } : {}),
          }
        : {},
    );
  }
  if (provider === "cashfree" || creds?.provider === "cashfree") {
    return new CashfreeSubscriptionProvider(creds ? { clientId: creds.keyId, clientSecret: creds.keySecret, mode: creds.mode } : {});
  }
  if (!creds) return new RazorpaySubscriptionProvider();
  return new RazorpaySubscriptionProvider({
    keyId: creds.keyId,
    keySecret: creds.keySecret,
    ...(creds.webhookSecret ? { webhookSecret: creds.webhookSecret } : {}),
  });
}

/** Prefix of the platform's GST invoice series. Revisit with the owner's GST registration details. */
export const PLATFORM_INVOICE_PREFIX = "BS";

/** Indian financial year (April to March) of a date, as "26-27". Uses the IST calendar date. */
export function financialYearSeries(at: Date): string {
  const ist = new Date(at.getTime() + 5.5 * 60 * 60 * 1000);
  const year = ist.getUTCFullYear();
  const startYear = ist.getUTCMonth() >= 3 ? year : year - 1;
  return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
}

/**
 * Issues the next number in the financial-year invoice series, for example BS/26-27/00001. The counter row is locked by
 * the calling transaction, so a rolled-back invoice never leaves a gap (GST needs a consecutive series).
 */
export async function nextPlatformInvoiceNumber(tx: Db, at: Date = new Date()): Promise<string> {
  const series = financialYearSeries(at);
  const res = await tx.execute<{ last_number: number }>(sql`
    INSERT INTO platform_invoice_counters (series, last_number) VALUES (${series}, 1)
    ON CONFLICT (series) DO UPDATE SET last_number = platform_invoice_counters.last_number + 1
    RETURNING last_number;
  `);
  const n = res.rows[0]?.last_number;
  if (!n) throw new Error("Failed to issue an invoice number");
  return `${PLATFORM_INVOICE_PREFIX}/${series}/${String(n).padStart(5, "0")}`;
}

export interface PlatformBillingWebhookResult {
  received: boolean;
  eventId: string;
  duplicate?: boolean;
  actionTaken?: string;
}

/**
 * A gateway event in the platform's own terms. Each gateway's payload is normalised into one of these, and one applier
 * (below) updates subscriptions, invoices and size tiers, so Razorpay and Cashfree cannot drift apart.
 */
type BillingEvent =
  | {
      kind: "charged";
      providerSubscriptionId?: string | undefined;
      tenantIdNote?: string | undefined;
      planCodeNote?: string | undefined;
      amountPaise: number;
      paymentId: string | null;
      currentStart?: Date | undefined;
      /** Omit to use the default of 30 days; "interval" derives it from the subscription's monthly or yearly interval. */
      currentEnd?: Date | "interval" | undefined;
    }
  | { kind: "authenticated"; providerSubscriptionId?: string | undefined; tenantIdNote?: string | undefined }
  | { kind: "authorised"; providerSubscriptionId?: string | undefined }
  | { kind: "past_due"; providerSubscriptionId?: string | undefined }
  | { kind: "cancelled"; providerSubscriptionId?: string | undefined; honourCancelAt?: boolean }
  | { kind: "resumed"; providerSubscriptionId?: string | undefined }
  | { kind: "ignored"; note: string };

/** An authorisation payment at or above this many rupees is a plan payment, not the 1 rupee mandate check. */
const AUTH_CHARGE_FLOOR_RUPEES = 10;

function addInterval(from: Date, interval: string): Date {
  const d = new Date(from);
  if (interval === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

async function applyBillingEvent(db: Db, ev: BillingEvent): Promise<string> {
  if (ev.kind === "ignored") return ev.note;

  if (ev.kind === "charged") {
    const subId = ev.providerSubscriptionId;
    if (!subId && !ev.tenantIdNote) return "ignored";
    let sub: typeof schema.subscriptions.$inferSelect | null = null;
    if (subId) {
      const [byProviderId] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.providerSubscriptionId, subId)).limit(1);
      if (byProviderId) sub = byProviderId;
    }
    if (!sub && ev.tenantIdNote) {
      const [byTenantId] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, ev.tenantIdNote)).orderBy(desc(schema.subscriptions.createdAt)).limit(1);
      if (byTenantId) sub = byTenantId;
    }
    if (!sub) return "ignored";

    const activeSub = sub;
    const currentStart = ev.currentStart ?? new Date();
    const currentEnd = ev.currentEnd === "interval" ? addInterval(currentStart, activeSub.interval) : (ev.currentEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));

    // The plan price is quoted inclusive of GST; the rate is Super Admin, Platform billing, Invoice details (default 18%).
    const gstRateBps = (await loadInvoiceProfile(db)).gstRateBps;
    const taxPaise = Math.round((ev.amountPaise * gstRateBps) / (10000 + gstRateBps));

    // Do the invoice, subscription and tier writes in ONE transaction
    await db.transaction(async (tx) => {
      // If planCodeNote is present, find plan by code and update planId
      let newPlanId = activeSub.planId;
      if (ev.planCodeNote) {
        const [targetPlan] = await tx.select().from(schema.plans).where(eq(schema.plans.code, ev.planCodeNote)).limit(1);
        if (targetPlan) newPlanId = targetPlan.id;
      }

      // Update subscription to active
      await tx
        .update(schema.subscriptions)
        .set({
          status: "active",
          ...(newPlanId ? { planId: newPlanId } : {}),
          providerSubscriptionId: subId ?? undefined,
          currentPeriodStart: currentStart,
          currentPeriodEnd: currentEnd,
          pastDueSince: null,
          dunningStage: 0,
          paymentRequired: false,
          authorizedAt: sql`COALESCE(${schema.subscriptions.authorizedAt}, now())`,
          updatedAt: new Date(),
        })
        .where(eq(schema.subscriptions.id, activeSub.id));

      // One invoice per provider payment: the same payment can arrive in more than one event.
      const [already] = ev.paymentId
        ? await tx.select({ id: schema.platformInvoices.id }).from(schema.platformInvoices).where(eq(schema.platformInvoices.providerPaymentId, ev.paymentId)).limit(1)
        : [];
      if (!already) {
        const issuedAt = new Date();
        await tx.insert(schema.platformInvoices).values({
          tenantId: activeSub.tenantId,
          subscriptionId: activeSub.id,
          number: await nextPlatformInvoiceNumber(tx, issuedAt),
          amountPaise: ev.amountPaise,
          taxPaise,
          status: "paid",
          issuedAt,
          paidAt: issuedAt,
          providerPaymentId: ev.paymentId,
        });
      }

      // Ensure tenant quota size tier reflects plan tier
      const effectivePlanId = newPlanId ?? activeSub.planId;
      if (effectivePlanId) {
        const planRow = await tx.execute<{ code: string; limits: Record<string, unknown> | string }>(sql`
          SELECT code, limits FROM plans WHERE id = ${effectivePlanId} LIMIT 1;
        `);
        const tier = tierForPlan(planRow.rows[0]?.code);
        await tx
          .insert(schema.tenantSizeTiers)
          .values({ tenantId: activeSub.tenantId, tier })
          .onConflictDoUpdate({ target: schema.tenantSizeTiers.tenantId, set: { tier, updatedAt: new Date() } });

        const rawLimits = planRow.rows[0]?.limits;
        const limits = typeof rawLimits === "string" ? (JSON.parse(rawLimits) as Record<string, unknown>) : rawLimits;
        const maxExtra = typeof limits?.max_extra_markets === "number" ? limits.max_extra_markets : 1;
        await enforceExtraMarketsQuota(tx, activeSub.tenantId, maxExtra);
      }
    });
    return "subscription_activated_and_invoiced";
  }

  if (ev.kind === "authenticated") {
    // The merchant authorised the card or UPI mandate. Nothing is charged yet when the first charge is deferred past a
    // trial or free period, so the status stays as it is; we only make sure the provider id is linked to the store.
    if (!ev.providerSubscriptionId || !ev.tenantIdNote) return "ignored";
    await db
      .update(schema.subscriptions)
      .set({ providerSubscriptionId: ev.providerSubscriptionId, updatedAt: new Date() })
      .where(and(eq(schema.subscriptions.tenantId, ev.tenantIdNote), sql`${schema.subscriptions.providerSubscriptionId} IS DISTINCT FROM ${ev.providerSubscriptionId}`));
    return "subscription_authenticated";
  }

  if (ev.kind === "authorised") {
    // The mandate is authorised, so automatic payment is set up. The plan does not change: the first charge may still be days away.
    if (!ev.providerSubscriptionId) return "ignored";
    const [authorised] = await db
      .update(schema.subscriptions)
      .set({ authorizedAt: sql`COALESCE(${schema.subscriptions.authorizedAt}, now())`, updatedAt: new Date() })
      .where(eq(schema.subscriptions.providerSubscriptionId, ev.providerSubscriptionId))
      .returning({ id: schema.subscriptions.id, tenantId: schema.subscriptions.tenantId, planId: schema.subscriptions.planId, status: schema.subscriptions.status, paymentRequired: schema.subscriptions.paymentRequired });
    // A store that must pay before opening (or whose zero-day trial already lapsed) has nothing to pay while a free-months
    // promotion covers it: the authorised mandate is the commitment, and Cashfree takes the first charge when the promotion ends.
    // So it is covered until then: trialing until the promotion ends (the trial sweep and dunning leave it alone) on its plan's
    // tier, not the restricted one. The first charge then makes it active. Without a promotion the first payment opens it.
    if (authorised && (authorised.paymentRequired || authorised.status === "past_due")) {
      const [promo] = await db
        .select({ endsAt: schema.tenantPromotions.endsAt })
        .from(schema.tenantPromotions)
        .where(
          and(
            eq(schema.tenantPromotions.tenantId, authorised.tenantId),
            eq(schema.tenantPromotions.status, "active"),
            sql`(${schema.tenantPromotions.kind} = 'free_months' OR ${schema.tenantPromotions.percentOff} >= 100)`,
            sql`${schema.tenantPromotions.endsAt} > now()`,
          ),
        )
        .limit(1);
      if (promo) {
        await db.transaction(async (tx) => {
          await tx
            .update(schema.subscriptions)
            .set({ status: "trialing", currentPeriodEnd: promo.endsAt, pastDueSince: null, dunningStage: 0, paymentRequired: false, updatedAt: new Date() })
            .where(eq(schema.subscriptions.id, authorised.id));
          if (authorised.planId) {
            const planRow = await tx.execute<{ code: string }>(sql`SELECT code FROM plans WHERE id = ${authorised.planId} LIMIT 1;`);
            const tier = tierForPlan(planRow.rows[0]?.code);
            await tx
              .insert(schema.tenantSizeTiers)
              .values({ tenantId: authorised.tenantId, tier })
              .onConflictDoUpdate({ target: schema.tenantSizeTiers.tenantId, set: { tier, updatedAt: new Date() } });
          }
        });
      }
    }
    return "subscription_authorised_noted";
  }

  if (ev.kind === "past_due") {
    // A charge failed: the gateway is retrying or gave up. The store is marked past due; limiting it after the grace
    // period is the dunning job's work (billing B5), not a webhook's.
    if (!ev.providerSubscriptionId) return "ignored";
    await db
      .update(schema.subscriptions)
      .set({ status: "past_due", pastDueSince: sql`COALESCE(${schema.subscriptions.pastDueSince}, now())`, updatedAt: new Date() })
      .where(eq(schema.subscriptions.providerSubscriptionId, ev.providerSubscriptionId));
    return "subscription_past_due";
  }

  if (ev.kind === "cancelled") {
    if (!ev.providerSubscriptionId) return "ignored";
    const subId = ev.providerSubscriptionId;
    if (ev.honourCancelAt) {
      // The gateway cancels at once, but the merchant paid for the period: keep the plan until cancelAt. A sweep ends it then.
      const [row] = await db.select({ cancelAt: schema.subscriptions.cancelAt }).from(schema.subscriptions).where(eq(schema.subscriptions.providerSubscriptionId, subId)).limit(1);
      if (row?.cancelAt && row.cancelAt.getTime() > Date.now()) return "subscription_cancel_scheduled";
    }
    await db.transaction(async (tx) => {
      const ended = await tx
        .update(schema.subscriptions)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(schema.subscriptions.providerSubscriptionId, subId))
        .returning({ tenantId: schema.subscriptions.tenantId });
      // The paid period is over: the store moves to the restricted tier until it subscribes again.
      for (const row of ended) {
        await tx
          .insert(schema.tenantSizeTiers)
          .values({ tenantId: row.tenantId, tier: LAPSED_TRIAL_TIER })
          .onConflictDoUpdate({ target: schema.tenantSizeTiers.tenantId, set: { tier: LAPSED_TRIAL_TIER, updatedAt: new Date() } });
        await enforceExtraMarketsQuota(tx, row.tenantId, 0);
      }
    });
    return "subscription_cancelled";
  }

  // resumed
  if (!ev.providerSubscriptionId) return "ignored";
  await db
    .update(schema.subscriptions)
    .set({ status: "active", pastDueSince: null, dunningStage: 0, updatedAt: new Date() })
    .where(eq(schema.subscriptions.providerSubscriptionId, ev.providerSubscriptionId));
  return "subscription_resumed";
}

/**
 * Claims the event atomically, runs `normalize` + the applier, and records the outcome in webhook_inbox.
 * Concurrent deliveries of the same event race on the unique (provider, event_id) key: exactly one wins the row and
 * processes it; the others see a duplicate. A previously failed event, or one stuck in 'processing' for over 5 minutes
 * (crashed handler), can be re-claimed.
 */
async function processBillingWebhook(
  db: Db,
  inboxProvider: "razorpay_platform" | "cashfree_platform" | "paypal_platform",
  eventId: string,
  payload: unknown,
  normalize: () => BillingEvent,
): Promise<PlatformBillingWebhookResult> {
  const claim = await db.execute<{ id: string }>(sql`
    INSERT INTO webhook_inbox (provider, event_id, signature_valid, payload_sanitized, status, attempts)
    VALUES (${inboxProvider}, ${eventId}, true, ${JSON.stringify(payload)}::jsonb, 'processing', 1)
    ON CONFLICT (provider, event_id) DO UPDATE
      SET status = 'processing', attempts = webhook_inbox.attempts + 1, updated_at = now(), error = NULL
      WHERE webhook_inbox.status = 'failed'
         OR (webhook_inbox.status = 'processing' AND webhook_inbox.updated_at < now() - interval '5 minutes')
    RETURNING id;
  `);
  if (claim.rows.length === 0) {
    return { received: true, eventId, duplicate: true, actionTaken: "already_processed" };
  }

  try {
    const actionTaken = await applyBillingEvent(db, normalize());
    await db
      .update(schema.webhookInbox)
      .set({ status: "processed", processedAt: new Date() })
      .where(and(eq(schema.webhookInbox.provider, inboxProvider), eq(schema.webhookInbox.eventId, eventId)));
    return { received: true, eventId, actionTaken };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await db
      .update(schema.webhookInbox)
      .set({ status: "failed", error: errorMsg })
      .where(and(eq(schema.webhookInbox.provider, inboxProvider), eq(schema.webhookInbox.eventId, eventId)));
    throw err;
  }
}

/**
 * A webhook that failed its signature check leaves one bounded trace (a single row per gateway, updated each time) so the owner
 * can see in Super Admin that deliveries are arriving but the secret does not match. Nothing from the body is kept but its event type.
 */
async function recordRejectedBillingWebhook(db: Db, provider: "razorpay_platform" | "cashfree_platform" | "paypal_platform", rawBody: string): Promise<void> {
  try {
    let type = "unknown";
    try {
      const parsed = JSON.parse(rawBody) as { type?: unknown; event?: unknown };
      type = String(parsed.type ?? parsed.event ?? "unknown").slice(0, 80);
    } catch {
      // not JSON
    }
    await db.execute(sql`
      INSERT INTO webhook_inbox (provider, event_id, signature_valid, payload_sanitized, status, attempts, error)
      VALUES (${provider}, 'rejected_latest', false, ${JSON.stringify({ type })}::jsonb, 'rejected', 1, 'The signature did not match the saved secret')
      ON CONFLICT (provider, event_id) DO UPDATE
        SET attempts = webhook_inbox.attempts + 1, payload_sanitized = EXCLUDED.payload_sanitized, status = 'rejected', updated_at = now();
    `);
  } catch {
    // diagnostics only: never let it change the answer to the gateway
  }
}

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

/**
 * Handles incoming Razorpay webhooks on /api/webhooks/platform-billing (ADR-014).
 * Fails closed on signature check, saves to webhook_inbox, and processes lifecycle events.
 */
export async function handlePlatformBillingWebhook(
  rt: Runtime,
  params: {
    rawBody: string;
    signature: string;
    provider?: SubscriptionBillingProvider;
    headers?: Record<string, string | string[] | undefined> | Headers;
    eventId?: string;
  },
): Promise<PlatformBillingWebhookResult> {
  const db = saasDb(rt);
  // Verified by Razorpay's keys even while Cashfree is the active gateway: existing Razorpay subscriptions keep charging.
  const billingProvider = params.provider ?? (await resolveBillingProvider(db, "razorpay"));

  // 1. Signature Verification (Fails closed per ADR-014)
  if (!billingProvider.verifyWebhookSignature(params.rawBody, params.signature)) {
    await recordRejectedBillingWebhook(db, "razorpay_platform", params.rawBody);
    throw badRequest("Invalid platform billing webhook signature");
  }

  interface RazorpayWebhookPayload {
    id?: string;
    event_id?: string;
    event?: string;
    payload?: {
      subscription?: { entity?: { id?: string; current_start?: number; current_end?: number; notes?: Record<string, string> } };
      payment?: { entity?: { id?: string; amount?: number; notes?: Record<string, string> } };
    };
  }

  let payload: RazorpayWebhookPayload;
  try {
    payload = JSON.parse(params.rawBody) as RazorpayWebhookPayload;
  } catch {
    throw badRequest("Invalid JSON payload");
  }

  const eventType = payload.event ?? "";

  // Take the idempotency key from the X-Razorpay-Event-Id header. If missing, use a hash of the raw body. Never use a random id.
  let eventId = params.eventId;
  if (!eventId && params.headers) {
    if (typeof (params.headers as Headers).get === "function") {
      eventId = (params.headers as Headers).get("x-razorpay-event-id") ?? undefined;
    } else {
      const h = params.headers as Record<string, string | string[] | undefined>;
      const val = h["x-razorpay-event-id"] ?? h["X-Razorpay-Event-Id"];
      eventId = Array.isArray(val) ? val[0] : val;
    }
  }
  if (!eventId && (payload.event_id || payload.id)) eventId = (payload.event_id || payload.id) as string;
  if (!eventId) eventId = createHash("sha256").update(params.rawBody).digest("hex");

  return processBillingWebhook(db, "razorpay_platform", eventId, payload, (): BillingEvent => {
    const subEntity = payload.payload?.subscription?.entity;
    const paymentEntity = payload.payload?.payment?.entity;
    if (eventType === "subscription.charged") {
      if (!paymentEntity || typeof paymentEntity.amount !== "number") {
        throw badRequest("Payment entity missing or invalid in subscription.charged webhook");
      }
      return {
        kind: "charged",
        providerSubscriptionId: subEntity?.id,
        tenantIdNote: subEntity?.notes?.tenant_id ?? paymentEntity.notes?.tenant_id,
        planCodeNote: subEntity?.notes?.plan_code ?? paymentEntity.notes?.plan_code,
        amountPaise: paymentEntity.amount,
        paymentId: paymentEntity.id ?? null,
        ...(subEntity?.current_start ? { currentStart: new Date(subEntity.current_start * 1000) } : {}),
        ...(subEntity?.current_end ? { currentEnd: new Date(subEntity.current_end * 1000) } : {}),
      };
    }
    if (eventType === "subscription.authenticated") return { kind: "authenticated", providerSubscriptionId: subEntity?.id, tenantIdNote: subEntity?.notes?.tenant_id };
    if (eventType === "subscription.pending" || eventType === "subscription.halted") return { kind: "past_due", providerSubscriptionId: subEntity?.id };
    if (eventType === "subscription.cancelled" || eventType === "subscription.completed") return { kind: "cancelled", providerSubscriptionId: subEntity?.id };
    if (eventType === "payment.failed") return { kind: "ignored", note: "payment_failed_noted" }; // recorded in the inbox for support
    if (eventType === "subscription.resumed" || eventType === "subscription.activated") return { kind: "resumed", providerSubscriptionId: subEntity?.id };
    return { kind: "ignored", note: "ignored" };
  });
}

/**
 * Handles incoming Cashfree subscription webhooks on /api/webhooks/platform-billing/cashfree (ADR-037).
 * Signed with the platform's Cashfree secret over `timestamp + raw body`; fails closed. Cashfree sends no event id, and a retry
 * carries the identical body, so the body's hash is the idempotency key.
 */
export async function handleCashfreeBillingWebhook(
  rt: Runtime,
  params: { rawBody: string; signature: string; timestamp: string; provider?: SubscriptionBillingProvider },
): Promise<PlatformBillingWebhookResult> {
  const db = saasDb(rt);
  const billingProvider = params.provider ?? (await resolveBillingProvider(db, "cashfree"));
  if (!billingProvider.verifyWebhookSignature(params.rawBody, params.signature, params.timestamp)) {
    await recordRejectedBillingWebhook(db, "cashfree_platform", params.rawBody);
    throw badRequest("Invalid platform billing webhook signature");
  }

  interface CashfreeWebhookPayload {
    type?: string;
    data?: {
      subscription_id?: string;
      cf_payment_id?: string | number;
      payment_id?: string;
      payment_type?: string;
      payment_amount?: number;
      payment_status?: string;
      authorization_details?: { authorization_status?: string };
      subscription_details?: { subscription_id?: string; subscription_status?: string };
    };
  }
  let payload: CashfreeWebhookPayload;
  try {
    payload = JSON.parse(params.rawBody) as CashfreeWebhookPayload;
  } catch {
    throw badRequest("Invalid JSON payload");
  }
  const eventId = `cf_${createHash("sha256").update(params.rawBody).digest("hex")}`;

  return processBillingWebhook(db, "cashfree_platform", eventId, payload, (): BillingEvent => {
    const type = payload.type ?? "";
    const d = payload.data ?? {};
    const subId = d.subscription_id ?? d.subscription_details?.subscription_id;
    // Authorisation payments (the refunded ₹1 mandate check) are not plan charges and must never be invoiced.
    const isCharge = d.payment_type === undefined || d.payment_type === "CHARGE";

    // The authorisation payment. A refunded 1 rupee check is not a plan charge, but when the first cycle is taken at authorisation the
    // authorisation payment IS the first plan payment (it arrives as an AUTH payment of the plan price). Real plan prices are far above
    // this floor, and one invoice is made per payment id either way.
    const isAuthPayment = d.payment_type === "AUTH";
    const authSucceeded = type === "SUBSCRIPTION_PAYMENT_SUCCESS" || d.payment_status === "SUCCESS" || d.authorization_details?.authorization_status === "ACTIVE";
    if ((type === "SUBSCRIPTION_AUTH_STATUS" || type === "SUBSCRIPTION_PAYMENT_SUCCESS") && isAuthPayment) {
      if (!authSucceeded) return { kind: "ignored", note: "authorisation_not_completed_noted" };
      if (typeof d.payment_amount === "number" && d.payment_amount >= AUTH_CHARGE_FLOOR_RUPEES) {
        const paymentId = d.cf_payment_id !== undefined ? String(d.cf_payment_id) : (d.payment_id ?? null);
        return { kind: "charged", providerSubscriptionId: subId, amountPaise: Math.round(d.payment_amount * 100), paymentId, currentStart: new Date(), currentEnd: "interval" };
      }
      return { kind: "authorised", providerSubscriptionId: subId };
    }
    if (type === "SUBSCRIPTION_AUTH_STATUS") return { kind: "ignored", note: "ignored" };

    if (type === "SUBSCRIPTION_PAYMENT_SUCCESS") {
      if (!isCharge) return { kind: "ignored", note: "authorisation_payment_noted" };
      if (typeof d.payment_amount !== "number") throw badRequest("Payment amount missing in SUBSCRIPTION_PAYMENT_SUCCESS webhook");
      const paymentId = d.cf_payment_id !== undefined ? String(d.cf_payment_id) : (d.payment_id ?? null);
      return { kind: "charged", providerSubscriptionId: subId, amountPaise: Math.round(d.payment_amount * 100), paymentId, currentStart: new Date(), currentEnd: "interval" };
    }
    if (type === "SUBSCRIPTION_PAYMENT_FAILED") {
      return isCharge ? { kind: "past_due", providerSubscriptionId: subId } : { kind: "ignored", note: "authorisation_failure_noted" };
    }
    if (type === "SUBSCRIPTION_STATUS_CHANGED") {
      const status = d.subscription_details?.subscription_status ?? "";
      // ACTIVE only means the mandate is authorised; the first charge may be deferred past a trial, so it does not activate the plan.
      if (status === "ACTIVE") return { kind: "authorised", providerSubscriptionId: subId };
      if (status === "ON_HOLD" || status === "CARD_EXPIRED") return { kind: "past_due", providerSubscriptionId: subId };
      if (status === "CANCELLED" || status === "CUSTOMER_CANCELLED" || status === "COMPLETED" || status === "EXPIRED") {
        return { kind: "cancelled", providerSubscriptionId: subId, honourCancelAt: true };
      }
      return { kind: "ignored", note: "ignored" };
    }
    return { kind: "ignored", note: "ignored" };
  });
}

/**
 * Handles PayPal billing webhooks (ADR-040 WP-5).
 * Inspects incoming CHECKOUT.ORDER.APPROVED and PAYMENT.CAPTURE.COMPLETED events,
 * verifies signature with PayPal's API (injectable for testing), and settles subscription state.
 */
export async function handlePayPalBillingWebhook(
  rt: Runtime,
  params: {
    rawBody: string;
    headers: Record<string, string | string[] | undefined>;
    provider?: SubscriptionBillingProvider;
    verifySignatureFn?: (headers: Record<string, string | string[] | undefined>, rawBody: string) => Promise<boolean>;
  },
): Promise<PlatformBillingWebhookResult> {
  const db = saasDb(rt);
  const creds = await loadPlatformBillingCredentials(db, "paypal");

  const parsed = (() => {
    try {
      return JSON.parse(params.rawBody) as Record<string, unknown>;
    } catch {
      throw badRequest("Invalid JSON in PayPal webhook payload");
    }
  })();

  // Signature verification
  let signatureValid = false;
  if (params.verifySignatureFn) {
    signatureValid = await params.verifySignatureFn(params.headers, params.rawBody);
  } else if (creds) {
    const paypal = new PayPalProvider({
      clientId: creds.keyId,
      clientSecret: creds.keySecret,
      webhookId: creds.webhookSecret ?? undefined,
      mode: creds.mode === "live" ? "live" : "sandbox",
    });
    const verified = await paypal.verifyWebhook(params.headers, params.rawBody);
    signatureValid = verified.isValid;
  }

  if (!signatureValid) {
    await recordRejectedBillingWebhook(db, "paypal_platform", params.rawBody);
    throw badRequest("Invalid platform billing webhook signature");
  }

  const eventId = String(parsed.id ?? `paypal_${Date.now()}`);
  const eventType = String(parsed.event_type ?? "");
  const resource = (parsed.resource ?? {}) as Record<string, unknown>;

  return processBillingWebhook(db, "paypal_platform", eventId, parsed, (): BillingEvent => {
    // 1. PAYMENT.CAPTURE.COMPLETED: A payment capture completed successfully
    if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
      const captureId = String(resource.id ?? "");
      const amountObj = resource.amount as { value?: string; currency_code?: string } | undefined;
      const currency = amountObj?.currency_code ?? "USD";
      const amountCents = amountObj?.value ? fromPayPalAmount(amountObj.value, currency) : 0;
      // In custom_id or supplementary_data, find tenant_id and plan_code
      let tenantIdNote: string | undefined;
      let planCodeNote: string | undefined;

      // Extract custom_id
      const customId = typeof resource.custom_id === "string" ? resource.custom_id : undefined;
      if (customId) {
        try {
          const parsedCustom = JSON.parse(customId) as { tenant_id?: string; plan_code?: string };
          tenantIdNote = parsedCustom.tenant_id;
          planCodeNote = parsedCustom.plan_code;
        } catch {
          // not JSON, might be raw tenantId
          tenantIdNote = customId;
        }
      }

      // Check supplementary_data or links for order id
      const supplementaryData = resource.supplementary_data as { related_ids?: { order_id?: string } } | undefined;
      const orderId = supplementaryData?.related_ids?.order_id;

      return {
        kind: "charged",
        providerSubscriptionId: orderId,
        tenantIdNote,
        planCodeNote,
        // Convert to minor units (for GST calculation & invoice, uses minor units)
        amountPaise: amountCents, // Stored as minor unit cents
        paymentId: captureId,
        currentStart: new Date(),
        currentEnd: "interval",
      };
    }

    // 2. CHECKOUT.ORDER.APPROVED: Order approved by merchant, capture may follow
    if (eventType === "CHECKOUT.ORDER.APPROVED") {
      const orderId = String(resource.id ?? "");
      const purchaseUnit = Array.isArray(resource.purchase_units) ? (resource.purchase_units[0] as Record<string, unknown> | undefined) : undefined;
      let tenantIdNote: string | undefined;
      let planCodeNote: string | undefined;
      const customId = typeof purchaseUnit?.custom_id === "string" ? purchaseUnit.custom_id : undefined;
      if (customId) {
        try {
          const parsedCustom = JSON.parse(customId) as { tenant_id?: string; plan_code?: string };
          tenantIdNote = parsedCustom.tenant_id;
          planCodeNote = parsedCustom.plan_code;
        } catch {
          tenantIdNote = customId;
        }
      }
      return {
        kind: "authenticated",
        providerSubscriptionId: orderId,
        tenantIdNote,
        ...(planCodeNote ? { planCodeNote } : {}),
      };
    }

    // 3. PAYMENT.CAPTURE.DENIED / DECLINED: Mark subscription past due
    if (eventType === "PAYMENT.CAPTURE.DENIED" || eventType === "PAYMENT.CAPTURE.DECLINED") {
      const supplementaryData = resource.supplementary_data as { related_ids?: { order_id?: string } } | undefined;
      const orderId = supplementaryData?.related_ids?.order_id ?? String(resource.id ?? "");
      return {
        kind: "past_due",
        providerSubscriptionId: orderId,
      };
    }

    return { kind: "ignored", note: "ignored" };
  });
}

/**
 * Ends Cashfree subscriptions whose paid period is over after the merchant cancelled. Cashfree cancels at once, so the
 * store keeps its plan until `cancelAt` (billing keeps what the merchant paid for), then drops to the restricted tier.
 */
export async function endDueCashfreeCancellations(rt: Runtime, now: Date = new Date()): Promise<{ ended: number }> {
  const db = rt._db.db;
  const due = await db
    .select({ id: schema.subscriptions.id, tenantId: schema.subscriptions.tenantId })
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.provider, "cashfree"), eq(schema.subscriptions.status, "active"), sql`${schema.subscriptions.cancelAt} IS NOT NULL AND ${schema.subscriptions.cancelAt} <= ${now.toISOString()}`))
    .limit(200);
  let ended = 0;
  for (const sub of due) {
    await db.transaction(async (tx) => {
      const upd = await tx
        .update(schema.subscriptions)
        .set({ status: "cancelled", updatedAt: now })
        .where(and(eq(schema.subscriptions.id, sub.id), eq(schema.subscriptions.status, "active")))
        .returning({ id: schema.subscriptions.id });
      if (upd.length === 0) return;
      await tx
        .insert(schema.tenantSizeTiers)
        .values({ tenantId: sub.tenantId, tier: LAPSED_TRIAL_TIER })
        .onConflictDoUpdate({ target: schema.tenantSizeTiers.tenantId, set: { tier: LAPSED_TRIAL_TIER, updatedAt: now } });
      await enforceExtraMarketsQuota(tx, sub.tenantId, 0);
      await tx.insert(schema.platformAuditLogs).values({
        actorType: "system",
        action: "billing.subscription_ended",
        targetType: "tenant",
        targetId: sub.tenantId,
        tenantId: sub.tenantId,
        diff: { subscriptionId: sub.id, reason: "cancelled_period_over" },
      });
      ended += 1;
    });
  }
  return { ended };
}

/**
 * Brings a Cashfree subscription up to date from Cashfree directly: that the merchant finished authorising, and that the first
 * payment was taken. The signed webhook is the primary route; this covers the merchant returning to the page before it arrives
 * and a webhook that never does. Best effort and short: any failure leaves things as they are. Returns true when something changed.
 */
export async function reconcileCashfreeSubscription(rt: Runtime, sub: typeof schema.subscriptions.$inferSelect): Promise<boolean> {
  if (sub.provider !== "cashfree" || !sub.providerSubscriptionId || sub.status === "cancelled") return false;
  const needsAuth = !sub.authorizedAt;
  const needsPayment = sub.status !== "active";
  if (!needsAuth && !needsPayment) return false;
  const subId = sub.providerSubscriptionId;
  try {
    const sdb = saasDb(rt);
    const provider = await resolveBillingProvider(sdb, "cashfree");
    if (!(provider instanceof CashfreeSubscriptionProvider) || !provider.isConfigured()) return false;
    const work = async (): Promise<boolean> => {
      let changed = false;
      const st = await provider.getSubscriptionState(subId);
      if (needsAuth && (st.status === "ACTIVE" || st.authorizationStatus === "ACTIVE")) {
        await sdb
          .update(schema.subscriptions)
          .set({ authorizedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(schema.subscriptions.id, sub.id), sql`${schema.subscriptions.authorizedAt} IS NULL`));
        changed = true;
      }
      if (needsPayment && st.authorizationPaymentId) {
        // The authorisation payment is the first plan payment when the plan price was taken at authorisation. Looking it up is a
        // bonus: if Cashfree cannot answer, what was learned above still counts.
        const paid = await provider.getSubscriptionPayment(subId, st.authorizationPaymentId).catch(() => undefined);
        if (paid && paid.status === "SUCCESS" && paid.id && paid.amountRupees >= AUTH_CHARGE_FLOOR_RUPEES) {
          await applyBillingEvent(sdb, {
            kind: "charged",
            providerSubscriptionId: subId,
            amountPaise: Math.round(paid.amountRupees * 100),
            paymentId: paid.id,
            currentStart: new Date(),
            currentEnd: "interval",
          });
          changed = true;
        }
      }
      return changed;
    };
    return await Promise.race([work(), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000))]);
  } catch {
    return false;
  }
}

/**
 * Retrieves the current subscription, plan, and invoice history for a tenant.
 */
export async function getTenantSubscription(
  rt: Runtime,
  tenantId: string,
) {
  const db = rt._db.db;

  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.tenantId, tenantId))
    .orderBy(desc(schema.subscriptions.createdAt))
    .limit(1);

  let currentPlan = null;
  if (sub?.planId) {
    const [p] = await db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.id, sub.planId))
      .limit(1);
    currentPlan = p ?? null;
  }

  const invoices = await db
    .select()
    .from(schema.platformInvoices)
    .where(eq(schema.platformInvoices.tenantId, tenantId))
    .orderBy(desc(schema.platformInvoices.issuedAt))
    .limit(20);

  const isTrial = sub?.status === "trialing";
  let daysLeftInTrial = 0;
  if (isTrial && sub?.currentPeriodEnd) {
    const msLeft = sub.currentPeriodEnd.getTime() - Date.now();
    daysLeftInTrial = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
  }

  return {
    subscription: sub ?? null,
    plan: currentPlan,
    invoices,
    isTrial,
    daysLeftInTrial,
  };
}

/**
 * Initiates an upgrade or plan change for a tenant.
 */
export async function changeTenantPlan(
  rt: Runtime,
  params: {
    tenantId: string;
    planCode: string;
    interval: "monthly" | "yearly";
    customerEmail: string;
    customerName?: string;
    /** Unix seconds of the first charge; set after a trial or free period so the merchant is not charged early. */
    startAt?: number;
    /** Cashfree requires the customer's phone for the mandate. */
    customerPhone?: string;
    /** Where the gateway returns the merchant after authorising (Cashfree). */
    returnUrl?: string;
    /** Charge the first cycle when the mandate is authorised (no trial or free period to wait for). */
    chargeFirstCycleNow?: boolean;
    firstPaymentPaise?: number;
    provider?: SubscriptionBillingProvider;
  },
) {
  const db = saasDb(rt);
  const billingProvider: SubscriptionBillingProvider = params.provider ?? (await resolveBillingProvider(db));
  const gateway: BillingProviderId = billingProvider.name ?? "razorpay";

  if (typeof billingProvider.isConfigured === "function" && !billingProvider.isConfigured()) {
    throw new Error(`Billing is not configured: missing ${gateway === "cashfree" ? "Cashfree" : "Razorpay"} credentials`);
  }

  const [plan] = await db
    .select()
    .from(schema.plans)
    .where(eq(schema.plans.code, params.planCode))
    .limit(1);

  if (!plan) {
    throw new Error(`Plan '${params.planCode}' not found`);
  }

  const pricePaise = params.interval === "yearly" ? plan.priceYearlyPaise : plan.priceMonthlyPaise;
  let razorpayPlanId: string | undefined;
  if (gateway === "razorpay") {
    // The plan synced for the active mode (Super Admin, Platform billing) wins; the old per-plan columns stay as a fallback.
    const activeMode = (await loadPlatformBillingCredentials(db, "razorpay"))?.mode ?? "test";
    const synced = await findRazorpayPlanId(db, plan.id, params.interval, activeMode, pricePaise);
    const features = plan.features as Record<string, unknown> | null;
    const planIds = features?.razorpay_plan_ids as Record<string, string> | undefined;
    razorpayPlanId =
      synced?.razorpayPlanId ??
      (params.interval === "yearly"
        ? plan.razorpayPlanIdYearly ?? planIds?.yearly
        : plan.razorpayPlanIdMonthly ?? planIds?.monthly);

    if (!razorpayPlanId) {
      throw new Error(
        `Plan '${plan.code}' has no Razorpay plan ID configured for interval '${params.interval}'. Please configure real Razorpay plan IDs.`,
      );
    }
  } else if (pricePaise <= 0) {
    throw new Error(`Plan '${plan.code}' has no price for interval '${params.interval}', so it cannot be charged.`);
  }

  // Create provider subscription (Cashfree defines the plan inline, so it needs the amount instead of a stored plan id)
  const result = await billingProvider.createSubscription({
    planCode: params.planCode,
    interval: params.interval,
    customerEmail: params.customerEmail,
    ...(params.customerName ? { customerName: params.customerName } : {}),
    ...(params.customerPhone ? { customerPhone: params.customerPhone } : {}),
    ...(params.returnUrl ? { returnUrl: params.returnUrl } : {}),
    ...(params.chargeFirstCycleNow ? { chargeFirstCycleNow: true } : {}),
    ...(params.firstPaymentPaise ? { firstPaymentPaise: params.firstPaymentPaise } : {}),
    tenantId: params.tenantId,
    ...(razorpayPlanId ? { planId: razorpayPlanId } : {}),
    ...(gateway === "cashfree" ? { amountPaise: pricePaise } : {}),
    ...(gateway === "paypal"
      ? {
          amountUsdCents:
            params.interval === "yearly"
              ? plan.priceYearlyUsdCents !== null
                ? Number(plan.priceYearlyUsdCents)
                : Math.round(plan.priceYearlyPaise / 80)
              : plan.priceMonthlyUsdCents !== null
              ? Number(plan.priceMonthlyUsdCents)
              : Math.round(plan.priceMonthlyPaise / 80),
        }
      : {}),
    ...(params.startAt ? { startAt: params.startAt } : {}),
  });

  // Update or insert subscription record
  // NOTE: Plan changes and activation take effect only after payment webhook confirms it.
  const [existingSub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.tenantId, params.tenantId))
    .orderBy(desc(schema.subscriptions.createdAt))
    .limit(1);

  if (existingSub) {
    await db
      .update(schema.subscriptions)
      .set({
        interval: params.interval,
        provider: gateway,
        providerSubscriptionId: result.providerSubscriptionId,
        updatedAt: new Date(),
      })
      .where(eq(schema.subscriptions.id, existingSub.id));
  } else {
    // The no-subscription branch must not insert an active subscription without payment.
    await db.insert(schema.subscriptions).values({
      tenantId: params.tenantId,
      planId: plan.id,
      interval: params.interval,
      status: "pending",
      provider: gateway,
      providerSubscriptionId: result.providerSubscriptionId,
    });
  }

  return {
    providerSubscriptionId: result.providerSubscriptionId,
    shortUrl: result.shortUrl,
    checkoutSession: result.checkoutSession,
    status: result.status,
    plan,
  };
}

/**
 * Cancels a tenant's subscription.
 */
export async function cancelTenantSubscription(
  rt: Runtime,
  tenantId: string,
  provider?: SubscriptionBillingProvider,
): Promise<{ status: string; cancelAt: Date | null }> {
  const db = saasDb(rt);

  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.tenantId, tenantId))
    .orderBy(desc(schema.subscriptions.createdAt))
    .limit(1);

  // The gateway that created the subscription cancels it, even if another gateway is the active one now.
  const billingProvider = provider ?? (await resolveBillingProvider(db, sub ? (sub.provider === "cashfree" ? "cashfree" : sub.provider === "paypal" ? "paypal" : "razorpay") : undefined));
  if (typeof billingProvider.isConfigured === "function" && !billingProvider.isConfigured()) {
    throw new Error(`Billing is not configured: missing ${billingProvider.name === "paypal" ? "PayPal" : billingProvider.name === "cashfree" ? "Cashfree" : "Razorpay"} credentials`);
  }

  if (!sub || !sub.providerSubscriptionId) {
    throw new Error("No active subscription found to cancel");
  }

  // An active subscription is cancelled at the end of the paid period (the merchant keeps what they paid for); one that
  // never started charging is cancelled at once. Razorpay ends it at the period end itself; Cashfree can only cancel at
  // once, so cancelAt is kept here and endDueCashfreeCancellations ends the plan when the period is over.
  const atCycleEnd = sub.status === "active";
  const res = await billingProvider.cancelSubscription(sub.providerSubscriptionId, { atCycleEnd });
  if (!atCycleEnd) {
    // Nothing was ever charged (still on the trial, or the payment method was never finished): stopping automatic payment must not
    // end the trial. The subscription link is dropped, so the gateway's own "cancelled" event finds no store to change, and the
    // merchant can set up payment again.
    await db
      .update(schema.subscriptions)
      .set({ providerSubscriptionId: null, authorizedAt: null, cancelAt: null, updatedAt: new Date() })
      .where(eq(schema.subscriptions.id, sub.id));
    return { ...res, cancelAt: null };
  }
  const cancelAt = sub.currentPeriodEnd ?? null;
  await db.update(schema.subscriptions).set({ cancelAt, updatedAt: new Date() }).where(eq(schema.subscriptions.id, sub.id));
  return { ...res, cancelAt };
}
