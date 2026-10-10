import { describe, expect, it } from "vitest";
import { isOrderEligibleForDelete } from "../src/routes/_store/orders.tsx";

describe("Orders Archive and Delete UI logic", () => {
  it("determines order delete eligibility correctly per plan rules", () => {
    // 1. Unarchived orders are never eligible for delete
    expect(
      isOrderEligibleForDelete({
        status: "cancelled",
        paymentStatus: "unpaid",
        fulfillmentStatus: "unfulfilled",
        archivedAt: null,
      }),
    ).toBe(false);

    // 2. Archived order, but confirmed (not cancelled or draft)
    expect(
      isOrderEligibleForDelete({
        status: "confirmed",
        paymentStatus: "unpaid",
        fulfillmentStatus: "unfulfilled",
        archivedAt: "2026-10-08T10:00:00.000Z",
      }),
    ).toBe(false);

    // 3. Archived order, but paid
    expect(
      isOrderEligibleForDelete({
        status: "cancelled",
        paymentStatus: "paid",
        fulfillmentStatus: "unfulfilled",
        archivedAt: "2026-10-08T10:00:00.000Z",
      }),
    ).toBe(false);

    // 4. Archived order, but fulfilled
    expect(
      isOrderEligibleForDelete({
        status: "cancelled",
        paymentStatus: "unpaid",
        fulfillmentStatus: "fulfilled",
        archivedAt: "2026-10-08T10:00:00.000Z",
      }),
    ).toBe(false);

    // 5. Archived order, cancelled, unpaid, unfulfilled -> ELIGIBLE
    expect(
      isOrderEligibleForDelete({
        status: "cancelled",
        paymentStatus: "unpaid",
        fulfillmentStatus: "unfulfilled",
        archivedAt: "2026-10-08T10:00:00.000Z",
      }),
    ).toBe(true);

    // 7. Archived order, draft, failed payment, unfulfilled, uninvoiced -> ELIGIBLE
    expect(
      isOrderEligibleForDelete({
        status: "draft",
        paymentStatus: "failed",
        fulfillmentStatus: "unfulfilled",
        archivedAt: "2026-10-08T10:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("checks mixed selection qualification for bulk delete in archived view", () => {
    const ineligibleOrder = {
      status: "delivered",
      paymentStatus: "paid",
      fulfillmentStatus: "fulfilled",
      archivedAt: "2026-10-08T10:00:00.000Z",
    };

    const eligibleOrder = {
      status: "cancelled",
      paymentStatus: "unpaid",
      fulfillmentStatus: "unfulfilled",
      archivedAt: "2026-10-08T10:00:00.000Z",
    };

    const selectionWithOnlyIneligible = [ineligibleOrder];
    const selectionWithMixed = [ineligibleOrder, eligibleOrder];

    // Delete button in bulk bar appears when at least one qualifies
    expect(selectionWithOnlyIneligible.some(isOrderEligibleForDelete)).toBe(false);
    expect(selectionWithMixed.some(isOrderEligibleForDelete)).toBe(true);
  });
});
