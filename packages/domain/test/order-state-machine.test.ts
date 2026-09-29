import { describe, expect, it } from "vitest";
import {
  ORDER_STATUSES,
  PAYMENT_INTENT_STATUSES,
  isValidOrderTransition,
  isValidPaymentIntentTransition,
  type OrderStatus,
  type PaymentIntentStatus,
} from "../src/orders/state-machine.ts";

describe("Order State Machine Transitions (PLAN §11.1)", () => {
  const allowedOrderTransitions: Record<OrderStatus, OrderStatus[]> = {
    pending: ["confirmed", "cancelled"],
    confirmed: ["processing", "cancelled"],
    processing: ["partially_fulfilled", "cancelled"],
    partially_fulfilled: ["fulfilled"],
    fulfilled: ["delivered"],
    delivered: ["returned"],
    cancelled: [],
    returned: [],
  };

  it("exhaustively verifies all 64 order state transitions", () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        const expectedValid = allowedOrderTransitions[from].includes(to);
        const actualValid = isValidOrderTransition(from, to);
        expect(
          actualValid,
          `Transition from '${from}' to '${to}' should be ${expectedValid ? "allowed" : "rejected"}`,
        ).toBe(expectedValid);
      }
    }
  });

  const allowedPaymentTransitions: Record<PaymentIntentStatus, PaymentIntentStatus[]> = {
    created: ["requires_action", "authorized", "captured", "failed"],
    requires_action: ["authorized", "captured", "failed"],
    authorized: ["captured", "cancelled"],
    captured: ["partially_refunded", "refunded"],
    partially_refunded: ["refunded"],
    cod_pending: ["cod_collected", "cod_failed"],
    cod_collected: [],
    cod_failed: [],
    failed: [],
    cancelled: [],
    refunded: [],
  };

  it("exhaustively verifies all payment intent state transitions", () => {
    for (const from of PAYMENT_INTENT_STATUSES) {
      for (const to of PAYMENT_INTENT_STATUSES) {
        const expectedValid = allowedPaymentTransitions[from].includes(to);
        const actualValid = isValidPaymentIntentTransition(from, to);
        expect(
          actualValid,
          `Payment transition from '${from}' to '${to}' should be ${expectedValid ? "allowed" : "rejected"}`,
        ).toBe(expectedValid);
      }
    }
  });
});
