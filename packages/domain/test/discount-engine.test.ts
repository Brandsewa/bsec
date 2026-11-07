import { describe, expect, it } from "vitest";
import {
  allocateApplications,
  evaluateDiscounts,
  splitProportionally,
  type EngineCart,
  type EngineDiscount,
  type EngineInput,
  type EngineLine,
} from "../src/discounts/engine.ts";

const NOW = new Date("2026-11-07T10:00:00Z");

// Scopes hold real uuids, so the tests use them too.
const C_SHIRTS = "00000000-0000-4000-8000-0000000000c1";
const C_HOME = "00000000-0000-4000-8000-0000000000c2";
const P_SHIRT = "00000000-0000-4000-8000-0000000000a1";
const P_MUG = "00000000-0000-4000-8000-0000000000a2";

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
    rules: {},
    createdAt: new Date(NOW.getTime() - seq * 1000),
    ...over,
  };
}

const line = (id: string, productId: string, lineTotal: number, over: Partial<EngineLine> = {}): EngineLine => ({
  id,
  productId,
  collectionIds: [],
  quantity: 1,
  unitPrice: lineTotal,
  lineTotal,
  onSale: false,
  ...over,
});

const cartOf = (lines: EngineLine[], over: Partial<EngineCart> = {}): EngineCart => ({
  lines,
  subtotal: lines.reduce((s, l) => s + l.lineTotal, 0),
  itemCount: lines.reduce((s, l) => s + l.quantity, 0),
  currency: "INR",
  baseCurrency: "INR",
  ...over,
});
/** Two items of one product, 2 x 500.00 = 1,000.00. */
const TWO = cartOf([line("l1", "p1", 100000, { quantity: 2, unitPrice: 50000 })]);

