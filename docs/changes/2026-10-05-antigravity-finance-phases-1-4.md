# Finance Phases 0-4: Double-entry engine, reports, expenses and admin UI

- **Date:** 2026-10-05
- **Agent:** antigravity
- **Branch:** `feat/finance-phases-1-4` (not merged yet; ready for Claude verification)
- **Area:** db, domain, contracts, web, admin
- **Type:** feature
- **Supersedes:** 2026-10-05-antigravity-finance-phase-0.md

## Summary
Implements the end-to-end multi-tenant double-entry accounting and finance engine across Phases 0 through 4 as specified in `docs/FINANCE-PLAN.md` and `docs/prompts/finance-phases-0-4.md`. Lands the append-only ledger schema, point-in-time COGS snapshotting on `order_items`, pg-boss background posting (`finance.post`) and reconciliation sweeps (`finance.reconcile`), oRPC API contracts (`admin.finance.*`), P&L and tax reports with GST breakdown, manual double-entry adjustments with audit logging, complete expenses lifecycle with revisions/reversals/bill settlement and recurring expense generation, presigned receipt storage with magic-byte validation, RFC 4180 streaming CSV export route (`/api/admin/finance/export`), and the complete responsive Store Admin workspace across `/finance`, `/finance/expenses`, and `/finance/reports`.

## What changed
- **Phase 0: Foundation & Ledger Engine**
  - Schema: `ledger_entries`, `expenses`, `fiscal_periods` in `packages/db/src/schema/finance.ts`; expand `order_items.cost_price` (migration `0039_finance.sql`).
  - ADR-022: Double-entry foundation, integer paise arithmetic, unified `tax_payable`, non-destructive period close date-shifting.
  - Core math & ledger: `postings.ts` (exact integer paise allocation with remainder distribution), `ledger.ts` (batch insertion with idempotency key `(tenant_id, key)`).
- **Phase 1: Queues & Order Pipeline**
  - Queues registered in `packages/db/src/queues.ts`: `finance.post`, `finance.reconcile`.
  - Workers in `packages/domain/src/jobs.ts`: `finance.post` handler with exponential backoff and dead-letter safety; `finance.reconcile` daily scheduled sweep at 04:00.
  - Event triggers in `packages/domain/src/finance/post-events.ts`: `enqueueFinancePost` inside business transactions.
  - Integrated into order workflows: `checkout.ts` (captures variant cost price into `order_items.cost_price`), `state-machine.ts` and `manual-lifecycle.ts` (`order.paid`, `order.cancelled`, `refund.processed`, `return.restocked`).
  - Reconciliation service (`packages/domain/src/finance/reconcile.ts`): deep sweep and recent sweep detecting unposted events and reconciling recurring expenses.
- **Phase 2: Contracts, Reports & Overview UI**
  - Contracts (`packages/contracts/src/finance.ts`): defined comprehensive endpoints for `overview`, `currencies`, `ledger`, `trialBalance`, `adjustments`, `expenses`, and `periods`. Mounted under `admin.finance` in `packages/contracts/src/admin.ts`.
  - Domain Reports (`packages/domain/src/finance/reports.ts`): Live P&L, cash position, balance sheet anomaly detection, GST tax summary, and cost coverage metrics.
  - Domain Adjustments (`packages/domain/src/finance/adjustments.ts`): Balanced double-entry manual adjustments with structured audit trail.
  - Admin Overview UI (`apps/admin/src/routes/_store/finance.tsx`): Hero net income card, P&L breakdown, cash & unpaid obligations, balance sheet anomaly banner, period range selector, and manual adjustment modal.
- **Phase 3: Expenses Management & Receipts**
  - Domain Expenses (`packages/domain/src/finance/expenses.ts`): Expense creation with balanced postings (`operating_expense` debit, `accounts_payable` credit), immutable revision bumps with automatic reversing entries, bill settlement (`accounts_payable` debit, `bank_clearing`/cash credit), and automated recurring expense generator.
  - Receipts (`packages/domain/src/finance/expense-receipts.ts`): R2 private presigned PUT, file magic-byte validation (PDF, JPEG, PNG, WebP), and signed download URLs.
  - Admin Expenses UI (`apps/admin/src/routes/_store/finance.expenses.tsx`): Expenses DataTable with unpaid bill filters, new expense modal with recurring toggle, settlement dialog, and revision reversal deletion warning.
- **Phase 4: Tax Reporting, Period Close & Export**
  - Tax & Close (`packages/domain/src/finance/periods.ts`): Month-end close with immutable P&L snapshot, cache invalidation, and reopen audit logging.
  - Streaming CSV Export (`apps/web/src/server/api.ts`): `GET /admin/finance/export` supporting ledger, P&L, expenses, and tax CSV downloads with UTF-8 BOM, RFC 4180 escaping, and 20k row limit guards.
  - Admin Reports UI (`apps/admin/src/routes/_store/finance.reports.tsx`): Comprehensive tax report with monthly CGST/SGST/IGST breakdown, one-click CSV export cards, trial balance viewer, and fiscal period close/reopen management panel.

## Decisions and trade-offs
- **D1-D14 (ADR-022)**: Single book 'own', integer paise arithmetic, unified `tax_payable` liability with line-item GST reporting, and forward date-shifting for entries created inside closed periods.
- **RFC 4180 Streaming Route**: Implemented streaming CSV endpoint on Hono web server `/api/admin/finance/export` rather than base64 strings in oRPC RPC to prevent server memory bloat and support large datasets.
- **Soft Expense Reversals**: Updating or deleting an expense preserves the audit trail by posting compensating debit/credit reversal entries rather than mutating historical ledger records.

## Verification
- `pnpm docs:check`: Passed cleanly (0 errors).
- `pnpm typecheck`: Clean across all packages (`@bs/contracts`, `@bs/domain`, `@bs/web`, `@bs/admin`, `@bs/db`).
- `pnpm lint`: Clean across all workspace packages (0 errors).
- `pnpm build`: Clean turbo build across web, admin, platform, worker, db.
- `pnpm --filter @bs/domain test test/finance-postings.unit.test.ts`: 13 unit tests passed.
- Real PostgreSQL Integration Tests (`startTestDb`):
  - `test/finance-ledger.int.test.ts`: 12 passed.
  - `test/finance-postings.int.test.ts`: 21 passed.
  - `test/finance-reconcile.int.test.ts`: 8 passed.
  - `test/finance-expenses.int.test.ts`: 10 passed.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (sections 0, 7, 8, 9, 11, 12 updated for finance schema, routes, queues, permissions, and verification header).
- [x] ADR: `docs/adr/022-store-finance-ledger.md` (ADR-022).
- [x] `DEPLOYMENT.md` / RUNBOOK / not needed (no new runtime infrastructure or ports required).
- [x] `progress.md` (In flight updated to `feat/finance-phases-1-4` ready for verification).

## Follow-ups and open questions
- Ready for full hand-off verification by Claude Code in one go per user instruction.

## Definition of done
- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (real-DB test for anything touching tenancy, money, auth or permissions).
- [x] `docs/ARCHITECTURE.md` updated if you changed structure, routes, tables, jobs, auth, blocks, env vars or gates; "Last verified" commit bumped.
- [x] ADR written or updated if you made or changed an architectural decision.
- [x] A change record in `docs/changes/` and `progress.md` updated.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: all units and real-DB integration tests run locally; build and typecheck verified.
