import { describe, expect, it } from "vitest";
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
});
