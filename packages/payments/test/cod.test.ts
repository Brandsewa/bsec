import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { CODProvider } from "../src/providers/cod.ts";

describe("CODProvider", () => {
  const ctx = { tenantId: "tenant_01" };
  const baseOrder = {
    id: "ord_1",
    number: "ORD-0001",
    currency: "INR",
    grandTotal: 50000, // 500.00 INR
    email: "customer@example.com",
    phone: "9876543210",
  };
  const webhookSecret = "cod_webhook_secret_test_xyz";

  it("creates intent with status cod_pending", async () => {
    const provider = new CODProvider({ fee: 5000, maxLimit: 100000 });
    const intent = await provider.createIntent(ctx, baseOrder);

    expect(intent.status).toBe("cod_pending");
    expect(intent.providerOrderId).toBeDefined();
    expect(intent.amount).toBe(50000);
  });

  it("rejects order exceeding COD limit", async () => {
    const provider = new CODProvider({ maxLimit: 20000 }); // 200.00 INR limit
    await expect(provider.createIntent(ctx, baseOrder)).rejects.toThrow(/exceeds COD limit/i);
  });

  it("captures COD payment marking cod_collected", async () => {
    const provider = new CODProvider();
    const result = await provider.capture(
      ctx,
      {
        id: "intent_1",
        orderId: baseOrder.id,
        provider: "cod",
        amount: 50000,
        currency: "INR",
        status: "cod_pending",
      },
      50000,
    );

    expect(result.status).toBe("captured");
  });

  it("verifies webhook signature correctly with valid HMAC", async () => {
    const provider = new CODProvider({ webhookSecret });
    const rawBody = JSON.stringify({
      event: "cod.confirmed",
      order_id: "ord_1",
    });

    const signature = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
    const verified = await provider.verifyWebhook({ "x-cod-signature": signature }, rawBody);

    expect(verified.isValid).toBe(true);
    expect(verified.eventType).toBe("cod.confirmed");
    expect(verified.orderId).toBe("ord_1");
  });

  it("rejects forged COD webhook signature", async () => {
    const provider = new CODProvider({ webhookSecret });
    const rawBody = JSON.stringify({ event: "cod.confirmed", order_id: "ord_1" });
    const forgedSig = createHmac("sha256", "wrong_secret").update(rawBody).digest("hex");

    const verified = await provider.verifyWebhook({ "x-cod-signature": forgedSig }, rawBody);
    expect(verified.isValid).toBe(false);
  });

  it("rejects malformed signature length without throwing", async () => {
    const provider = new CODProvider({ webhookSecret });
    const rawBody = JSON.stringify({ event: "cod.confirmed" });

    const verified = await provider.verifyWebhook({ "x-cod-signature": "short" }, rawBody);
    expect(verified.isValid).toBe(false);
  });
});
