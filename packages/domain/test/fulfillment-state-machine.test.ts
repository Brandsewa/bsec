import { describe, expect, it } from "vitest";
import {
  FULFILLMENT_STATUSES,
  isValidFulfillmentTransition,
  type FulfillmentStatus,
} from "../src/orders/fulfillment-state-machine.ts";

describe("Fulfillment State Machine Transitions (PLAN §11.1)", () => {
  const allowedFulfillmentTransitions: Record<FulfillmentStatus, FulfillmentStatus[]> = {
    pending: ["label_created", "cancelled"],
    label_created: ["picked_up", "cancelled"],
    picked_up: ["in_transit"],
    in_transit: ["out_for_delivery", "delivered", "rto"],
    out_for_delivery: ["delivered", "rto"],
    delivered: [],
    rto: ["rto_delivered"],
    rto_delivered: [],
    cancelled: [],
  };

  it("exhaustively verifies all 81 fulfillment state transitions", () => {
    for (const from of FULFILLMENT_STATUSES) {
      for (const to of FULFILLMENT_STATUSES) {
        const expectedValid = allowedFulfillmentTransitions[from].includes(to);
        const actualValid = isValidFulfillmentTransition(from, to);
        expect(
          actualValid,
          `Transition from '${from}' to '${to}' should be ${expectedValid ? "allowed" : "rejected"}`,
        ).toBe(expectedValid);
      }
    }
  });
});
