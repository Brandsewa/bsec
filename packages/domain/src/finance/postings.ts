/**
 * Pure posting rules (ADR-022, docs/FINANCE-PLAN.md §3.4).
 *
 * One money event in, balanced LedgerPosting[] out. Pure functions with NO database
 * reads or writes. Identical code runs on live paths (via pg-boss jobs) and
 * during background reconciliation/backfill passes.
 */

import {
  LEDGER_ACCOUNT,
  LEDGER_BOOK,
  type LedgerAccount,
} from "./accounts.ts";
import { postingKey, type LedgerPosting } from "./ledger.ts";

/**
 * Exact-sum integer paise allocation (ADR-022, docs/FINANCE-PLAN.md §3.3).
 *
 * Takes an amount in integer paise and an array of non-negative integer weights.
 * Performs proportional floor allocation, then distributes the integer remainder
 * 1 paise at a time to the shares with the largest weights (with index tie-breaker).
 *
 * Invariant: reduce(sum, share) === safeAmount ALWAYS holds. Never produces floats.
 */
export function allocate(amountPaise: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const safeAmount = Math.max(0, Math.trunc(amountPaise));
  const safeWeights = weights.map((w) => Math.max(0, Math.trunc(w)));
  const totalWeight = safeWeights.reduce((sum, w) => sum + w, 0);

  if (totalWeight <= 0) {
    // Nothing to weight by: assign all to the first slot so money is conserved
    return safeWeights.map((_, index) => (index === 0 ? safeAmount : 0));
  }

  // BigInt math prevents overflow when multiplying large paise amounts
  const amountBig = BigInt(safeAmount);
  const totalWeightBig = BigInt(totalWeight);
  const shares = safeWeights.map((w) =>
    Number((amountBig * BigInt(w)) / totalWeightBig),
  );

  const assigned = shares.reduce((sum, s) => sum + s, 0);
  const remainder = safeAmount - assigned;

  if (remainder > 0) {
    // Distribute remainder 1 paise at a time to largest weights
    const indexed = safeWeights.map((w, index) => ({ w, index }));
    indexed.sort((a, b) => b.w - a.w || a.index - b.index);

    for (let i = 0; i < remainder; i++) {
      const target = indexed[i % indexed.length];
      if (target !== undefined) {
        shares[target.index] = (shares[target.index] ?? 0) + 1;
      }
    }
  }

  return shares;
}

export interface OrderItemInput {
  id?: string | null;
  variantId?: string | null;
  quantity: number;
  costPrice?: number | null;
}

export interface PostingOrderInput {
  id: string;
  orderNumber?: string | null;
  subtotal: number;
  discountTotal?: number | null;
  shippingTotal?: number | null;
  codFee?: number | null;
  taxTotal?: number | null;
  grandTotal: number;
  paymentMethod?: string | null;
  currency?: string | null;
  placedAt?: Date | string | null;
  paidAt?: Date | string | null;
  items?: OrderItemInput[] | null;
}

export interface OrderDecomposition {
  merchandise: number;
  shipping: number;
  tax: number;
  grandTotal: number;
  currency: string;
  residual: number;
}

/**
 * Decomposes an order into its financial components.
 * Invariant: merchandise + shipping + tax === grandTotal.
 * If a legacy or malformed order deviates, the residual is booked into merchandise (product_revenue).
 */
export function decomposeOrder(order: PostingOrderInput): OrderDecomposition {
  const currency = (order.currency || "INR").toUpperCase();
  const subtotal = Math.max(0, Math.trunc(order.subtotal || 0));
  const discountTotal = Math.max(0, Math.trunc(order.discountTotal || 0));
  const shippingTotal = Math.max(0, Math.trunc(order.shippingTotal || 0));
  const codFee = Math.max(0, Math.trunc(order.codFee || 0));
  const taxTotal = Math.max(0, Math.trunc(order.taxTotal || 0));
  const grandTotal = Math.max(0, Math.trunc(order.grandTotal || 0));

  let merchandise = Math.max(0, subtotal - discountTotal);
  const shipping = shippingTotal + codFee;
  const tax = taxTotal;

  const expectedGrand = merchandise + shipping + tax;
  const residual = grandTotal - expectedGrand;

  if (residual !== 0) {
    merchandise = Math.max(0, merchandise + residual);
  }

  return {
    merchandise,
    shipping,
    tax,
    grandTotal,
    currency,
    residual,
  };
}

