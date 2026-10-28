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
 * PayPal payment provider (ADR-040 section 5, docs/MULTIMARKET-PLAN.md section 6.5).
 *
 * Orders v2 with a hosted approval page (a redirect to paypal.com): card and wallet data never touch our pages and no
 * PayPal script is added to the storefront. Talks to PayPal's REST API with `fetch` (no SDK). Per-store credentials come
 * from tenant_secrets, never from environment variables. Money goes to the merchant's own PayPal account.
 * Amounts arrive as integer minor units and are sent as PayPal decimal strings using the currency's exponent.
 */
export const PAYPAL_LIVE_BASE = "https://api-m.paypal.com";
export const PAYPAL_SANDBOX_BASE = "https://api-m.sandbox.paypal.com";

const ZERO_DECIMAL = new Set(["JPY", "HUF", "TWD"]);

export function paypalExponent(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

/** 1250 USD cents -> "12.50"; 500 JPY -> "500". */
export function toPayPalAmount(minor: number, currency: string): string {
  const exp = paypalExponent(currency);
  return exp === 0 ? String(Math.round(minor)) : (Math.round(minor) / 100).toFixed(2);
}

/** "12.50" -> 1250. */
export function fromPayPalAmount(value: string | number, currency: string): number {
  const exp = paypalExponent(currency);
  return Math.round(Number(value) * 10 ** exp);
}

export interface PayPalProviderOptions {
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  /** The webhook id PayPal assigns when the merchant registers the webhook URL; needed to verify signatures. */
  webhookId?: string | undefined;
  mode?: "sandbox" | "live" | undefined;
  returnUrl?: string | undefined;
  cancelUrl?: string | undefined;
  brandName?: string | undefined;
  fetchFn?: typeof fetch | undefined;
}

export class PayPalApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "PayPalApiError";
  }
}

/** Strips anything that looks like a credential before it reaches logs or the UI. */
export function redactPayPalSecrets(text: string, secrets: Array<string | undefined> = []): string {
  let out = text.replace(/\bA[A-Za-z0-9_-]{40,}\b/g, "[REDACTED]").replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]");
  for (const s of secrets) {
    if (s && s.length >= 6) out = out.split(s).join("[REDACTED]");
  }
  return out.slice(0, 300);
}

interface PayPalLink {
  href: string;
  rel: string;
}

export class PayPalProvider implements PaymentProvider {
  readonly name = "paypal";
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly webhookId: string | undefined;
  private readonly base: string;
  private readonly returnUrl: string | undefined;
  private readonly cancelUrl: string | undefined;
  private readonly brandName: string | undefined;
  private readonly fetchFn: typeof fetch;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(opts: PayPalProviderOptions = {}) {
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.webhookId = opts.webhookId;
    this.base = opts.mode === "live" ? PAYPAL_LIVE_BASE : PAYPAL_SANDBOX_BASE;
    this.returnUrl = opts.returnUrl;
    this.cancelUrl = opts.cancelUrl;
    this.brandName = opts.brandName;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
  }

