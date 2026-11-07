import { describe, expect, it } from "vitest";
import { evaluateDiscounts, type EngineDiscount, type EngineInput } from "../src/discounts/engine.ts";

const NOW = new Date("2026-11-07T10:00:00Z");

let seq = 0;
function d(over: Partial<EngineDiscount> = {}): EngineDiscount {
  seq += 1;
  return {
    id: `d${seq}`,
    code: null,
    title: `Discount ${seq}`,
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
    createdAt: new Date(NOW.getTime() - seq * 1000),
    ...over,
  };
}

const run = (discounts: EngineDiscount[], over: Partial<EngineInput> = {}) =>
  evaluateDiscounts({
    discounts,
    codes: [],
    cart: { subtotal: 100000, itemCount: 2, currency: "INR", baseCurrency: "INR" },
    customerUses: {},
    now: NOW,
    ...over,
  });

describe("discount engine: automatic discounts", () => {
  it("applies an automatic discount with no code typed", () => {
    const r = run([d({ value: 10 })]);
    expect(r.applications).toHaveLength(1);
    expect(r.applications[0]).toMatchObject({ automatic: true, amount: 10000, discountClass: "order" });
  });

  it("skips an automatic discount whose minimum is not met, without a rejection", () => {
    const r = run([d({ minSubtotal: 200000 })]);
    expect(r.applications).toEqual([]);
    expect(r.rejections).toEqual([]);
  });

  it("skips scheduled, expired and disabled automatic discounts", () => {
    const r = run([
      d({ startsAt: new Date(NOW.getTime() + 1000) }),
      d({ endsAt: new Date(NOW.getTime() - 1000) }),
      d({ status: "disabled" }),
    ]);
    expect(r.applications).toEqual([]);
  });
});

describe("discount engine: typed codes", () => {
  it("matches a code case-insensitively", () => {
    const r = run([d({ code: "SAVE20", value: 20 })], { codes: ["save20"] });
    expect(r.applications[0]).toMatchObject({ code: "SAVE20", amount: 20000, automatic: false });
  });

  it("explains why a code cannot be used", () => {
    expect(run([d({ code: "OLD", endsAt: new Date(NOW.getTime() - 1) })], { codes: ["old"] }).rejections).toEqual([{ code: "OLD", reason: "Discount has expired" }]);
    expect(run([], { codes: ["nope"] }).rejections).toEqual([{ code: "NOPE", reason: "Discount code not found" }]);
    expect(run([d({ code: "BIG", minSubtotal: 500000 })], { codes: ["big"] }).rejections[0]?.reason).toMatch(/Minimum order subtotal/);
    expect(run([d({ code: "FEW", minQty: 5 })], { codes: ["few"] }).rejections[0]?.reason).toMatch(/Minimum order quantity of 5/);
    expect(run([d({ code: "GONE", usageLimit: 3, usedCount: 3 })], { codes: ["gone"] }).rejections[0]?.reason).toMatch(/usage limit/);
  });

  it("refuses product-scoped and buy-x-get-y rules it cannot apply yet, instead of guessing", () => {
    expect(run([d({ code: "COL", appliesTo: { type: "collection" } })], { codes: ["col"] }).rejections[0]?.reason).toMatch(/can't be used at checkout yet/);
    expect(run([d({ code: "BXGY", type: "buy_x_get_y" })], { codes: ["bxgy"] }).rejections[0]?.reason).toMatch(/can't be used at checkout yet/);
  });
});

describe("discount engine: per-customer limit", () => {
  const code = d({ code: "ONCE", perCustomerLimit: 1 });

  it("allows a customer who has not used it", () => {
    expect(run([code], { codes: ["once"] }).applications).toHaveLength(1);
  });

  it("refuses a customer at the limit", () => {
    const r = run([code], { codes: ["once"], customerUses: { [code.id]: 1 } });
    expect(r.applications).toEqual([]);
    expect(r.rejections[0]?.reason).toBe("You have already used this code");
  });

  it("does not block an automatic discount for a customer under its limit", () => {
    const auto = d({ perCustomerLimit: 2 });
    expect(run([auto], { customerUses: { [auto.id]: 1 } }).applications).toHaveLength(1);
    expect(run([auto], { customerUses: { [auto.id]: 2 } }).applications).toHaveLength(0);
  });
});

describe("discount engine: fixed amounts and currency", () => {
  it("takes a fixed amount off in the store's currency, never more than the subtotal", () => {
    expect(run([d({ code: "F", type: "fixed", value: 5000 })], { codes: ["f"] }).applications[0]?.amount).toBe(5000);
    expect(run([d({ code: "F", type: "fixed", value: 999999 })], { codes: ["f"] }).applications[0]?.amount).toBe(100000);
  });

  it("refuses a fixed amount in another currency, but lets percent and free shipping through", () => {
    const usd = { subtotal: 5000, itemCount: 1, currency: "USD", baseCurrency: "INR" };
    expect(run([d({ code: "F", type: "fixed", value: 5000 })], { codes: ["f"], cart: usd }).rejections[0]?.reason).toBe("This code only works on orders in INR");
    expect(run([d({ code: "P", value: 10 })], { codes: ["p"], cart: usd }).applications[0]?.amount).toBe(500);
    expect(run([d({ code: "S", type: "free_shipping", value: 0 })], { codes: ["s"], cart: usd }).applications[0]?.freeShipping).toBe(true);
  });
});

describe("discount engine: stacking", () => {
  it("picks the better of two automatic goods discounts", () => {
    const r = run([d({ value: 5 }), d({ value: 15 })]);
    expect(r.applications).toHaveLength(1);
    expect(r.applications[0]?.amount).toBe(15000);
  });

  it("a typed code beats an automatic discount even when the automatic one is worth more", () => {
    const r = run([d({ value: 30 }), d({ code: "MINE", value: 5 })], { codes: ["mine"] });
    expect(r.applications).toHaveLength(1);
    expect(r.applications[0]).toMatchObject({ code: "MINE", amount: 5000 });
  });

  it("goods and shipping discounts need both to opt in to stack", () => {
    const goods = d({ value: 10, combinable: true });
    const ship = d({ type: "free_shipping", value: 0, combinable: true });
    expect(run([goods, ship]).applications).toHaveLength(2);
    expect(run([{ ...goods, combinable: false }, ship]).applications).toHaveLength(1);
    expect(run([goods, { ...ship, combinable: false }]).applications).toHaveLength(1);
  });

  it("when a typed shipping code and an automatic goods discount cannot stack, the code stays", () => {
    const r = run([d({ value: 10 }), d({ code: "SHIP", type: "free_shipping", value: 0 })], { codes: ["ship"] });
    expect(r.applications).toHaveLength(1);
    expect(r.applications[0]?.freeShipping).toBe(true);
    expect(r.rejections).toEqual([]);
  });

  it("tells the shopper when a typed code lost to another typed code", () => {
    const a = d({ code: "A", value: 20 });
    const b = d({ code: "B", value: 10 });
    const r = run([a, b], { codes: ["a", "b"] });
    expect(r.applications.map((x) => x.code)).toEqual(["A"]);
    expect(r.rejections).toEqual([{ code: "B", reason: "This code can't be combined with the other discount on your order" }]);
  });

  it("gives the same answer whatever order the rows arrive in", () => {
    const rows = [d({ value: 10 }), d({ value: 10 }), d({ value: 10 })];
    const first = run(rows).applications[0]?.discountId;
    expect(run([...rows].reverse()).applications[0]?.discountId).toBe(first);
  });
});
