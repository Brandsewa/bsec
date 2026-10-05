# Finance section: Phase 0 builder prompt (ADR + accounting engine)

You are the assigned builder for **Phase 0 only** of the Finance section in the `bsec` monorepo. Do not start Phase 1 or later. The full design, decisions, build order and acceptance criteria are in [`docs/FINANCE-PLAN.md`](../FINANCE-PLAN.md); read all of it first, then `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/migrations.md` and `docs/adr/README.md`. Where this prompt and the plan disagree, stop and ask the owner. Claude verifies your work against the plan's section 7 before Phase 1 starts. Never merge your own PR.

## 0. Before you write code

1. **Own worktree and branch.** `git fetch`, then a new worktree from `origin/main` on `feat/finance-phase-0`. Do not work in another agent's checkout. Stage files by explicit path only (never `git add -A`, `git add .` or a directory).
2. **Claim it:** add one line to "In flight" in `progress.md` (`antigravity · feat/finance-phase-0 · db, domain, auth · 2026-10-05 · finance ledger engine`).
3. **`Storify/` is not in git.** It is only at `C:/dev/bsec/Storify/`. Read `lib/finance/accounts.ts`, `ledger.ts`, `postings.ts` and `models/ledger-entry.model.ts` there by absolute path. Port the ideas, not marketplace arms. Never copy `Storify/` into the repo or commit it.
4. **Numbers are not fixed.** The migration number is the next free one at build time (`main` is at `0032`; unmerged settings branches hold `0033` to `0038`, so check `git branch -a` and expect `0039` or later, re-check before you push). The ADR number is the next free one (`020` and `021` are taken). Never edit an applied migration.
5. Read the plan's coordination note and section 1.2 (what is dropped) so you do not build vendor, store-credit, FX or POS arms.

## 1. Objective

Land the append-only double-entry ledger as a tested, tenant-isolated engine with no UI, no triggers and no behaviour change anywhere else. After Phase 0, `packages/domain/src/finance/` can post balanced, idempotent entries; nothing calls it yet.

## 2. Scope: you must build

1. **ADR** `docs/adr/0NN-store-finance-ledger.md` (from `docs/adr/template.md`, registered in `docs/adr/README.md`): single book with reserved `book` column (D1), paise integers (D2), cost snapshot (D3), one `tax_payable` liability (D4), INR-only (D5), COD fee as shipping income (D6), the `promotions` reserve (D7), pg-boss posting (D8), 60 s closed-period cache (D9). Record any deviation you make from the plan.
2. **Schema** `packages/db/src/schema/finance.ts`: `ledger_entries`, `expenses`, `fiscal_periods` exactly per plan section 3.2, all with `tenantTable()`, composite `tenantForeignKey` for `expenses.receipt_media_id`, the constraints (`amount > 0`, `debit <> credit`, note length), unique `(tenant_id, key)`, the listed indexes, and the unique partial index on expenses. Export from the schema index.
3. **Migration** `00NN_finance.sql` (expand only) with `forceRlsSql(name)` for all three tables, plus the nullable `order_items.cost_price bigint` expand. Do **not** write or read `cost_price` anywhere yet (Phase 1 does). Update the migration journal.
4. **Permissions** in `packages/auth/src/index.ts`: add `finance.read` and `finance.write` to `STORE_PERMISSIONS`. Keep both out of the support-session read and write sets in `packages/domain/src/context.ts` (support sessions must not gain finance access; add a test). Both system roles get them by default (plan D14); flag that in your change record.
5. **Engine** in `packages/domain/src/finance/`:
   - `accounts.ts`: fixed chart (plan 3.1), `debitSign()`, `LEDGER_ACCOUNTS` derived from the map.
   - `postings.ts`: pure functions only (documents in, `LedgerPosting[]` out, no DB): sale/collection decomposition with the `merchandise + shipping + tax = grandTotal` invariant and residual-to-`product_revenue` handling, refund proration over what is left, restock capped at posted COGS, expense + reversal + settlement postings, adjustment postings, and the dormant gateway-fee and label-cost rules (unit-tested, wired to nothing). Refund cash account follows plan 3.4 (never credit `cash_gateway` unless the sale debited it). `allocate()` is integer paise only and sums exactly.
   - `ledger.ts`: `postingKey`, `postLedgerEntries` (batch `INSERT ... ON CONFLICT (tenant_id, key) DO NOTHING`, count inserted rows, `strict` mode), `applyPeriodClose` with the 60 s `closedThrough` cache and an invalidation hook, `getTrialBalance`.
   - Every public function checks `assertPermission` where it is a service entry point (rule 4); the pure rules do not.
   - Export from `packages/domain` index only what Phase 1 needs.

## 3. You must not build

- No UI, no contracts, no API handlers, no routes, no jobs or queues (`QUEUES`, `jobs.ts` and `checkout.ts` are untouched in Phase 0), no CSV, no expenses CRUD, no reports, no reconcile.
- Nothing in Razorpay or Shiprocket code (rule 14). No new dependencies.
- Do not apply the migration to any shared or production database. Test only against local or ephemeral Postgres.

## 4. Tests (real Postgres for anything touching the database)

- Pure unit tests (no DB): every posting rule, `allocate` property test with adversarial remainders, refund proration across two partial refunds, residual booking, invariant checks.
- `packages/domain/test/finance-ledger.int.test.ts` (`startTestDb`): idempotency (same key twice gives one row), period-close shift to `closedThrough + 1s` with the note, trial balance balances, strict vs non-strict failure behaviour, `debit <> credit` and `amount > 0` rejected by the database.
- Isolation: extend the isolation suite so all three tables are covered (cross-tenant read returns 0 rows, cross-tenant insert rejected, `relforcerowsecurity` asserted).
- Support-session test: finance permissions are in neither support set.

## 5. Definition of done (copy into your change record)

- [ ] ADR written and registered; deviations from `docs/FINANCE-PLAN.md` listed in it.
- [ ] Gate passes: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`, `pnpm --filter @bs/domain test:fast`, then `pnpm --filter @bs/domain test:heavy` (or `pnpm test:heavy:local`), one package at a time. Paste the counts. Say plainly anything you could not run.
- [ ] `docs/ARCHITECTURE.md` updated (tables, permissions, finance module) and "Last verified" bumped.
- [ ] Change record `docs/changes/YYYY-MM-DD-antigravity-finance-phase-0.md` (copy `TEMPLATE.md`), `progress.md` in-flight line updated.
- [ ] No secrets, no generated files, no unrelated edits; `git status` read for files you did not write before committing.
- [ ] Commit trailer: `Co-Authored-By: Antigravity <noreply@google.com>`. Push your branch and open a PR to `main`. Do not merge it; hand back to Claude to verify against `docs/FINANCE-PLAN.md` section 7 (Phase 0 items).

## 6. After Phase 0 (for orientation only, do not build)

Phase 1 wires `finance.post`/`finance.reconcile` jobs and the COD, refund and restock triggers, and starts writing `order_items.cost_price` on every order-creation path. Phases 2 to 4 add the overview, expenses and reports. Each phase gets its own prompt and branch (`feat/finance-phase-N`).

## 7. Open owner questions (do not guess; list in your change record if they block you)

D14 (does `store_admin` see the books), D13 (input GST credit), D10 (CSV permission).