  private async accessToken(): Promise<string> {
    if (!this.clientId || !this.clientSecret) throw new Error("PayPal client id and secret are required for API calls");
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const res = await this.fetchFn(`${this.base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!res.ok || !data.access_token) {
      throw new PayPalApiError(redactPayPalSecrets(data.error_description ?? `PayPal returned HTTP ${res.status}`, [this.clientId, this.clientSecret]), res.status);
    }
    this.token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 300) * 1000 };
    return this.token.value;
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown, requestId?: string): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${await this.accessToken()}`, "Content-Type": "application/json" };
    if (requestId) headers["PayPal-Request-Id"] = requestId;
    const res = await this.fetchFn(`${this.base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const details = Array.isArray(data.details) ? (data.details[0] as { issue?: string; description?: string } | undefined) : undefined;
      throw new PayPalApiError(
        redactPayPalSecrets(details?.description ?? (typeof data.message === "string" ? data.message : `PayPal returned HTTP ${res.status}`), [this.clientId, this.clientSecret]),
        res.status,
        details?.issue ?? (typeof data.name === "string" ? data.name : undefined),
      );
    }
    return data as T;
  }

  /** Checks the credentials by asking for an access token. Never moves money. */
  async testConnection(): Promise<{ ok: boolean; mode?: "sandbox" | "live"; error?: string }> {
    try {
      this.token = null;
      await this.accessToken();
      return { ok: true, mode: this.base === PAYPAL_LIVE_BASE ? "live" : "sandbox" };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "PayPal connection failed" };
    }
  }

  /** Creates a PayPal order for the shop order total and returns the hosted approval link. */
  async createIntent(ctx: TenantContext, order: OrderForPayment): Promise<IntentResult> {
    if (!this.returnUrl || !this.cancelUrl) throw new Error("PayPal return and cancel URLs are required to create an order");
    const currency = (order.currency ?? "USD").toUpperCase();
    const amount = Math.round(Number(order.grandTotal));
    const created = await this.call<{ id: string; status: string; links?: PayPalLink[] }>(
      "POST",
      "/v2/checkout/orders",
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: order.id,
            custom_id: order.id,
            invoice_id: order.number,
            description: `Order ${order.number}`,
            amount: { currency_code: currency, value: toPayPalAmount(amount, currency) },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              ...(this.brandName ? { brand_name: this.brandName } : {}),
              shipping_preference: "NO_SHIPPING",
              user_action: "PAY_NOW",
              return_url: this.returnUrl,
              cancel_url: this.cancelUrl,
            },
          },
        },
      },
      `bsec-checkout-${order.id}`,
    );
    const approve = created.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href ?? null;
    return {
      providerOrderId: created.id,
      amount,
      currency,
      status: "requires_action",
      meta: { checkoutUrl: approve, tenantId: ctx.tenantId },
    };
  }

  /**
   * Captures an order the shopper approved (called when they return from PayPal). Returns the capture id and the amount
   * and currency PayPal reports, so the server can check them against the shop order before marking it paid.
   */
  async captureOrder(providerOrderId: string): Promise<{ status: "captured" | "pending" | "failed"; captureId?: string; amount?: number; currency?: string; errorMessage?: string }> {
    try {
      const res = await this.call<{
        status: string;
        purchase_units?: Array<{ payments?: { captures?: Array<{ id: string; status: string; amount?: { currency_code: string; value: string } }> } }>;
      }>("POST", `/v2/checkout/orders/${encodeURIComponent(providerOrderId)}/capture`, {}, `bsec-capture-${providerOrderId}`);
      const capture = res.purchase_units?.[0]?.payments?.captures?.[0];
      if (!capture) return { status: "failed", errorMessage: `PayPal order is ${res.status}` };
      const currency = capture.amount?.currency_code;
      const amount = capture.amount && currency ? fromPayPalAmount(capture.amount.value, currency) : undefined;
      return {
        status: capture.status === "COMPLETED" ? "captured" : capture.status === "PENDING" ? "pending" : "failed",
        captureId: capture.id,
        ...(amount !== undefined ? { amount } : {}),
        ...(currency ? { currency } : {}),
      };
    } catch (err) {
      return { status: "failed", errorMessage: err instanceof Error ? err.message : String(err) };
    }
  }

  async authorize(_ctx: TenantContext, intent: PaymentIntentModel): Promise<AuthorizeResult> {
    if (!intent.providerOrderId) throw new Error("Cannot authorize payment without providerOrderId");
    const order = await this.call<{ status: string }>("GET", `/v2/checkout/orders/${encodeURIComponent(intent.providerOrderId)}`);
    return { status: order.status === "APPROVED" || order.status === "COMPLETED" ? "authorized" : "failed", providerPaymentId: intent.providerPaymentId ?? undefined };
  }

  async capture(_ctx: TenantContext, intent: PaymentIntentModel, amount: bigint | number): Promise<CaptureResult> {
    if (!intent.providerOrderId) throw new Error("Cannot capture payment without providerOrderId");
    const res = await this.captureOrder(intent.providerOrderId);
    if (res.status !== "captured") return { status: "failed", ...(res.captureId ? { providerPaymentId: res.captureId } : {}), errorMessage: res.errorMessage ?? "Payment was not completed" };
    return { status: "captured", providerPaymentId: res.captureId, amountCaptured: res.amount ?? amount };
  }

  /** PayPal orders that were never approved simply expire; there is nothing to cancel on PayPal's side. */
  async cancel(_ctx: TenantContext, _intent: PaymentIntentModel): Promise<CancelResult> {
    return { status: "cancelled" };
  }

  /** Full or partial refund of a capture (POST /v2/payments/captures/{id}/refund), in the currency that was charged. */
  async refund(
    _ctx: TenantContext,
    payment: { intentId: string; providerPaymentId?: string | null | undefined },
    amount: bigint | number,
    reason?: string,
    currency = "USD",
  ): Promise<RefundResult> {
    const capture = payment.providerPaymentId;
    if (!capture) throw new Error("Cannot refund payment without providerPaymentId");
    const amt = Math.round(Number(amount));
    const refund = await this.call<{ id: string; status: string; amount?: { value: string; currency_code: string } }>(
      "POST",
      `/v2/payments/captures/${encodeURIComponent(capture)}/refund`,
      { amount: { currency_code: currency.toUpperCase(), value: toPayPalAmount(amt, currency) }, note_to_payer: (reason ?? "Refund").slice(0, 255) },
      `bsec-refund-${payment.intentId}-${amt}-${reason ?? "refund"}`,
    );
    return {
      providerRefundId: refund.id,
      status: refund.status === "COMPLETED" ? "processed" : refund.status === "FAILED" || refund.status === "CANCELLED" ? "failed" : "pending",
      amount: refund.amount ? fromPayPalAmount(refund.amount.value, refund.amount.currency_code) : amt,
    };
  }

  /**
   * Verifies a webhook with PayPal's own verification endpoint (POST /v1/notifications/verify-webhook-signature) using the
   * webhook id the merchant registered. Without a webhook id nothing can be verified, so the event is rejected.
   */
  async verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string | Buffer): Promise<VerifiedWebhookEvent> {
    const bodyStr = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(bodyStr) as Record<string, unknown>;
    } catch {
      // malformed JSON stays invalid below
    }
    const h = (name: string): string | undefined => {
      const v = headers[name] ?? headers[name.toLowerCase()];
      return Array.isArray(v) ? v[0] : v;
    };

    let isValid = false;
    if (this.webhookId && parsed.id) {
      try {
        const res = await this.call<{ verification_status?: string }>("POST", "/v1/notifications/verify-webhook-signature", {
          auth_algo: h("paypal-auth-algo"),
          cert_url: h("paypal-cert-url"),
          transmission_id: h("paypal-transmission-id"),
          transmission_sig: h("paypal-transmission-sig"),
          transmission_time: h("paypal-transmission-time"),
          webhook_id: this.webhookId,
          webhook_event: parsed,
        });
        isValid = res.verification_status === "SUCCESS";
      } catch {
        isValid = false;
      }
    }

    const resource = (parsed.resource ?? {}) as Record<string, unknown>;
    const eventType = typeof parsed.event_type === "string" ? parsed.event_type : "unknown";
    const related = ((resource.supplementary_data as Record<string, unknown> | undefined)?.related_ids ?? {}) as Record<string, unknown>;
    const isCapture = eventType.startsWith("PAYMENT.CAPTURE.");
    const amountObj = resource.amount as { value?: string; currency_code?: string } | undefined;
    const amount = amountObj?.value && amountObj.currency_code ? fromPayPalAmount(amountObj.value, amountObj.currency_code) : undefined;
    const providerOrderId = isCapture ? (typeof related.order_id === "string" ? related.order_id : undefined) : typeof resource.id === "string" ? resource.id : undefined;

    return {
      isValid,
      provider: "paypal",
      eventId: typeof parsed.id === "string" ? parsed.id : "unknown",
      eventType,
      orderId: typeof resource.custom_id === "string" ? resource.custom_id : undefined,
      providerOrderId,
      providerPaymentId: isCapture && typeof resource.id === "string" ? resource.id : undefined,
      amount,
      rawPayload: sanitizePaymentPayload(parsed),
    };
  }

  async getPayment(_ctx: TenantContext, providerPaymentId: string): Promise<ProviderPayment> {
    const p = await this.call<{ id: string; status: string; amount: { value: string; currency_code: string }; create_time?: string }>(
      "GET",
      `/v2/payments/captures/${encodeURIComponent(providerPaymentId)}`,
    );
    const status: ProviderPayment["status"] = p.status === "COMPLETED" ? "captured" : p.status === "REFUNDED" ? "refunded" : p.status === "DECLINED" || p.status === "FAILED" ? "failed" : "created";
    return {
      id: p.id,
      status,
      amount: fromPayPalAmount(p.amount.value, p.amount.currency_code),
      currency: p.amount.currency_code,
      captured: p.status === "COMPLETED",
      createdAt: p.create_time ? new Date(p.create_time) : new Date(),
    };
  }

  async reconcile(_ctx: TenantContext, date: Date | string): Promise<ReconciliationReport> {
    const target = typeof date === "string" ? new Date(date) : date;
    return { date: target.toISOString().slice(0, 10), totalPaymentsCount: 0, totalAmountCaptured: 0, totalRefundsAmount: 0, discrepancies: [] };
  }
}
