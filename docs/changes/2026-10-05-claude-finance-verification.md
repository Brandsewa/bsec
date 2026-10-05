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
Found by running the build, not by reading it:
- **Admin routes:** `finance.expenses.tsx` and `finance.reports.tsx` were children of `finance.tsx`, which has no outlet, so `/finance/expenses` and `/finance/reports` rendered the Overview. Renamed to `finance_.expenses.tsx` and `finance_.reports.tsx` (repo convention, like `orders_.new.tsx`).
- **Ledger list, trial balance and ledger CSV were empty** under RLS (the raw handle had no tenant setting). New permission-checked `listLedgerEntriesForAdmin` and `getTrialBalanceForAdmin` run inside `withTenant` (also fixes rule 4: the raw readers had no permission check).
- **Settle and recurring-create returned HTTP 500 after the write committed**: nulls in optional-only contract fields (`settlement.note`, `recurring.endsAt`). Contract made nullish; a test parses outputs through `ExpenseItem`.
- **Adjustments accepted unknown accounts** (`nope` landed in the ledger). Validated against `LEDGER_ACCOUNTS` in `createAdjustment` and in `isPostingUsable`.
- **Restock "cap" was circular** (capped at the lines being restocked). Now capped at COGS booked in the ledger for the order minus earlier restocks.
- **Receipt finalize omitted `tenantId`** on the `media` insert, so it failed under RLS for every store.
- **CSV buttons** used `window.location.href` to a relative URL (wrong origin, no `x-store-id`). New `apps/admin/src/lib/finance-export.ts` fetches via the API base with cookie and store header; `content-disposition` is now CORS-exposed. CSV export requires `exports.run` AND `finance.read` (plan D10).
- **Receipts:** new `getExpenseReceiptUrl` (15-minute signed URL, `finance.read`, refuses keys outside the tenant's receipt folder), contract `finance.expenses.receiptUrl`, handler, and UI (upload in the expense dialog, view icon in the table). **Edit expense** added to the UI (reversal plus new revision); icon-only buttons now have labels; raw `(cash_bank)` text removed from option labels.
- Typecheck error on the expense selects.
- Tests: isolation suite maps all 18 `admin.finance.*` procedures and its `store_admin` fixture gains `finance.*`; `finance-postings` and `finance-reconcile` seeds could not insert tenants as `app_rw`, so neither had ever run (now use `provisionTenant`); new `finance-reports.int.test.ts` (overview figures to the paisa for a tax-inclusive order, month close, shift, reopen newest-only, permissions, admin cost snapshot); `finance-queues.test.ts`; receipt, adjustment and contract-shape cases.
- ADR-022 now records the deviations and known gaps (categories, tax-inclusive residual path, recurring, CSV permission, cancelled-after-payment, COD remittance, negative inventory).

## Decisions and trade-offs
- Expense categories and paid-from values differ from the plan; contract, UI and ledger agree, recorded in ADR-022.
- Cancel-time restock is not wired: COGS posts at collection and cancel is only allowed pre-shipment, so only paid-by-hand-then-cancelled orders are affected, and they also need a refund record. Owner decision needed.

## Verification
- Ran: `pnpm typecheck` 15/15, `pnpm lint` 15/15, `pnpm docs:check` ok, `@bs/domain test:fast` 306/306, `pnpm test:heavy:local` 72 of 72 files and 1547 of 1547 tests on real Postgres.
- Exercised by hand in the browser (dev stack on a local Postgres, seeded demo store, port 5180): Overview figures checked against a hand calculation; expenses create, edit, delete in the UI with the resulting ledger rows checked in the database; settle, unsettle, recurring catch-up (12 per template per tick, repeat sweep writes 0), period close, closed-period shift, reopen, adjustments, CSV (BOM present), audit rows, via the API from the page.
- NOT verified: receipt upload to a real R2 bucket (none locally; presign, finalize and signed-URL logic are tested with a stubbed client); storefront checkout cost-snapshot path (read only; the admin path is tested); the Add/Edit dialog's recurring next-copy preview does not exist; mobile layout at 375 px overflows horizontally on Finance pages, as the existing Returns page also does (not caused by this work).

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: updated by the builder; not re-checked
- [x] ADR-022 updated with deviations and known gaps
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [ ] `progress.md`: in-flight line from the builder remains