/**
 * Generates balanced double-entry postings when order payment is collected.
 * Events: COD order marked delivered, manual order with "Payment received", online payment capture.
 */
export function orderPaidPostings(params: {
  order: PostingOrderInput;
  date?: Date | string | null;
}): LedgerPosting[] {
  const { order } = params;
  const decomposition = decomposeOrder(order);
  const { merchandise, shipping, tax, currency, residual } = decomposition;
  const date = params.date
    ? new Date(params.date)
    : order.paidAt
      ? new Date(order.paidAt)
      : order.placedAt
        ? new Date(order.placedAt)
        : new Date();

  const isCod = (order.paymentMethod || "").trim().toLowerCase() === "cod";
  const cashAccount = isCod
    ? LEDGER_ACCOUNT.CASH_ON_HAND
    : LEDGER_ACCOUNT.CASH_GATEWAY;

  const postings: LedgerPosting[] = [];
  const residualNote =
    residual !== 0
      ? `Residual of ₹${(residual / 100).toFixed(2)} booked to product_revenue`
      : null;

  // 1. Merchandise revenue
  if (merchandise > 0) {
    postings.push({
      date,
      book: LEDGER_BOOK.OWN,
      debit: cashAccount,
      credit: LEDGER_ACCOUNT.PRODUCT_REVENUE,
      amount: merchandise,
      currency,
      source: { kind: "order", id: order.id, ref: order.orderNumber ?? null },
      key: postingKey("order", order.id, "revenue"),
      note: residualNote,
    });
  }

  // 2. Tax payable
  if (tax > 0) {
    postings.push({
      date,
      book: LEDGER_BOOK.OWN,
      debit: cashAccount,
      credit: LEDGER_ACCOUNT.TAX_PAYABLE,
      amount: tax,
      currency,
      source: { kind: "order", id: order.id, ref: order.orderNumber ?? null },
      key: postingKey("order", order.id, "tax"),
    });
  }

  // 3. Shipping income (+ COD fee)
  if (shipping > 0) {
    postings.push({
      date,
      book: LEDGER_BOOK.OWN,
      debit: cashAccount,
      credit: LEDGER_ACCOUNT.SHIPPING_INCOME,
      amount: shipping,
      currency,
      source: { kind: "order", id: order.id, ref: order.orderNumber ?? null },
      key: postingKey("order", order.id, "shipping"),
    });
  }

  // 4. Cost of Goods Sold (COGS)
  if (order.items && order.items.length > 0) {
    let cogsTotal = 0;
    for (const item of order.items) {
      if (
        item.costPrice !== null &&
        item.costPrice !== undefined &&
        item.costPrice > 0
      ) {
        cogsTotal += Math.trunc(item.costPrice) * Math.max(0, item.quantity);
      }
    }
    if (cogsTotal > 0) {
      postings.push({
        date,
        book: LEDGER_BOOK.OWN,
        debit: LEDGER_ACCOUNT.COST_OF_GOODS,
        credit: LEDGER_ACCOUNT.INVENTORY,
        amount: cogsTotal,
        currency,
        source: { kind: "order", id: order.id, ref: order.orderNumber ?? null },
        key: postingKey("order", order.id, "cogs"),
        note: "Line-item cost price snapshot",
      });
    }
  }

  return postings;
}

export interface PostingRefundInput {
  id: string;
  amount: number;
  method?: string | null;
  reference?: string | null;
  date?: Date | string | null;
}

export interface RefundAlreadyReversed {
  merchandise?: number | null;
  tax?: number | null;
  shipping?: number | null;
}

/**
 * Generates balanced double-entry postings for customer refunds.
 *
 * Prorates the refund amount across remaining unrefunded portions of merchandise,
 * tax, and shipping using exact integer allocation.
 *
 * Cash account selected according to refund method and original order payment method.
 * Never credits cash_gateway if the sale did not debit it.
 */
