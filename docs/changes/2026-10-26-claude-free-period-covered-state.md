# A store covered by a free-months coupon is trialing until the coupon ends, on its plan's tier

- **Date:** 2026-10-26
- **Agent:** claude
- **Branch:** `fix/free-period-covered` (merged in: not yet)
- **Area:** domain
- **Type:** fix
- **Supersedes:** none

## Summary
After `2026-10-26-claude-activation-free-period.md` the store opened, but the owner saw Plan and billing as `past_due`, "Renews 26 Oct 2026" and "first payment has not come through yet". With the trial off, the zero-day trial had already lapsed: the trial sweep set the subscription `past_due` and the store to the restricted XS tier, and dunning could act on it later.

## What changed
- `packages/domain/src/saas/billing.ts`, `applyBillingEvent` "authorised": when a store that must pay first (or is `past_due`) holds an unexpired free-months (or 100%) promotion, the subscription becomes `trialing` with `current_period_end` = the promotion's end, past-due markers cleared, `payment_required` false, and the size tier is set from the plan (not XS). The first charge at the promotion's end makes it `active` as before.
- Test: extended the free-months case in `packages/domain/test/platform-billing-cashfree.int.test.ts` (starts past due and XS; asserts trialing, period end, tier S).
- One-off data fix for the already open store: `scripts/one-off/2026-10-26-cover-free-period-store.sql` (interactive psql; replace the store name).

## Decisions and trade-offs
- Covered state reuses `trialing` rather than a new status, so Plan and billing, the sweep and dunning already do the right thing. The page wording says "free trial" for a coupon period; acceptable for now.

## Verification
- Ran: `vitest run test/platform-billing-cashfree.int.test.ts` 17 passed (real Postgres).
- NOT verified: a live sandbox signup with the fix; the wording on Plan and billing for a coupon period; the hand-off from `trialing` to `active` at the end of a real free period.

## Docs updated
- [ ] ARCHITECTURE, ADR, DEPLOYMENT not needed
- [ ] `progress.md` not needed

## Follow-ups and open questions
- Reword the Plan and billing text for coupon periods ("free period" and the real end date).

## Definition of done
Gate run before push; no secrets or generated files.
