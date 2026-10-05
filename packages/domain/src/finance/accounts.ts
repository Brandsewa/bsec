/**
 * Chart of accounts, fixed in code (ADR-022, docs/FINANCE-PLAN.md §3.1).
 *
 * Accounts are immutable constants, not database rows. Every posting rule names
 * two accounts from this fixed chart. Display names and categories map to these
 * identifiers.
 *
 * Types determine how reports and trial balance treat each account:
 * - Asset / Expense: debit increases balance (+1), credit decreases (-1)
 * - Liability / Income: credit increases balance (+1), debit decreases (-1)
 */

export const LEDGER_ACCOUNT = {
  /** Notes and coins collected on COD delivery or in store. */
  CASH_ON_HAND: "cash_on_hand",
  /** Money sitting with payment gateway, not yet settled to bank. */
  CASH_GATEWAY: "cash_gateway",
  /** Money in store's bank account. */
  CASH_BANK: "cash_bank",
  /** Stock inventory owned by the store at cost. */
  INVENTORY: "inventory",

  /** GST charged to shoppers, owed onward to the government. */
  TAX_PAYABLE: "tax_payable",
  /** Unpaid operational bills (recorded expense not yet paid). */
  ACCOUNTS_PAYABLE: "accounts_payable",

  /** Merchandise sales revenue. */
  PRODUCT_REVENUE: "product_revenue",
  /** Shipping charged to shopper plus COD collection fees. */
  SHIPPING_INCOME: "shipping_income",
  /** Contra-income: money returned to customer on refund. Reduces revenue. */
  REFUNDS: "refunds",

  /** Cost of goods sold, from line item cost price snapshots. */
  COST_OF_GOODS: "cost_of_goods",
  /** Hand-entered operating expenses (rent, marketing, software, etc.). */
  OPERATING_EXPENSE: "operating_expense",
  /** Gateway transaction cut (dormant until Razorpay). */
  PROCESSING_FEES: "processing_fees",
  /** Courier label costs (dormant until Shiprocket). */
  SHIPPING_COST: "shipping_cost",
  /** Store-funded discounts/promotions (reserved for future coupon splits). */
  PROMOTIONS: "promotions",
} as const;

export type LedgerAccount = (typeof LEDGER_ACCOUNT)[keyof typeof LEDGER_ACCOUNT];

/** All ledger accounts as an array, derived from LEDGER_ACCOUNT. */
export const LEDGER_ACCOUNTS: readonly LedgerAccount[] = Object.values(LEDGER_ACCOUNT);

export const LEDGER_ACCOUNT_TYPE = {
  ASSET: "asset",
  LIABILITY: "liability",
  INCOME: "income",
  EXPENSE: "expense",
} as const;

export type LedgerAccountType =
  (typeof LEDGER_ACCOUNT_TYPE)[keyof typeof LEDGER_ACCOUNT_TYPE];

export const LEDGER_ACCOUNT_TYPES: Record<LedgerAccount, LedgerAccountType> = {
  [LEDGER_ACCOUNT.CASH_ON_HAND]: LEDGER_ACCOUNT_TYPE.ASSET,
  [LEDGER_ACCOUNT.CASH_GATEWAY]: LEDGER_ACCOUNT_TYPE.ASSET,
  [LEDGER_ACCOUNT.CASH_BANK]: LEDGER_ACCOUNT_TYPE.ASSET,
  [LEDGER_ACCOUNT.INVENTORY]: LEDGER_ACCOUNT_TYPE.ASSET,

  [LEDGER_ACCOUNT.TAX_PAYABLE]: LEDGER_ACCOUNT_TYPE.LIABILITY,
  [LEDGER_ACCOUNT.ACCOUNTS_PAYABLE]: LEDGER_ACCOUNT_TYPE.LIABILITY,

  [LEDGER_ACCOUNT.PRODUCT_REVENUE]: LEDGER_ACCOUNT_TYPE.INCOME,
  [LEDGER_ACCOUNT.SHIPPING_INCOME]: LEDGER_ACCOUNT_TYPE.INCOME,
  // Contra-income: sits on income side of P&L with negative sign
  [LEDGER_ACCOUNT.REFUNDS]: LEDGER_ACCOUNT_TYPE.INCOME,

  [LEDGER_ACCOUNT.COST_OF_GOODS]: LEDGER_ACCOUNT_TYPE.EXPENSE,
  [LEDGER_ACCOUNT.OPERATING_EXPENSE]: LEDGER_ACCOUNT_TYPE.EXPENSE,
  [LEDGER_ACCOUNT.PROCESSING_FEES]: LEDGER_ACCOUNT_TYPE.EXPENSE,
  [LEDGER_ACCOUNT.SHIPPING_COST]: LEDGER_ACCOUNT_TYPE.EXPENSE,
  [LEDGER_ACCOUNT.PROMOTIONS]: LEDGER_ACCOUNT_TYPE.EXPENSE,
};

export const LEDGER_BOOK = {
  OWN: "own",
  MARKETPLACE: "marketplace",
} as const;

export type LedgerBook = (typeof LEDGER_BOOK)[keyof typeof LEDGER_BOOK];

/**
 * The sign a debit applies to an account's balance:
 * +1 for Asset and Expense accounts (debit increases balance)
 * -1 for Liability and Income accounts (debit decreases balance)
 */
export function debitSign(account: LedgerAccount): 1 | -1 {
  const type = LEDGER_ACCOUNT_TYPES[account];
  return type === LEDGER_ACCOUNT_TYPE.ASSET ||
    type === LEDGER_ACCOUNT_TYPE.EXPENSE
    ? 1
    : -1;
}
