/**
 * Payment Provider types and interfaces (PLAN §11.5, ADR-008).
 * Minimal, provider-neutral interface implemented by RazorpayProvider, CODProvider, etc.
 */

export interface TenantContext {
  tenantId: string;
  storeStatus?: string | undefined;
  actor?: { type: "system" | "customer" | "staff"; id?: string | undefined } | undefined;
  roles?: readonly string[] | undefined;
  permissions?: readonly string[] | undefined;
  requestId?: string | undefined;
}

export interface OrderForPayment {
  id: string;
  number: string;
  currency: string;
  grandTotal: bigint | number;
  email: string;
  phone: string;
  notes?: string | null | undefined;
}

export interface PaymentIntentModel {
  id: string;
  orderId: string;
  provider: string;
  amount: bigint | number;
  currency: string;
  status: string;
  providerOrderId?: string | null | undefined;
  providerPaymentId?: string | null | undefined;
}

export interface IntentResult {
  providerOrderId: string;
  amount: bigint | number;
  currency: string;
  status: "created" | "requires_action" | "authorized" | "captured" | "cod_pending";
  clientSecret?: string | undefined;
  actionToken?: string | undefined;
  meta?: Record<string, unknown> | undefined;
}

export interface AuthorizeResult {
  status: "authorized" | "failed";
  providerPaymentId?: string | undefined;
  errorCode?: string | undefined;
  errorMessage?: string | undefined;
}

export interface CaptureResult {
  status: "captured" | "failed";
  providerPaymentId?: string | undefined;
  amountCaptured?: bigint | number | undefined;
  errorCode?: string | undefined;
  errorMessage?: string | undefined;
}

export interface CancelResult {
  status: "cancelled" | "failed";
  errorCode?: string | undefined;
  errorMessage?: string | undefined;
}

export interface RefundResult {
  providerRefundId: string;
  status: "processed" | "pending" | "failed";
  amount: bigint | number;
  errorCode?: string | undefined;
  errorMessage?: string | undefined;
}

export interface VerifiedWebhookEvent {
  isValid: boolean;
  provider: string;
  eventId: string;
  eventType: string; // e.g. "payment.captured", "payment.failed"
  orderId?: string | undefined;
  providerOrderId?: string | undefined;
  providerPaymentId?: string | undefined;
  amount?: bigint | number | undefined;
  rawPayload: Record<string, unknown>;
}

export interface ProviderPayment {
  id: string;
  status: "created" | "authorized" | "captured" | "failed" | "refunded";
  amount: bigint | number;
  currency: string;
  method?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  captured: boolean;
  createdAt: Date;
}

export interface ReconciliationReport {
  date: string;
  totalPaymentsCount: number;
  totalAmountCaptured: bigint | number;
  totalRefundsAmount: bigint | number;
  discrepancies: Array<{
    providerPaymentId: string;
    issue: string;
    expectedAmount?: bigint | number | undefined;
    actualAmount?: bigint | number | undefined;
  }>;
}

/**
 * PaymentProvider (PLAN §11.5 verbatim):
 */
export interface PaymentProvider {
  readonly name: string;
  createIntent(ctx: TenantContext, order: OrderForPayment): Promise<IntentResult>;
  authorize(ctx: TenantContext, intent: PaymentIntentModel): Promise<AuthorizeResult>;
  capture(ctx: TenantContext, intent: PaymentIntentModel, amount: bigint | number): Promise<CaptureResult>;
  cancel(ctx: TenantContext, intent: PaymentIntentModel): Promise<CancelResult>;
  refund(
    ctx: TenantContext,
    payment: { intentId: string; providerPaymentId?: string | null | undefined },
    amount: bigint | number,
    reason?: string | undefined,
  ): Promise<RefundResult>;
  verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string | Buffer,
  ): Promise<VerifiedWebhookEvent>;
  getPayment(ctx: TenantContext, providerPaymentId: string): Promise<ProviderPayment>;
  reconcile(ctx: TenantContext, date: Date | string): Promise<ReconciliationReport>;
}
