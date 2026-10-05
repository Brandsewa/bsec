/**
 * Finance Reports Domain Service (docs/FINANCE-PLAN.md §3.6).
 *
 * Live groupings over the double-entry ledger entries and order items.
 * Implements:
 * 1. getProfitAndLoss: Income lines, expense lines, contra-refunds, net profit.
 * 2. getCashPosition: Asset and liability account balances, total cash, inventory value.
 * 3. findLedgerAnomalies: Negative cash or negative liability accounts.
 * 4. getTaxSummary: tax_payable balance + GST monthly split from order_items.
 * 5. getCostCoverage: Share of collected revenue with variant cost_price snapshot.
 * 6. getGmv: Placed non-cancelled orders total.
 * 7. getFinanceOverview: Bundled response for the overview screen.
 */

import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import { schema, withTenant, type DbHandle } from "@bs/db";
import { assertPermission, type TenantContext } from "../context.ts";
import {
  getTrialBalance,
  listLedgerEntries,
  type ListLedgerEntriesFilter,
  type TrialBalanceFilter,
} from "./ledger.ts";
import {
  LEDGER_ACCOUNT,
  debitSign,
  type LedgerAccount,
} from "./accounts.ts";
import { resolvePeriod, type PeriodInput } from "./period-resolution.ts";

type Tx = Parameters<Parameters<typeof withTenant>[2]>[0];

export interface AccountBalanceMap {
  [account: string]: number; // in paise
}

export async function getLedgerBalances(
  db: Tx,
  tenantId: string,
  filter: { from?: Date; to?: Date; currency?: string } = {},
): Promise<AccountBalanceMap> {
  const conditions = [eq(schema.ledgerEntries.tenantId, tenantId)];
  if (filter.from) conditions.push(gte(schema.ledgerEntries.date, filter.from));
  if (filter.to) conditions.push(lte(schema.ledgerEntries.date, filter.to));
  if (filter.currency) conditions.push(eq(schema.ledgerEntries.currency, filter.currency));

  const debitRows = await db
    .select({
      account: schema.ledgerEntries.debit,
      total: sql<string>`COALESCE(SUM(${schema.ledgerEntries.amount}), 0)`,
    })
    .from(schema.ledgerEntries)
    .where(and(...conditions))
    .groupBy(schema.ledgerEntries.debit);

  const creditRows = await db
    .select({
      account: schema.ledgerEntries.credit,
      total: sql<string>`COALESCE(SUM(${schema.ledgerEntries.amount}), 0)`,
    })
    .from(schema.ledgerEntries)
    .where(and(...conditions))
    .groupBy(schema.ledgerEntries.credit);

  const map: Record<string, { debits: number; credits: number }> = {};

  for (const r of debitRows) {
    const cur = map[r.account] ?? { debits: 0, credits: 0 };
    cur.debits += Number(r.total);
    map[r.account] = cur;
  }

  for (const r of creditRows) {
    const cur = map[r.account] ?? { debits: 0, credits: 0 };
    cur.credits += Number(r.total);
    map[r.account] = cur;
  }

  const result: AccountBalanceMap = {};
  for (const [account, sums] of Object.entries(map)) {
    const sign = debitSign(account as LedgerAccount);
    // sign === 1 (Asset/Expense): debit - credit
    // sign === -1 (Liability/Income): credit - debit
    result[account] = sign === 1 ? sums.debits - sums.credits : sums.credits - sums.debits;
  }

  return result;
}

export async function getDistinctCurrencies(
  dbRw: DbHandle,
  ctx: TenantContext,
): Promise<string[]> {
  assertPermission(ctx, "finance.read");
  return withTenant(dbRw.db, ctx.tenantId, async (tx) => {
    const rows = await tx
      .selectDistinct({ currency: schema.ledgerEntries.currency })
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.tenantId, ctx.tenantId));

    const currs = rows.map((r) => r.currency).filter(Boolean);
    return currs.length > 0 ? currs : ["INR"];
  });
}

