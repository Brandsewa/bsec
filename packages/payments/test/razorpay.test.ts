import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import type Razorpay from "razorpay";
import { RazorpayProvider, sanitizePaymentPayload } from "../src/providers/razorpay.ts";
import type { TenantContext } from "../src/types.ts";

describe("RazorpayProvider", () => {
  const webhookSecret = "rzp_webhook_secret_test_123";
  const mockTenantCtx: TenantContext = {
    tenantId: "tenant_0199a000",
    storeStatus: "live",
    actor: { type: "system" },
    roles: ["admin"],
    permissions: ["*"],
    requestId: "req_test_123",
  };

  it("verifies webhook signature correctly with valid HMAC", async () => {
    const provider = new RazorpayProvider({
      keyId: "rzp_test_key",
      keySecret: "rzp_test_secret",
      webhookSecret,
    });

    const rawBody = JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_12345",
            order_id: "order_rzp_999",
            amount: 50000,
            status: "captured",
          },
        },
      },
    });

    const signature = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
    const verified = await provider.verifyWebhook({ "x-razorpay-signature": signature }, rawBody);

    expect(verified.isValid).toBe(true);
    expect(verified.eventId).toBeDefined();
    expect(verified.eventType).toBe("payment.captured");
    expect(verified.providerPaymentId).toBe("pay_12345");
  });

  it("rejects forged webhook signature (tampered payload or incorrect secret)", async () => {
    const provider = new RazorpayProvider({
      keyId: "rzp_test_key",
      keySecret: "rzp_test_secret",
      webhookSecret,
    });

    const rawBody = JSON.stringify({ event: "payment.captured", order_id: "fake_order" });
    // Generated with a different attacker secret
    const forgedSig = createHmac("sha256", "attacker_secret").update(rawBody).digest("hex");

    const verified = await provider.verifyWebhook({ "x-razorpay-signature": forgedSig }, rawBody);
    expect(verified.isValid).toBe(false);
  });

  it("rejects invalid length signature without throwing timingSafeEqual length error", async () => {
    const provider = new RazorpayProvider({
      keyId: "rzp_test_key",
      keySecret: "rzp_test_secret",
      webhookSecret,
    });

    const rawBody = JSON.stringify({ event: "payment.captured" });
    const verified = await provider.verifyWebhook({ "x-razorpay-signature": "short_sig" }, rawBody);

    expect(verified.isValid).toBe(false);
  });

  it("sanitizes webhook payload stripping card and secrets", () => {
    const dirty = {
      card: { number: "4111111111111111", cvv: "123", expiry: "12/28" },
      token: "secret_token_abc",
      authorization: "Bearer secret",
      amount: 50000,
      email: "buyer@example.com",
    };

    const sanitized = sanitizePaymentPayload(dirty);
    expect(sanitized.card).toBeUndefined();
    expect(sanitized.token).toBeUndefined();
    expect(sanitized.authorization).toBeUndefined();
    expect(sanitized.amount).toBe(50000);
    expect(sanitized.email).toBe("buyer@example.com");
  });

  it("createIntent sends expected SDK shape (paise amount, currency, notes)", async () => {
    const mockOrdersCreate = vi.fn().mockResolvedValue({
      id: "order_rzp_mock_001",
      amount: 149900,
      currency: "INR",
      receipt: "ORD-00001",
      status: "created",
    });

    const mockClient = {
      orders: { create: mockOrdersCreate },
    } as unknown as Razorpay;

    const provider = new RazorpayProvider({
      keyId: "rzp_test_key",
      keySecret: "rzp_test_secret",
      client: mockClient,
    });

    const intent = await provider.createIntent(mockTenantCtx, {
      id: "ord_domain_001",
      number: "ORD-00001",
      grandTotal: 149900,
      currency: "INR",
      email: "buyer@example.com",
      phone: "9876543210",
    });

    expect(mockOrdersCreate).toHaveBeenCalledWith({
      amount: 149900,
      currency: "INR",
      receipt: "ORD-00001",
      notes: {
        tenant_id: "tenant_0199a000",
        order_id: "ord_domain_001",
      },
    });

    expect(intent.providerOrderId).toBe("order_rzp_mock_001");
    expect(intent.amount).toBe(149900);
    expect(intent.status).toBe("created");
  });

  it("capture sends correct payment ID and amount to Razorpay API", async () => {
    const mockPaymentsCapture = vi.fn().mockResolvedValue({
      id: "pay_rzp_mock_002",
      amount: 149900,
      status: "captured",
    });

    const mockClient = {
      payments: { capture: mockPaymentsCapture },
    } as unknown as Razorpay;

    const provider = new RazorpayProvider({
      keyId: "rzp_test_key",
      keySecret: "rzp_test_secret",
      client: mockClient,
    });

    const res = await provider.capture(
      mockTenantCtx,
      {
        id: "pi_001",
        orderId: "ord_001",
        provider: "razorpay",
        providerPaymentId: "pay_rzp_mock_002",
        currency: "INR",
        amount: 149900,
        status: "authorized",
      },
      149900,
    );

    expect(mockPaymentsCapture).toHaveBeenCalledWith("pay_rzp_mock_002", 149900, "INR");
    expect(res.status).toBe("captured");
    expect(res.providerPaymentId).toBe("pay_rzp_mock_002");
    expect(res.amountCaptured).toBe(149900);
  });

  it("authorize fetches payment and checks status", async () => {
    const mockPaymentsFetch = vi.fn().mockResolvedValue({
      id: "pay_rzp_mock_003",
      status: "authorized",
    });

    const mockClient = {
      payments: { fetch: mockPaymentsFetch },
    } as unknown as Razorpay;

    const provider = new RazorpayProvider({
      keyId: "rzp_test_key",
      keySecret: "rzp_test_secret",
      client: mockClient,
    });

    const res = await provider.authorize(mockTenantCtx, {
      id: "pi_002",
      orderId: "ord_002",
      provider: "razorpay",
      providerPaymentId: "pay_rzp_mock_003",
      currency: "INR",
      amount: 50000,
      status: "created",
    });

    expect(mockPaymentsFetch).toHaveBeenCalledWith("pay_rzp_mock_003");
    expect(res.status).toBe("authorized");
  });

  it("refund calls payments.refund with amount and reason note", async () => {
    const mockPaymentsRefund = vi.fn().mockResolvedValue({
      id: "rfnd_rzp_mock_004",
      amount: 50000,
      status: "processed",
    });

    const mockClient = {
      payments: { refund: mockPaymentsRefund },
    } as unknown as Razorpay;

    const provider = new RazorpayProvider({
      keyId: "rzp_test_key",
      keySecret: "rzp_test_secret",
      client: mockClient,
    });

    const res = await provider.refund(
      mockTenantCtx,
      { intentId: "pi_003", providerPaymentId: "pay_rzp_mock_004" },
      50000,
      "defective_item",
    );

    expect(mockPaymentsRefund).toHaveBeenCalledWith("pay_rzp_mock_004", {
      amount: 50000,
      notes: { reason: "defective_item" },
    });
    expect(res.providerRefundId).toBe("rfnd_rzp_mock_004");
    expect(res.status).toBe("processed");
    expect(res.amount).toBe(50000);
  });

  it("reconcile fetches all payments for target day and aggregates captured amount", async () => {
    const mockPaymentsAll = vi.fn().mockResolvedValue({
      entity: "collection",
      count: 2,
      items: [
        { id: "pay_1", amount: 15000, status: "captured" },
        { id: "pay_2", amount: 25000, status: "captured" },
        { id: "pay_3", amount: 5000, status: "failed" },
      ],
    });

    const mockClient = {
      payments: { all: mockPaymentsAll },
    } as unknown as Razorpay;

    const provider = new RazorpayProvider({
      keyId: "rzp_test_key",
      keySecret: "rzp_test_secret",
      client: mockClient,
    });

    const report = await provider.reconcile(mockTenantCtx, new Date("2026-09-29T12:00:00Z"));

    expect(mockPaymentsAll).toHaveBeenCalled();
    expect(report.totalPaymentsCount).toBe(2);
    expect(report.totalAmountCaptured).toBe(40000);
    expect(report.totalRefundsAmount).toBe(0);
  });
});