export function refundPostings(params: {
  order: PostingOrderInput;
  refund: PostingRefundInput;
  alreadyReversed?: RefundAlreadyReversed | null;
  date?: Date | string | null;
}): LedgerPosting[] {
  const { order, refund } = params;
  const decomposition = decomposeOrder(order);
  const { merchandise, shipping, tax, currency } = decomposition;
  const refundAmount = Math.max(0, Math.trunc(refund.amount || 0));

  if (refundAmount <= 0) return [];

  // Calculate unrefunded headroom per component
  const alreadyMerchandise = Math.max(
    0,
    Math.trunc(params.alreadyReversed?.merchandise || 0),
  );
  const alreadyTax = Math.max(0, Math.trunc(params.alreadyReversed?.tax || 0));
  const alreadyShipping = Math.max(
    0,
    Math.trunc(params.alreadyReversed?.shipping || 0),
  );

  const remMerchandise = Math.max(0, merchandise - alreadyMerchandise);
  const remTax = Math.max(0, tax - alreadyTax);
  const remShipping = Math.max(0, shipping - alreadyShipping);
  const totalRemaining = remMerchandise + remTax + remShipping;

  if (totalRemaining <= 0) {
    // No remaining headroom on this order
    return [];
  }

  // Cap refund amount at remaining headroom
  const effectiveAmount = Math.min(refundAmount, totalRemaining);

  // Allocate effectiveAmount proportionally over remaining parts
  const [merchandiseBack = 0, taxBack = 0, shippingBack = 0] = allocate(
    effectiveAmount,
    [remMerchandise, remTax, remShipping],
  );

  // Determine cash account
  const isCod = (order.paymentMethod || "").trim().toLowerCase() === "cod";
  const orderCashAccount = isCod
    ? LEDGER_ACCOUNT.CASH_ON_HAND
    : LEDGER_ACCOUNT.CASH_GATEWAY;

  const refundMethod = (refund.method || "").trim().toLowerCase();
  let cashAccount: LedgerAccount;

  if (refundMethod === "cash") {
    cashAccount = LEDGER_ACCOUNT.CASH_ON_HAND;
  } else if (
    refundMethod === "bank_transfer" ||
    refundMethod === "upi" ||
    refundMethod === "other"
  ) {
    cashAccount = LEDGER_ACCOUNT.CASH_BANK;
  } else if (refundMethod === "original_payment_method") {
    // Only credit gateway if the sale actually went into gateway
    cashAccount =
      orderCashAccount === LEDGER_ACCOUNT.CASH_GATEWAY
        ? LEDGER_ACCOUNT.CASH_GATEWAY
        : LEDGER_ACCOUNT.CASH_BANK;
  } else {
    cashAccount =
      orderCashAccount === LEDGER_ACCOUNT.CASH_GATEWAY
        ? LEDGER_ACCOUNT.CASH_GATEWAY
        : LEDGER_ACCOUNT.CASH_BANK;
  }

  const date = params.date
    ? new Date(params.date)
    : refund.date
      ? new Date(refund.date)
      : new Date();

  const postings: LedgerPosting[] = [];

  if (merchandiseBack > 0) {
    postings.push({
      date,
      book: LEDGER_BOOK.OWN,
      debit: LEDGER_ACCOUNT.REFUNDS,
      credit: cashAccount,
      amount: merchandiseBack,
      currency,
      source: { kind: "refund", id: refund.id, ref: order.orderNumber ?? null },
      key: postingKey("refund", refund.id, "merchandise"),
    });
  }

  if (taxBack > 0) {
    postings.push({
      date,
      book: LEDGER_BOOK.OWN,
      debit: LEDGER_ACCOUNT.TAX_PAYABLE,
      credit: cashAccount,
      amount: taxBack,
      currency,
      source: { kind: "refund", id: refund.id, ref: order.orderNumber ?? null },
      key: postingKey("refund", refund.id, "tax"),
    });
  }

  if (shippingBack > 0) {
    postings.push({
      date,
      book: LEDGER_BOOK.OWN,
      debit: LEDGER_ACCOUNT.SHIPPING_INCOME,
      credit: cashAccount,
      amount: shippingBack,
      currency,
      source: { kind: "refund", id: refund.id, ref: order.orderNumber ?? null },
      key: postingKey("refund", refund.id, "shipping"),
    });
  }

  return postings;
}

/**
 * Generates balanced entries when returned or cancelled items are restocked to inventory.
 * Inverts COGS: debit inventory, credit cost_of_goods.
 * Capped at the COGS actually posted for the order.
 */
