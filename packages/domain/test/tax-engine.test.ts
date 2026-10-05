import { describe, it, expect } from "vitest";
import { calculateTax, apportionDiscount } from "../src/orders/tax-engine.ts";

describe("tax-engine", () => {
  describe("apportionDiscount", () => {
    it("distributes discount with largest remainder so sum matches exactly", () => {
      const lineTotals = [1000, 2000, 3000]; // 10, 20, 30
      const discount = 500; // 5.00
      const res = apportionDiscount(lineTotals, discount);
      expect(res.reduce((a, b) => a + b, 0)).toBe(500);
      // exact: 500/6000 * 1000 = 83.33, 166.67, 250.00
      // floors: 83, 166, 250 -> sum 499, remainder 1 goes to idx 1 (.67)
      expect(res).toEqual([83, 167, 250]);
    });
  });

  describe("calculateTax", () => {
    it("computes intra-state tax inclusive with SGST receiving odd paisa", () => {
      // 1 line: ₹1000 (100000 paise), 18% GST (1800 bps)
      const res = calculateTax({
        lines: [
          {
            quantity: 1,
            unitPrice: 100000,
            taxRateBps: 1800,
          },
        ],
        pricesIncludeTax: true,
        sellerState: "Karnataka",
        destinationState: "Karnataka",
      });

      expect(res.isInterState).toBe(false);
      // taxableAmount: Math.round(100000 * 10000 / 11800) = 84746
      expect(res.lines[0]?.taxableAmount).toBe(84746);
      expect(res.lines[0]?.totalTax).toBe(15254);
      // CGST: 15254 / 2 = 7627, SGST: 7627
      expect(res.lines[0]?.cgst).toBe(7627);
      expect(res.lines[0]?.sgst).toBe(7627);
      expect(res.lines[0]?.igst).toBe(0);
      expect(res.lines[0]?.lineTotal).toBe(100000);
      expect(res.grandTotal).toBe(100000);
    });

    it("allocates odd tax paisa to SGST", () => {
      // Net ₹100 exclusive at 5% = 5 tax -> CGST 2, SGST 3
      const res = calculateTax({
        lines: [
          {
            quantity: 1,
            unitPrice: 10000,
            taxRateBps: 500,
          },
        ],
        pricesIncludeTax: false,
        sellerState: "Delhi",
        destinationState: "Delhi",
      });

      expect(res.lines[0]?.totalTax).toBe(500); // 500 paise
      expect(res.lines[0]?.cgst).toBe(250);
      expect(res.lines[0]?.sgst).toBe(250);

      // Unit price with odd tax: ₹1 (100 paise) exclusive at 5% = 5 paise
      const resOdd = calculateTax({
        lines: [
          {
            quantity: 1,
            unitPrice: 100,
            taxRateBps: 500,
          },
        ],
        pricesIncludeTax: false,
        sellerState: "Delhi",
        destinationState: "Delhi",
      });

      expect(resOdd.lines[0]?.totalTax).toBe(5);
      expect(resOdd.lines[0]?.cgst).toBe(2);
      expect(resOdd.lines[0]?.sgst).toBe(3);
    });

    it("computes inter-state IGST", () => {
      const res = calculateTax({
        lines: [
          {
            quantity: 1,
            unitPrice: 100000,
            taxRateBps: 1800,
          },
        ],
        pricesIncludeTax: true,
        sellerState: "Karnataka",
        destinationState: "Maharashtra",
      });

      expect(res.isInterState).toBe(true);
      expect(res.lines[0]?.cgst).toBe(0);
      expect(res.lines[0]?.sgst).toBe(0);
      expect(res.lines[0]?.igst).toBe(15254);
    });

    it("computes shipping tax following highest line rate (mixed supply)", () => {
      const res = calculateTax({
        lines: [
          { quantity: 1, unitPrice: 50000, taxRateBps: 500 }, // 5%
          { quantity: 1, unitPrice: 50000, taxRateBps: 1800 }, // 18%
        ],
        shippingTotal: 10000, // ₹100
        shippingTaxMode: "highest_line_rate",
        pricesIncludeTax: true,
        sellerState: "Delhi",
        destinationState: "Delhi",
      });

      expect(res.shipping.taxRateBps).toBe(1800);
      expect(res.shipping.shippingTotal).toBe(10000);
      // Math.round(10000 * 10000 / 11800) = 8475
      expect(res.shipping.shippingTaxable).toBe(8475);
      expect(res.shipping.totalTax).toBe(1525);
      expect(res.shipping.cgst).toBe(762);
      expect(res.shipping.sgst).toBe(763);
    });

    it("returns zero taxes when tax collection is disabled", () => {
      const res = calculateTax({
        lines: [
          { quantity: 1, unitPrice: 100000, taxRateBps: 1800 },
        ],
        taxCollectionEnabled: false,
        shippingTotal: 10000,
        pricesIncludeTax: true,
        sellerState: "Delhi",
        destinationState: "Delhi",
      });

      expect(res.totalTax).toBe(0);
      expect(res.cgst).toBe(0);
      expect(res.sgst).toBe(0);
      expect(res.igst).toBe(0);
      expect(res.lines[0]?.taxableAmount).toBe(100000);
      expect(res.lines[0]?.totalTax).toBe(0);
      expect(res.shipping.totalTax).toBe(0);
      expect(res.shipping.shippingTaxable).toBe(10000);
    });
  });
});
