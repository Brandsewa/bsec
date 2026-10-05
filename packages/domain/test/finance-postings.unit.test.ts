/**
 * Unit Test: Finance Ledger & Posting Rules (ADR-022, Phase 0-4).
 *
 * Verifies without database reads or writes:
 * 1. Integer paise allocate() function (exact remainder distribution).
 * 2. Order collected posting rules (merchandise, tax, shipping, COD fee).
 * 3. Refund posting rules and proration (contra-income, tax reduction).
 * 4. Return restock posting rules (inventory restoration vs COGS).
 * 5. Operating expense posting rules (revision tracking, reversals, settlements).
 * 6. Admin adjustment posting rules and validation invariants.
 */

import { describe, expect, it } from "vitest";
import {
  LEDGER_ACCOUNT,
} from "../src/finance/accounts.ts";
import {
  allocate,
  orderPaidPostings,
  refundPostings,
  restockCostPostings,
  expensePostings,
  expenseSettlementPostings,
  adjustmentPostings,
} from "../src/finance/postings.ts";

describe("Finance Allocate: Integer Paise Remainder Distribution", () => {
  it("exact sums: reduce(sum, share) === amount ALWAYS holds", () => {
    const amount = 1000; // ₹10.00
    const weights = [333, 333, 334];
    const shares = allocate(amount, weights);

    expect(shares.reduce((a, b) => a + b, 0)).toBe(amount);
    expect(shares).toEqual([333, 333, 334]);
  });

  it("distributes odd paise remainder 1 at a time to highest weights", () => {
    const amount = 100; // 100 paise
    const weights = [3, 3, 3]; // 33.333 each -> 33, 33, 33 = 99 -> 1 remainder
    const shares = allocate(amount, weights);

    expect(shares.reduce((a, b) => a + b, 0)).toBe(amount);
    // First slot gets the extra paise
    expect(shares[0]).toBe(34);
    expect(shares[1]).toBe(33);
    expect(shares[2]).toBe(33);
  });

  it("handles zero total weight by conserving money into slot 0", () => {
    const amount = 500;
    const weights = [0, 0, 0];
    const shares = allocate(amount, weights);

    expect(shares.reduce((a, b) => a + b, 0)).toBe(amount);
    expect(shares).toEqual([500, 0, 0]);
  });

  it("handles empty weights", () => {
    expect(allocate(100, [])).toEqual([]);
  });
});

describe("Finance Postings: Order Collected", () => {
  it("generates balanced postings for a standard order with tax and shipping", () => {
    const postings = orderPaidPostings({
      order: {
        id: "order-123",
        orderNumber: "ORD-123",
        paymentMethod: "gateway",
        subtotal: 200000,
        taxTotal: 36000, // ₹360 GST (18%)
        shippingTotal: 10000, // ₹100
        grandTotal: 246000,
        items: [
          { quantity: 2, costPrice: 40000 }, // 2 * 40000 = 80000 COGS
        ],
      },
    });

    // 1: Debit cash_gateway, Credit product_revenue (200000)
    // 2: Debit cash_gateway, Credit tax_payable (36000)
    // 3: Debit cash_gateway, Credit shipping_income (10000)
    // 4: Debit cost_of_goods, Credit inventory (80000)
    expect(postings).toHaveLength(4);

    const totalDebits = postings.reduce((sum, p) => sum + p.amount, 0);
    expect(totalDebits).toBe(246000 + 80000);

    const rev = postings.find((p) => p.credit === LEDGER_ACCOUNT.PRODUCT_REVENUE);
    expect(rev?.amount).toBe(200000);

    const tax = postings.find((p) => p.credit === LEDGER_ACCOUNT.TAX_PAYABLE);
    expect(tax?.amount).toBe(36000);

    const cogs = postings.find((p) => p.debit === LEDGER_ACCOUNT.COST_OF_GOODS);
    expect(cogs?.credit).toBe(LEDGER_ACCOUNT.INVENTORY);
    expect(cogs?.amount).toBe(80000);
  });

  it("routes COD order collections to cash_on_hand and includes COD fee in shipping income", () => {
    const postings = orderPaidPostings({
      order: {
        id: "order-cod-1",
        paymentMethod: "cod",
        subtotal: 100000,
        taxTotal: 18000,
        shippingTotal: 5000,
        codFee: 4000,
        grandTotal: 127000,
      },
    });

    // Each leg debits cash_on_hand
    const cashDebits = postings.filter((p) => p.debit === LEDGER_ACCOUNT.CASH_ON_HAND);
    const totalCashCollected = cashDebits.reduce((sum, p) => sum + p.amount, 0);
    expect(totalCashCollected).toBe(127000);

    const shippingIncome = postings.find((p) => p.credit === LEDGER_ACCOUNT.SHIPPING_INCOME);
    expect(shippingIncome?.amount).toBe(9000); // 5000 shipping + 4000 cod fee
  });
});

