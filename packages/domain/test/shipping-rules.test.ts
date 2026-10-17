import { describe, expect, it } from "vitest";
import { pickShippingZone, rateProblem, tierApplies, tierOverlap } from "../src/orders/shipping-rules.ts";

const india = { id: "in", countries: ["IN"], states: [] as string[], isDefault: true };
const kerala = { id: "kl", countries: ["IN"], states: ["Kerala", "Tamil Nadu"], isDefault: false };
const world = { id: "world", countries: ["US", "GB"], states: [] as string[], isDefault: false };
const zones = [india, kerala, world];

describe("pickShippingZone", () => {
  it("uses the default zone when the destination is unknown", () => {
    expect(pickShippingZone(zones)?.id).toBe("in");
    expect(pickShippingZone(zones, {})?.id).toBe("in");
  });

  it("prefers a zone that lists the state, then a whole-country zone, then the default", () => {
    expect(pickShippingZone(zones, { country: "IN", state: "kerala" })?.id).toBe("kl");
    expect(pickShippingZone(zones, { country: "IN", state: "Tamil  Nadu" })?.id).toBe("kl");
    expect(pickShippingZone(zones, { country: "IN", state: "Goa" })?.id).toBe("in");
    expect(pickShippingZone(zones, { country: "us" })?.id).toBe("world");
    expect(pickShippingZone(zones, { country: "FR" })?.id).toBe("in"); // nothing covers it: keep the old behaviour
  });
});

describe("tiers", () => {
  it("matches price and weight ranges (min inclusive, max exclusive, open-ended max)", () => {
    const price = { rateType: "price_tier", minSubtotalPaise: 50_000, maxSubtotalPaise: 100_000 };
    expect(tierApplies(price, 49_999, 0)).toBe(false);
    expect(tierApplies(price, 50_000, 0)).toBe(true);
    expect(tierApplies(price, 99_999, 0)).toBe(true);
    expect(tierApplies(price, 100_000, 0)).toBe(false);
    const weight = { rateType: "weight_tier", minWeightGrams: 500, maxWeightGrams: null };
    expect(tierApplies(weight, 0, 499)).toBe(false);
    expect(tierApplies(weight, 0, 500)).toBe(true);
    expect(tierApplies(weight, 0, 50_000)).toBe(true);
    expect(tierApplies({ rateType: "flat" }, 0, 0)).toBe(true);
  });

  it("explains invalid rates and overlapping tiers", () => {
    expect(rateProblem({ name: "A", method: "standard", pricePaise: -1 })).toMatch(/zero or more/);
    expect(rateProblem({ name: "A", method: "standard", pricePaise: 0, rateType: "free_above_threshold" })).toMatch(/order value/);
    expect(rateProblem({ name: "A", method: "standard", pricePaise: 5, rateType: "weight_tier", minWeightGrams: 500, maxWeightGrams: 500 })).toMatch(/above the minimum/);
    expect(rateProblem({ name: "A", method: "standard", pricePaise: 5, rateType: "flat" })).toBeNull();

    const a = { name: "Light", method: "standard", pricePaise: 4000, rateType: "weight_tier", minWeightGrams: 0, maxWeightGrams: 500 };
    const b = { name: "Heavy", method: "standard", pricePaise: 9000, rateType: "weight_tier", minWeightGrams: 500, maxWeightGrams: null };
    expect(tierOverlap([a, b])).toBeNull();
    expect(tierOverlap([a, { ...b, minWeightGrams: 400 }])).toMatch(/overlapping weights/);
    // different methods may share a range
    expect(tierOverlap([a, { ...a, name: "Express light", method: "express" }])).toBeNull();
  });
});
