import { describe, expect, it } from "vitest";
import { describeOrderStatus, describePayment } from "../src/components/orders/order-labels.ts";

describe("thank-you page wording", () => {
  it("a new order reads as received; a cancelled one as cancelled", () => {
    expect(describeOrderStatus("pending")).toEqual({ label: "Order received", tone: "good" });
    expect(describeOrderStatus("confirmed").label).toBe("Order received");
    expect(describeOrderStatus("cancelled")).toEqual({ label: "Cancelled", tone: "bad" });
    expect(describeOrderStatus("delivered").label).toBe("Delivered");
  });

  it("explains the payment in plain words, and says nothing is due after a cancellation", () => {
    expect(describePayment("cod_pending")).toMatch(/pay when your order arrives/);
    expect(describePayment("paid")).toBe("Paid");
    expect(describePayment("cancelled")).toBe("No payment due");
  });
});
