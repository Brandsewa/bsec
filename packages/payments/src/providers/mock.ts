import { randomBytes } from "node:crypto";
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
 * MockPaymentProvider for testing commerce workflows without external APIs.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";
  shouldFailAuthorize = false;
  shouldFailCapture = false;
  simulateWebhookEvent?: Partial<VerifiedWebhookEvent>;

  async createIntent(_ctx: TenantContext, order: OrderForPayment): Promise<IntentResult> {
    return {
      providerOrderId: `mock_order_${order.id}`,
      amount: order.grandTotal,
      currency: order.currency,
      status: "created",
    };
  }

  async authorize(_ctx: TenantContext, _intent: PaymentIntentModel): Promise<AuthorizeResult> {
    if (this.shouldFailAuthorize) {
      return { status: "failed", errorCode: "MOCK_AUTH_FAILED", errorMessage: "Simulated auth failure" };
    }
    return { status: "authorized", providerPaymentId: `mock_pay_${randomBytes(4).toString("hex")}` };
  }

  async capture(
    _ctx: TenantContext,
    intent: PaymentIntentModel,
    amount: bigint | number,
  ): Promise<CaptureResult> {
    if (this.shouldFailCapture) {
      return {
        status: "failed",
        errorCode: "MOCK_CAPTURE_FAILED",
        errorMessage: "Simulated capture failure",
        amountCaptured: 0,
      };
    }
    return {
      status: "captured",
      providerPaymentId: `mock_pay_${randomBytes(4).toString("hex")}`,
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
      providerRefundId: `mock_rfnd_${randomBytes(4).toString("hex")}`,
      status: "processed",
      amount,
    };
  }

  async verifyWebhook(
    _headers: Record<string, string | string[] | undefined>,
    _rawBody: string | Buffer,
  ): Promise<VerifiedWebhookEvent> {
    return {
      isValid: true,
      provider: "mock",
      eventId: `mock_evt_${randomBytes(4).toString("hex")}`,
      eventType: "payment.captured",
      rawPayload: {},
      ...this.simulateWebhookEvent,
    };
  }

  async getPayment(_ctx: TenantContext, providerPaymentId: string): Promise<ProviderPayment> {
    return {
      id: providerPaymentId,
      status: "captured",
      amount: 1000,
      currency: "INR",
      method: "card",
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
