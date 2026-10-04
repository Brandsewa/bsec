import { describe, expect, it } from "vitest";
import {
  RETURN_STATUSES,
  isValidReturnTransition,
  type ReturnStatus,
} from "../src/orders/return-state-machine.ts";

describe("Return State Machine Transitions (PLAN §11.1)", () => {
  const allowedReturnTransitions: Record<ReturnStatus, ReturnStatus[]> = {
    requested: ["approved", "rejected", "cancelled"],
    approved: ["received", "refunded", "replaced", "picked_up"],
    rejected: ["closed"],
    cancelled: ["closed"],
    picked_up: ["received"],
    received: ["refunded", "replaced"],
    refunded: ["closed"],
    replaced: ["closed"],
    closed: [],
  };

  it("exhaustively verifies all 64 return state transitions", () => {
    for (const from of RETURN_STATUSES) {
      for (const to of RETURN_STATUSES) {
        const expectedValid = allowedReturnTransitions[from].includes(to);
        const actualValid = isValidReturnTransition(from, to);
        expect(
          actualValid,
          `Return transition from '${from}' to '${to}' should be ${expectedValid ? "allowed" : "rejected"}`,
        ).toBe(expectedValid);
      }
    }
  });
});