const run = (discounts: EngineDiscount[], over: Partial<EngineInput> = {}) =>
  evaluateDiscounts({
    discounts,
    codes: [],
    cart: TWO,
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

  it("refuses buy-x-get-y and rules it does not understand, instead of guessing", () => {
    expect(run([d({ code: "BXGY", type: "buy_x_get_y" })], { codes: ["bxgy"] }).rejections[0]?.reason).toMatch(/can't be used at checkout yet/);
    expect(run([d({ code: "ODD", appliesTo: { type: "customers" } })], { codes: ["odd"] }).rejections[0]?.reason).toMatch(/can't be used at checkout yet/);
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
    const usd = cartOf([line("l1", "p1", 5000)], { currency: "USD" });
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

describe("discount engine: product and collection scope", () => {
  const cart = cartOf([
    line("shirt", P_SHIRT, 200000, { quantity: 2, unitPrice: 100000, collectionIds: [C_SHIRTS] }),
    line("mug", P_MUG, 50000, { collectionIds: [C_HOME] }),
  ]);
  const onShirts = (over: Partial<EngineDiscount> = {}) =>
    d({ code: "SHIRTS", appliesTo: { type: "collections", collectionIds: [C_SHIRTS] }, ...over });

  it("takes a percent off only the lines in the chosen collection", () => {
    const r = run([onShirts({ value: 20 })], { codes: ["shirts"], cart });
    expect(r.applications[0]).toMatchObject({ discountClass: "product", amount: 40000, lineAmounts: { shirt: 40000 } });
  });

  it("takes a percent off only the chosen products", () => {
    const r = run([d({ code: "MUG", value: 10, appliesTo: { type: "products", productIds: [P_MUG] } })], { codes: ["mug"], cart });
    expect(r.applications[0]).toMatchObject({ amount: 5000, lineAmounts: { mug: 5000 } });
  });

  it("takes a fixed amount off every item of the chosen products, never more than the line costs", () => {
    const r = run([onShirts({ type: "fixed", value: 30000 })], { codes: ["shirts"], cart });
    expect(r.applications[0]).toMatchObject({ amount: 60000, lineAmounts: { shirt: 60000 } }); // 2 items x 300.00
    const big = run([onShirts({ type: "fixed", value: 900000 })], { codes: ["shirts"], cart });
    expect(big.applications[0]?.amount).toBe(200000);
  });

  it("takes a fixed amount once for the order when asked", () => {
    const r = run([onShirts({ type: "fixed", value: 30000, rules: { oncePerOrder: true } })], { codes: ["shirts"], cart });
    expect(r.applications[0]?.amount).toBe(30000);
  });

  it("caps a percent discount at the most it may take off", () => {
    const r = run([onShirts({ value: 50, rules: { maxDiscount: 25000 } })], { codes: ["shirts"], cart });
    expect(r.applications[0]?.amount).toBe(25000);
    const whole = run([d({ code: "UPTO", value: 50, rules: { maxDiscount: 30000 } })], { codes: ["upto"], cart });
    expect(whole.applications[0]).toMatchObject({ discountClass: "order", amount: 30000 });
  });

  it("leaves out items already on sale when asked", () => {
    const sale = cartOf([line("a", "p1", 100000, { onSale: true }), line("b", "p2", 100000)]);
    expect(run([d({ code: "ALL", value: 10, rules: { excludeOnSale: true } })], { codes: ["all"], cart: sale }).applications[0]?.amount).toBe(10000);
    expect(run([d({ code: "ALL", value: 10 })], { codes: ["all"], cart: sale }).applications[0]?.amount).toBe(20000);
    const onlySale = cartOf([line("a", "p1", 100000, { onSale: true })]);
    expect(run([d({ code: "ALL", value: 10, rules: { excludeOnSale: true } })], { codes: ["all"], cart: onlySale }).rejections[0]?.reason).toMatch(/doesn't apply to anything/);
  });

  it("says so when nothing in the cart matches, and skips it quietly when automatic", () => {
    const other = cartOf([line("mug", P_MUG, 50000)]);
    expect(run([onShirts()], { codes: ["shirts"], cart: other }).rejections[0]?.reason).toMatch(/doesn't apply to anything/);
    expect(run([onShirts({ code: null })], { cart: other })).toEqual({ applications: [], rejections: [] });
  });

  it("lets product discounts on different lines stack, but not on the same line", () => {
    const shirts = onShirts({ value: 10, code: null });
    const mugs = d({ value: 50, appliesTo: { type: "products", productIds: [P_MUG] } });
    expect(run([shirts, mugs], { cart }).applications.map((a) => a.amount).sort((x, y) => x - y)).toEqual([20000, 25000]);
    const overlap = d({ value: 5, appliesTo: { type: "products", productIds: [P_SHIRT] } });
    expect(run([shirts, overlap], { cart }).applications).toHaveLength(1);
  });

  it("takes an order discount off what is left after a product discount, when both opt in", () => {
    const shirts = onShirts({ value: 50, code: null, combinable: true }); // 100000 off the shirts
    const order = d({ value: 10, combinable: true }); // 10% of the remaining 150000
    const r = run([shirts, order], { cart });
    expect(r.applications.map((a) => [a.discountClass, a.amount])).toEqual([
      ["product", 100000],
      ["order", 15000],
    ]);
    // without opting in only one applies
    expect(run([shirts, { ...order, combinable: false }], { cart }).applications).toHaveLength(1);
  });
});

describe("allocating applied discounts over cart lines", () => {
  it("puts a product discount on its own lines and spreads an order discount over what is left", () => {
    const lines = [
      { id: "a", lineTotal: 100000 },
      { id: "b", lineTotal: 50000 },
    ];
    const out = allocateApplications(lines, [
      { discountClass: "product", amount: 40000, lineAmounts: { a: 40000 } },
      { discountClass: "order", amount: 11000 },
    ]);
    // left after the product discount: a 60000, b 50000 -> 11000 split 6:5
    expect(out).toEqual([40000 + 6000, 5000]);
    expect(out.reduce((x, y) => x + y, 0)).toBe(51000);
  });

  it("splitProportionally always adds back up", () => {
    for (const total of [1, 7, 99, 1001]) {
      const parts = splitProportionally([3333, 3333, 3334], total);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
    expect(splitProportionally([0, 0], 10)).toEqual([0, 0]);
  });
});
