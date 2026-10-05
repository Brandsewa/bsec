import { describe, expect, it } from "vitest";
import {
  LEDGER_ACCOUNT,
  LEDGER_ACCOUNTS,
  debitSign,
} from "../src/finance/accounts.ts";
import {
  allocate,
  decomposeOrder,
  orderPaidPostings,
  refundPostings,
  restockCostPostings,
  expensePostings,
  expenseSettlementPostings,
  adjustmentPostings,
  gatewayFeePostings,
  shippingCostPostings,
} from "../src/finance/postings.ts";
import {
  SUPPORT_READ_PERMISSIONS,
  SUPPORT_WRITE_PERMISSIONS,
} from "../src/context.ts";

describe("Finance Accounts & Permissions", () => {
  it("contains all 14 fixed accounts with proper types", () => {
    expect(LEDGER_ACCOUNTS).toHaveLength(14);
    expect(LEDGER_ACCOUNTS).toContain(LEDGER_ACCOUNT.CASH_ON_HAND);
    expect(LEDGER_ACCOUNTS).toContain(LEDGER_ACCOUNT.CASH_GATEWAY);
    expect(LEDGER_ACCOUNTS).toContain(LEDGER_ACCOUNT.CASH_BANK);
    expect(LEDGER_ACCOUNTS).toContain(LEDGER_ACCOUNT.INVENTORY);
    expect(LEDGER_ACCOUNTS).toContain(LEDGER_ACCOUNT.TAX_PAYABLE);
    expect(LEDGER_ACCOUNTS).toContain(LEDGER_ACCOUNT.ACCOUNTS_PAYABLE);
    expect(LEDGER_ACCOUNTS).toContain(LEDGER_ACCOUNT.PRODUCT_REVENUE);
    expect(LEDGER_ACCOUNTS).toContain(LEDGER_ACCOUNT.SHIPPING_INCOME);
    expect(LEDGER_ACCOUNTS).toContain(LEDGER_ACCOUNT.REFUNDS);
    expect(LEDGER_ACCOUNTS).toContain(LEDGER_ACCOUNT.COST_OF_GOODS);
    expect(LEDGER_ACCOUNTS).toContain(LEDGER_ACCOUNT.OPERATING_EXPENSE);
    expect(LEDGER_ACCOUNTS).toContain(LEDGER_ACCOUNT.PROCESSING_FEES);
    expect(LEDGER_ACCOUNTS).toContain(LEDGER_ACCOUNT.SHIPPING_COST);
    expect(LEDGER_ACCOUNTS).toContain(LEDGER_ACCOUNT.PROMOTIONS);

    // Verify debit signs: +1 for asset/expense, -1 for liability/income
    expect(debitSign(LEDGER_ACCOUNT.CASH_BANK)).toBe(1);
    expect(debitSign(LEDGER_ACCOUNT.INVENTORY)).toBe(1);
    expect(debitSign(LEDGER_ACCOUNT.COST_OF_GOODS)).toBe(1);
    expect(debitSign(LEDGER_ACCOUNT.OPERATING_EXPENSE)).toBe(1);
    expect(debitSign(LEDGER_ACCOUNT.TAX_PAYABLE)).toBe(-1);
    expect(debitSign(LEDGER_ACCOUNT.ACCOUNTS_PAYABLE)).toBe(-1);
    expect(debitSign(LEDGER_ACCOUNT.PRODUCT_REVENUE)).toBe(-1);
    expect(debitSign(LEDGER_ACCOUNT.SHIPPING_INCOME)).toBe(-1);
    expect(debitSign(LEDGER_ACCOUNT.REFUNDS)).toBe(-1); // Contra-income
  });

  it("excludes finance.read and finance.write from support session scopes", () => {
    expect(SUPPORT_READ_PERMISSIONS).not.toContain("finance.read");
    expect(SUPPORT_READ_PERMISSIONS).not.toContain("finance.write");
    expect(SUPPORT_WRITE_PERMISSIONS).not.toContain("finance.read");
    expect(SUPPORT_WRITE_PERMISSIONS).not.toContain("finance.write");
  });
});

