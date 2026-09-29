import { describe, expect, it } from "vitest";
import { calculateRateFromRule } from "../src/orders/shipping-rates.ts";

describe("Shipping rates rule calculation (PLAN §5.4, §7 / M7)", () => {
  it("calculates flat rate when subtotal is under threshold", () => {
    const rule = {
      pricePaise: 5000,
      thresholdPaise: 99900,
      name: "Standard Shipping",
      method: "standard",
      minDays: 4,
      maxDays: 7,
    };

    const rateLow = calculateRateFromRule(rule, 0);
    expect(rateLow.amount).toBe(5000);
    expect(rateLow.isFree).toBe(false);

    const rateUnderThreshold = calculateRateFromRule(rule, 99899);
    expect(rateUnderThreshold.amount).toBe(5000);
    expect(rateUnderThreshold.isFree).toBe(false);
  });

  it("provides free shipping when subtotal is >= threshold", () => {
    const rule = {
      pricePaise: 5000,
      thresholdPaise: 99900,
      name: "Standard Shipping",
      method: "standard",
      minDays: 4,
      maxDays: 7,
    };

    const rateExact = calculateRateFromRule(rule, 99900);
    expect(rateExact.amount).toBe(0);
    expect(rateExact.isFree).toBe(true);

    const rateAbove = calculateRateFromRule(rule, 150000);
    expect(rateAbove.amount).toBe(0);
    expect(rateAbove.isFree).toBe(true);
  });

  it("calculates flat express rate regardless of subtotal when no threshold set", () => {
    const rule = {
      pricePaise: 15000,
      thresholdPaise: null,
      name: "Express Shipping",
      method: "express",
      minDays: 2,
      maxDays: 3,
    };

    const expressLow = calculateRateFromRule(rule, 50000);
    expect(expressLow.amount).toBe(15000);
    expect(expressLow.isFree).toBe(false);

    const expressHigh = calculateRateFromRule(rule, 200000);
    expect(expressHigh.amount).toBe(15000);
    expect(expressHigh.isFree).toBe(false);
  });
});
