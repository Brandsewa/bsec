# Plan: discounts and offers upgrade

- **Date:** 2026-11-07
- **Agent:** claude
- **Branch:** not committed yet (written in the `docs/go-live-hardening-plan` checkout)
- **Area:** docs
- **Type:** docs
- **Supersedes:** none

## Summary
The owner asked to check the existing discounts and plan the four types (amount off products, buy X get Y, amount off order, free shipping) plus other popular offer types. This adds `docs/DISCOUNTS-PLAN.md`. No code changed.

## What changed
- New `docs/DISCOUNTS-PLAN.md`: audit of the current discount code, defects found, research summary, ranked extra types, target model, phases 0-5 with acceptance criteria, owner decisions.

## Decisions and trade-offs
- Amount off order and free shipping already work; the plan upgrades them rather than rebuilding.
- Defects found by reading code (not run): automatic discounts never apply, per-customer limit not enforced, `combinable` ignored, no audit row on create, fixed-amount codes may ignore the cart currency (to confirm with a test).

## Verification
- Ran: `pnpm docs:check` (see session). No tests run; defects are from reading code.

## Docs updated
- [ ] `docs/ARCHITECTURE.md` not needed (no structure change)
- [ ] ADR not yet: the plan requires one before Phase 1
- [ ] `progress.md` not changed (plan only, nothing in flight)

## Follow-ups and open questions
- Owner decisions: plan section 8.