export async function getProfitAndLoss(
  db: Tx,
  tenantId: string,
  from: Date,
  to: Date,
  currency = "INR",
) {
  const balances = await getLedgerBalances(db, tenantId, { from, to, currency });

  const incomeAccounts: Array<{ account: LedgerAccount; label: string; sign: "income" | "contra_income" }> = [
    { account: LEDGER_ACCOUNT.PRODUCT_REVENUE, label: "Product Revenue", sign: "income" },
    { account: LEDGER_ACCOUNT.SHIPPING_INCOME, label: "Shipping Income & COD Fees", sign: "income" },
    { account: LEDGER_ACCOUNT.REFUNDS, label: "Refunds", sign: "contra_income" },
  ];

  const expenseAccounts: Array<{ account: LedgerAccount; label: string }> = [
    { account: LEDGER_ACCOUNT.COST_OF_GOODS, label: "Cost of Goods Sold (COGS)" },
    { account: LEDGER_ACCOUNT.OPERATING_EXPENSE, label: "Operating Expenses" },
    { account: LEDGER_ACCOUNT.PROCESSING_FEES, label: "Payment Processing Fees" },
    { account: LEDGER_ACCOUNT.SHIPPING_COST, label: "Courier & Shipping Costs" },
    { account: LEDGER_ACCOUNT.PROMOTIONS, label: "Promotions & Discounts" },
  ];

  let totalIncomePaise = 0;
  const incomeLines = [];

  for (const item of incomeAccounts) {
    const bal = balances[item.account] ?? 0;
    if (bal !== 0 || item.account === LEDGER_ACCOUNT.PRODUCT_REVENUE) {
      if (item.sign === "contra_income") {
        // refunds are positive in their account but reduce revenue
        const netContribution = -bal;
        totalIncomePaise += netContribution;
        incomeLines.push({
          account: item.account,
          label: item.label,
          amountPaise: -bal,
          amount: (-bal / 100).toFixed(2),
          sign: item.sign,
        });
      } else {
        totalIncomePaise += bal;
        incomeLines.push({
          account: item.account,
          label: item.label,
          amountPaise: bal,
          amount: (bal / 100).toFixed(2),
          sign: item.sign,
        });
      }
    }
  }

  let totalExpensePaise = 0;
  const expenseLines = [];

  for (const item of expenseAccounts) {
    const bal = balances[item.account] ?? 0;
    if (bal !== 0 || item.account === LEDGER_ACCOUNT.COST_OF_GOODS) {
      totalExpensePaise += bal;
      expenseLines.push({
        account: item.account,
        label: item.label,
        amountPaise: bal,
        amount: (bal / 100).toFixed(2),
        sign: "expense" as const,
      });
    }
  }

  const netProfitPaise = totalIncomePaise - totalExpensePaise;

  return {
    currency,
    incomeLines,
    expenseLines,
    totalIncomePaise,
    totalExpensePaise,
    netProfitPaise,
  };
}

export async function getCashPosition(
  db: Tx,
  tenantId: string,
  asOf: Date,
  currency = "INR",
) {
  // Cash position is all-time up to asOf
  const balances = await getLedgerBalances(db, tenantId, { to: asOf, currency });

  const gateway = balances[LEDGER_ACCOUNT.CASH_GATEWAY] ?? 0;
  const bank = balances[LEDGER_ACCOUNT.CASH_BANK] ?? 0;
  const onHand = balances[LEDGER_ACCOUNT.CASH_ON_HAND] ?? 0;
  const inventory = balances[LEDGER_ACCOUNT.INVENTORY] ?? 0;

  const taxPayable = balances[LEDGER_ACCOUNT.TAX_PAYABLE] ?? 0;
  const accountsPayable = balances[LEDGER_ACCOUNT.ACCOUNTS_PAYABLE] ?? 0;

  const totalCashPaise = gateway + bank + onHand;

  const assets = [
    { account: LEDGER_ACCOUNT.CASH_GATEWAY, label: "Payment Gateway", category: "asset" as const, balancePaise: gateway },
    { account: LEDGER_ACCOUNT.CASH_BANK, label: "Bank Account", category: "asset" as const, balancePaise: bank },
    { account: LEDGER_ACCOUNT.CASH_ON_HAND, label: "Cash on Hand / COD", category: "asset" as const, balancePaise: onHand },
    { account: LEDGER_ACCOUNT.INVENTORY, label: "Inventory at Cost", category: "asset" as const, balancePaise: inventory },
  ];

  const liabilities = [
    { account: LEDGER_ACCOUNT.TAX_PAYABLE, label: "Tax Payable (GST)", category: "liability" as const, balancePaise: taxPayable },
    { account: LEDGER_ACCOUNT.ACCOUNTS_PAYABLE, label: "Accounts Payable (Unpaid Bills)", category: "liability" as const, balancePaise: accountsPayable },
  ];

  return {
    asOf: asOf.toISOString(),
    assets,
    liabilities,
    totalCashPaise,
    inventoryValuePaise: inventory,
    taxPayablePaise: taxPayable,
    unpaidBillsPaise: accountsPayable,
  };
}