describe("Integer paise allocate()", () => {
  it("handles empty weights and zero total weight", () => {
    expect(allocate(1000, [])).toEqual([]);
    expect(allocate(1000, [0, 0])).toEqual([1000, 0]);
  });

  it("splits amount proportionally and conserves sum exactly", () => {
    const shares = allocate(100, [1, 1, 1]);
    expect(shares).toEqual([34, 33, 33]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("allocates remainder to largest weight", () => {
    // 100 paise over weights [10, 20, 30] (total 60)
    // floors: 16, 33, 50 (sum 99, rem 1 goes to index 2)
    const shares = allocate(100, [10, 20, 30]);
    expect(shares).toEqual([16, 33, 51]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("handles adversarial property tests with 200 random remainder distributions", () => {
    for (let i = 0; i < 200; i++) {
      const amount = Math.floor(Math.random() * 10_000_000); // Up to ₹100,000 in paise
      const numSlots = 2 + Math.floor(Math.random() * 6);
      const weights = Array.from({ length: numSlots }, () =>
        Math.floor(Math.random() * 1000),
      );

      const shares = allocate(amount, weights);
      const totalAllocated = shares.reduce((a, b) => a + b, 0);

      expect(totalAllocated).toBe(amount);
      for (const share of shares) {
        expect(Number.isInteger(share)).toBe(true);
        expect(share).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("handles huge amounts without integer overflow", () => {
    const hugeAmount = 5_000_000_000; // 50 million rupees
    const weights = [1000, 2000, 3000];
    const shares = allocate(hugeAmount, weights);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(hugeAmount);
  });
});

describe("Order Decomposition & Paid Postings", () => {
  it("decomposes clean order with zero residual", () => {
    const order = {
      id: "ord_1",
      orderNumber: "BSEC-1001",
      subtotal: 100000, // ₹1000
      discountTotal: 10000, // ₹100
      shippingTotal: 5000, // ₹50
      codFee: 3000, // ₹30
      taxTotal: 18000, // ₹180
      grandTotal: 116000, // ₹1160 (900 + 80 + 180 = 1160)
    };

    const decomp = decomposeOrder(order);
    expect(decomp.merchandise).toBe(90000);
    expect(decomp.shipping).toBe(8000);
    expect(decomp.tax).toBe(18000);
    expect(decomp.residual).toBe(0);
    expect(decomp.merchandise + decomp.shipping + decomp.tax).toBe(order.grandTotal);
  });

  it("books residual into merchandise on legacy or rounded orders", () => {
    const order = {
      id: "ord_legacy",
      subtotal: 100000,
      grandTotal: 100005, // 5 paise residual
    };

    const decomp = decomposeOrder(order);
    expect(decomp.residual).toBe(5);
    expect(decomp.merchandise).toBe(100005);
    expect(decomp.merchandise + decomp.shipping + decomp.tax).toBe(order.grandTotal);
  });

  it("generates correct postings for COD order with line COGS", () => {
    const postings = orderPaidPostings({
      order: {
        id: "0199a000-0000-7000-8000-000000000001",
        orderNumber: "BSEC-1001",
        subtotal: 100000,
        discountTotal: 10000,
        shippingTotal: 5000,
        taxTotal: 18000,
        grandTotal: 113000,
        paymentMethod: "cod",
        currency: "INR",
        items: [
          { quantity: 2, costPrice: 20000 }, // 2 * ₹200 = ₹400 COGS
          { quantity: 1, costPrice: null }, // uncosted line
        ],
      },
    });

    expect(postings).toHaveLength(4);

    // Revenue
    const rev = postings.find((p) => p.credit === LEDGER_ACCOUNT.PRODUCT_REVENUE);
    expect(rev).toBeDefined();
    expect(rev?.debit).toBe(LEDGER_ACCOUNT.CASH_ON_HAND);
    expect(rev?.amount).toBe(90000);
    expect(rev?.key).toBe("order:0199a000-0000-7000-8000-000000000001:revenue");

    // Tax
    const tax = postings.find((p) => p.credit === LEDGER_ACCOUNT.TAX_PAYABLE);
    expect(tax).toBeDefined();
    expect(tax?.amount).toBe(18000);

    // Shipping
    const ship = postings.find((p) => p.credit === LEDGER_ACCOUNT.SHIPPING_INCOME);
    expect(ship).toBeDefined();
    expect(ship?.amount).toBe(5000);

    // COGS
    const cogs = postings.find((p) => p.debit === LEDGER_ACCOUNT.COST_OF_GOODS);
    expect(cogs).toBeDefined();
    expect(cogs?.credit).toBe(LEDGER_ACCOUNT.INVENTORY);
    expect(cogs?.amount).toBe(40000);
    expect(cogs?.key).toBe("order:0199a000-0000-7000-8000-000000000001:cogs");
  });

  it("debits cash_gateway for online orders", () => {
    const postings = orderPaidPostings({
      order: {
        id: "0199a000-0000-7000-8000-000000000002",
        subtotal: 50000,
        grandTotal: 50000,
        paymentMethod: "razorpay",
      },
    });

    expect(postings[0]?.debit).toBe(LEDGER_ACCOUNT.CASH_GATEWAY);
  });
});

describe("Refund Postings & Proration", () => {
  const sampleOrder = {
    id: "0199a000-0000-7000-8000-000000000010",
    orderNumber: "BSEC-1010",
    subtotal: 70000, // ₹700 merchandise
    taxTotal: 20000, // ₹200 tax
    shippingTotal: 10000, // ₹100 shipping
    grandTotal: 100000, // ₹1000 total
    paymentMethod: "cod",
  };

  it("handles single partial refund proportionally", () => {
    const postings = refundPostings({
      order: sampleOrder,
      refund: {
        id: "ref_1",
        amount: 40000, // ₹400
        method: "cash",
      },
    });

    expect(postings).toHaveLength(3);
    const merch = postings.find((p) => p.debit === LEDGER_ACCOUNT.REFUNDS);
    const tax = postings.find((p) => p.debit === LEDGER_ACCOUNT.TAX_PAYABLE);
    const ship = postings.find((p) => p.debit === LEDGER_ACCOUNT.SHIPPING_INCOME);

    expect(merch?.credit).toBe(LEDGER_ACCOUNT.CASH_ON_HAND);
    expect(merch?.amount).toBe(28000); // 700/1000 * 400 = 280
    expect(tax?.amount).toBe(8000); // 200/1000 * 400 = 80
    expect(ship?.amount).toBe(4000); // 100/1000 * 400 = 40
    expect((merch?.amount ?? 0) + (tax?.amount ?? 0) + (ship?.amount ?? 0)).toBe(40000);
  });

  it("handles consecutive partial refunds taking only from remaining portions", () => {
    // First refund: ₹400
    const firstRefund = refundPostings({
      order: sampleOrder,
      refund: { id: "ref_1", amount: 40000, method: "upi" },
    });
    const firstMerch = firstRefund.find((p) => p.debit === LEDGER_ACCOUNT.REFUNDS)!.amount;
    const firstTax = firstRefund.find((p) => p.debit === LEDGER_ACCOUNT.TAX_PAYABLE)!.amount;
    const firstShip = firstRefund.find((p) => p.debit === LEDGER_ACCOUNT.SHIPPING_INCOME)!.amount;

    // Second refund: ₹600 (remaining ₹600)
    const secondRefund = refundPostings({
      order: sampleOrder,
      refund: { id: "ref_2", amount: 60000, method: "bank_transfer" },
      alreadyReversed: {
        merchandise: firstMerch,
        tax: firstTax,
        shipping: firstShip,
      },
    });

    const secondMerch = secondRefund.find((p) => p.debit === LEDGER_ACCOUNT.REFUNDS)!.amount;
    const secondTax = secondRefund.find((p) => p.debit === LEDGER_ACCOUNT.TAX_PAYABLE)!.amount;
    const secondShip = secondRefund.find((p) => p.debit === LEDGER_ACCOUNT.SHIPPING_INCOME)!.amount;

    // Both refunds sum up to total order components
    expect(firstMerch + secondMerch).toBe(70000);
    expect(firstTax + secondTax).toBe(20000);
    expect(firstShip + secondShip).toBe(10000);

    // A third refund attempt has 0 remaining and produces no entries
    const thirdRefund = refundPostings({
      order: sampleOrder,
      refund: { id: "ref_3", amount: 5000, method: "cash" },
      alreadyReversed: {
        merchandise: 70000,
        tax: 20000,
        shipping: 10000,
      },
    });
    expect(thirdRefund).toEqual([]);
  });

  it("never credits cash_gateway for COD orders even if method is original_payment_method", () => {
    const postings = refundPostings({
      order: sampleOrder, // COD
      refund: {
        id: "ref_orig",
        amount: 10000,
        method: "original_payment_method",
      },
    });

    for (const p of postings) {
      expect(p.credit).toBe(LEDGER_ACCOUNT.CASH_BANK);
      expect(p.credit).not.toBe(LEDGER_ACCOUNT.CASH_GATEWAY);
    }
  });
});

describe("Restock COGS Inversion", () => {
  it("inverts COGS up to posted amount", () => {
    const postings = restockCostPostings({
      orderId: "ord_restock",
      orderNumber: "BSEC-1020",
      items: [{ quantity: 1, costPrice: 35000 }],
      reason: "return-ret_123",
      postedCogs: 50000,
    });

    expect(postings).toHaveLength(1);
    expect(postings[0]?.debit).toBe(LEDGER_ACCOUNT.INVENTORY);
    expect(postings[0]?.credit).toBe(LEDGER_ACCOUNT.COST_OF_GOODS);
    expect(postings[0]?.amount).toBe(35000);
    expect(postings[0]?.key).toBe("order:ord_restock:cogs-back:return-ret_123");
  });

  it("caps restock at posted COGS minus already restocked", () => {
    const postings = restockCostPostings({
      orderId: "ord_restock",
      items: [{ quantity: 1, costPrice: 35000 }],
      reason: "cancel",
      postedCogs: 20000,
      alreadyRestockedCogs: 10000,
    });

    expect(postings[0]?.amount).toBe(10000); // Capped at remaining 10000
  });
});

describe("Expense & Settlement Postings", () => {
  it("generates normal expense and reversal postings", () => {
    const normal = expensePostings({
      expense: {
        id: "exp_1",
        date: "2026-10-01",
        category: "software",
        amount: 499900,
        description: "Figma subscription",
        paidFrom: "bank",
        revision: 0,
      },
    });

    expect(normal).toHaveLength(1);
    expect(normal[0]?.debit).toBe(LEDGER_ACCOUNT.OPERATING_EXPENSE);
    expect(normal[0]?.credit).toBe(LEDGER_ACCOUNT.CASH_BANK);
    expect(normal[0]?.key).toBe("expense:exp_1:v:0");

    const reversal = expensePostings({
      expense: {
        id: "exp_1",
        date: "2026-10-01",
        category: "software",
        amount: 499900,
        description: "Figma subscription",
        paidFrom: "bank",
        revision: 0,
      },
      isReversal: true,
    });

    expect(reversal[0]?.debit).toBe(LEDGER_ACCOUNT.CASH_BANK);
    expect(reversal[0]?.credit).toBe(LEDGER_ACCOUNT.OPERATING_EXPENSE);
    expect(reversal[0]?.key).toBe("expense:exp_1:v:0:reversal");
  });

  it("debits inventory for inventory_purchase expenses", () => {
    const postings = expensePostings({
      expense: {
        id: "exp_stock",
        date: "2026-10-01",
        category: "inventory_purchase",
        amount: 1500000,
        description: "Packaging cartons and raw stock",
        paidFrom: "unpaid",
        revision: 0,
      },
    });

    expect(postings[0]?.debit).toBe(LEDGER_ACCOUNT.INVENTORY);
    expect(postings[0]?.credit).toBe(LEDGER_ACCOUNT.ACCOUNTS_PAYABLE);
  });

  it("generates settlement and unsettle reversal postings", () => {
    const settle = expenseSettlementPostings({
      expenseId: "exp_stock",
      amount: 1500000,
      sequence: 1,
      paidFrom: "bank",
      paidAt: "2026-10-03",
    });

    expect(settle[0]?.debit).toBe(LEDGER_ACCOUNT.ACCOUNTS_PAYABLE);
    expect(settle[0]?.credit).toBe(LEDGER_ACCOUNT.CASH_BANK);
    expect(settle[0]?.key).toBe("expense:exp_stock:settle:1");

    const unsettle = expenseSettlementPostings({
      expenseId: "exp_stock",
      amount: 1500000,
      sequence: 1,
      paidFrom: "bank",
      paidAt: "2026-10-03",
      isReversal: true,
    });

    expect(unsettle[0]?.debit).toBe(LEDGER_ACCOUNT.CASH_BANK);
    expect(unsettle[0]?.credit).toBe(LEDGER_ACCOUNT.ACCOUNTS_PAYABLE);
    expect(unsettle[0]?.key).toBe("expense:exp_stock:settle:1:reversal");
  });
});

describe("Adjustments & Dormant Rules", () => {
  it("enforces strict adjustment validation", () => {
    expect(() =>
      adjustmentPostings({
        id: "adj_1",
        debit: LEDGER_ACCOUNT.CASH_BANK,
        credit: LEDGER_ACCOUNT.CASH_BANK, // Same account rejected
        amount: 1000,
        reason: "Test adjustment",
      }),
    ).toThrow(/distinct/i);

    expect(() =>
      adjustmentPostings({
        id: "adj_2",
        debit: LEDGER_ACCOUNT.CASH_BANK,
        credit: LEDGER_ACCOUNT.CASH_ON_HAND,
        amount: 0, // Zero amount rejected
        reason: "Test adjustment",
      }),
    ).toThrow(/positive/i);

    expect(() =>
      adjustmentPostings({
        id: "adj_3",
        debit: LEDGER_ACCOUNT.CASH_BANK,
        credit: LEDGER_ACCOUNT.CASH_ON_HAND,
        amount: 1000,
        reason: "no", // Too short (< 4 chars)
      }),
    ).toThrow(/between 4 and 500/i);

    const valid = adjustmentPostings({
      id: "adj_cod",
      debit: LEDGER_ACCOUNT.CASH_BANK,
      credit: LEDGER_ACCOUNT.CASH_ON_HAND,
      amount: 50000,
      reason: "COD courier cash remittance received",
    });
    expect(valid[0]?.key).toBe("adjustment:adj_cod");
    expect(valid[0]?.amount).toBe(50000);
  });

  it("dormant gateway and shipping rules produce expected entries", () => {
    const gw = gatewayFeePostings({
      orderId: "ord_gw",
      feeAmount: 236,
    });
    expect(gw[0]?.debit).toBe(LEDGER_ACCOUNT.PROCESSING_FEES);
    expect(gw[0]?.credit).toBe(LEDGER_ACCOUNT.CASH_GATEWAY);

    const ship = shippingCostPostings({
      shipmentId: "shp_1",
      costAmount: 4800,
    });
    expect(ship[0]?.debit).toBe(LEDGER_ACCOUNT.SHIPPING_COST);
    expect(ship[0]?.credit).toBe(LEDGER_ACCOUNT.CASH_BANK);
  });
});
