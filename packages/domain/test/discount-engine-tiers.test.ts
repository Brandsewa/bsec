import { describe, expect, it } from "vitest";
import { evaluateDiscounts, type EngineCart, type EngineDiscount, type EngineLine } from "../src/discounts/engine.ts";
import { priceOrder, toPricingDiscounts } from "../src/orders/pricing.ts";

const NOW = new Date("2026-11-07T10:00:00Z");
const BASE_MARKET = "00000000-0000-4000-8000-0000000000b1";
const US_MARKET = "00000000-0000-4000-8000-0000000000b2";
const P_A = "00000000-0000-4000-8000-0000000000a1";

let seq = 0;
function d(over: Partial<EngineDiscount> = {}): EngineDiscount {
  seq += 1;
  return {
    id: `t${seq}`,
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
    createdAt: new Date(NOW.getTime() - seq * 1000),
    ...over,
  };
}

const line = (id: string, total: number, qty = 1, over: Partial<EngineLine> = {}): EngineLine => ({
  id,
  productId: P_A,
  collectionIds: [],
  quantity: qty,
  unitPrice: Math.round(total / qty),
  lineTotal: total,
  onSale: false,
  ...over,
});

const cart = (lines: EngineLine[], over: Partial<EngineCart> = {}): EngineCart => ({
  lines,
  subtotal: lines.reduce((s, l) => s + l.lineTotal, 0),
  itemCount: lines.reduce((s, l) => s + l.quantity, 0),
  currency: "INR",
  baseCurrency: "INR",
  marketId: BASE_MARKET,
  ...over,
});

const run = (discounts: EngineDiscount[], c: EngineCart, codes: string[] = []) =>
  evaluateDiscounts({ discounts, codes, cart: c, customerUses: {}, now: NOW });

describe("tiered order discounts (spend more, save more)", () => {
  // 999.00 -> 10%, 1999.00 -> 15%, 2999.00 -> 20%
  const tiered = d({ rules: { tiers: [{ threshold: 99900, value: 10 }, { threshold: 199900, value: 15 }, { threshold: 299900, value: 20 }] } });

  it("applies nothing below the first tier", () => {
    expect(run([tiered], cart([line("a", 99899)]))).toEqual({ applications: [], rejections: [] });
  });

  it("gives the first tier at its exact threshold, and one paisa under the next tier still gives the first", () => {
    expect(run([tiered], cart([line("a", 99900)])).applications[0]?.amount).toBe(9990);
    expect(run([tiered], cart([line("a", 199899)])).applications[0]?.amount).toBe(19990); // 10% of 1998.99
  });

  it("moves to the next tier at its exact threshold", () => {
    expect(run([tiered], cart([line("a", 199900)])).applications[0]?.amount).toBe(29985); // 15%
    expect(run([tiered], cart([line("a", 299900)])).applications[0]?.amount).toBe(59980); // 20%
    expect(run([tiered], cart([line("a", 1000000)])).applications[0]?.amount).toBe(200000);
  });

  it("tells a shopper with a typed code how much the first tier needs", () => {
    const coded = d({ code: "BIGSPEND", rules: tiered.rules });
    expect(run([coded], cart([line("a", 50000)]), ["bigspend"]).rejections[0]?.reason).toMatch(/Minimum order subtotal of .*999/);
  });

  it("can tier by quantity", () => {
    const byQty = d({ rules: { tierBy: "quantity", tiers: [{ threshold: 2, value: 10 }, { threshold: 3, value: 15 }] } });
    expect(run([byQty], cart([line("a", 100000, 1)])).applications).toEqual([]);
    expect(run([byQty], cart([line("a", 100000, 2)])).applications[0]?.amount).toBe(10000);
    expect(run([byQty], cart([line("a", 300000, 3)])).applications[0]?.amount).toBe(45000);
  });

  it("uses fixed amounts per tier when the discount is a fixed amount", () => {
    const fixed = d({ type: "fixed", rules: { tiers: [{ threshold: 100000, value: 10000 }, { threshold: 200000, value: 30000 }] } });
    expect(run([fixed], cart([line("a", 150000)])).applications[0]?.amount).toBe(10000);
    expect(run([fixed], cart([line("a", 250000)])).applications[0]?.amount).toBe(30000);
  });

  it("can count only the chosen products towards a tier", () => {
    const P_B = "00000000-0000-4000-8000-0000000000a2";
    const onlyA = d({
      appliesTo: { type: "products", productIds: [P_A] },
      rules: { countEligibleOnly: true, tiers: [{ threshold: 100000, value: 10 }] },
    });
    const mixed = cart([line("a", 60000), line("b", 90000, 1, { productId: P_B })]);
    expect(run([onlyA], mixed).applications).toEqual([]); // only 600.00 of the chosen product
    const enough = cart([line("a", 110000), line("b", 90000, 1, { productId: P_B })]);
    expect(run([onlyA], enough).applications[0]?.amount).toBe(11000);
    const wholeCart = d({ appliesTo: { type: "products", productIds: [P_A] }, rules: { tiers: [{ threshold: 100000, value: 10 }] } });
    expect(run([wholeCart], mixed).applications[0]?.amount).toBe(6000); // whole cart is 1500.00, 10% of the chosen line only
  });
});

describe("free shipping limits", () => {
  const c = cart([line("a", 50000)]);

  it("works in every market when none is chosen", () => {
    expect(run([d({ type: "free_shipping", value: 0 })], cart([line("a", 50000)], { marketId: US_MARKET })).applications).toHaveLength(1);
  });

  it("works only in the chosen markets", () => {
    const india = d({ code: "INDIA", type: "free_shipping", value: 0, rules: { markets: [BASE_MARKET] } });
    expect(run([india], c, ["india"]).applications).toHaveLength(1);
    const us = cart([line("a", 50000)], { marketId: US_MARKET, currency: "USD" });
    expect(run([india], us, ["india"]).rejections[0]?.reason).toBe("This code isn't available in your region");
    expect(run([{ ...india, code: null }], us).applications).toEqual([]);
  });

  it("carries the most it may waive", () => {
    const capped = d({ code: "UPTO100", type: "free_shipping", value: 0, rules: { maxShipping: 10000 } });
    expect(run([capped], c, ["upto100"]).applications[0]).toMatchObject({ freeShipping: true, maxShipping: 10000 });
    expect(run([d({ code: "ALL", type: "free_shipping", value: 0 })], c, ["all"]).applications[0]?.maxShipping).toBeNull();
  });
});

describe("pricing a capped free-shipping discount", () => {
  it("waives only up to the cap and leaves the rest to pay", () => {
    const r = priceOrder({ subtotal: 50000, shipping: 15000, codFee: 0, discounts: toPricingDiscounts([{ type: "free_shipping", amount: 0, maxShipping: 10000 }]) });
    expect(r).toMatchObject({ shippingDiscount: 10000, shippingTotal: 5000, grandTotal: 55000, discountValue: 10000 });
  });

  it("waives all of a charge under the cap", () => {
    const r = priceOrder({ subtotal: 50000, shipping: 6000, codFee: 0, discounts: toPricingDiscounts([{ type: "free_shipping", amount: 0, maxShipping: 10000 }]) });
    expect(r).toMatchObject({ shippingDiscount: 6000, shippingTotal: 0 });
  });

  it("without a cap waives everything", () => {
    const r = priceOrder({ subtotal: 50000, shipping: 15000, codFee: 0, discounts: toPricingDiscounts([{ type: "free_shipping", amount: 0 }]) });
    expect(r).toMatchObject({ shippingDiscount: 15000, shippingTotal: 0 });
  });
});
