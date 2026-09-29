import { createHmac, randomBytes } from "node:crypto";
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
  keyId?: string;
  keySecret?: string;
  webhookSecret?: string;
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

  constructor(opts: RazorpayProviderOptions = {}) {
    this.keyId = opts.keyId;
    this.keySecret = opts.keySecret;
    this.webhookSecret = opts.webhookSecret;
  }


  async createIntent(_ctx: TenantContext, order: OrderForPayment): Promise<IntentResult> {
    const total = Number(order.grandTotal);
    // In production, would call Razorpay orders API: https://api.razorpay.com/v1/orders
    const providerOrderId = `order_rzp_${randomBytes(8).toString("hex")}`;

    return {
      providerOrderId,
      amount: total,
      currency: order.currency,
      status: "created",
      clientSecret: this.keyId,
      meta: {
        receipt: order.number,
      },
    };
  }

  async authorize(_ctx: TenantContext, _intent: PaymentIntentModel): Promise<AuthorizeResult> {
    return {
      status: "authorized",
      providerPaymentId: `pay_rzp_${randomBytes(8).toString("hex")}`,
    };
  }

  async capture(
    _ctx: TenantContext,
    intent: PaymentIntentModel,
    amount: bigint | number,
  ): Promise<CaptureResult> {
    return {
      status: "captured",
      providerPaymentId: `pay_rzp_${randomBytes(8).toString("hex")}`,
      amountCaptured: amount,
    };
  }

  async cancel(_ctx: TenantContext, _intent: PaymentIntentModel): Promise<CancelResult> {
    return { status: "cancelled" };
  }

  async refund(
    _ctx: TenantContext,
    _payment: { intentId: string; providerPaymentId?: string | null },
    amount: bigint | number,
    _reason?: string,
  ): Promise<RefundResult> {
    return {
      providerRefundId: `rfnd_rzp_${randomBytes(8).toString("hex")}`,
      status: "processed",
      amount,
    };
  }

  async verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string | Buffer,
  ): Promise<VerifiedWebhookEvent> {
    const signature = headers["x-razorpay-signature"] as string | undefined;
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
      isValid = signature === expected;
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

  async getPayment(_ctx: TenantContext, providerPaymentId: string): Promise<ProviderPayment> {
    return {
      id: providerPaymentId,
      status: "captured",
      amount: 50000,
      currency: "INR",
      method: "upi",
      captured: true,
      createdAt: new Date(),
    };
  }

  async reconcile(_ctx: TenantContext, date: Date | string): Promise<ReconciliationReport> {
    const d = typeof date === "string" ? date : date.toISOString().slice(0, 10);
    return {

      date: d,
      totalPaymentsCount: 0,
      totalAmountCaptured: 0,
      totalRefundsAmount: 0,
      discrepancies: [],
    };
  }
}
