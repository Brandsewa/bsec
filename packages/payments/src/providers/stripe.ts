import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  AuthorizeResult,
  CancelResult,
  CaptureResult,
  IntentResult,
  OrderForPayment,
  PaymentIntentModel,
  PaymentProvider,
  ProviderPayment,
  ReconciliationReport,
  RefundResult,
  TenantContext,
  VerifiedWebhookEvent,
} from "../types.ts";
import { sanitizePaymentPayload } from "./razorpay.ts";

/**
 * Stripe payment provider (ADR-008, ADMIN-IMPROVEMENTS-PLAN §6.4).
 *
 * Two ways to take a card. Without a publishable key the store uses Stripe-hosted Checkout (a redirect to stripe.com).
 * With one it uses the Payment Element: Stripe's own iframe fields inside our checkout page, on a PaymentIntent
 * (ADR-047). Either way card data never touches our code. Talks to Stripe's REST API with `fetch` (no SDK dependency), with the API
 * version pinned so Stripe changes cannot alter behaviour under us. Amounts are the smallest currency unit (paise).
 * Per-store keys come from tenant_secrets, never from environment variables.
 */
export const STRIPE_API_VERSION = "2025-09-30.clover";
/**
 * Stripe.js release train that matches STRIPE_API_VERSION. The storefront loads this train explicitly instead of the moving
 * default, so a Stripe.js change cannot alter behaviour under us. Move both together.
 */
export const STRIPE_JS_TRAIN = "clover";
export const STRIPE_JS_URL = `https://js.stripe.com/${STRIPE_JS_TRAIN}/stripe.js`;
const STRIPE_BASE = "https://api.stripe.com";
/** Stripe's own recommendation for webhook replay protection. */
export const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;

export interface StripeProviderOptions {
  secretKey?: string | undefined;
  webhookSecret?: string | undefined;
  /** Where Stripe sends the shopper after paying or cancelling. Required to create a Checkout Session (hosted mode). */
  successUrl?: string | undefined;
  cancelUrl?: string | undefined;
  /**
   * "hosted" (default) redirects the shopper to stripe.com. "elements" creates a PaymentIntent and returns its client secret,
   * which the checkout page confirms with the Payment Element, so the shopper never leaves the page.
   */
  uiMode?: "hosted" | "elements" | undefined;
  /** Makes the idempotency key unique for a replacement PaymentIntent after the previous one was cancelled. */
  idempotencySalt?: string | undefined;
  fetchFn?: typeof fetch | undefined;
  /** Injected clock for signature tolerance tests (unix seconds). */
  nowSeconds?: (() => number) | undefined;
}

function toForm(params: Record<string, string | number | undefined>): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) out.append(k, String(v));
  }
  return out.toString();
}

export class StripeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "StripeApiError";
  }
}

/** Strips anything that looks like a key from an error string before it reaches logs or the UI. */
export function redactStripeSecrets(text: string, secrets: Array<string | undefined> = []): string {
  let out = text.replace(/\b(sk|rk|pk|whsec)_(test|live)?_?[A-Za-z0-9]{6,}/g, "[REDACTED]");
  for (const s of secrets) {
    if (s && s.length >= 6) out = out.split(s).join("[REDACTED]");
  }
  return out.slice(0, 300);
}

export class StripeProvider implements PaymentProvider {
  readonly name = "stripe";
  private readonly secretKey: string | undefined;
  private readonly webhookSecret: string | undefined;
  private readonly successUrl: string | undefined;
  private readonly cancelUrl: string | undefined;
  private readonly uiMode: "hosted" | "elements";
  private readonly idempotencySalt: string | undefined;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;

  constructor(opts: StripeProviderOptions = {}) {
    this.secretKey = opts.secretKey;
    this.webhookSecret = opts.webhookSecret;
    this.successUrl = opts.successUrl;
    this.cancelUrl = opts.cancelUrl;
    this.uiMode = opts.uiMode ?? "hosted";
    this.idempotencySalt = opts.idempotencySalt;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
    this.now = opts.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  }

