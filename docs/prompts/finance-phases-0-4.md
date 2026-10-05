# Finance section: execution prompt for Phases 0 to 4 (one doc, step by step)

You are the assigned builder for the **Finance section** in the `bsec` monorepo. This one document drives all five phases, **one phase at a time**. The design, decisions (D1 to D14), data model, posting rules and acceptance criteria are in [`docs/FINANCE-PLAN.md`](../FINANCE-PLAN.md). Read it completely first, then `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/migrations.md`, `docs/admin-ui-standards.md` and `docs/adr/README.md`. Where this prompt and the plan disagree, stop and ask the owner. This document supersedes `docs/prompts/finance-phase-0.md` (its Phase 0 content is folded in below).

## A. How to work (applies to every phase)

1. **One phase = one branch = one PR.** Branch `feat/finance-phase-N` from the latest `origin/main`, in **your own worktree** (never another agent's checkout). Stage files by explicit path only (never `git add -A`, `git add .` or a directory); read `git status` for files you did not write before every commit.
2. **Strictly sequential.** Do not start Phase N+1 until Phase N is merged to `main`. When your PR is ready, **stop and report**; Claude verifies it against `docs/FINANCE-PLAN.md` section 7 (the items for that phase), runs the gate, fixes or sends back, and merges. You never merge your own PR. After the merge you will be told to continue; then `git fetch` and branch the next phase from the new `origin/main`.
3. **Claim and release:** add one line to "In flight" in `progress.md` (`antigravity · feat/finance-phase-N · <area> · <date> · <goal>`) when you start a phase; remove it in the same PR that completes the phase.
4. **Numbers are not fixed.** Migration number = next free at build time (`main` was at `0032`; unmerged settings branches hold `0033` to `0038`; check `git branch -a` and `origin/main` and re-check right before you push). ADR number = next free (`020` and `021` are taken). Never edit an applied migration; expand only.
5. **`Storify/` is not in git.** It exists only at `C:/dev/bsec/Storify/`. Read `lib/finance/*` there by absolute path (the plan's section 8 maps files to concerns). Port ideas, not marketplace arms. Never copy it into the repo or commit it.
6. **Local data only.** Test against local or ephemeral Postgres. Never touch the live production store, never create records there, never rotate secrets, never touch Coolify or Cloudflare. Never touch Razorpay or Shiprocket code or add provider keys (rule 14); their posting rules stay dormant and unwired.
7. **Hard rules** (`AGENTS.md` section 2) hold throughout: tenant tables via `tenantTable()` + `forceRlsSql`; only `packages/db` and `packages/domain` import the db libraries; business logic in `packages/domain`; permissions asserted in the domain service; secrets never in code, logs or responses; side effects through pg-boss after commit; every admin route has `pendingComponent`; no `eslint-disable`, no bypass role. When a rule blocks you, do not work around it: write it under "Open questions" in your change record and ask.
8. **Gate before every PR** (one package at a time, never the whole suite in parallel against one database): `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`, `pnpm --filter @bs/domain test:fast`, then `pnpm --filter @bs/domain test:heavy` (or `pnpm test:heavy:local`), plus the tests of every other package you touched. Paste the counts. Say plainly anything you could not run. Never claim "verified" for something you did not run.
9. **Every PR includes:** a change record `docs/changes/YYYY-MM-DD-antigravity-finance-phase-N.md` (copy `TEMPLATE.md`, include the definition-of-done list), `docs/ARCHITECTURE.md` updates for what you changed with "Last verified" bumped, `progress.md` updates, no secrets, no generated files, no unrelated edits. Commit trailer: `Co-Authored-By: Antigravity <noreply@google.com>`. Push the branch, open a PR to `main`, and stop.
10. **Owner questions you must not guess:** D14 (does `store_admin` see the books; default kept: yes), D13 (input GST credit not modelled), D10 (CSV needs `exports.run`). Keep the defaults in the plan and list them in your change record.

## B. Phase 0: ADR and accounting engine (`feat/finance-phase-0`)

**Objective:** land the append-only double-entry ledger as a tested, tenant-isolated engine. No UI, no triggers, no behaviour change elsewhere.

**Build:**
1. **ADR** `docs/adr/0NN-store-finance-ledger.md` (from `docs/adr/template.md`, registered in `docs/adr/README.md`): D1 to D9 as in the plan, plus any deviation you make.
2. **Schema** `packages/db/src/schema/finance.ts`: `ledger_entries`, `expenses`, `fiscal_periods` exactly per plan 3.2 (constraints, indexes, composite `tenantForeignKey` for `expenses.receipt_media_id`, unique partial index on expenses). Export from the schema index.
3. **Migration** `00NN_finance.sql` (expand only): `forceRlsSql` on all three tables, plus the nullable `order_items.cost_price bigint` column. Journal updated. Do **not** read or write `cost_price` yet.
4. **Permissions:** `finance.read`, `finance.write` in `STORE_PERMISSIONS` (`packages/auth/src/index.ts`); keep both out of the support-session read and write sets in `packages/domain/src/context.ts`.
5. **Engine** in `packages/domain/src/finance/`: `accounts.ts` (fixed chart, `debitSign`, derived `LEDGER_ACCOUNTS`); `postings.ts` (pure functions: sale decomposition with the invariant and residual handling, refund proration over what is left, restock capped at posted COGS, expense and reversal and settlement postings, adjustments, dormant gateway-fee and label-cost rules; refund cash account per plan 3.4; `allocate()` integer paise only); `ledger.ts` (`postingKey`, `postLedgerEntries` as batch `INSERT ... ON CONFLICT (tenant_id, key) DO NOTHING` counting inserted rows with `strict` mode, `applyPeriodClose` with the 60 s `closedThrough` cache and invalidation hook, `getTrialBalance`).

**Do not build:** UI, contracts, handlers, routes, jobs or queues, CSV, expenses CRUD, reports, reconcile.

**Tests:** pure unit tests (every rule, `allocate` property test with adversarial remainders, two partial refunds, residual booking); `packages/domain/test/finance-ledger.int.test.ts` (idempotency, period-close shift, trial balance, strict vs non-strict, DB rejects `debit = credit` and `amount <= 0`); isolation suite covers all three tables (cross-tenant read 0 rows, cross-tenant insert rejected, `relforcerowsecurity` asserted); support sessions hold neither finance permission.

**Phase 0 done when:** plan section 7 items for the ADR, tenant tables, idempotent keys, period close, paise integers and `allocate` are met, and the gate passes.

## C. Phase 1: wiring and reconcile (`feat/finance-phase-1`)

**Objective:** make real money events post to the ledger, safely and replayably. Still no admin UI.

**Build:**
1. **Queues** in `packages/db/src/queues.ts` and handlers in `packages/domain/src/jobs.ts` (additive, small edits; these are hot files, rebase first): `finance.post` (payload `{kind, id}`; the handler loads the document and posts, the same bridge the reconcile pass uses) and `finance.reconcile` (daily schedule like the existing 03:00 and 06:00 sweeps). Options copied from neighbouring entries. Consumer tests in `queue-consumers.int.test.ts`.
2. **Triggers**, each **enqueueing inside the business transaction** (rule 13), never posting inline: COD marked delivered (`orders/manual-lifecycle.ts`), manual order created with "Payment received", refund recorded (returns `refund` action in `orders/return-state-machine.ts` and order refunds), order cancelled after payment and return received with restock. Fire-and-forget semantics: a posting failure never fails the order (log and continue).
3. **Cost snapshot:** write `order_items.cost_price` (variant cost at placement) on **every** order-creation path: storefront checkout, admin manual order, quote-to-order, pre-order, exchange orders. Grep for `orderItems` inserts and cover each site; add a test per path. Never backfill old orders.
4. **Reconcile service** `finance/reconcile.ts` per plan 3.5: recurring-expense materialization hook (stub until Phase 3), recent 3-day pass, rotating 30-day deep sweep (first run over all history is the backfill), budget-checked, stateless. Iterate tenants like the marketing sweep in `jobs.ts` (around line 677), each tenant under its own RLS context as `app_rw`, never `app_platform`. Log `written > 0` at warn.
5. Expense and adjustment bridges exist as no-ops until Phases 2 and 3 provide the documents (plan 3.4 keys are already reserved).

**Tests (real Postgres):** `finance-postings.int.test.ts` (order collected posts revenue + tax + shipping(+COD fee) + COGS summing to `grandTotal`; two partial refunds post only the remaining parts; a refund larger than what is left is refused; restock capped at posted COGS; no gateway-account credit when the sale never debited it); `finance-reconcile.int.test.ts` (healthy replay writes nothing; deleting a ledger row is repaired by the next pass; backfill over pre-feature orders); a posting failure does not fail the order; per-path cost-snapshot tests.

**Phase 1 done when:** plan section 7 items for collection and refund postings, fire-and-forget, the daily job and queue registration are met, and the gate passes.

## D. Phase 2: overview and adjustments (`feat/finance-phase-2`)

**Objective:** the first visible Finance screen.

**Build (contracts first, then handler, then domain, then UI):**
1. `financeContract` in `packages/contracts` (follow the file's existing organisation; mounted as `admin.finance.*`): `finance.overview`, `finance.ledger.list`, `finance.adjustments.list/create`, `finance.currencies` per plan 3.10. Handlers in `apps/web/src/server/api.ts`.
2. Domain `finance/reports.ts` (P&L, cash position, cost coverage, anomalies, trial balance, GMV from orders, overview "Owed" block) and `finance/adjustments.ts`, with `assertPermission` (`finance.read` / `finance.write`) in the services (rule 4). Period resolution helper (`7d|30d|90d|ytd|all` or custom, store timezone from `store_settings.timezone`). No `"use cache"` on reports in v1.
3. Adjustments are strict: presets per plan 3.8 (settled gateway to bank, cash deposited or COD remittance, tax paid, write off, custom), reason required, two distinct accounts, positive paise. Each writes an `audit_logs` row (rule 6).
4. **Admin UI** `apps/admin/src/routes/_store/finance.tsx` and nav group "Finance" after Orders, visible only with `finance.read`: period picker in the URL, anomaly banner first, hero net card, P&L lines with ledger drill-down, holdings, owed card, GMV card, cost-coverage warning, "Adjust balances" dialog. Follow `docs/admin-ui-standards.md` (shared kit, `pendingComponent`, no native `<select>`, no `window.confirm`).

**Tests:** real-DB report tests against a seeded scenario that match exactly; adjustment presets produce the documented pairs; permission denial (403 and no nav) for a role without `finance.read`; audit rows exist (extend the audit-coverage style test). **Run the app** (`pnpm --filter @bs/admin dev` with web and platform) and walk the screen at 375 px and desktop; say plainly if you could not.

## E. Phase 3: expenses (`feat/finance-phase-3`)

**Objective:** hand-entered money: expenses, settlement, recurrence, receipts.

**Build:**
1. Domain `finance/expenses.ts` per plan 3.7: create, edit (revision bump, reversal plus new posting, strict), delete (reverse first, nothing deleted if the reversal fails), settle and unsettle (separate postings, settle locks money fields), unpaid list. `debit_account` stored, not re-derived. Audit rows for every mutation.
2. Recurring: template plus generated copies, unique `(tenant_id, template_id, date)`, catch-up capped at 12 per template per tick, wired into the Phase 1 reconcile hook; copies refuse schedule edits.
3. **Receipts** reusing the return-photos private-bucket pattern (`packages/domain/src/media/`): presigned PUT to `tenants/<tenantId>/expense-receipts/<uuid>`, finalize with magic-byte check (pdf, png, jpeg, webp only, at most 5 MB), `media` row, `expenses.receipt_media_id`, 15-minute signed GET through an authenticated route for `finance.read` holders only. No public URLs. Unattached-upload cleanup added to an existing daily sweep or a registered queue.
4. Contracts: `finance.expenses.list/create/update/delete/settle/unsettle`, `finance.expenses.receipt.presign/finalize`.
5. **UI** `/finance/expenses`: stats row, `DataTable` with search and category and paid-from filters, outstanding banner, create/edit dialog (repeats section with next-copy preview and backfill checkbox, receipt upload), settle dialog, delete and unsettle confirms that describe the reversal.

**Tests:** `finance-expenses.int.test.ts` (create, edit with revision and reversal, delete, settle, unsettle ledger state; recurrence catch-up cap and one copy per day; heal path restores a missing entry); receipt rules (type, size, magic bytes, private, signed only); permissions and audit. Walk the screen locally and report honestly.

## F. Phase 4: reports, close, export (`feat/finance-phase-4`)

**Objective:** accountant-facing outputs and month-end control.

**Build:**
1. **Tax summary** `getTaxSummary`: ledger `tax_payable` (collected minus refunded) plus the CGST/SGST/IGST split read from `order_items` by month (orders not cancelled), refund tax share prorated and shown as its own line.
2. **Period close** per plan 3.9: close a finished month (stored P&L snapshot, unique label, 409 on duplicate, invalidate the `closedThrough` cache, audit), reopen newest only (audited, confirm dialog says shifted entries are not moved back). Contracts `finance.periods.list/close/reopen`.
3. **CSV export** as a plain route `apps/web/src/app/api/admin/finance/export/route.ts` (`?type=ledger|expenses&period=...|from&to`), `assertPermission('exports.run')`, BOM, RFC 4180 quoting, hard 20 000-row ceiling signalled in the filename (`-partial-N-of-M`) and a final `TRUNCATED` row.
4. **UI** `/finance/reports`: tax summary with visible arithmetic, GST monthly table, ledger and expenses CSV download rows, trial balance, Month-end close panel. Ledger drill-down reachable from every report line.
5. **Docs close-out:** `docs/ARCHITECTURE.md` sections 7, 8, 9, 11, 12 fully updated, `progress.md` finance milestone status, and a final review of plan section 7 ticking each criterion with evidence in your change record.

**Tests:** tax summary matches a seeded scenario; period close shift, snapshot, duplicate refusal, newest-only reopen; CSV BOM, quoting and truncation; permissions and audit. Walk the screens locally.

**Phase 4 done when:** every item in `docs/FINANCE-PLAN.md` section 7 is checked with evidence, and the gate passes.

## G. Reporting back at the end of each phase

Post: branch and PR link, gate output with counts, what you ran and walked by hand, what you only read or could not run, any deviation from the plan and any owner question hit. Then stop and wait for verification.