describe("Finance Postings: Refunds & Restocks", () => {
  it("generates prorated contra-revenue and tax reduction on refund", () => {
    const postings = refundPostings({
      order: {
        id: "order-123",
        subtotal: 10000,
        grandTotal: 11800, // ₹118 (100 merch + 18 tax)
        paymentMethod: "gateway",
        taxTotal: 1800,
        shippingTotal: 0,
      },
      refund: {
        id: "refund-1",
        amount: 5900, // Half refund (₹59)
      },
      alreadyReversed: {
        merchandise: 0,
        tax: 0,
        shipping: 0,
      },
    });

    expect(postings.length).toBeGreaterThan(0);

    // Debits refunds (contra-income) and debits tax_payable (reduces liability)
    const refundsLine = postings.find((p) => p.debit === LEDGER_ACCOUNT.REFUNDS);
    expect(refundsLine?.amount).toBe(5000); // ₹50 merch

    const taxLine = postings.find((p) => p.debit === LEDGER_ACCOUNT.TAX_PAYABLE);
    expect(taxLine?.amount).toBe(900); // ₹9 tax
  });

  it("restocks inventory by debiting inventory and crediting cost_of_goods", () => {
    const postings = restockCostPostings({
      orderId: "order-123",
      reason: "Item returned in good condition",
      items: [
        { costPrice: 4000, quantity: 2 }, // 2 * 40 = 80
      ],
      postedCogs: 20000,
      alreadyRestockedCogs: 0,
    });

    expect(postings).toHaveLength(1);
    expect(postings[0]?.debit).toBe(LEDGER_ACCOUNT.INVENTORY);
    expect(postings[0]?.credit).toBe(LEDGER_ACCOUNT.COST_OF_GOODS);
    expect(postings[0]?.amount).toBe(8000);
  });
});

describe("Finance Postings: Expenses & Settlements", () => {
  it("posts operating expense to operating_expense debit and cash_bank credit", () => {
    const postings = expensePostings({
      expense: {
        id: "exp-1",
        date: "2026-10-01",
        category: "rent",
        amount: 5000000, // ₹50,000
        currency: "INR",
        description: "Office rent",
        paidFrom: "cash_bank",
        revision: 0,
      },
    });

    expect(postings).toHaveLength(1);
    expect(postings[0]?.debit).toBe(LEDGER_ACCOUNT.OPERATING_EXPENSE);
    expect(postings[0]?.credit).toBe(LEDGER_ACCOUNT.CASH_BANK);
    expect(postings[0]?.amount).toBe(5000000);
    expect(postings[0]?.key).toBe("expense:exp-1:v:0");
  });

  it("generates exact reversal posting when isReversal is true", () => {
    const postings = expensePostings({
      expense: {
        id: "exp-1",
        date: "2026-10-01",
        category: "rent",
        amount: 5000000,
        currency: "INR",
        description: "Office rent",
        paidFrom: "cash_bank",
        revision: 0,
      },
      isReversal: true,
    });

    expect(postings).toHaveLength(1);
    // Swapped debit and credit
    expect(postings[0]?.debit).toBe(LEDGER_ACCOUNT.CASH_BANK);
    expect(postings[0]?.credit).toBe(LEDGER_ACCOUNT.OPERATING_EXPENSE);
    expect(postings[0]?.key).toBe("expense:exp-1:v:0:reversal");
  });

  it("posts settlement of unpaid bill by debiting accounts_payable and crediting cash account", () => {
    const postings = expenseSettlementPostings({
      expenseId: "exp-bill-1",
      amount: 250000,
      sequence: 1,
      paidFrom: "cash_bank",
      paidAt: "2026-10-05",
      description: "Packaging supplier invoice",
    });

    expect(postings).toHaveLength(1);
    expect(postings[0]?.debit).toBe(LEDGER_ACCOUNT.ACCOUNTS_PAYABLE);
    expect(postings[0]?.credit).toBe(LEDGER_ACCOUNT.CASH_BANK);
    expect(postings[0]?.amount).toBe(250000);
    expect(postings[0]?.key).toBe("expense:exp-bill-1:settle:1");
  });
});

describe("Finance Postings: Adjustments", () => {
  it("rejects non-distinct accounts or non-positive amount", () => {
    expect(() =>
      adjustmentPostings({
        id: "adj-1",
        debit: LEDGER_ACCOUNT.CASH_BANK,
        credit: LEDGER_ACCOUNT.CASH_BANK,
        amount: 1000,
        reason: "Test adjustment note",
      }),
    ).toThrow("distinct");

    expect(() =>
      adjustmentPostings({
        id: "adj-2",
        debit: LEDGER_ACCOUNT.CASH_BANK,
        credit: LEDGER_ACCOUNT.CASH_GATEWAY,
        amount: 0,
        reason: "Test adjustment note",
      }),
    ).toThrow("positive");
  });

  it("generates deterministic key and note", () => {
    const postings = adjustmentPostings({
      id: "adj-123",
      debit: LEDGER_ACCOUNT.CASH_BANK,
      credit: LEDGER_ACCOUNT.CASH_GATEWAY,
      amount: 50000,
      reason: "Gateway payout settlement",
    });

    expect(postings).toHaveLength(1);
    expect(postings[0]?.debit).toBe(LEDGER_ACCOUNT.CASH_BANK);
    expect(postings[0]?.credit).toBe(LEDGER_ACCOUNT.CASH_GATEWAY);
    expect(postings[0]?.amount).toBe(50000);
    expect(postings[0]?.key).toBe("adjustment:adj-123");
  });
});
