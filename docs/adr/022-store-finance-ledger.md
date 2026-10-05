# ADR-022: Store finance double-entry ledger, expenses, and fiscal periods

- **Status:** Proposed
- **Date:** 2026-10-05
- **Plan reference:** `docs/FINANCE-PLAN.md` §4 (D1 to D14), `docs/prompts/finance-phases-0-4.md`

## Context

bsec stores need accurate, tamper-evident financial accounting for money events (order revenue, COD collections, refunds, cancellations/restocks, expenses, and balance adjustments). Prior to this ADR, bsec had no ledger, no cash position tracking, no record of operating expenses, and no GST summary.

The Storify reference application (`C:/dev/bsec/Storify/lib/finance/`) implements a double-entry accounting engine for multi-vendor marketplaces. However, bsec operates as a single-vendor D2C commerce platform with strict architectural constraints:
1. Strict PostgreSQL Row-Level Security (`tenantTable()`, composite `tenantForeignKey`, `forceRlsSql`).
2. Integer paise (`bigint`) for all currency amounts — no floating point values.
3. Modular monolith architecture: domain logic in `packages/domain`, schema in `packages/db`, thin API routes, and asynchronous side effects via `pg-boss` after transaction commit.
4. Granular RBAC permissions with isolation from platform support sessions.

## Decisions

We adopt an append-only double-entry ledger adapted from the Storify architecture with the following decisions:

1. **Single Book, Column Reserved (D1):**
   Stores operate a single set of books (`book = 'own'`). Multi-vendor marketplace accounts (`vendor_payable`, `commission_receivable`, etc.) are dropped. The `book` column is preserved with default `'own'` to avoid future migration rewrites.

2. **Paise Integers, Never Floats (D2):**
   All monetary amounts across `ledger_entries`, `expenses`, and calculations are stored and processed as integer paise (`bigint` in Postgres, integer `number` in JS domain). Rounding in splits is handled by `allocate()`, which distributes integer remainders to the largest shares and guarantees exact sum conservation.

3. **COGS Snapshot on `order_items` (D3):**
   A nullable `cost_price bigint` column is added to `order_items` (expand migration). Order placement paths snapshot the variant's cost at purchase time. Historical orders without snapshots are reported as uncosted in the Cost Coverage report rather than retroactively re-evaluating live variant costs.

4. **Unified `tax_payable` Liability with Reporting Split (D4):**
   Output tax collected is credited to a single `tax_payable` liability account. The CGST/SGST/IGST breakdown required for Indian GST reporting is read directly from `order_items` during report generation.

5. **Single Currency (INR) with Currency Grouping (D5):**
   v1 assumes INR for all stores. The `currency` column is retained on ledger entries and reports group by currency to prevent cross-currency summation.

6. **Shipping and COD Income (D6):**
   COD collection fees charged to shoppers are booked under `shipping_income` alongside standard shipping charges.

7. **Reserved Accounts (D7):**
   Contra and reserve accounts (`promotions`, `processing_fees`, `shipping_cost`) are defined in the chart of accounts for future gateway and courier integrations but remain dormant until providers are wired. Discounts remain net inside `product_revenue`.

8. **Asynchronous Postings via pg-boss (D8):**
   Order-time money events enqueue a `finance.post` job inside the business transaction (ADR-006). Posting execution is fire-and-forget: ledger write failures are logged but never fail customer checkout or order transitions. Hand-entered records (expenses, adjustments) use strict posting mode where failures surface to the user.

9. **Non-destructive Period Close (D9):**
   Closing a fiscal period (`fiscal_periods`) snapshots P&L metrics and advances the closed boundary. Postings dated within a closed period are shifted to `closedThrough + 1s` with an explanatory audit note rather than rejected or backdated. A 60-second in-process cache for `closedThrough` is maintained and invalidated on close/reopen.

10. **Export Authorization (D10, owner decision 2026-10-05):**
    CSV ledger and expense exports are for the **store owner and store admin roles only**, and they must also hold `exports.run` and `finance.read` (`assertCanExportFinance`, `FINANCE_EXPORT_ROLES` in `@bs/auth`). The finance role and custom roles cannot export; the Export buttons are hidden for them.

11. **Granular Permissions and the finance role (D14, owner decision 2026-10-05):**
    `finance.read` and `finance.write` are added to `STORE_PERMISSIONS`. Three system roles can use the books: `store_owner`, `store_admin`, and a new `store_finance` role that holds exactly `finance.read` and `finance.write` (no exports, no orders, no staff management). Platform support sessions never get finance access (`SUPPORT_READ_PERMISSIONS` and `SUPPORT_WRITE_PERMISSIONS`). Only owners and admins can invite or assign the finance role. Because every store keeps its own copy of each system role's permission array, stores created before this feature would have had no finance access at all; the finance permissions are therefore taken from the system role definition (`systemRoleFinancePermissions`) when the request context and the signed-in profile are built, and `store_finance` is created for a store the first time its roles are listed (new stores get it at provisioning).

