# Finance section plan brought onto main-based branch and audited

- **Date:** 2026-10-05
- **Agent:** claude
- **Branch:** `docs/finance-plan` (not merged yet)
- **Area:** docs
- **Type:** docs
- **Supersedes:** none

## Summary
`docs/FINANCE-PLAN.md` existed only on `feat/customers-phase-0`. It is now on a branch off `origin/main` and has been audited against current code so it can be handed to one builder (Antigravity) on its own `feat/finance-phase-N` branch. Docs only; no code.

## What changed
- `docs/FINANCE-PLAN.md` added, with these audit corrections:
  - Stale coordination note replaced: migration `0029` is not safe (main is at `0032`, settings branches hold `0033` to `0038`); the plan now says "next free number at branch time" (`00NN_finance`).
  - ADR-020 and ADR-021 are taken by the settings rebuild; the plan says "next free ADR number". Fixed the nonexistent `AGENTS.md` section 16 reference.
  - Fixed wrong decision cross-references (D6/D7/D8 to D4/D6/D7) and a typo.
  - Bug: manual UPI refunds credited `cash_gateway`, which nothing debits while Razorpay is dormant, producing a false negative-cash anomaly. Refund cash account now follows how the order was paid, and refunds are capped at what the sale entries booked.
  - Added COD remittance preset (`cash_on_hand` to `cash_bank`), the second queue (`finance.post` plus `finance.reconcile`) registration, tenant iteration under `app_rw`, a rule that every order-creation path writes `order_items.cost_price`, a no-`"use cache"` rule for v1 reports, the store timezone source, input-tax-credit decision D13 and `store_admin` permission decision D14.
  - Noted that `Storify/` is git-excluded and only exists at `C:/dev/bsec/Storify/`.

## Decisions and trade-offs
Owner confirmations still needed: D14 (should `store_admin` see the books, or owner only), D13 (input GST credit, CA review), D10 (CSV permission).

## Verification
- Ran: `node scripts/check-docs.mjs` pass (docs:check).
- Read only: file and line references were checked against `origin/main` (queues, auth permissions, refunds schema, manual lifecycle, marketing sweep) but nothing was built or run. The `refunds.status` values and per-site `orderItems` inserts were not enumerated.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed (no structure changed)
- [ ] ADR: not needed for this docs change (the finance ADR is Phase 0 of the plan)
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [ ] `progress.md`: in-flight line to be added by the builder