  private async call<T>(
    method: "GET" | "POST",
    path: string,
    form?: Record<string, string | number | undefined>,
    idempotencyKey?: string,
  ): Promise<T> {
    if (!this.secretKey) throw new Error("Stripe secret key is required for API calls");
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.secretKey}`,
      "Stripe-Version": STRIPE_API_VERSION,
    };
    if (form) headers["Content-Type"] = "application/x-www-form-urlencoded";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    const res = await this.fetchFn(`${STRIPE_BASE}${path}`, {
      method,
      headers,
      ...(form ? { body: toForm(form) } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = (data.error ?? {}) as { message?: string; code?: string };
      throw new StripeApiError(
        redactStripeSecrets(err.message ?? `Stripe returned HTTP ${res.status}`, [this.secretKey, this.webhookSecret]),
        res.status,
        err.code,
      );
    }
    return data as T;
  }

  /**
   * Checks that the secret key works (GET /v1/balance) and reports whether it is a live or test key.
   * Used by "Test connection" in Store Admin; never moves money.
   */
  async testConnection(): Promise<{ ok: boolean; livemode?: boolean; error?: string }> {
    try {
      const balance = await this.call<{ livemode?: boolean }>("GET", "/v1/balance");
      return { ok: true, livemode: Boolean(balance.livemode) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Stripe connection failed" };
    }
  }

  /**
   * Creates what the shopper pays: a Stripe-hosted Checkout Session (redirect), or in "elements" mode a PaymentIntent whose
   * client secret the checkout page confirms with the Payment Element. Both carry the tenant and order ids in metadata.
   */
  async createIntent(ctx: TenantContext, order: OrderForPayment): Promise<IntentResult> {
    const amount = Math.round(Number(order.grandTotal));
    const currency = (order.currency ?? "INR").toLowerCase();
    if (this.uiMode === "elements") {
      const pi = await this.call<{ id: string; status?: string; client_secret?: string }>(
        "POST",
        "/v1/payment_intents",
        {
          amount,
          currency,
          "automatic_payment_methods[enabled]": "true",
          description: `Order ${order.number}`,
          receipt_email: order.email || undefined,
          "metadata[tenant_id]": ctx.tenantId,
          "metadata[order_id]": order.id,
        },
        `bsec-pi-${order.id}${this.idempotencySalt ? `-${this.idempotencySalt}` : ""}`,
      );
      return {
        providerOrderId: pi.id,
        amount,
        currency: currency.toUpperCase(),
        status: "requires_action",
        ...(pi.client_secret ? { clientSecret: pi.client_secret } : {}),
        meta: { checkoutUrl: null, paymentIntentStatus: pi.status ?? null },
      };
    }
    if (!this.successUrl || !this.cancelUrl) throw new Error("Stripe success and cancel URLs are required to create a Checkout Session");
    const session = await this.call<{ id: string; url?: string; status?: string }>(
      "POST",
      "/v1/checkout/sessions",
      {
        mode: "payment",
        "line_items[0][quantity]": 1,
        "line_items[0][price_data][currency]": currency,
        "line_items[0][price_data][unit_amount]": amount,
        "line_items[0][price_data][product_data][name]": `Order ${order.number}`,
        success_url: this.successUrl,
        cancel_url: this.cancelUrl,
        client_reference_id: order.id,
        customer_email: order.email || undefined,
        "metadata[tenant_id]": ctx.tenantId,
        "metadata[order_id]": order.id,
        "payment_intent_data[metadata][tenant_id]": ctx.tenantId,
        "payment_intent_data[metadata][order_id]": order.id,
      },
      `bsec-checkout-${order.id}`,
    );
    return {
      providerOrderId: session.id,
      amount,
      currency: currency.toUpperCase(),
      status: "requires_action",
      meta: { checkoutUrl: session.url ?? null, sessionStatus: session.status ?? null },
    };
  }

  /**
   * Reads a PaymentIntent the checkout page confirmed, so the shopper's return can settle the order without waiting for the
   * webhook. `clientSecret` is returned only while it can still be paid, so a reload can mount the same payment again.
   */
  async retrievePaymentIntent(id: string): Promise<{
    status: string;
    amount: number;
    amountReceived: number;
    currency: string;
    orderId: string | null;
    clientSecret: string | null;
  }> {
    const p = await this.call<{ status: string; amount: number; amount_received?: number; currency: string; client_secret?: string | null; metadata?: Record<string, string> }>(
      "GET",
      `/v1/payment_intents/${encodeURIComponent(id)}`,
    );
    const payable = p.status === "requires_payment_method" || p.status === "requires_confirmation" || p.status === "requires_action";
    return {
      status: p.status,
      amount: Number(p.amount),
      amountReceived: Number(p.amount_received ?? 0),
      currency: p.currency.toUpperCase(),
      orderId: p.metadata?.order_id ?? null,
      clientSecret: payable ? (p.client_secret ?? null) : null,
    };
  }

  /** Reads a Checkout Session, so the shopper's return can settle the order without waiting for the webhook. */
  async retrieveSession(sessionId: string): Promise<{
    paymentStatus: string;
    /** "open", "complete" or "expired". */
    status: string;
    amountTotal: number | null;
    currency: string | null;
    paymentIntentId: string | null;
    orderId: string | null;
  }> {
    const s = await this.call<{ status?: string; payment_status?: string; amount_total?: number; currency?: string; payment_intent?: string | null; client_reference_id?: string | null }>(
      "GET",
      `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    );
    return {
      paymentStatus: s.payment_status ?? "unpaid",
      status: s.status ?? "open",
      amountTotal: typeof s.amount_total === "number" ? s.amount_total : null,
      currency: s.currency ? s.currency.toUpperCase() : null,
      paymentIntentId: s.payment_intent ?? null,
      orderId: s.client_reference_id ?? null,
    };
  }

  /** Stripe Checkout captures automatically, so "authorize" reads the session's payment state. */
  async authorize(_ctx: TenantContext, intent: PaymentIntentModel): Promise<AuthorizeResult> {
    const pi = intent.providerPaymentId;
    if (!pi) throw new Error("Cannot authorize payment without providerPaymentId");
    const payment = await this.call<{ id: string; status: string }>("GET", `/v1/payment_intents/${encodeURIComponent(pi)}`);
    const ok = payment.status === "succeeded" || payment.status === "requires_capture";
    return { status: ok ? "authorized" : "failed", providerPaymentId: payment.id };
  }

  async capture(_ctx: TenantContext, intent: PaymentIntentModel, amount: bigint | number): Promise<CaptureResult> {
    const pi = intent.providerPaymentId;
    if (!pi) throw new Error("Cannot capture payment without providerPaymentId");
    const payment = await this.call<{ id: string; status: string; amount_received?: number }>(
      "GET",
      `/v1/payment_intents/${encodeURIComponent(pi)}`,
    );
    if (payment.status !== "succeeded") {
      return { status: "failed", providerPaymentId: payment.id, errorMessage: `Payment is ${payment.status}` };
    }
    const received = Number(payment.amount_received ?? amount);
    return { status: "captured", providerPaymentId: payment.id, amountCaptured: received };
  }

  /** Expires an unpaid Checkout Session, or cancels an unpaid PaymentIntent, so the shopper can no longer pay it. */
  async cancel(_ctx: TenantContext, intent: PaymentIntentModel): Promise<CancelResult> {
    const sessionId = intent.providerOrderId;
    if (!sessionId) return { status: "cancelled" };
    try {
      // A PaymentIntent (Payment Element) is cancelled; a hosted Checkout Session is expired.
      const path = sessionId.startsWith("pi_") ? `/v1/payment_intents/${encodeURIComponent(sessionId)}/cancel` : `/v1/checkout/sessions/${encodeURIComponent(sessionId)}/expire`;
      await this.call("POST", path, {});
      return { status: "cancelled" };
    } catch (err) {
      return { status: "failed", errorMessage: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Full or partial refund (POST /v1/refunds). Idempotent per payment, amount and reason. */
  async refund(
    _ctx: TenantContext,
    payment: { intentId: string; providerPaymentId?: string | null | undefined },
    amount: bigint | number,
    reason?: string,
  ): Promise<RefundResult> {
    const pi = payment.providerPaymentId;
    if (!pi) throw new Error("Cannot refund payment without providerPaymentId");
    const amt = Math.round(Number(amount));
    const refund = await this.call<{ id: string; status: string; amount: number }>(
      "POST",
      "/v1/refunds",
      {
        payment_intent: pi,
        amount: amt,
        "metadata[reason]": reason ?? "customer_requested",
      },
      `bsec-refund-${payment.intentId}-${amt}-${reason ?? "customer_requested"}`,
    );
    return {
      providerRefundId: refund.id,
      status: refund.status === "succeeded" ? "processed" : refund.status === "failed" || refund.status === "canceled" ? "failed" : "pending",
      amount: Number(refund.amount),
    };
  }

  /**
   * Verifies the `Stripe-Signature` header: HMAC-SHA256 of `${timestamp}.${rawBody}` with the store's own
   * signing secret, compared in constant time, rejecting timestamps outside the tolerance window.
   * No fallback to shared secrets: a store without its own webhook secret can never verify.
   */
  async verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string | Buffer,
  ): Promise<VerifiedWebhookEvent> {
    const header = headers["stripe-signature"] ?? headers["Stripe-Signature"];
    const sigHeader = Array.isArray(header) ? header[0] : header;
    const bodyStr = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(bodyStr) as Record<string, unknown>;
    } catch {
      // malformed JSON stays invalid below
    }

    let isValid = false;
    if (sigHeader && this.webhookSecret) {
      const parts = sigHeader.split(",").map((p) => p.trim());
      const t = parts.find((p) => p.startsWith("t="))?.slice(2);
      const v1s = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
      const ts = Number(t);
      if (t && Number.isFinite(ts) && Math.abs(this.now() - ts) <= STRIPE_WEBHOOK_TOLERANCE_SECONDS) {
        const expected = createHmac("sha256", this.webhookSecret).update(`${t}.${bodyStr}`).digest("hex");
        const expBuf = Buffer.from(expected, "utf8");
        isValid = v1s.some((sig) => {
          const sigBuf = Buffer.from(sig, "utf8");
          return sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
        });
      }
    }

    const obj = ((parsed.data as Record<string, unknown> | undefined)?.object ?? {}) as Record<string, unknown>;
    const metadata = (obj.metadata ?? {}) as Record<string, unknown>;
    const eventType = typeof parsed.type === "string" ? parsed.type : "unknown";
    const isSession = eventType.startsWith("checkout.session.");
    const paymentIntentId =
      typeof obj.payment_intent === "string" ? obj.payment_intent : eventType.startsWith("payment_intent.") && typeof obj.id === "string" ? obj.id : undefined;
    const amount =
      typeof obj.amount_total === "number" ? obj.amount_total : typeof obj.amount === "number" ? obj.amount : undefined;

    return {
      isValid,
      provider: "stripe",
      eventId: typeof parsed.id === "string" ? parsed.id : "unknown",
      eventType,
      orderId: typeof metadata.order_id === "string" ? metadata.order_id : undefined,
      // A Checkout Session's own id, or a PaymentIntent's id (the Payment Element saves it as the order's provider reference).
      providerOrderId: (isSession || eventType.startsWith("payment_intent.")) && typeof obj.id === "string" ? obj.id : undefined,
      providerPaymentId: paymentIntentId,
      amount,
      rawPayload: sanitizePaymentPayload(parsed),
    };
  }

  async getPayment(_ctx: TenantContext, providerPaymentId: string): Promise<ProviderPayment> {
    const p = await this.call<{
      id: string;
      status: string;
      amount: number;
      currency: string;
      amount_received?: number;
      created: number;
      receipt_email?: string | null;
    }>("GET", `/v1/payment_intents/${encodeURIComponent(providerPaymentId)}`);
    const status: ProviderPayment["status"] =
      p.status === "succeeded" ? "captured" : p.status === "requires_capture" ? "authorized" : p.status === "canceled" ? "failed" : "created";
    return {
      id: p.id,
      status,
      amount: p.amount,
      currency: p.currency.toUpperCase(),
      email: p.receipt_email ?? undefined,
      captured: p.status === "succeeded",
      createdAt: new Date(p.created * 1000),
    };
  }

  async reconcile(_ctx: TenantContext, date: Date | string): Promise<ReconciliationReport> {
    const target = typeof date === "string" ? new Date(date) : date;
    const start = new Date(target);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(target);
    end.setUTCHours(23, 59, 59, 999);
    const list = await this.call<{ data: Array<{ status: string; amount_received?: number; amount: number }> }>(
      "GET",
      `/v1/payment_intents?limit=100&created[gte]=${Math.floor(start.getTime() / 1000)}&created[lte]=${Math.floor(end.getTime() / 1000)}`,
    );
    let total = 0;
    let count = 0;
    for (const p of list.data ?? []) {
      if (p.status === "succeeded") {
        total += Number(p.amount_received ?? p.amount);
        count += 1;
      }
    }
    return {
      date: start.toISOString().slice(0, 10),
      totalPaymentsCount: count,
      totalAmountCaptured: total,
      totalRefundsAmount: 0,
      discrepancies: [],
    };
  }
}
