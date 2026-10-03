# Finance section plan (Storify-derived ledger, expenses, reports)

- **Date:** 2026-10-03
- **Agent:** zcode
- **Branch:** `main` working tree (docs only, not committed; the building agent should carry these files on `docs/finance-plan`)
- **Area:** docs
- **Type:** docs
- **Supersedes:** none

## Summary
Wrote `docs/FINANCE-PLAN.md`, a hand-off plan to build a **Finance** admin section for bsec, derived from the Storify reference app (`Storify/lib/finance/`, `Storify/models/`, `Storify/app/[locale]/admin/finance/` — analysed in full, see the plan's §1/§8 reference map). Storify runs a double-entry ledger (24 fixed accounts, deterministic idempotency keys, own/marketplace books), expenses with recurrence/receipts/settlements, fiscal-period close, ledger-derived reports, and a stateless reconcile cron. The plan keeps the load-bearing ideas (append-only entries, `(tenant_id, key)` idempotency, fire-and-forget vs strict posting, period close that shifts instead of locking, exact integer allocation, replay-as-backfill) and drops everything marketplace-specific (books, vendor payable/commission, payouts, store credit, multi-currency FX, POS, duty), because bsec tenants are single-vendor INR D2C stores.

## What changed
- Added `docs/FINANCE-PLAN.md`: reference analysis (keep/drop), verified bsec state and gaps F1–F9, design (chart of accounts, three tenant tables + `order_items.cost_price` expand in migration `0029_finance`, posting rules v1, reconcile job, reports, expense lifecycle, adjustments, period close, contracts/UI surface), decisions D1–D12, 5-phase build order, acceptance criteria, Storify file map. Requires **ADR-020 before Phase 0 code**.
- Registered the `zcode` agent so its change records pass `pnpm docs:check` and future ZCode sessions are recognised: `scripts/check-docs.mjs` `AGENTS` array, `docs/changes/README.md` agent list, and a ZCode row in the `AGENTS.md` §6 per-agent table. Follow-on agents: if another harness name appears, add it in the same three places.
- `progress.md`: added the In-flight line for this planning work.

## Decisions and trade-offs
- Docs-only change: no ADR (the plan *requires* the builder to write ADR-020 first, and contains its outline as D1–D12).
- Kept a `book` column (default `'own'`) on `ledger_entries` as cheap future-proofing for a possible marketplace, while dropping all marketplace logic — a column now avoids rewriting history later.
- Money is paise `bigint` end to end; Storify's decimal `quantizeToCurrency` becomes integer allocation with exact-sum remainder distribution — this is the riskiest port and gets dedicated acceptance criteria.
- Postings ride pg-boss (`finance.post`) so live path and reconcile replay share one code path (rule 13); the reconcile pass doubles as the historical backfill.
- Touched `AGENTS.md` and `scripts/check-docs.mjs` (shared files) — additive one-line/one-row changes; flagged here per AGENTS.md §6.3.

## Verification
- Ran: `pnpm docs:check` → `docs:check ok` (with this change in the tree; it validates the new change record, the zcode agent registration and doc cross-references).
- Exercised by hand: not applicable (no app change).
- NOT verified: the bsec-side totals invariant `subtotal − discountTotal + shippingTotal + taxTotal (+ codFee) = grandTotal` is asserted from reading `docs/ORDERS-ALL-ORDERS-PLAN.md` and the schema, not from `orders/checkout.ts` line-by-line — the plan tells the builder to verify it first (§3.4). Migration numbering `0029` assumes Antigravity's `0028_customers_phase0.sql` lands first; renumber if that changes.

## Docs updated
- [ ] `docs/ARCHITECTURE.md` — not needed yet; the plan updates sections 7, 8, 9, 11, 12 when the feature lands (listed in its Phase 4)
- [ ] ADR — deferred by design: ADR-020 is Phase 0's first deliverable, drafted as D1–D12 in the plan
- [ ] `DEPLOYMENT.md` / RUNBOOK — not needed (no env vars or services change in a docs commit)
- [x] `progress.md` (In-flight line added; builder updates the status board per phase)

## Follow-ups and open questions
- Owner: should `store_admin` hold `finance.read`/`finance.write`, or owner-only? (Plan defaults to both roles, flag in its change record.)
- Owner (with the CA): GST credit notes / GSTR-style exports remain out of scope (plan D12; returns plan D2 still open).
- Coordination: Phases 1+ touch `packages/db/src/queues.ts`, `packages/domain/src/jobs.ts` and `orders/checkout.ts`, all being edited by `feat/customers-phase-0` — sequence after their merge (plan header note).

## Definition of done
Docs-only change: gate items that apply are `pnpm docs:check` (ran, passed — see Verification) and honest status above. No code, tests, secrets or generated files in this change.
