# Finance Phase 0: ADR-022 and double-entry accounting engine

- **Date:** 2026-10-05
- **Agent:** antigravity
- **Branch:** `feat/finance-phase-0`
- **Area:** db, domain, auth
- **Type:** feature
- **Supersedes:** none

## Summary
Implements Phase 0 of the Finance section per `docs/FINANCE-PLAN.md` and `docs/prompts/finance-phases-0-4.md`. Lands the append-only double-entry ledger foundation, database schema (`ledger_entries`, `expenses`, `fiscal_periods`), expand migration `0039_finance.sql` (adding nullable `order_items.cost_price`), architectural decision record ADR-022, `finance.read`/`finance.write` permissions, and pure posting rules with exact integer paise allocation. No UI or event triggers are introduced in this phase.

## What changed
- **ADR-022 (`docs/adr/022-store-finance-ledger.md`)**: Documents decisions D1 to D14 (single book 'own', integer paise arithmetic, COGS snapshot on `order_items`, unified `tax_payable` with reporting GST split, pg-boss async triggers, period close date shifting).
- **Database Schema (`packages/db/src/schema/finance.ts`, `packages/db/src/schema/orders.ts`, `packages/db/src/schema/index.ts`)**:
  - `ledger_entries`: tenant table with RLS, check constraints (`amount > 0`, `debit <> credit`, `length(note) <= 500`), unique `(tenant_id, key)` idempotency key.
  - `expenses`: tenant table with RLS, check constraints, receipt media foreign key (`expenses_receipt_media_fk`), unique partial index `(tenant_id, template_id, date)` for recurrence.
  - `fiscal_periods`: tenant table with RLS, unique `(tenant_id, label)`.
  - `order_items.cost_price`: nullable `bigint` column for point-in-time cost snapshots (expanded only, unwired until Phase 1).
- **Migration (`packages/db/migrations/0039_finance.sql`, `_journal.json`)**: Expand migration creating all 3 tables with `forceRlsSql`, check constraints, indexes, and `app_rw`/`app_platform` grants.
- **Permissions (`packages/auth/src/index.ts`, `packages/domain/src/context.ts`)**:
  - Added `finance.read` and `finance.write` to `STORE_PERMISSIONS`.
  - Included by default in `store_owner` and `store_admin` system roles.
  - Explicitly excluded from platform support sessions (`SUPPORT_READ_PERMISSIONS` and `SUPPORT_WRITE_PERMISSIONS`).
- **Accounting Engine (`packages/domain/src/finance/`)**:
  - `accounts.ts`: 14 fixed ledger accounts, types, `LEDGER_BOOK`, and `debitSign()`.
  - `postings.ts`: pure functions for `allocate()` (integer paise with remainder distribution to largest shares), `decomposeOrder()`, `orderPaidPostings()`, `refundPostings()` (prorated over remaining headroom across consecutive partial refunds), `restockCostPostings()`, `expensePostings()`, `expenseSettlementPostings()`, `adjustmentPostings()`, and dormant `gatewayFeePostings()` / `shippingCostPostings()`.
  - `ledger.ts`: `postingKey()`, `applyPeriodClose()` (shifts closed-period entries to `closedThrough + 1s` with audit note), `getClosedThrough()` with 60 s in-process cache and `invalidateClosedPeriodCache()`, `postLedgerEntries()` with batch `ON CONFLICT DO NOTHING`, and `getTrialBalance()`.

## Decisions and trade-offs
- **D1 (Single Book 'own')**: All postings use book `'own'`. Multi-vendor marketplace accounts from Storify were omitted.
- **D2 (Integer paise)**: Float arithmetic is strictly prohibited; all amounts and calculations use integer paise with `BigInt` scaling in allocation.
- **D4 (Unified tax_payable)**: One ledger liability account for tax; CGST/SGST/IGST breakdown is read directly from `order_items` during reporting.
- **D9 (Non-destructive period close)**: Entries dated inside a closed period shift forward by 1 second past periodTo with an explanatory note rather than failing customer transactions.
- **D14 (Store admin access)**: Inherited by `store_admin` by default; platform support sessions are strictly denied access.

## Verification
- `pnpm --filter @bs/auth test`: 2 test files, 6 tests passed.
- `pnpm --filter @bs/db test --no-file-parallelism`: 5 test files, 41 passed (including tenant RLS, grants, schema).
- `pnpm --filter @bs/domain test test/finance-postings.test.ts`: 21 unit tests passed (allocation adversarial property testing, order decomposition, partial refunds, restocks, reversals, adjustments, support permissions).
- `pnpm --filter @bs/domain test test/finance-ledger.int.test.ts`: 12 real-PostgreSQL integration tests passed (RLS cross-tenant isolation, idempotency on duplicate replay, period-close date shifting, database check constraints, fire-and-forget vs strict mode, trial balance).
- `pnpm docs:check`: passed cleanly.
- `pnpm typecheck`: all workspace packages passed cleanly (0 errors).
- `pnpm lint`: all workspace packages passed cleanly (0 errors).

## Docs updated
- [x] `docs/ARCHITECTURE.md` (sections 7 and 12 updated for 0039 migration and finance permissions)
- [x] ADR: `docs/adr/022-store-finance-ledger.md` written and registered in `docs/adr/README.md`
- [x] `DEPLOYMENT.md` / RUNBOOK / not needed (no new ports, env vars, or external services)
- [x] `progress.md` (In flight updated)

## Follow-ups and open questions
- Owner confirmation on D14: whether `store_admin` should retain access to books or if finance should be restricted exclusively to `store_owner`.
- Phase 1 will implement pg-boss `finance.post` and `finance.reconcile` jobs and wire order triggers.

## Definition of done
- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (real-DB test for anything touching tenancy, money, auth or permissions).
- [x] `docs/ARCHITECTURE.md` updated if you changed structure, routes, tables, jobs, auth, blocks, env vars or gates; "Last verified" commit bumped.
- [x] ADR written or updated if you made or changed an architectural decision.
- [x] `DEPLOYMENT.md` / `infra/coolify/RUNBOOK.md` updated if env vars, services, ports or the deploy pipeline changed.
- [x] A change record in `docs/changes/` (required) and `progress.md` status/known-gaps/in-flight updated if a milestone item changed state.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: what you verified live, what you only read, what you did not do.