export function restockCostPostings(params: {
  orderId: string;
  orderNumber?: string | null;
  items: Array<{ quantity: number; costPrice?: number | null }>;
  reason: string; // "cancel" | `return-${returnId}`
  postedCogs: number;
  alreadyRestockedCogs?: number | null;
  date?: Date | string | null;
  currency?: string | null;
}): LedgerPosting[] {
  const postedCogs = Math.max(0, Math.trunc(params.postedCogs || 0));
  const alreadyRestocked = Math.max(
    0,
    Math.trunc(params.alreadyRestockedCogs || 0),
  );
  const maxRestockable = Math.max(0, postedCogs - alreadyRestocked);

  if (maxRestockable <= 0) return [];

  let itemsCost = 0;
  for (const item of params.items) {
    if (
      item.costPrice !== null &&
      item.costPrice !== undefined &&
      item.costPrice > 0
    ) {
      itemsCost += Math.trunc(item.costPrice) * Math.max(0, item.quantity);
    }
  }

  const effectiveCost = Math.min(itemsCost, maxRestockable);
  if (effectiveCost <= 0) return [];

  const date = params.date ? new Date(params.date) : new Date();
  const currency = (params.currency || "INR").toUpperCase();

  return [
    {
      date,
      book: LEDGER_BOOK.OWN,
      debit: LEDGER_ACCOUNT.INVENTORY,
      credit: LEDGER_ACCOUNT.COST_OF_GOODS,
      amount: effectiveCost,
      currency,
      source: { kind: "order", id: params.orderId, ref: params.orderNumber ?? null },
      key: postingKey("order", params.orderId, "cogs-back", params.reason),
      note: `Restock cost reversal (${params.reason})`,
    },
  ];
}

export interface PostingExpenseInput {
  id: string;
  date: Date | string;
  category: string;
  amount: number;
  currency?: string | null;
  description: string;
  payee?: string | null;
  paidFrom?: string | null; // "bank" | "cash" | "gateway" | "unpaid"
  revision?: number | null;
  debitAccount?: string | null;
}

/**
 * Maps paid_from string to the appropriate credit ledger account.
 */
export function expensePaidFromToAccount(paidFrom?: string | null): LedgerAccount {
  const normalized = (paidFrom || "bank").trim().toLowerCase();
  switch (normalized) {
    case "unpaid":
      return LEDGER_ACCOUNT.ACCOUNTS_PAYABLE;
    case "cash":
      return LEDGER_ACCOUNT.CASH_ON_HAND;
    case "gateway":
      return LEDGER_ACCOUNT.CASH_GATEWAY;
    case "bank":
    default:
      return LEDGER_ACCOUNT.CASH_BANK;
  }
}

/**
 * Generates postings for an expense create, edit, or reversal.
 * For edits, the caller posts the reversal of the old revision and the new revision.
 */
export function expensePostings(params: {
  expense: PostingExpenseInput;
  isReversal?: boolean;
  date?: Date | string | null;
}): LedgerPosting[] {
  const { expense, isReversal = false } = params;
  const amount = Math.max(0, Math.trunc(expense.amount || 0));
  if (amount <= 0) return [];

  const currency = (expense.currency || "INR").toUpperCase();
  const date = params.date
    ? new Date(params.date)
    : new Date(expense.date);
  const revision = Math.max(0, Math.trunc(expense.revision || 0));

  // Determine debit account (stored on expense or derived from category)
  let debitAccount: LedgerAccount;
  if (
    expense.debitAccount &&
    expense.debitAccount in LEDGER_ACCOUNT
  ) {
    debitAccount = expense.debitAccount as LedgerAccount;
  } else if (expense.category === "inventory_purchase") {
    debitAccount = LEDGER_ACCOUNT.INVENTORY;
  } else {
    debitAccount = LEDGER_ACCOUNT.OPERATING_EXPENSE;
  }

  const creditAccount = expensePaidFromToAccount(expense.paidFrom);
  const baseKey = postingKey("expense", expense.id, "v", revision);
  const key = isReversal ? `${baseKey}:reversal` : baseKey;

  // Normal: debit debitAccount, credit creditAccount
  // Reversal: debit creditAccount, credit debitAccount
  const debit = isReversal ? creditAccount : debitAccount;
  const credit = isReversal ? debitAccount : creditAccount;

  return [
    {
      date,
      book: LEDGER_BOOK.OWN,
      debit,
      credit,
      amount,
      currency,
      source: { kind: "expense", id: expense.id, ref: expense.description },
      key,
      note: isReversal ? `Reversal of revision ${revision}` : expense.description,
    },
  ];
}

/**
 * Generates postings when an unpaid expense bill is settled or unsettled.
 * Settles accounts_payable down by debiting accounts_payable and crediting cash account.
 */
