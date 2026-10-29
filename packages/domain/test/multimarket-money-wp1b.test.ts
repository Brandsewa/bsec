import { describe, expect, it } from "vitest";
import { formatMoney } from "@bs/contracts/money";
import { orderPaidPostings } from "../src/finance/postings.ts";

describe("multimarket domain money text formatting (WP-1b)", () => {
  describe("finance residual note", () => {
    it("formats INR residual note byte-identically with ₹ and two decimals", () => {
      // Create an order where sum of parts does not match grand total, inducing a residual
      const postings = orderPaidPostings({
        order: {
          id: "ord_1",
          orderNumber: "ORD-001",
          subtotal: 10000,
          discountTotal: 0,
          shippingTotal: 1000,
          codFee: 0,
          taxTotal: 500,
          grandTotal: 11501, // 1 paise residual
          currency: "INR",
          paymentMethod: "prepaid",
          placedAt: new Date("2026-10-01T12:00:00Z"),
        },
      });

      const revenuePosting = postings.find((p) => p.credit === "product_revenue");
      expect(revenuePosting).toBeDefined();
      expect(revenuePosting?.note).toBe("Residual of ₹0.01 booked to product_revenue");
    });

    it("formats USD residual note with $ and two decimals", () => {
      const postings = orderPaidPostings({
        order: {
          id: "ord_2",
          orderNumber: "ORD-002",
          subtotal: 1000,
          discountTotal: 0,
          shippingTotal: 200,
          codFee: 0,
          taxTotal: 100,
          grandTotal: 1302, // 2 cents residual
          currency: "USD",
          paymentMethod: "prepaid",
          placedAt: new Date("2026-10-01T12:00:00Z"),
        },
      });

      const revenuePosting = postings.find((p) => p.credit === "product_revenue");
      expect(revenuePosting).toBeDefined();
      expect(revenuePosting?.note).toBe("Residual of $0.02 booked to product_revenue");
    });
  });

  describe("formatMoney contract behavior for WP-1b money strings", () => {
    it("formats discount threshold messages byte-identical for INR and properly for USD", () => {
      const minSubtotal = 15000; // 150.00
      const inrText = `Minimum order subtotal of ${formatMoney(minSubtotal, "INR", { alwaysShowFraction: true })} required`;
      expect(inrText).toBe("Minimum order subtotal of ₹150.00 required");

      const usdText = `Minimum order subtotal of ${formatMoney(minSubtotal, "USD", { alwaysShowFraction: true })} required`;
      expect(usdText).toBe("Minimum order subtotal of $150.00 required");
    });

    it("formats refund limit messages byte-identical for INR and properly for USD", () => {
      const amount = 50000;
      const maxRefundable = 40000;

      const inrError = `Conflict: Refund of ${formatMoney(amount, "INR", { alwaysShowFraction: true })} exceeds maximum refundable amount of ${formatMoney(maxRefundable, "INR", { alwaysShowFraction: true })}`;
      expect(inrError).toBe("Conflict: Refund of ₹500.00 exceeds maximum refundable amount of ₹400.00");

      const usdError = `Conflict: Refund of ${formatMoney(amount, "USD", { alwaysShowFraction: true })} exceeds maximum refundable amount of ${formatMoney(maxRefundable, "USD", { alwaysShowFraction: true })}`;
      expect(usdError).toBe("Conflict: Refund of $500.00 exceeds maximum refundable amount of $400.00");
    });

    it("formats return refund event messages byte-identical for INR and properly for USD", () => {
      const refundAmount = 25000;
      const method = "manual";

      const inrMsg = `Return refunded (${formatMoney(refundAmount, "INR", { alwaysShowFraction: true })}) via ${method}`;
      expect(inrMsg).toBe("Return refunded (₹250.00) via manual");

      const usdMsg = `Return refunded (${formatMoney(refundAmount, "USD", { alwaysShowFraction: true })}) via ${method}`;
      expect(usdMsg).toBe("Return refunded ($250.00) via manual");
    });

    it("formats coupon benefits and conditions byte-identical for INR and properly for USD", () => {
      const fixedValue = 20000;
      const minOrder = 99900;

      const inrBenefit = `${formatMoney(fixedValue, "INR")} off`;
      const inrCondition = `On orders over ${formatMoney(minOrder, "INR")}`;
      expect(inrBenefit).toBe("₹200 off");
      expect(inrCondition).toBe("On orders over ₹999");

      const usdBenefit = `${formatMoney(fixedValue, "USD")} off`;
      const usdCondition = `On orders over ${formatMoney(minOrder, "USD")}`;
      expect(usdBenefit).toBe("$200 off");
      expect(usdCondition).toBe("On orders over $999");
    });

    it("formats finance anomaly reasons byte-identical for INR and properly for USD", () => {
      const bal = -125050; // negative cash balance of 1250.50

      const inrReason = `Negative cash balance (${formatMoney(Math.abs(bal), "INR", { alwaysShowFraction: true })}) indicates more funds disbursed than recorded collected.`;
      expect(inrReason).toBe("Negative cash balance (₹1,250.50) indicates more funds disbursed than recorded collected.");

      const usdReason = `Negative cash balance (${formatMoney(Math.abs(bal), "USD", { alwaysShowFraction: true })}) indicates more funds disbursed than recorded collected.`;
      expect(usdReason).toBe("Negative cash balance ($1,250.50) indicates more funds disbursed than recorded collected.");
    });
  });
});
