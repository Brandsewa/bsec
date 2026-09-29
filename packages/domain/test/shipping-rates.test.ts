import { describe, expect, it } from "vitest";
import { calculateShippingRate } from "../src/orders/shipping-rates.ts";

describe("Shipping rates canonical calculation (PLAN §5.4, §7 / M7)", () => {
  it("charges 5000 paise for standard shipping when cart subtotal is under ₹999", () => {
    const rateLow = calculateShippingRate(0, "standard");
    expect(rateLow.amount).toBe(5000);
    expect(rateLow.isFree).toBe(false);

    const rateUnderThreshold = calculateShippingRate(99899, "standard");
    expect(rateUnderThreshold.amount).toBe(5000);
    expect(rateUnderThreshold.isFree).toBe(false);
  });

  it("provides free standard shipping when cart subtotal is >= ₹999 (99900 paise)", () => {
    const rateExact = calculateShippingRate(99900, "standard");
    expect(rateExact.amount).toBe(0);
    expect(rateExact.isFree).toBe(true);

    const rateAbove = calculateShippingRate(150000, "standard");
    expect(rateAbove.amount).toBe(0);
    expect(rateAbove.isFree).toBe(true);
  });

  it("charges 12000 paise for express shipping regardless of subtotal", () => {
    const expressLow = calculateShippingRate(50000, "express");
    expect(expressLow.amount).toBe(12000);
    expect(expressLow.isFree).toBe(false);

    const expressHigh = calculateShippingRate(200000, "express");
    expect(expressHigh.amount).toBe(12000);
    expect(expressHigh.isFree).toBe(false);
  });
});