12. **Input tax credit (D13, owner decision 2026-10-05):**
    Purchases are not tracked for GST. Expenses are booked at the gross amount and the tax summary covers output GST only. Revisit with the CA before the books are used for filing.

## Consequences

- **Easier:**
  - Complete, balanced financial picture (P&L, cash position, tax payable, trial balance) computed directly from ledger queries.
  - Safe, replayable historical backfill via idempotent deterministic keys (`(tenant_id, key)` unique constraint).
  - No retroactive data distortion when products or tax rates change.
- **Enforced:**
  - All ledger writes must have deterministic keys (`postingKey(kind, id, ...parts)`).
  - Database-level check constraints enforce `amount > 0` and `debit <> credit`.
  - Direct updates or deletions on `ledger_entries` are prohibited; corrections require reversal entries.
  - Every tenant table enforces PostgreSQL RLS via `forceRlsSql()`.

## Deviations from `docs/FINANCE-PLAN.md` (recorded 2026-10-05 after verification)

- **Expense categories and paid-from values.** The contract and UI use `rent, utilities, salaries, contractor, software_tools, marketing_ads, packaging, office_supplies, logistics_courier, inventory_purchase, professional_fees, travel, other` and `paid_from` of `cash_bank | cash_gateway | cash_on_hand | unpaid`, not the plan's `premises, people, marketing, ...` and `bank | cash | gateway | unpaid`. Contract, UI and ledger agree with each other; the plan lists are superseded. The ledger account for each paid-from value is stored on the expense row (`debit_account`), so changing these lists later does not break reversals.
- **Tax-inclusive orders.** Real checkout computes `grandTotal = subtotal - discountTotal + shippingTotal + codFee` (tax is inside the price; `pricesIncludeTax` on admin orders). The plan's identity `merchandise + shipping + tax = grandTotal` therefore does not hold for the normal case. `decomposeOrder` handles it with its residual rule: the tax is removed from `product_revenue`, so revenue is booked ex-tax and the entries sum to `grandTotal`. This is the expected path, not an error path. Known simplification: tax charged on shipping is also taken out of merchandise revenue rather than shipping income.
- **Recurring expenses.** Intervals are `monthly | quarterly | yearly` (no weekly). Schedule maths lives in `@bs/contracts` (`addRecurringInterval`, `firstRecurringDue`) so the server and the admin form's next-copy preview cannot disagree; months keep the anchor day and clamp short months without drifting (31 Jan: 28 Feb, 31 Mar). A past-dated template schedules only future copies unless the merchant ticks "also create copies already due", which the daily reconcile tick then books at most 12 per template per tick.
- **CSV export permission (D10).** Owner and admin roles only (decision 2026-10-05), see decision 10.

## Known gaps (not built)

- **Cancelling a paid order creates a refund (owner decision 2026-10-05).** `transitionOrder` on `order.cancel` records a `succeeded` refund (`method: other`, `initiatedBy: system`) for the unrefunded part of any collected payment intent, marks the intent and order `refunded`, notes it on the cancel event ("return it to the customer") and enqueues `finance.post`. It is a record, like every manual refund: nothing is sent to a payment provider. Cancelling also gives the stock back (fix 2026-10-05): confirming a COD order or paying an order commits its reservation (`on_hand` goes down), and `releaseReservation` only released *active* reservations, so cancelling any confirmed or paid order before it shipped lost those units for good. `restoreCommittedStock` now returns them to `on_hand`, writes a `cancelled` inventory movement per line, closes the reservation as `returned_to_stock`, and the cancel enqueues `finance.post` kind `cancel_restock`, which debits `inventory` and credits `cost_of_goods` (key `order:{id}:cogs-back:cancel`), capped at the COGS actually posted for the order and only when a restore movement exists, so orders cancelled before this fix are not given an inventory asset that never came back. The reconcile pass replays it for cancelled orders.
- **Settlement of COD cash.** COD collections book to `cash_on_hand`; recording the courier remittance to the bank is a manual adjustment ("Cash deposited to bank / COD remittance received"). Until it is recorded, a manual UPI or bank refund of a COD order shows the bank balance as negative (an anomaly banner, by design).
- **Inventory purchases.** `inventory` goes negative until stock purchases are recorded as `inventory_purchase` expenses; the overview shows it as a negative asset.

## Alternatives Considered

1. **Direct inline posting during order checkout:**
   Rejected because ledger failures must never fail payment processing or customer orders. Queueing via pg-boss preserves order path reliability.

2. **Floating-point currency math:**
   Rejected due to IEEE 754 precision issues that cause trial balance discrepancies and tax rounding errors.

3. **Dynamic user-defined chart of accounts:**
   Rejected to ensure report queries, posting rules, and period closes remain deterministic and reliable without risk of broken references.
