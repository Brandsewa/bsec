import { describe, expect, it } from "vitest";
import { evaluateDiscounts, type EngineBulkCode, type EngineCart, type EngineCustomer, type EngineDiscount } from "../src/discounts/engine.ts";

const NOW = new Date("2026-11-07T10:00:00Z");
const CUSTOMER = "00000000-0000-4000-8000-0000000000e1";
const OTHER = "00000000-0000-4000-8000-0000000000e2";

let seq = 0;
function d(over: Partial<EngineDiscount> = {}): EngineDiscount {
  seq += 1;
  return {
    id: `a${seq}`,
    code: `CODE${seq}`,
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

const cart: EngineCart = {
  lines: [{ id: "l1", productId: "00000000-0000-4000-8000-0000000000a1", collectionIds: [], quantity: 1, unitPrice: 100000, lineTotal: 100000, onSale: false }],
  subtotal: 100000,
  itemCount: 1,
  currency: "INR",
  baseCurrency: "INR",
  marketId: null,
};

const as = (customer: EngineCustomer, discount: EngineDiscount, extra: { bulk?: Record<string, EngineBulkCode> } = {}) =>
  evaluateDiscounts({ discounts: [discount], codes: [discount.code ?? "BULKCODE1"], cart, customerUses: {}, customer, now: NOW, ...(extra.bulk ? { bulk: extra.bulk } : {}) });

const guest = (strict: boolean): EngineCustomer => ({ id: null, isNew: true, tags: [], strict });
const known = (over: Partial<EngineCustomer> = {}): EngineCustomer => ({ id: CUSTOMER, isNew: false, tags: [], strict: true, ...over });

describe("discount audiences", () => {
  it("everyone can use a plain code", () => {
    expect(as(known(), d()).applications).toHaveLength(1);
  });

  it("new customers: a returning customer is refused, a guest or first-timer is not", () => {
    const code = d({ customerEligibility: { type: "new_customers" } });
    expect(as(known({ isNew: false }), code).rejections[0]?.reason).toBe("This code is only for new customers");
    expect(as(known({ isNew: true }), code).applications).toHaveLength(1);
    expect(as(guest(true), code).applications).toHaveLength(1);
  });

  it("tags: needs one of the tags; an unknown guest is let through only while browsing", () => {
    const code = d({ customerEligibility: { type: "tags", tags: ["vip", "wholesale"] } });
    expect(as(known({ tags: ["vip"] }), code).applications).toHaveLength(1);
    expect(as(known({ tags: ["new"] }), code).rejections[0]?.reason).toBe("This code isn't available for your account");
    expect(as(guest(false), code).applications).toHaveLength(1); // not known yet
    expect(as(guest(true), code).rejections[0]?.reason).toBe("This code isn't available for your account"); // at checkout, a stranger
  });

  it("chosen customers: only those customers", () => {
    const code = d({ customerEligibility: { type: "customers", customerIds: [CUSTOMER] } });
    expect(as(known(), code).applications).toHaveLength(1);
    expect(as(known({ id: OTHER }), code).rejections).toHaveLength(1);
    expect(as(guest(true), code).rejections).toHaveLength(1);
  });

  it("an automatic offer made for some customers never applies by itself", () => {
    const auto = d({ code: null, customerEligibility: { type: "new_customers" } });
    expect(evaluateDiscounts({ discounts: [auto], codes: [], cart, customerUses: {}, now: NOW })).toEqual({ applications: [], rejections: [] });
  });

  it("an audience this version does not understand is refused, never opened to everyone", () => {
    expect(as(known(), d({ customerEligibility: { type: "somebody-new" } })).rejections[0]?.reason).toMatch(/can't be used at checkout yet/);
  });
});

describe("generated codes", () => {
  const list = d({ code: null, usesCodeList: true, value: 25 });

  it("a typed generated code applies its discount and remembers which code it was", () => {
    const r = as(known(), list, { bulk: { BULKCODE1: { discountId: list.id, codeId: "code-1", used: false } } });
    expect(r.applications[0]).toMatchObject({ code: "BULKCODE1", amount: 25000, automatic: false, bulkCodeId: "code-1" });
  });

  it("a used code says so", () => {
    expect(as(known(), list, { bulk: { BULKCODE1: { discountId: list.id, codeId: "code-1", used: true } } }).rejections[0]?.reason).toBe("This code has already been used");
  });

  it("the discount behind a list never applies without a code", () => {
    expect(evaluateDiscounts({ discounts: [list], codes: [], cart, customerUses: {}, now: NOW })).toEqual({ applications: [], rejections: [] });
  });

  it("a code that is on no list is not found", () => {
    expect(as(known(), list).rejections[0]?.reason).toBe("Discount code not found");
  });
});

describe("several typed codes", () => {
  it("earlier codes keep their place even when a later one is worth more", () => {
    const small = d({ code: "SMALL", value: 5, combinable: true });
    const big = d({ code: "BIG", value: 40, combinable: true });
    const r = evaluateDiscounts({ discounts: [small, big], codes: ["small", "big"], cart, customerUses: {}, now: NOW });
    expect(r.applications.map((a) => a.code)).toEqual(["SMALL"]);
    expect(r.rejections).toEqual([{ code: "BIG", reason: "This code can't be combined with the other discount on your order" }]);
  });
});
