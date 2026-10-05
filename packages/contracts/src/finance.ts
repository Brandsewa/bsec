import { oc } from "@orpc/contract";
import { z } from "zod";

/**
 * Finance contracts (docs/FINANCE-PLAN.md §3.10).
 * Mounted under admin.finance.*
 */

export const FinancePeriod = z.object({
  named: z.enum(["7d", "30d", "90d", "ytd", "all"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
export type FinancePeriod = z.infer<typeof FinancePeriod>;

export const ProfitAndLossLine = z.object({
  account: z.string(),
  label: z.string(),
  amount: z.string(), // paise string or formatted representation
  amountPaise: z.number(),
  sign: z.enum(["income", "expense", "contra_income"]),
});

export const ProfitAndLossReport = z.object({
  currency: z.string(),
  incomeLines: z.array(ProfitAndLossLine),
  expenseLines: z.array(ProfitAndLossLine),
  totalIncomePaise: z.number(),
  totalExpensePaise: z.number(),
  netProfitPaise: z.number(),
});

export const CashPositionAccount = z.object({
  account: z.string(),
  label: z.string(),
  category: z.enum(["asset", "liability"]),
  balancePaise: z.number(),
});

export const CashPositionReport = z.object({
  asOf: z.string(),
  assets: z.array(CashPositionAccount),
  liabilities: z.array(CashPositionAccount),
  totalCashPaise: z.number(), // gateway + bank + on-hand
  inventoryValuePaise: z.number(),
  taxPayablePaise: z.number(),
  unpaidBillsPaise: z.number(),
});

export const AnomalyItem = z.object({
  account: z.string(),
  label: z.string(),
  currentBalancePaise: z.number(),
  reason: z.string(),
});

export const TaxSummaryMonth = z.object({
  month: z.string(), // "2026-09"
  taxablePaise: z.number(),
  cgstPaise: z.number(),
  sgstPaise: z.number(),
  igstPaise: z.number(),
  totalTaxPaise: z.number(),
});

export const TaxSummaryReport = z.object({
  currency: z.string(),
  taxCollectedPaise: z.number(),
  taxRefundedPaise: z.number(),
  taxOwedPaise: z.number(),
  gstMonthlyBreakdown: z.array(TaxSummaryMonth),
});

export const CostCoverageReport = z.object({
  revenueTotalPaise: z.number(),
  revenueCostedPaise: z.number(),
  revenueUncostedPaise: z.number(),
  uncostedSharePercent: z.number(),
});

export const TrialBalanceRow = z.object({
  account: z.string(),
  label: z.string(),
  accountType: z.string(),
  totalDebitPaise: z.number(),
  totalCreditPaise: z.number(),
  balancePaise: z.number(),
});

export const TrialBalanceReport = z.object({
  balanced: z.boolean(),
  totalDebitPaise: z.number(),
  totalCreditPaise: z.number(),
  rows: z.array(TrialBalanceRow),
});

export const FinanceOverviewResponse = z.object({
  period: z.object({
    from: z.string(),
    to: z.string(),
    named: z.string().optional(),
  }),
  currencies: z.array(z.string()),
  profitAndLoss: ProfitAndLossReport,
  cashPosition: CashPositionReport,
  anomalies: z.array(AnomalyItem),
  taxSummary: TaxSummaryReport,
  gmvPaise: z.number(),
  costCoverage: CostCoverageReport,
  owed: z.object({
    youOweTaxPaise: z.number(),
    youOweBillsPaise: z.number(),
    totalYouOwePaise: z.number(),
    owedToYouPaise: z.number(),
  }),
});

export const LedgerEntryItem = z.object({
  id: z.string().uuid(),
  date: z.string(),
  book: z.string(),
  accountDebit: z.string(),
  accountCredit: z.string(),
  amount: z.number(), // in paise as number
  currency: z.string(),
  sourceKind: z.string(),
  sourceId: z.string().uuid().nullable(),
  reason: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});

export const AdjustmentPreset = z.enum([
  "settled_gateway_to_bank",
  "cash_deposited_to_bank",
  "tax_paid",
  "write_off",
  "custom",
]);

export const CreateAdjustmentInput = z.object({
  date: z.string(), // ISO date YYYY-MM-DD
  accountDebit: z.string().min(1).max(50),
  accountCredit: z.string().min(1).max(50),
  amount: z.number().int().positive(), // in paise
  currency: z.string().length(3).default("INR"),
  reason: z.string().min(4).max(500),
});

export const ExpenseItem = z.object({
  id: z.string().uuid(),
  templateId: z.string().uuid().nullable(),
  number: z.string(),
  date: z.string(),
  amount: z.number(), // paise
  currency: z.string(),
  category: z.string(),
  paidFrom: z.string(),
  payee: z.string().nullable(),
  note: z.string().nullable(),
  receiptMediaId: z.string().uuid().nullable(),
  settlement: z.object({
    settledAt: z.string(),
    paidFrom: z.string(),
    note: z.string().nullish(),
  }).nullable(),
  recurring: z.object({
    enabled: z.boolean(),
    interval: z.enum(["monthly", "quarterly", "yearly"]).optional(),
    intervalCount: z.number().int().optional(),
    nextDueAt: z.string().nullish(),
    endsAt: z.string().nullish(),
  }).nullable(),
  revision: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ExpenseItem = z.infer<typeof ExpenseItem>;

export const CreateExpenseInput = z.object({
  date: z.string(),
  amount: z.number().int().positive(), // in paise
  currency: z.string().length(3).default("INR"),
  category: z.enum([
    "rent",
    "utilities",
    "salaries",
    "contractor",
    "software_tools",
    "marketing_ads",
    "packaging",
    "office_supplies",
    "logistics_courier",
    "inventory_purchase",
    "professional_fees",
    "travel",
    "other",
  ]),
  paidFrom: z.enum(["cash_bank", "cash_gateway", "cash_on_hand", "unpaid"]),
  payee: z.string().max(200).optional(),
  note: z.string().max(1000).optional(),
  receiptMediaId: z.string().uuid().optional(),
  recurring: z.object({
    enabled: z.boolean(),
    interval: z.enum(["monthly", "quarterly", "yearly"]),
    intervalCount: z.number().int().min(1).max(12).default(1),
    endsAt: z.string().optional(),
    backfillDue: z.boolean().default(false),
  }).optional(),
});

export const UpdateExpenseInput = z.object({
  id: z.string().uuid(),
  date: z.string().optional(),
  amount: z.number().int().positive().optional(),
  category: z.enum([
    "rent",
    "utilities",
    "salaries",
    "contractor",
    "software_tools",
    "marketing_ads",
    "packaging",
    "office_supplies",
    "logistics_courier",
    "inventory_purchase",
    "professional_fees",
    "travel",
    "other",
  ]).optional(),
  paidFrom: z.enum(["cash_bank", "cash_gateway", "cash_on_hand", "unpaid"]).optional(),
  payee: z.string().max(200).nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
  receiptMediaId: z.string().uuid().nullable().optional(),
});

export const SettleExpenseInput = z.object({
  id: z.string().uuid(),
  settledAt: z.string(),
  paidFrom: z.enum(["cash_bank", "cash_gateway", "cash_on_hand"]),
  note: z.string().max(500).optional(),
});

export const FiscalPeriodItem = z.object({
  id: z.string().uuid(),
  label: z.string(),
  closedAt: z.string(),
  closedByUserId: z.string().uuid().nullable(),
  note: z.string().nullable(),
  snapshot: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});
export type FiscalPeriodItem = z.infer<typeof FiscalPeriodItem>;

export const ClosePeriodInput = z.object({
  label: z.string().regex(/^\d{4}-\d{2}$/, "Period label must be YYYY-MM"),
  note: z.string().max(500).optional(),
});

export const ReopenPeriodInput = z.object({
  label: z.string().regex(/^\d{4}-\d{2}$/, "Period label must be YYYY-MM"),
  reason: z.string().min(4).max(500),
});

export const financeContract = {
  overview: oc
    .route({ method: "GET", path: "/admin/finance/overview" })
    .input(FinancePeriod.optional())
    .output(FinanceOverviewResponse),

  currencies: oc
    .route({ method: "GET", path: "/admin/finance/currencies" })
    .output(z.object({ currencies: z.array(z.string()) })),

  ledger: {
    list: oc
      .route({ method: "GET", path: "/admin/finance/ledger" })
      .input(
        z.object({
          book: z.string().optional(),
          account: z.string().optional(),
          sourceKind: z.string().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        }).optional(),
      )
      .output(
        z.object({
          items: z.array(LedgerEntryItem),
          total: z.number().int(),
        }),
      ),
    trialBalance: oc
      .route({ method: "GET", path: "/admin/finance/ledger/trial-balance" })
      .input(FinancePeriod.optional())
      .output(TrialBalanceReport),
  },

  adjustments: {
    list: oc
      .route({ method: "GET", path: "/admin/finance/adjustments" })
      .input(
        z.object({
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        }).optional(),
      )
      .output(
        z.object({
          items: z.array(LedgerEntryItem),
          total: z.number().int(),
        }),
      ),
    create: oc
      .route({ method: "POST", path: "/admin/finance/adjustments" })
      .input(CreateAdjustmentInput)
      .output(LedgerEntryItem),
  },

  expenses: {
    list: oc
      .route({ method: "GET", path: "/admin/finance/expenses" })
      .input(
        z.object({
          period: z.enum(["7d", "30d", "90d", "ytd", "all"]).optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          category: z.string().optional(),
          paidFrom: z.string().optional(),
          search: z.string().optional(),
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        }).optional(),
      )
      .output(
        z.object({
          items: z.array(ExpenseItem),
          total: z.number().int(),
          periodTotalPaise: z.number(),
          allTimeUnpaidPaise: z.number(),
        }),
      ),
    create: oc
      .route({ method: "POST", path: "/admin/finance/expenses" })
      .input(CreateExpenseInput)
      .output(ExpenseItem),
    update: oc
      .route({ method: "PATCH", path: "/admin/finance/expenses/{id}" })
      .input(UpdateExpenseInput)
      .output(ExpenseItem),
    delete: oc
      .route({ method: "DELETE", path: "/admin/finance/expenses/{id}" })
      .input(z.object({ id: z.string().uuid() }))
      .output(z.object({ success: z.boolean() })),
    settle: oc
      .route({ method: "POST", path: "/admin/finance/expenses/{id}/settle" })
      .input(SettleExpenseInput)
      .output(ExpenseItem),
    unsettle: oc
      .route({ method: "POST", path: "/admin/finance/expenses/{id}/unsettle" })
      .input(z.object({ id: z.string().uuid() }))
      .output(ExpenseItem),
    receiptPresign: oc
      .route({ method: "POST", path: "/admin/finance/expenses/receipts/presign" })
      .input(
        z.object({
          fileName: z.string().min(1).max(255),
          contentType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
          sizeBytes: z.number().int().min(1).max(5 * 1024 * 1024),
        }),
      )
      .output(
        z.object({
          uploadUrl: z.string(),
          key: z.string(),
          mediaId: z.string().uuid(),
        }),
      ),
    receiptFinalize: oc
      .route({ method: "POST", path: "/admin/finance/expenses/receipts/finalize" })
      .input(z.object({ mediaId: z.string().uuid(), key: z.string() }))
      .output(z.object({ mediaId: z.string().uuid(), viewUrl: z.string() })),
    receiptUrl: oc
      .route({ method: "GET", path: "/admin/finance/expenses/{id}/receipt" })
      .input(z.object({ id: z.string().uuid() }))
      .output(z.object({ url: z.string().nullable() })),
  },

  periods: {
    list: oc
      .route({ method: "GET", path: "/admin/finance/periods" })
      .output(
        z.object({
          items: z.array(FiscalPeriodItem),
          closedThrough: z.string().nullable(),
          closableMonths: z.array(z.string()),
        }),
      ),
    close: oc
      .route({ method: "POST", path: "/admin/finance/periods/close" })
      .input(ClosePeriodInput)
      .output(FiscalPeriodItem),
    reopen: oc
      .route({ method: "POST", path: "/admin/finance/periods/reopen" })
      .input(ReopenPeriodInput)
      .output(z.object({ reopenedLabel: z.string() })),
  },
};
