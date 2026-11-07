import { describe, expect, it } from "vitest";
import type { DiscountRules } from "@bs/contracts/discount-rules";
import { evaluateDiscounts, type EngineCart, type EngineDiscount, type EngineLine } from "../src/discounts/engine.ts";

const NOW = new Date("2026-11-07T10:00:00Z");
const P_A = "00000000-0000-4000-8000-0000000000a1";
const P_B = "00000000-0000-4000-8000-0000000000a2";
const P_GIFT = "00000000-0000-4000-8000-0000000000a3";
const C_SHIRTS = "00000000-0000-4000-8000-0000000000c1";

let seq = 0;
function d(type: string, rules: DiscountRules, over: Partial<EngineDiscount> = {}): EngineDiscount {
  seq += 1;
  return {
    id: `x${seq}`,
    code: null,
    title: `Offer ${seq}`,
    type,
    value: 0,
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
    rules,
    createdAt: new Date(NOW.getTime() - seq * 1000),
    ...over,
  };
}

const line = (id: string, unit: number, qty: number, over: Partial<EngineLine> = {}): EngineLine => ({
  id,
  productId: P_A,
  collectionIds: [],
  quantity: qty,
  unitPrice: unit,
  lineTotal: unit * qty,
  onSale: false,
  ...over,
});

const cart = (lines: EngineLine[], over: Partial<EngineCart> = {}): EngineCart => ({
  lines,
  subtotal: lines.reduce((s, l) => s + l.lineTotal, 0),
  itemCount: lines.reduce((s, l) => s + l.quantity, 0),
  currency: "INR",
  baseCurrency: "INR",
  marketId: null,
  ...over,
});

const run = (discounts: EngineDiscount[], c: EngineCart, codes: string[] = []) =>
  evaluateDiscounts({ discounts, codes, cart: c, customerUses: {}, now: NOW });

const ALL = { type: "all" } as const;
/** "Buy 2 get 1 free" on everything. */
const buy2get1 = (extra: Partial<NonNullable<DiscountRules["bxgy"]>> = {}): DiscountRules => ({
  bxgy: { buy: { trigger: "quantity", value: 2, appliesTo: ALL }, get: { quantity: 1, appliesTo: ALL, effect: "free" }, ...extra },
});

describe("buy X get Y: quantity", () => {
  it("buy 2 get 1 free: with three items the cheapest is free", () => {
    const c = cart([line("a", 30000, 1), line("b", 20000, 1), line("c", 10000, 1)]);
    const r = run([d("buy_x_get_y", buy2get1())], c);
    expect(r.applications[0]).toMatchObject({ discountClass: "product", amount: 10000, lineAmounts: { c: 10000 } });
  });

  it("with two items nothing is free yet, and a typed code says what is missing", () => {
    const c = cart([line("a", 30000, 1), line("b", 20000, 1)]);
    expect(run([d("buy_x_get_y", buy2get1())], c).applications).toEqual([]);
    const coded = run([d("buy_x_get_y", buy2get1(), { code: "B2G1" })], c, ["b2g1"]);
    expect(coded.rejections[0]?.reason).toBe("Add the items this offer needs to your cart");
  });

  it("repeats for every complete set: six items, two free", () => {
    const c = cart([line("a", 10000, 6)]);
    expect(run([d("buy_x_get_y", buy2get1())], c).applications[0]?.amount).toBe(20000);
  });

  it("stops at the limit per order", () => {
    const c = cart([line("a", 10000, 6)]);
    expect(run([d("buy_x_get_y", buy2get1({ maxUsesPerOrder: 1 }))], c).applications[0]?.amount).toBe(10000);
  });

  it("buy X free from the same product is buy 1 get 1 free", () => {
    const rules: DiscountRules = { bxgy: { buy: { trigger: "quantity", value: 1, appliesTo: ALL }, get: { quantity: 1, appliesTo: ALL, effect: "free" } } };
    expect(run([d("buy_x_get_y", rules)], cart([line("a", 10000, 2)])).applications[0]?.amount).toBe(10000);
    expect(run([d("buy_x_get_y", rules)], cart([line("a", 10000, 3)])).applications[0]?.amount).toBe(10000); // 3 items: one complete pair
  });

  it("buy from one collection, get an item from another", () => {
    const rules: DiscountRules = {
      bxgy: {
        buy: { trigger: "quantity", value: 2, appliesTo: { type: "collections", collectionIds: [C_SHIRTS] } },
        get: { quantity: 1, appliesTo: { type: "products", productIds: [P_B] }, effect: "free" },
      },
    };
    const shirts = line("s", 50000, 2, { collectionIds: [C_SHIRTS] });
    const socks = line("k", 8000, 1, { productId: P_B });
    expect(run([d("buy_x_get_y", rules)], cart([shirts, socks])).applications[0]).toMatchObject({ amount: 8000, lineAmounts: { k: 8000 } });
    expect(run([d("buy_x_get_y", rules)], cart([line("s", 50000, 1, { collectionIds: [C_SHIRTS] }), socks])).applications).toEqual([]);
    expect(run([d("buy_x_get_y", rules)], cart([shirts])).applications).toEqual([]);
  });

  it("the second item at a percentage off, or at a fixed price", () => {
    const pct: DiscountRules = { bxgy: { buy: { trigger: "quantity", value: 1, appliesTo: ALL }, get: { quantity: 1, appliesTo: ALL, effect: "percent", value: 50 } } };
    expect(run([d("buy_x_get_y", pct)], cart([line("a", 20000, 2)])).applications[0]?.amount).toBe(10000);
    const fixedPrice: DiscountRules = { bxgy: { buy: { trigger: "quantity", value: 2, appliesTo: ALL }, get: { quantity: 1, appliesTo: ALL, effect: "fixed_price", value: 9900 } } };
    expect(run([d("buy_x_get_y", fixedPrice)], cart([line("a", 20000, 3)])).applications[0]?.amount).toBe(10100);
    // a fixed price is money in the store's currency
    expect(run([d("buy_x_get_y", fixedPrice, { code: "FP" })], cart([line("a", 20000, 3)], { currency: "USD" }), ["fp"]).rejections[0]?.reason).toBe("This code only works on orders in INR");
  });

  it("leaves out sale items when asked", () => {
    const c = cart([line("a", 10000, 1, { onSale: true }), line("b", 10000, 1), line("c", 10000, 1)]);
    expect(run([d("buy_x_get_y", buy2get1())], c).applications[0]?.amount).toBe(10000);
    expect(run([d("buy_x_get_y", { ...buy2get1(), excludeOnSale: true })], c).applications).toEqual([]);
  });
});

