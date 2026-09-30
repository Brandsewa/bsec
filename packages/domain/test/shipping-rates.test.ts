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

  // The default store has TWO "standard" rules: a flat one and "free above the threshold". The free one costs 0, but
  // only applies once the cart reaches the threshold (it used to look free for every cart, and the flat rule won).
  describe("a 'free above threshold' rule", () => {
    const freeAbove = {
      pricePaise: 0,
      thresholdPaise: 99900,
      name: "Free Shipping on orders above ₹999",
      method: "standard",
      rateType: "free_above_threshold",
      minDays: 3,
      maxDays: 7,
    };

    it("is not offered below the threshold", () => {
      expect(calculateRateFromRule(freeAbove, 10000).applicable).toBe(false);
      expect(calculateRateFromRule(freeAbove, 99899).applicable).toBe(false);
    });

    it("is offered, and free, from the threshold up", () => {
      const r = calculateRateFromRule(freeAbove, 99900);
      expect(r).toMatchObject({ applicable: true, amount: 0, isFree: true });
    });

    it("a 'free above threshold' rate that has its own price is always offered, and becomes free at the threshold", () => {
      const priced = { ...freeAbove, pricePaise: 7000, thresholdPaise: 120000, name: "Standard Shipping" };
      expect(calculateRateFromRule(priced, 50000)).toMatchObject({ applicable: true, amount: 7000, isFree: false });
      expect(calculateRateFromRule(priced, 120000)).toMatchObject({ applicable: true, amount: 0, isFree: true });
    });

    it("never hides an ordinary flat rate", () => {
      const flat = { pricePaise: 9900, thresholdPaise: null, name: "Standard Shipping", method: "standard", rateType: "flat" };
      expect(calculateRateFromRule(flat, 10000).applicable).toBe(true);
      expect(calculateRateFromRule(flat, 500000)).toMatchObject({ applicable: true, amount: 9900 });
    });
  });
});
