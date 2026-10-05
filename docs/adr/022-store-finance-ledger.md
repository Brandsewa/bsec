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

10. **Export Authorization (D10):**
    CSV ledger and expense exports require the `exports.run` permission.

11. **Granular Permissions (D14):**
    `finance.read` and `finance.write` permissions are added to `STORE_PERMISSIONS`. They are granted to store owners and store admins, but explicitly excluded from platform support sessions (`SUPPORT_READ_PERMISSIONS` and `SUPPORT_WRITE_PERMISSIONS`).

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

## Alternatives Considered

1. **Direct inline posting during order checkout:**
   Rejected because ledger failures must never fail payment processing or customer orders. Queueing via pg-boss preserves order path reliability.

2. **Floating-point currency math:**
   Rejected due to IEEE 754 precision issues that cause trial balance discrepancies and tax rounding errors.

3. **Dynamic user-defined chart of accounts:**
   Rejected to ensure report queries, posting rules, and period closes remain deterministic and reliable without risk of broken references.