describe("buy X get Y: spend an amount (free gift)", () => {
  // Spend 1,499.00 on anything, get the gift (product P_GIFT) free.
  const gift = (): DiscountRules => ({
    bxgy: {
      buy: { trigger: "amount", value: 149900, appliesTo: ALL },
      get: { quantity: 1, appliesTo: { type: "products", productIds: [P_GIFT] }, effect: "free" },
    },
  });
  const giftLine = line("g", 49900, 1, { productId: P_GIFT });

  it("makes the gift free once the rest of the cart reaches the amount", () => {
    expect(run([d("buy_x_get_y", gift())], cart([line("a", 149900, 1), giftLine])).applications[0]).toMatchObject({ amount: 49900, lineAmounts: { g: 49900 } });
  });

  it("the gift's own price does not count towards the amount", () => {
    expect(run([d("buy_x_get_y", gift())], cart([line("a", 120000, 1), giftLine])).applications).toEqual([]);
  });

  it("applies once per order unless allowed more", () => {
    const c = cart([line("a", 300000, 1), line("g", 49900, 2, { productId: P_GIFT })]);
    expect(run([d("buy_x_get_y", gift())], c).applications[0]?.amount).toBe(49900);
    const more = gift();
    more.bxgy!.maxUsesPerOrder = 2;
    expect(run([d("buy_x_get_y", more)], c).applications[0]?.amount).toBe(99800);
  });
});

describe("bundle price", () => {
  const bundle = (quantity: number, price: number): DiscountRules => ({ bundle: { quantity, price, appliesTo: ALL } });

  it("any 3 for 999.00", () => {
    const r = run([d("bundle", bundle(3, 99900))], cart([line("a", 50000, 3)]));
    expect(r.applications[0]).toMatchObject({ discountClass: "product", amount: 50100, lineAmounts: { a: 50100 } });
  });

  it("charges the bundle price for each complete group and full price for the rest", () => {
    const r = run([d("bundle", bundle(3, 99900))], cart([line("a", 50000, 7)])); // two groups, one item left over
    expect(r.applications[0]?.amount).toBe(2 * 50100);
  });

  it("never costs more than the items would have", () => {
    expect(run([d("bundle", bundle(3, 999900))], cart([line("a", 50000, 3)])).applications).toEqual([]);
  });

  it("groups the cheapest items first and splits the saving over the lines", () => {
    const r = run([d("bundle", bundle(2, 10000))], cart([line("a", 30000, 1), line("b", 5000, 1), line("c", 5000, 1)]));
    // cheapest two (5000 + 5000) already cost 10000: no saving. The 30000 item is left over at full price.
    expect(r.applications).toEqual([]);
    const r2 = run([d("bundle", bundle(2, 20000))], cart([line("a", 30000, 1), line("b", 5000, 1), line("c", 20000, 1)]));
    // cheapest two: 5000 + 20000 = 25000 -> 20000, saving 5000 split 1:4
    expect(r2.applications[0]?.amount).toBe(5000);
    expect(r2.applications[0]?.lineAmounts).toEqual({ b: 1000, c: 4000 });
  });

  it("only counts items in its scope", () => {
    const scoped = d("bundle", { bundle: { quantity: 2, price: 10000, appliesTo: { type: "products", productIds: [P_B] } } });
    const c = cart([line("a", 20000, 2), line("b", 20000, 2, { productId: P_B })]);
    expect(run([scoped], c).applications[0]).toMatchObject({ amount: 30000, lineAmounts: { b: 30000 } });
  });
});

describe("stacking with product discounts", () => {
  it("a buy-x-get-y offer and a product discount cannot both take the same line", () => {
    const pct = d("percent", {}, { value: 10, appliesTo: { type: "products", productIds: [P_A] } });
    const c = cart([line("a", 10000, 3)]);
    expect(run([d("buy_x_get_y", buy2get1()), pct], c).applications).toHaveLength(1);
  });
});
