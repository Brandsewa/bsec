import { describe, expect, it } from "vitest";
import { allocateDiscount, priceOrder } from "../src/orders/pricing.ts";

describe("priceOrder: the one place an order's money is worked out", () => {
  it("adds shipping and a COD fee to the goods when there is no code", () => {
    expect(priceOrder({ subtotal: 10000, shipping: 9900, codFee: 4000 })).toEqual({
      subtotal: 10000,
      discountTotal: 0,
      shippingTotal: 9900,
      shippingDiscount: 0,
      codFee: 4000,
      grandTotal: 23900,
      discountValue: 0,
    });
  });

  it("takes a percent or fixed code off the goods only", () => {
    const r = priceOrder({ subtotal: 10000, shipping: 9900, codFee: 0, discount: { type: "percent", discountAmount: 1000 } });
    expect(r).toMatchObject({ discountTotal: 1000, shippingTotal: 9900, grandTotal: 18900, discountValue: 1000 });
  });

  it("never discounts below zero: a code worth more than the goods only zeroes the goods", () => {
    const r = priceOrder({ subtotal: 3000, shipping: 5000, codFee: 0, discount: { type: "fixed", discountAmount: 9000 } });
    expect(r).toMatchObject({ discountTotal: 3000, grandTotal: 5000 });
  });

  it("a free-shipping code waives the shipping charge and leaves the goods alone", () => {
    const r = priceOrder({ subtotal: 10000, shipping: 9900, codFee: 0, discount: { type: "free_shipping", discountAmount: 0 } });
    expect(r).toMatchObject({ discountTotal: 0, shippingTotal: 0, shippingDiscount: 9900, grandTotal: 10000, discountValue: 9900 });
  });

  it("free shipping on an already free delivery changes nothing", () => {
    const r = priceOrder({ subtotal: 10000, shipping: 0, codFee: 0, discount: { type: "free_shipping", discountAmount: 0 } });
    expect(r).toMatchObject({ shippingTotal: 0, shippingDiscount: 0, grandTotal: 10000 });
  });

  it("ignores nonsense amounts instead of producing a negative or fractional total", () => {
    const r = priceOrder({ subtotal: 10000.4, shipping: -50, codFee: -1, discount: { type: "percent", discountAmount: -200 } });
    expect(r.grandTotal).toBe(10000);
    expect(Number.isInteger(r.grandTotal)).toBe(true);
  });
});

describe("allocateDiscount: a goods discount split over order lines", () => {
  it("always adds back up to exactly the discount, whatever the rounding", () => {
    for (const lines of [[10000], [3333, 3333, 3334], [1, 1, 1], [99999, 1], [500, 500, 500, 500, 500, 500, 500]]) {
      for (const discount of [0, 1, 7, 100, 999, 1000]) {
        const total = lines.reduce((a, b) => a + b, 0);
        if (discount > total) continue;
        const parts = allocateDiscount(lines, discount);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(discount);
        expect(parts.every((p) => p >= 0)).toBe(true);
      }
    }
  });

  it("splits in proportion to what each line costs", () => {
    expect(allocateDiscount([30000, 10000], 4000)).toEqual([3000, 1000]);
  });

  it("gives nothing to anyone when there is no discount or no goods", () => {
    expect(allocateDiscount([100, 200], 0)).toEqual([0, 0]);
    expect(allocateDiscount([0, 0], 50)).toEqual([0, 0]);
  });
});
