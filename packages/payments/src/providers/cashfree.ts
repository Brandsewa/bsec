import { createHash, createHmac, timingSafeEqual } from "node:crypto";
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
 * Cashfree payment provider (ADR-037, ADR-008).
 *
 * Talks to Cashfree's REST API with `fetch` (no SDK), with the API version pinned so Cashfree changes cannot alter
 * behaviour under us. Cashfree takes amounts in rupees (decimal); the rest of the platform uses paise, so every amount
 * is converted at this boundary only. Cashfree authenticates with an App ID (`x-client-id`) and a secret
 * (`x-client-secret`), and signs webhooks with that same secret, so there is no separate webhook secret.
 */
export const CASHFREE_API_VERSION = "2026-01-01";
export type CashfreeMode = "test" | "live";

export function cashfreeBaseUrl(mode: CashfreeMode): string {
  return mode === "live" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";
}

/** Test credentials carry `_test_` in the secret; production ones carry `_prod_`. Anything else is treated as test. */
export function cashfreeModeOfSecret(secret: string): CashfreeMode {
  return secret.includes("_prod_") ? "live" : "test";
}

export function paiseToRupees(paise: bigint | number): number {
  return Number((Number(paise) / 100).toFixed(2));
}

export function rupeesToPaise(rupees: number | string): number {
  return Math.round(Number(rupees) * 100);
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cashfree requires `x-idempotency-key` to be a UUID. Our own ids (subscription and refund ids) are not, so a stable UUID is
 * derived from them: the same id always gives the same key, so a retried request is still recognised as a retry.
 */
export function cashfreeIdempotencyKey(id: string): string {
  if (UUID_SHAPE.test(id)) return id.toLowerCase();
  const h = createHash("sha256").update(id).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

export class CashfreeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "CashfreeApiError";
  }
}

export interface CashfreeCredentials {
  clientId: string;
  clientSecret: string;
  mode: CashfreeMode;
}

