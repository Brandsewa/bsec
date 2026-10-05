import { describe, expect, it } from "vitest";
import { calculateGstLineItem, getIndianFinancialYear } from "../src/orders/invoices.ts";

describe("GST Invoices Engine: Parity with Today (PLAN §15 V1 Scope)", () => {
  it("determines correct financial year string across dates", () => {
    // April 2026 -> 2026-27
    expect(getIndianFinancialYear(new Date(2026, 3, 1))).toBe("2026-27");
    // March 2027 -> 2026-27
    expect(getIndianFinancialYear(new Date(2027, 2, 31))).toBe("2026-27");
    // February 2026 -> 2025-26
    expect(getIndianFinancialYear(new Date(2026, 1, 15))).toBe("2025-26");
  });

  it("calculates Intra-State tax-inclusive line item (CGST + SGST split)", () => {
    // ₹1,180 total price inclusive of 18% GST (1800 bps)
    const line = calculateGstLineItem({
      orderItemId: "item_1",
      variantId: "var_1",
      productTitle: "Test Apparel",
      hsn: "6109",
      quantity: 1,
      unitPrice: 118000, // paise = ₹1,180
      discountAmount: 0,
      taxRateBps: 1800,
      pricesIncludeTax: true,
      isInterState: false,
    });

    expect(line.taxableAmount).toBe(100000); // ₹1,000
    expect(line.totalTax).toBe(18000); // ₹180
    expect(line.cgst).toBe(9000); // ₹90 (9%)
    expect(line.sgst).toBe(9000); // ₹90 (9%)
    expect(line.igst).toBe(0);
    expect(line.lineTotal).toBe(118000);
  });

  it("calculates Inter-State tax-exclusive line item (IGST full rate)", () => {
    // ₹2,000 base price exclusive of 12% GST (1200 bps)
    const line = calculateGstLineItem({
      orderItemId: "item_2",
      variantId: "var_2",
      productTitle: "Artisanal Tea",
      hsn: "0902",
      quantity: 2,
      unitPrice: 100000, // ₹1,000 each -> ₹2,000
      discountAmount: 0,
      taxRateBps: 1200,
      pricesIncludeTax: false,
      isInterState: true,
    });

    expect(line.taxableAmount).toBe(200000); // ₹2,000
    expect(line.totalTax).toBe(24000); // ₹240 (12%)
    expect(line.cgst).toBe(0);
    expect(line.sgst).toBe(0);
    expect(line.igst).toBe(24000); // ₹240
    expect(line.lineTotal).toBe(224000); // ₹2,240
  });

  it("discounts proportionally reduce taxable value before tax application", () => {
    // ₹1,000 item with ₹200 discount -> taxable base is ₹800
    const line = calculateGstLineItem({
      orderItemId: "item_3",
      variantId: "var_3",
      productTitle: "Handicraft",
      quantity: 1,
      unitPrice: 100000,
      discountAmount: 20000, // ₹200
      taxRateBps: 1800,
      pricesIncludeTax: false,
      isInterState: true,
    });

    expect(line.taxableAmount).toBe(80000); // ₹800
    expect(line.totalTax).toBe(14400); // 18% of ₹800 = ₹144
    expect(line.igst).toBe(14400);
    expect(line.lineTotal).toBe(94400);
  });

  it("locks exact odd-paise split: extra paisa is allocated to SGST under today's calculator", () => {
    // e.g. taxable item where total tax is odd (1001 paise)
    // today's calculation: cgst = Math.floor(1001 / 2) = 500, sgst = 1001 - 500 = 501
    const line = calculateGstLineItem({
      orderItemId: "item_odd",
      variantId: "var_odd",
      productTitle: "Odd Tax Item",
      quantity: 1,
      unitPrice: 100100,
      discountAmount: 0,
      taxRateBps: 100, // 1%
      pricesIncludeTax: false,
      isInterState: false,
    });

    expect(line.totalTax).toBe(1001);
    expect(line.cgst).toBe(500);
    expect(line.sgst).toBe(501);
    expect(line.cgst + line.sgst).toBe(1001);
  });
});
