import { describe, expect, it } from "vitest";
import { nextOffer, type EngineCart, type EngineDiscount } from "../src/discounts/engine.ts";

const NOW = new Date("2026-11-07T10:00:00Z");

let seq = 0;
function d(over: Partial<EngineDiscount> = {}): EngineDiscount {
  seq += 1;
  return {
    id: `n${seq}`,
    code: null,
    title: `Offer ${seq}`,
    type: "percent",
    value: 10,
    minSubtotal: 0,
    minQty: 0,
    usageLimit: null,
    usedCount: 0,
    perCustomerLimit: null,
    combinable: false,
    startsAt: null,
    endsAt: null,
    status: "active",
    appliesTo: { type: "all" },
    rules: {},
    customerEligibility: { type: "all" },
    createdAt: new Date(NOW.getTime() - seq * 1000),
    ...over,
  };
}

const cartAt = (subtotal: number): EngineCart => ({
  lines: [{ id: "l1", productId: "00000000-0000-4000-8000-0000000000a1", collectionIds: [], quantity: 1, unitPrice: subtotal, lineTotal: subtotal, onSale: false }],
  subtotal,
  itemCount: 1,
  currency: "INR",
  baseCurrency: "INR",
  marketId: null,
});

const near = (discounts: EngineDiscount[], subtotal: number, codes: string[] = []) => nextOffer({ discounts, codes, cart: cartAt(subtotal), customerUses: {}, now: NOW });

describe("the nearest offer within reach", () => {
  it("points at an automatic discount whose minimum is not met yet", () => {
    expect(near([d({ minSubtotal: 99900, value: 10 })], 70000)).toEqual({ remaining: 29900, threshold: 99900, benefit: "10% off" });
  });

  it("names free shipping and fixed amounts in words", () => {
    expect(near([d({ type: "free_shipping", value: 0, minSubtotal: 50000 })], 20000)?.benefit).toBe("free shipping");
    expect(near([d({ type: "fixed", value: 10000, minSubtotal: 50000 })], 20000)?.benefit).toMatch(/100.*off/);
  });

  it("points at the next tier of a tiered discount, and at none once the top tier is reached", () => {
    const tiered = d({ rules: { tiers: [{ threshold: 99900, value: 10 }, { threshold: 199900, value: 15 }] } });
    expect(near([tiered], 50000)).toEqual({ remaining: 49900, threshold: 99900, benefit: "10% off" });
    expect(near([tiered], 120000)).toEqual({ remaining: 79900, threshold: 199900, benefit: "15% off" });
    expect(near([tiered], 250000)).toBeNull();
  });

  it("picks the closest of several", () => {
    const far = d({ minSubtotal: 300000, value: 20 });
    const closer = d({ minSubtotal: 120000, value: 10 });
    expect(near([far, closer], 100000)).toMatchObject({ remaining: 20000, benefit: "10% off" });
  });

  it("ignores codes, code lists, scoped offers, quantity tiers, other types and ones that cannot apply anyway", () => {
    expect(near([d({ code: "TYPED", minSubtotal: 99900 })], 50000)).toBeNull();
    expect(near([d({ usesCodeList: true, minSubtotal: 99900 })], 50000)).toBeNull();
    expect(near([d({ minSubtotal: 99900, appliesTo: { type: "products", productIds: ["00000000-0000-4000-8000-0000000000a1"] } })], 50000)).toBeNull();
    expect(near([d({ rules: { tierBy: "quantity", tiers: [{ threshold: 3, value: 10 }] } })], 50000)).toBeNull();
    expect(near([d({ type: "bundle", minSubtotal: 99900 })], 50000)).toBeNull();
    expect(near([d({ minSubtotal: 99900, status: "disabled" })], 50000)).toBeNull();
    expect(near([d({ minSubtotal: 99900, endsAt: new Date(NOW.getTime() - 1) })], 50000)).toBeNull();
    expect(near([d({ minSubtotal: 99900, customerEligibility: { type: "new_customers" } })], 50000)).toBeNull();
  });

  it("has nothing to say when the offer is already reached", () => {
    expect(near([d({ minSubtotal: 50000 })], 60000)).toBeNull();
  });
});