export async function findLedgerAnomalies(
  db: Tx,
  tenantId: string,
  currency = "INR",
) {
  // All-time balances
  const balances = await getLedgerBalances(db, tenantId, { currency });
  const anomalies = [];

  const cashAccounts = [
    { account: LEDGER_ACCOUNT.CASH_GATEWAY, label: "Payment Gateway" },
    { account: LEDGER_ACCOUNT.CASH_BANK, label: "Bank Account" },
    { account: LEDGER_ACCOUNT.CASH_ON_HAND, label: "Cash on Hand" },
  ];

  for (const acc of cashAccounts) {
    const bal = balances[acc.account] ?? 0;
    if (bal < 0) {
      anomalies.push({
        account: acc.account,
        label: acc.label,
        currentBalancePaise: bal,
        reason: `Negative cash balance (₹${(bal / 100).toFixed(2)}) indicates more funds disbursed than recorded collected.`,
      });
    }
  }

  const liabilityAccounts = [
    { account: LEDGER_ACCOUNT.TAX_PAYABLE, label: "Tax Payable" },
    { account: LEDGER_ACCOUNT.ACCOUNTS_PAYABLE, label: "Accounts Payable" },
  ];

  for (const acc of liabilityAccounts) {
    const bal = balances[acc.account] ?? 0;
    if (bal < 0) {
      anomalies.push({
        account: acc.account,
        label: acc.label,
        currentBalancePaise: bal,
        reason: `Negative liability balance (₹${(bal / 100).toFixed(2)}) indicates an overpayment or excess settlement.`,
      });
    }
  }

  return anomalies;
}

export async function getTaxSummary(
  db: Tx,
  tenantId: string,
  from: Date,
  to: Date,
  currency = "INR",
) {
  // Ledger tax_payable:
  // credit on tax_payable increases liability (collected)
  // debit on tax_payable decreases liability (refunded or paid)
  const conditions = [
    eq(schema.ledgerEntries.tenantId, tenantId),
    gte(schema.ledgerEntries.date, from),
    lte(schema.ledgerEntries.date, to),
    eq(schema.ledgerEntries.currency, currency),
  ];

  const [collectedRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${schema.ledgerEntries.amount}), 0)` })
    .from(schema.ledgerEntries)
    .where(and(...conditions, eq(schema.ledgerEntries.credit, LEDGER_ACCOUNT.TAX_PAYABLE)));

  const [refundedRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${schema.ledgerEntries.amount}), 0)` })
    .from(schema.ledgerEntries)
    .where(and(...conditions, eq(schema.ledgerEntries.debit, LEDGER_ACCOUNT.TAX_PAYABLE)));

  const taxCollectedPaise = Number(collectedRow?.total ?? 0);
  const taxRefundedPaise = Number(refundedRow?.total ?? 0);
  const taxOwedPaise = taxCollectedPaise - taxRefundedPaise;

  // Monthly GST split read directly from order_items for non-cancelled orders
  const gstRows = await db
    .select({
      month: sql<string>`TO_CHAR(${schema.orders.createdAt}, 'YYYY-MM')`,
      cgst: sql<string>`COALESCE(SUM(${schema.orderItems.cgst}), 0)`,
      sgst: sql<string>`COALESCE(SUM(${schema.orderItems.sgst}), 0)`,
      igst: sql<string>`COALESCE(SUM(${schema.orderItems.igst}), 0)`,
      taxable: sql<string>`COALESCE(SUM(${schema.orderItems.total} - (${schema.orderItems.cgst} + ${schema.orderItems.sgst} + ${schema.orderItems.igst})), 0)`,
    })
    .from(schema.orderItems)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
    .where(
      and(
        eq(schema.orderItems.tenantId, tenantId),
        gte(schema.orders.createdAt, from),
        lte(schema.orders.createdAt, to),
        ne(schema.orders.status, "cancelled"),
      ),
    )
    .groupBy(sql`TO_CHAR(${schema.orders.createdAt}, 'YYYY-MM')`)
    .orderBy(sql`TO_CHAR(${schema.orders.createdAt}, 'YYYY-MM') ASC`);

  const gstMonthlyBreakdown = gstRows.map((r) => {
    const cgstPaise = Number(r.cgst);
    const sgstPaise = Number(r.sgst);
    const igstPaise = Number(r.igst);
    return {
      month: r.month,
      taxablePaise: Number(r.taxable),
      cgstPaise,
      sgstPaise,
      igstPaise,
      totalTaxPaise: cgstPaise + sgstPaise + igstPaise,
    };
  });

  return {
    currency,
    taxCollectedPaise,
    taxRefundedPaise,
    taxOwedPaise,
    gstMonthlyBreakdown,
  };
}

