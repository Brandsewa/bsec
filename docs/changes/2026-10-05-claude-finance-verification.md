# Finance phases 0-4 verification and fixes

- **Date:** 2026-10-05
- **Agent:** claude
- **Branch:** `feat/finance-verify-fixes` (stacked on `feat/finance-phases-1-4`; not merged yet)
- **Area:** domain, web, admin, docs
- **Type:** fix
- **Supersedes:** none

## Summary
Verified Antigravity's Finance build (`docs/changes/2026-10-05-antigravity-finance-phases-1-4.md`) against `docs/FINANCE-PLAN.md` section 7 with the full gate and real Postgres, and fixed what failed.

## What changed
- `apps/admin/.../finance.expenses.tsx`: typecheck errors on the category and paid-from selects.
- `apps/web/src/server/api.ts`: CSV export now requires `exports.run` AND `finance.read` (plan D10); ledger list and trial balance go through new permission-checked services.
- `packages/domain/src/finance/reports.ts`: `listLedgerEntriesForAdmin`, `getTrialBalanceForAdmin` (rule 4: the raw readers had no permission check).
- `packages/domain/src/finance/post-events.ts`: restock was "capped" at the very lines being restocked (no real cap). It now caps at COGS booked in the ledger for the order minus earlier restocks; with no COGS posted it posts nothing.
- `packages/domain/src/finance/expense-receipts.ts`: media insert omitted `tenantId`, so receipt finalize failed under RLS for every store.
- Tests: isolation suite maps all 17 `admin.finance.*` procedures (they were unmapped, 34 failures) and its store_admin fixture gains `finance.*`; `finance-postings` and `finance-reconcile` seeds used inserts `app_rw` cannot do, so neither suite had ever run: both now provision tenants via `provisionTenant`; restock test asserts the cap.

## Decisions and trade-offs
- Expense categories and paid-from values in the contract differ from the plan's lists (`rent`, `salaries`, `cash_bank` etc. instead of `premises`, `people`, `bank`); contract and UI agree, so kept. Plan section 3.2 should be updated or the ADR should record it.
- Cancel-time restock is not wired (only return restock); reconcile has no cancel scan.
- Not added: dedicated tests for reports, period close, CSV, recurrence catch-up cap, per-path cost snapshot, and an audit-coverage extension. Isolation now exercises every finance procedure's permission and real-DB path only.

## Verification
- Ran: `pnpm typecheck` 15/15, `pnpm lint` 15/15, `pnpm docs:check` ok, `@bs/domain test:fast` 305/305 (before the fixes), `pnpm test:heavy:local` 70 of 71 files, 1531 of 1533 tests passed; the missing file (`queue-consumers.int.test.ts`) crashed its worker with a Windows native exit code 3221226505 in the full run and passed 7/7 when rerun alone.
- Exercised by hand: nothing; no UI walkthrough was done.
- NOT verified: UI screens at 375 px and desktop, CSV route end to end, month-end close and recurrence behaviour beyond what the existing int tests cover.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: updated by the builder; not re-checked
- [ ] ADR: ADR-022 exists (builder); category list deviation not yet recorded
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [ ] `progress.md`: in-flight line from the builder remains