export function expenseSettlementPostings(params: {
  expenseId: string;
  amount: number;
  sequence: number;
  paidFrom: string; // "bank" | "cash" | "gateway"
  paidAt: Date | string;
  description?: string | null;
  currency?: string | null;
  isReversal?: boolean;
}): LedgerPosting[] {
  const amount = Math.max(0, Math.trunc(params.amount || 0));
  if (amount <= 0) return [];

  const currency = (params.currency || "INR").toUpperCase();
  const date = new Date(params.paidAt);
  const sequence = Math.max(0, Math.trunc(params.sequence || 0));
  const isReversal = params.isReversal || false;

  const cashAccount = expensePaidFromToAccount(params.paidFrom);
  const debitAccount = LEDGER_ACCOUNT.ACCOUNTS_PAYABLE;

  const baseKey = postingKey("expense", params.expenseId, "settle", sequence);
  const key = isReversal ? `${baseKey}:reversal` : baseKey;

  // Normal settlement: debit accounts_payable, credit cashAccount
  // Unsettle (reversal): debit cashAccount, credit accounts_payable
  const debit = isReversal ? cashAccount : debitAccount;
  const credit = isReversal ? debitAccount : cashAccount;

  return [
    {
      date,
      book: LEDGER_BOOK.OWN,
      debit,
      credit,
      amount,
      currency,
      source: { kind: "expense", id: params.expenseId, ref: params.description ?? null },
      key,
      note: isReversal
        ? `Reversal of settlement #${sequence}`
        : `Settlement #${sequence} via ${params.paidFrom}`,
    },
  ];
}

/**
 * Generates postings for an admin balance adjustment.
 * Enforces strict two distinct accounts, positive amount, and required reason.
 */
export function adjustmentPostings(params: {
  id: string;
  debit: LedgerAccount;
  credit: LedgerAccount;
  amount: number;
  reason: string;
  date?: Date | string | null;
  currency?: string | null;
}): LedgerPosting[] {
  const amount = Math.trunc(params.amount || 0);
  if (amount <= 0) {
    throw new Error("Adjustment amount must be positive paise");
  }
  if (params.debit === params.credit) {
    throw new Error("Adjustment debit and credit accounts must be distinct");
  }
  const reason = (params.reason || "").trim();
  if (reason.length < 4 || reason.length > 500) {
    throw new Error("Adjustment reason must be between 4 and 500 characters");
  }

  const currency = (params.currency || "INR").toUpperCase();
  const date = params.date ? new Date(params.date) : new Date();

  return [
    {
      date,
      book: LEDGER_BOOK.OWN,
      debit: params.debit,
      credit: params.credit,
      amount,
      currency,
      source: { kind: "adjustment", id: params.id, ref: reason },
      key: postingKey("adjustment", params.id),
      note: reason,
    },
  ];
}

/**
 * Dormant gateway fee posting rule (rule 14: unwired until Razorpay is live).
 */
export function gatewayFeePostings(params: {
  orderId: string;
  orderNumber?: string | null;
  feeAmount: number;
  date?: Date | string | null;
  currency?: string | null;
}): LedgerPosting[] {
  const feeAmount = Math.max(0, Math.trunc(params.feeAmount || 0));
  if (feeAmount <= 0) return [];

  const currency = (params.currency || "INR").toUpperCase();
  const date = params.date ? new Date(params.date) : new Date();

  return [
    {
      date,
      book: LEDGER_BOOK.OWN,
      debit: LEDGER_ACCOUNT.PROCESSING_FEES,
      credit: LEDGER_ACCOUNT.CASH_GATEWAY,
      amount: feeAmount,
      currency,
      source: { kind: "order", id: params.orderId, ref: params.orderNumber ?? null },
      key: postingKey("order", params.orderId, "processing-fee"),
      note: "Payment gateway processing fee",
    },
  ];
}

/**
 * Dormant courier label cost posting rule (rule 14: unwired until Shiprocket is live).
 */
export function shippingCostPostings(params: {
  shipmentId: string;
  costAmount: number;
  date?: Date | string | null;
  currency?: string | null;
}): LedgerPosting[] {
  const costAmount = Math.max(0, Math.trunc(params.costAmount || 0));
  if (costAmount <= 0) return [];

  const currency = (params.currency || "INR").toUpperCase();
  const date = params.date ? new Date(params.date) : new Date();

  return [
    {
      date,
      book: LEDGER_BOOK.OWN,
      debit: LEDGER_ACCOUNT.SHIPPING_COST,
      credit: LEDGER_ACCOUNT.CASH_BANK,
      amount: costAmount,
      currency,
      source: { kind: "shipment", id: params.shipmentId },
      key: postingKey("shipment", params.shipmentId, "label"),
      note: "Carrier shipment label cost",
    },
  ];
}
