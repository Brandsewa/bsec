# Multi-market Phase 0: ADR-040 and PayPal rule update

- **Date:** 2026-10-28
- **Agent:** claude
- **Branch:** `docs/multimarket-phase0` (merged in #150, a23f5a7)
- **Area:** docs
- **Type:** docs
- **Supersedes:** none

## Summary
Phase 0 of `docs/MULTIMARKET-PLAN.md`: writes ADR-040 (markets, money rules, resolution order, merchant as seller of record), updates `AGENTS.md` rule 14 to allow PayPal in sandbox, records the owner's decisions in `progress.md`, and claims the work in "In flight".

## What changed
- `docs/adr/040-markets.md` and its index line (`docs/adr/README.md`, next number 041).
- `AGENTS.md` rule 14: Razorpay, Stripe and PayPal, test/sandbox only, via the multi-market plan.
- `progress.md`: decisions on record, in-flight claim.
- The plan uses ADR-040, not 039 (039 is the notification manager) and records migration 0082 as latest.

## Decisions and trade-offs
- PayPal facts were only partly verified: the REST currency list is currency- and account-dependent; **PayPal Subscriptions for an India-registered platform account is unverified** and is settled in the Phase 4B sandbox, with a payment-link-per-cycle fallback (written in the ADR).

## Verification
- Ran: `pnpm docs:check` (result below in the PR).
- NOT verified: PayPal Subscriptions availability for India; Razorpay international currencies for the owner's account.

## Docs updated
- [x] ADR 040
- [x] `progress.md`
- [ ] `docs/ARCHITECTURE.md`: no structural change yet

## Follow-ups and open questions
- Phase 1 (foundation) next. It is the largest phase (about 100 files with a hardcoded rupee sign).

## Definition of done
Docs only: no secrets, no generated files, no unrelated edits.