/** One authenticated JSON call to Cashfree. Throws CashfreeApiError with Cashfree's own message on a non-2xx answer. */
export async function cashfreeRequest<T>(
  creds: CashfreeCredentials,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  fetchFn: typeof fetch = fetch,
  idempotencyKey?: string,
): Promise<T> {
  const res = await fetchFn(`${cashfreeBaseUrl(creds.mode)}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-api-version": CASHFREE_API_VERSION,
      "x-client-id": creds.clientId,
      "x-client-secret": creds.clientSecret,
      ...(idempotencyKey ? { "x-idempotency-key": cashfreeIdempotencyKey(idempotencyKey) } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON error page
  }
  if (!res.ok) {
    const err = (data ?? {}) as { message?: string; code?: string };
    throw new CashfreeApiError(err.message ?? `Cashfree answered ${res.status}`, res.status, err.code);
  }
  return data as T;
}

/**
 * Verifies a Cashfree webhook: base64(HMAC-SHA256(secret, timestamp + rawBody)) must equal `x-webhook-signature`.
 * Cashfree's docs show both a bare concatenation and a dot between the two in different places, so both are accepted;
 * either one still needs the secret. The raw body must be the unparsed text. Timing-safe; fails closed on anything missing.
 */
export function verifyCashfreeSignature(secret: string | undefined, timestamp: string | undefined, rawBody: string, signature: string | undefined): boolean {
  if (!secret || !timestamp || !signature) return false;
  const given = Buffer.from(signature, "utf8");
  for (const signed of [`${timestamp}${rawBody}`, `${timestamp}.${rawBody}`]) {
    const expected = Buffer.from(createHmac("sha256", secret).update(signed).digest("base64"), "utf8");
    if (expected.length === given.length && timingSafeEqual(expected, given)) return true;
  }
  return false;
}

function headerOf(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(raw) ? raw[0] : raw;
}

export interface CashfreeProviderOptions {
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  /** Defaults from the secret (`_prod_` means live). */
  mode?: CashfreeMode | undefined;
  /** Where Cashfree sends the shopper after paying; `{order_id}` is replaced by Cashfree. */
  returnUrl?: string | undefined;
  /** Server-to-server notification URL (HTTPS). */
  notifyUrl?: string | undefined;
  fetchFn?: typeof fetch | undefined;
}

interface CfOrder {
  order_id: string;
  cf_order_id?: string | number;
  order_amount: number;
  order_currency: string;
  order_status: string;
  payment_session_id?: string;
}

interface CfPayment {
  cf_payment_id: string | number;
  payment_status: string;
  payment_amount: number;
  payment_currency: string;
  payment_group?: string;
  payment_time?: string;
}

export class CashfreeProvider implements PaymentProvider {
  readonly name = "cashfree";
  private readonly creds: CashfreeCredentials | null;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly opts: CashfreeProviderOptions = {}) {
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
    this.creds =
      opts.clientId && opts.clientSecret
        ? { clientId: opts.clientId, clientSecret: opts.clientSecret, mode: opts.mode ?? cashfreeModeOfSecret(opts.clientSecret) }
        : null;
  }

  private need(): CashfreeCredentials {
    if (!this.creds) throw new Error("Cashfree credentials (App ID and secret) are required for API calls");
    return this.creds;
  }

  /**
   * Read-only credential check: asks for an order that cannot exist. Valid credentials answer 404 (order not found);
   * wrong ones answer 401. No money moves and nothing is created.
   */
  async testConnection(): Promise<{ ok: boolean; mode?: CashfreeMode | undefined; error?: string | undefined }> {
    if (!this.creds) return { ok: false, error: "Save your Cashfree App ID and secret first." };
    try {
      await cashfreeRequest(this.creds, "GET", "/orders/bs_connection_probe", undefined, this.fetchFn);
      return { ok: true, mode: this.creds.mode };
    } catch (err) {
      if (err instanceof CashfreeApiError) {
        if (err.status === 404) return { ok: true, mode: this.creds.mode };
        if (err.status === 401 || err.status === 403) return { ok: false, error: "Cashfree rejected these credentials. Check the App ID and secret belong to the same mode." };
        return { ok: false, error: `Cashfree returned HTTP ${err.status}.` };
      }
      return { ok: false, error: "Could not reach Cashfree. Try again." };
    }
  }

  /** Creates a Cashfree order (POST /orders). `clientSecret` carries the payment_session_id the checkout needs. */
  async createIntent(ctx: TenantContext, order: OrderForPayment): Promise<IntentResult> {
    const creds = this.need();
    const cfOrderId = `bs_${order.number}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 45);
    const created = await cashfreeRequest<CfOrder>(
      creds,
      "POST",
      "/orders",
      {
        order_id: cfOrderId,
        order_amount: paiseToRupees(order.grandTotal),
        order_currency: order.currency ?? "INR",
        customer_details: {
          customer_id: `c_${createHash("sha256").update(order.email).digest("hex").slice(0, 20)}`,
          customer_phone: order.phone,
          customer_email: order.email,
        },
        order_meta: {
          ...(this.opts.returnUrl ? { return_url: this.opts.returnUrl } : {}),
          ...(this.opts.notifyUrl ? { notify_url: this.opts.notifyUrl } : {}),
        },
        order_tags: { tenant_id: ctx.tenantId, order_id: order.id },
      },
      this.fetchFn,
      order.id,
    );
    return {
      providerOrderId: created.order_id,
      amount: rupeesToPaise(created.order_amount),
      currency: created.order_currency,
      status: "created",
      ...(created.payment_session_id ? { clientSecret: created.payment_session_id } : {}),
      meta: { cfOrderId: created.cf_order_id, orderStatus: created.order_status, mode: creds.mode },
    };
  }

  /** Cashfree settles a payment when it succeeds; there is no separate authorize step. */
  async authorize(_ctx: TenantContext, intent: PaymentIntentModel): Promise<AuthorizeResult> {
    if (!intent.providerOrderId) throw new Error("Cannot authorize without providerOrderId");
    const paid = await this.findSuccessfulPayment(intent.providerOrderId);
    return paid ? { status: "authorized", providerPaymentId: String(paid.cf_payment_id) } : { status: "failed" };
  }

  async capture(_ctx: TenantContext, intent: PaymentIntentModel, _amount: bigint | number): Promise<CaptureResult> {
    if (!intent.providerOrderId) throw new Error("Cannot capture without providerOrderId");
    const paid = await this.findSuccessfulPayment(intent.providerOrderId);
    return paid
      ? { status: "captured", providerPaymentId: String(paid.cf_payment_id), amountCaptured: rupeesToPaise(paid.payment_amount) }
      : { status: "failed", errorMessage: "No successful Cashfree payment for this order" };
  }

  /** An unpaid order expires on its own; a paid one has to be refunded, which is `refund`'s job. */
  async cancel(_ctx: TenantContext, intent: PaymentIntentModel): Promise<CancelResult> {
    if (!intent.providerOrderId) return { status: "cancelled" };
    const paid = await this.findSuccessfulPayment(intent.providerOrderId).catch(() => null);
    return paid ? { status: "failed", errorMessage: "The order is already paid; refund it instead." } : { status: "cancelled" };
  }

  /** `payment.providerPaymentId` here is the Cashfree *order id* (refunds are per order); the intent keeps it as providerOrderId. */
  async refund(
    _ctx: TenantContext,
    payment: { intentId: string; providerPaymentId?: string | null | undefined },
    amount: bigint | number,
    reason?: string,
  ): Promise<RefundResult> {
    const orderId = payment.providerPaymentId;
    if (!orderId) throw new Error("Cannot refund without the Cashfree order id");
    const refundId = `rf_${payment.intentId}_${Date.now()}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40);
    const r = await cashfreeRequest<{ cf_refund_id?: string | number; refund_id: string; refund_status: string; refund_amount: number }>(
      this.need(),
      "POST",
      `/orders/${encodeURIComponent(orderId)}/refunds`,
      { refund_id: refundId, refund_amount: paiseToRupees(amount), refund_note: (reason ?? "customer_requested").slice(0, 100) },
      this.fetchFn,
      refundId,
    );
    return {
      providerRefundId: r.refund_id,
      status: r.refund_status === "SUCCESS" ? "processed" : r.refund_status === "FAILED" || r.refund_status === "CANCELLED" ? "failed" : "pending",
      amount: rupeesToPaise(r.refund_amount),
    };
  }

  async verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string | Buffer): Promise<VerifiedWebhookEvent> {
    const bodyStr = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(bodyStr) as Record<string, unknown>;
    } catch {
      // malformed JSON stays invalid below
    }
    const isValid = verifyCashfreeSignature(
      this.opts.clientSecret,
      headerOf(headers, "x-webhook-timestamp"),
      bodyStr,
      headerOf(headers, "x-webhook-signature"),
    );
    const data = (parsed.data ?? {}) as { order?: { order_id?: string; order_amount?: number }; payment?: { cf_payment_id?: string | number; payment_amount?: number } };
    const paymentId = data.payment?.cf_payment_id;
    return {
      isValid,
      provider: "cashfree",
      // Cashfree sends no event id; a retry carries the identical body, so the body's hash is a stable idempotency key.
      eventId: `cf_${createHash("sha256").update(bodyStr).digest("hex").slice(0, 40)}`,
      eventType: typeof parsed.type === "string" ? parsed.type : "unknown",
      providerOrderId: data.order?.order_id,
      providerPaymentId: paymentId !== undefined ? String(paymentId) : undefined,
      amount: typeof data.payment?.payment_amount === "number" ? rupeesToPaise(data.payment.payment_amount) : undefined,
      rawPayload: sanitizePaymentPayload(parsed),
    };
  }

  /** `providerPaymentId` is the Cashfree order id: Cashfree lists payments per order. */
  async getPayment(_ctx: TenantContext, providerPaymentId: string): Promise<ProviderPayment> {
    const payments = await cashfreeRequest<CfPayment[]>(this.need(), "GET", `/orders/${encodeURIComponent(providerPaymentId)}/payments`, undefined, this.fetchFn);
    const p = payments.find((x) => x.payment_status === "SUCCESS") ?? payments[0];
    if (!p) throw new Error("Not Found: no Cashfree payment for this order");
    const status = p.payment_status === "SUCCESS" ? "captured" : p.payment_status === "FAILED" ? "failed" : "created";
    return {
      id: String(p.cf_payment_id),
      status,
      amount: rupeesToPaise(p.payment_amount),
      currency: p.payment_currency,
      method: p.payment_group ?? "unknown",
      captured: status === "captured",
      createdAt: p.payment_time ? new Date(p.payment_time) : new Date(),
    };
  }

  /** Daily reconciliation needs Cashfree's settlement reports; not built until online checkout is live (ADR-037). */
  async reconcile(_ctx: TenantContext, date: Date | string): Promise<ReconciliationReport> {
    const d = typeof date === "string" ? new Date(date) : date;
    return { date: d.toISOString().slice(0, 10), totalPaymentsCount: 0, totalAmountCaptured: 0, totalRefundsAmount: 0, discrepancies: [] };
  }

  private async findSuccessfulPayment(orderId: string): Promise<CfPayment | undefined> {
    const payments = await cashfreeRequest<CfPayment[]>(this.need(), "GET", `/orders/${encodeURIComponent(orderId)}/payments`, undefined, this.fetchFn);
    return payments.find((p) => p.payment_status === "SUCCESS");
  }
}
