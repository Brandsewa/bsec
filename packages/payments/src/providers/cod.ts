import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sanitizePaymentPayload } from "./razorpay.ts";
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

export interface CODProviderOptions {
  fee?: number | undefined; // extra fee in paise
  maxLimit?: number | undefined; // max order amount allowed for COD in paise (e.g. 5000000 for 50k INR)
  requiresConfirmation?: boolean | undefined; // whether to issue action token for confirmation
  webhookSecret?: string | undefined;
}

/**
 * Cash on Delivery (COD) Provider (PLAN §11.5 / ADR-008).
 * Handles fee calculation, order value limits, and offline payment lifecycle.
 */
export class CODProvider implements PaymentProvider {
  readonly name = "cod";
  private readonly fee: number;
  private readonly maxLimit: number;
  private readonly requiresConfirmation: boolean;
  private readonly webhookSecret: string | undefined;

  constructor(opts: CODProviderOptions = {}) {
    this.fee = opts.fee ?? 0;
    this.maxLimit = opts.maxLimit ?? 5000000; // 50,000 INR default max
    this.requiresConfirmation = opts.requiresConfirmation ?? false;
    this.webhookSecret = opts.webhookSecret;
  }

  async createIntent(_ctx: TenantContext, order: OrderForPayment): Promise<IntentResult> {
    const total = Number(order.grandTotal);
    if (total > this.maxLimit) {
      throw new Error(`Order grand total ${total} exceeds COD limit of ${this.maxLimit} paise`);
    }

    const providerOrderId = `cod_${order.number}_${randomBytes(4).toString("hex")}`;
    const actionToken = this.requiresConfirmation ? randomBytes(16).toString("hex") : undefined;

    return {
      providerOrderId,
      amount: total,
      currency: order.currency,
      status: "cod_pending",
      actionToken,
      meta: {
        fee: this.fee,
        requiresConfirmation: this.requiresConfirmation,
      },
    };
  }

  async authorize(_ctx: TenantContext, _intent: PaymentIntentModel): Promise<AuthorizeResult> {
    return { status: "authorized" };
  }

  async capture(_ctx: TenantContext, intent: PaymentIntentModel, _amount: bigint | number): Promise<CaptureResult> {
    return {
      status: "captured",
      providerPaymentId: `cod_col_${intent.orderId}`,
      amountCaptured: intent.amount,
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
      providerRefundId: `cod_ref_${randomBytes(6).toString("hex")}`,
      status: "processed",
      amount,
    };
  }

  async verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string | Buffer,
  ): Promise<VerifiedWebhookEvent> {
    const signature = (headers["x-cod-signature"] ??
      headers["X-COD-Signature"] ??
      headers["x-webhook-signature"] ??
      headers["X-Webhook-Signature"] ??
      headers["x-signature"] ??
      headers["X-Signature"]) as string | undefined;
    const bodyStr = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(bodyStr);
    } catch {
      // malformed JSON
    }

    const secret = this.webhookSecret ?? process.env.COD_WEBHOOK_SECRET ?? "";
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
    const eventType = (parsed.event as string) ?? "cod.updated";
    const eventId = (parsed.event_id as string) ?? `cod_evt_${randomBytes(8).toString("hex")}`;
    const orderId = (parsed.order_id as string) ?? undefined;

    return {
      isValid,
      provider: "cod",
      eventId,
      eventType,
      orderId,
      rawPayload: sanitized,
    };
  }

  async getPayment(_ctx: TenantContext, providerPaymentId: string): Promise<ProviderPayment> {
    return {
      id: providerPaymentId,
      status: "captured",
      amount: 0,
      currency: "INR",
      method: "cod",
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
