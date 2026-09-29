import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import Razorpay from "razorpay";
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

/**
 * Sanitizes payment payload before saving to webhook inbox or logs (PLAN §4 security checklist).
 * Strips card numbers, CVVs, authorization headers, access tokens, and passwords.
 */
export function sanitizePaymentPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = new Set([
    "card",
    "card_number",
    "number",
    "cvv",
    "cvc",
    "expiry",
    "exp_month",
    "exp_year",
    "token",
    "access_token",
    "authorization",
    "secret",
    "key_secret",
    "password",
  ]);

  function sanitize(obj: unknown): unknown {
    if (!obj || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(sanitize);

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      if (
        sensitiveKeys.has(lower) ||
        lower.includes("secret") ||
        lower.includes("password") ||
        lower.includes("cvv") ||
        lower.includes("cvc")
      ) {
        continue;
      }
      if (typeof value === "object" && value !== null) {
        result[key] = sanitize(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  return sanitize(payload) as Record<string, unknown>;
}

export interface RazorpayProviderOptions {
  keyId?: string | undefined;
  keySecret?: string | undefined;
  webhookSecret?: string | undefined;
  client?: Razorpay | undefined;
}

/**
 * Razorpay Payment Provider (PLAN §11.5 / ADR-008).
 * Per-store encrypted keys stored in tenant_secrets.
 */
export class RazorpayProvider implements PaymentProvider {
  readonly name = "razorpay";
  private readonly keyId: string | undefined;
  private readonly keySecret: string | undefined;
  private readonly webhookSecret: string | undefined;
  private client: Razorpay | undefined;

  constructor(opts: RazorpayProviderOptions = {}) {
    this.keyId = opts.keyId;
    this.keySecret = opts.keySecret;
    this.webhookSecret = opts.webhookSecret;
    this.client = opts.client;
  }

  private getClient(): Razorpay {
    if (this.client) return this.client;
    if (!this.keyId || !this.keySecret) {
      throw new Error("Razorpay credentials (keyId and keySecret) are required for API calls");
    }
    this.client = new Razorpay({
      key_id: this.keyId,
      key_secret: this.keySecret,
    });
    return this.client;
  }

  /**
   * Creates an Order on Razorpay (POST /v1/orders).
   */
  async createIntent(ctx: TenantContext, order: OrderForPayment): Promise<IntentResult> {
    const total = Math.round(Number(order.grandTotal));
    const rzp = this.getClient();

    const rzpOrder = await rzp.orders.create({
      amount: total,
      currency: order.currency ?? "INR",
      receipt: order.number.slice(0, 40),
      notes: {
        tenant_id: ctx.tenantId,
        order_id: order.id,
      },
    });

    return {
      providerOrderId: rzpOrder.id,
      amount: Number(rzpOrder.amount),
      currency: rzpOrder.currency,
      status: "created",
      clientSecret: this.keyId,
      meta: {
        receipt: rzpOrder.receipt,
        status: rzpOrder.status,
      },
    };
  }

  /**
   * Authorizes payment via Razorpay Payments API (GET /v1/payments/:id).
   */
  async authorize(_ctx: TenantContext, intent: PaymentIntentModel): Promise<AuthorizeResult> {
    const paymentId = intent.providerPaymentId;
    if (!paymentId) throw new Error("Cannot authorize payment without providerPaymentId");

    const rzp = this.getClient();
    const payment = await rzp.payments.fetch(paymentId);
    const isAuthorized = payment.status === "authorized" || payment.status === "captured";

    return {
      status: isAuthorized ? "authorized" : "failed",
      providerPaymentId: payment.id,
    };
  }

  /**
   * Captures an authorized payment on Razorpay (POST /v1/payments/:id/capture).
   */
  async capture(
    _ctx: TenantContext,
    intent: PaymentIntentModel,
    amount: bigint | number,
  ): Promise<CaptureResult> {
    const paymentId = intent.providerPaymentId;
    if (!paymentId) throw new Error("Cannot capture payment without providerPaymentId");

    const rzp = this.getClient();
    const captured = await rzp.payments.capture(
      paymentId,
      Number(amount),
      intent.currency ?? "INR",
    );

    return {
      status: "captured",
      providerPaymentId: captured.id,
      amountCaptured: Number(captured.amount),
    };
  }

  async cancel(_ctx: TenantContext, _intent: PaymentIntentModel): Promise<CancelResult> {
    return { status: "cancelled" };
  }

  /**
   * Refunds a captured payment on Razorpay (POST /v1/payments/:id/refund).
   */
  async refund(
    _ctx: TenantContext,
    payment: { intentId: string; providerPaymentId?: string | null },
    amount: bigint | number,
    reason?: string,
  ): Promise<RefundResult> {
    const paymentId = payment.providerPaymentId;
    if (!paymentId) throw new Error("Cannot refund payment without providerPaymentId");

    const rzp = this.getClient();
    const rfnd = await rzp.payments.refund(paymentId, {
      amount: Number(amount),
      notes: {
        reason: reason ?? "customer_requested",
      },
    });

    return {
      providerRefundId: rfnd.id,
      status: rfnd.status === "processed" ? "processed" : "pending",
      amount: Number(rfnd.amount),
    };
  }

  /**
   * Verifies Razorpay webhook signatures using timing-safe comparison (PLAN §11.4).
   */
  async verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string | Buffer,
  ): Promise<VerifiedWebhookEvent> {
    const signature = (headers["x-razorpay-signature"] ?? headers["X-Razorpay-Signature"]) as string | undefined;
    const bodyStr = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(bodyStr);
    } catch {
      // malformed JSON
    }

    const secret = this.webhookSecret ?? process.env.RAZORPAY_WEBHOOK_SECRET ?? "";
    let isValid = false;

    if (signature && secret) {
      const expected = createHmac("sha256", secret).update(bodyStr).digest("hex");
      const sigBuf = Buffer.from(signature, "utf8");
      const expBuf = Buffer.from(expected, "utf8");
      if (sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf)) {
        isValid = true;
      }
    }

    const sanitized = sanitizePaymentPayload(parsed);
    const eventType = (parsed.event as string) ?? "unknown";
    const eventId = (parsed.event_id as string) ?? `rzp_evt_${randomBytes(8).toString("hex")}`;

    const payloadObj = (parsed.payload as Record<string, unknown>) ?? {};
    const paymentObj = (payloadObj.payment as Record<string, unknown>) ?? {};
    const paymentEntity = (paymentObj.entity as Record<string, unknown>) ?? {};

    const providerOrderId = (paymentEntity.order_id as string) ?? undefined;
    const providerPaymentId = (paymentEntity.id as string) ?? undefined;
    const amount = typeof paymentEntity.amount === "number" ? paymentEntity.amount : undefined;

    return {
      isValid,
      provider: "razorpay",
      eventId,
      eventType,
      providerOrderId,
      providerPaymentId,
      amount,
      rawPayload: sanitized,
    };
  }

  /**
   * Fetches payment details from Razorpay (GET /v1/payments/:id).
   */
  async getPayment(_ctx: TenantContext, providerPaymentId: string): Promise<ProviderPayment> {
    const rzp = this.getClient();
    const payment = await rzp.payments.fetch(providerPaymentId);

    return {
      id: payment.id,
      status: payment.status,
      amount: Number(payment.amount),
      currency: payment.currency,
      method: payment.method ?? "unknown",
      captured: Boolean(payment.captured),
      createdAt: new Date(Number(payment.created_at) * 1000),
    };
  }

  /**
   * Reconciles payments for a given date via Razorpay payments list API (PLAN §11.5).
   * GET /v1/payments?from=...&to=...&count=100
   */
  async reconcile(_ctx: TenantContext, date: Date | string): Promise<ReconciliationReport> {
    const rzp = this.getClient();
    const targetDate = typeof date === "string" ? new Date(date) : date;
    const startOfDay = new Date(targetDate);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    const from = Math.floor(startOfDay.getTime() / 1000);
    const to = Math.floor(endOfDay.getTime() / 1000);

    const list = await rzp.payments.all({
      from,
      to,
      count: 100,
    });

    let totalAmountCaptured = 0;
    let totalPaymentsCount = 0;
    for (const p of list.items ?? []) {
      if (p.status === "captured") {
        totalAmountCaptured += Number(p.amount);
        totalPaymentsCount += 1;
      }
    }

    return {
      date: startOfDay.toISOString().slice(0, 10),
      totalPaymentsCount,
      totalAmountCaptured,
      totalRefundsAmount: 0,
      discrepancies: [],
    };
  }
}

