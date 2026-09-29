import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { RazorpayProvider, sanitizePaymentPayload } from "../src/providers/razorpay.ts";

describe("RazorpayProvider", () => {
  const webhookSecret = "rzp_webhook_secret_test_123";
  const provider = new RazorpayProvider({
    keyId: "rzp_test_key",
    keySecret: "rzp_test_secret",
    webhookSecret,
  });

  it("verifies webhook signature correctly", async () => {
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

  it("rejects invalid webhook signature", async () => {
    const rawBody = JSON.stringify({ event: "payment.captured" });
    const verified = await provider.verifyWebhook({ "x-razorpay-signature": "invalid_sig" }, rawBody);

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
});