export async function getCostCoverage(
  db: Tx,
  tenantId: string,
  from: Date,
  to: Date,
) {
  // Share of collected revenue whose lines have cost_price snapshot
  const rows = await db
    .select({
      hasCost: sql<boolean>`${schema.orderItems.costPrice} IS NOT NULL`,
      totalLine: sql<string>`COALESCE(SUM(${schema.orderItems.total}), 0)`,
    })
    .from(schema.orderItems)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
    .where(
      and(
        eq(schema.orderItems.tenantId, tenantId),
        gte(schema.orders.createdAt, from),
        lte(schema.orders.createdAt, to),
        ne(schema.orders.status, "cancelled"),
      ),
    )
    .groupBy(sql`${schema.orderItems.costPrice} IS NOT NULL`);

  let costed = 0;
  let uncosted = 0;

  for (const r of rows) {
    if (r.hasCost) {
      costed += Number(r.totalLine);
    } else {
      uncosted += Number(r.totalLine);
    }
  }

  const revenueTotalPaise = costed + uncosted;
  const uncostedSharePercent =
    revenueTotalPaise > 0 ? Math.round((uncosted / revenueTotalPaise) * 100) : 0;

  return {
    revenueTotalPaise,
    revenueCostedPaise: costed,
    revenueUncostedPaise: uncosted,
    uncostedSharePercent,
  };
}

export async function getGmv(
  db: Tx,
  tenantId: string,
  from: Date,
  to: Date,
): Promise<number> {
  // GMV reads orders directly: placed, not cancelled
  const [row] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${schema.orders.grandTotal}), 0)`,
    })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.tenantId, tenantId),
        gte(schema.orders.createdAt, from),
        lte(schema.orders.createdAt, to),
        ne(schema.orders.status, "cancelled"),
      ),
    );

  return Number(row?.total ?? 0);
}

export async function getFinanceOverview(
  dbRw: DbHandle,
  ctx: TenantContext,
  periodInput: PeriodInput = {},
) {
  assertPermission(ctx, "finance.read");

  const resolution = resolvePeriod(periodInput);

  return withTenant(dbRw.db, ctx.tenantId, async (tx) => {
    const currencies = await getDistinctCurrencies(dbRw, ctx);
    const primaryCurrency = currencies[0] ?? "INR";

    const [profitAndLoss, cashPosition, anomalies, taxSummary, costCoverage, gmvPaise] =
      await Promise.all([
        getProfitAndLoss(tx, ctx.tenantId, resolution.from, resolution.to, primaryCurrency),
        getCashPosition(tx, ctx.tenantId, resolution.to, primaryCurrency),
        findLedgerAnomalies(tx, ctx.tenantId, primaryCurrency),
        getTaxSummary(tx, ctx.tenantId, resolution.from, resolution.to, primaryCurrency),
        getCostCoverage(tx, ctx.tenantId, resolution.from, resolution.to),
        getGmv(tx, ctx.tenantId, resolution.from, resolution.to),
      ]);

    const youOweTaxPaise = cashPosition.taxPayablePaise;
    const youOweBillsPaise = cashPosition.unpaidBillsPaise;
    const totalYouOwePaise = Math.max(0, youOweTaxPaise) + Math.max(0, youOweBillsPaise);

    return {
      period: {
        from: resolution.fromIso,
        to: resolution.toIso,
        named: resolution.named,
      },
      currencies,
      profitAndLoss,
      cashPosition,
      anomalies,
      taxSummary,
      gmvPaise,
      costCoverage,
      owed: {
        youOweTaxPaise,
        youOweBillsPaise,
        totalYouOwePaise,
        owedToYouPaise: 0, // reserved in v1
      },
    };
  });
}

/**
 * Permission-checked entry points for the ledger list and trial balance. The raw readers in
 * ledger.ts take no context, so the check (rule 4) lives here and the API handlers call these.
 */
export async function listLedgerEntriesForAdmin(
  dbRw: DbHandle,
  ctx: TenantContext,
  filter: ListLedgerEntriesFilter = {},
) {
  assertPermission(ctx, "finance.read");
  // RLS: the raw handle has no tenant setting and would silently return zero rows.
  return withTenant(dbRw.db, ctx.tenantId, (tx) => listLedgerEntries(tx, ctx.tenantId, filter));
}

export async function getTrialBalanceForAdmin(
  dbRw: DbHandle,
  ctx: TenantContext,
  filter: TrialBalanceFilter = {},
) {
  assertPermission(ctx, "finance.read");
  return withTenant(dbRw.db, ctx.tenantId, (tx) => getTrialBalance(tx, ctx.tenantId, filter));
}
