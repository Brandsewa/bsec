# A store covered by a free-months coupon opens when its mandate is authorised

- **Date:** 2026-10-26
- **Agent:** claude
- **Branch:** `fix/activation-free-period` (not merged, not committed)
- **Area:** domain
- **Type:** fix
- **Supersedes:** none

## Summary
With the free trial off, a self-service store must pay before it opens. The owner signed up with a 3-month free coupon, chose a plan and authorised the mandate in the Cashfree sandbox, and the store stayed on "Activate your store / Confirming your payment". The coupon defers the first charge, so Cashfree only takes and refunds the 1 rupee mandate check; the check is rightly not treated as a plan payment, so nothing ever cleared `subscriptions.payment_required`.

## What changed
- `packages/domain/src/saas/billing.ts`, `applyBillingEvent` "authorised": when the subscription still has `payment_required` and the tenant has an active, unexpired `free_months` promotion, the authorised mandate clears `payment_required`. Without a promotion the first payment still opens the store.
- Percent-off coupons: `subscribeToPlan` takes the percentage off the FIRST payment only (the Cashfree authorisation amount); `plan_amount` and renewals stay at the list price. One use per store (not after any invoice), only while the coupon is unexpired and matches the chosen plan. A 100% coupon is treated as a free period. New billing view fields `freePeriodEndsAt` and `firstPaymentCoupon`; the Activate screen explains both cases (refunded ~1 rupee check for free periods; discounted first payment for percent-off).
- One-off data fix for a store already stuck: `scripts/one-off/2026-10-26-clear-payment-required.sql` (interactive psql, no auto-commit; not run).
- Exclusivity: already enforced, one active promotion per store (`insertGrant`).
- Test: `packages/domain/test/platform-billing-cashfree.int.test.ts` ("...free-months coupon, authorising the mandate opens the store"): the 1 rupee check opens the store, creates no invoice.

## Decisions and trade-offs
- Authorisation, not payment, is the commitment during a free period. The first charge is taken by Cashfree when the free period ends.
- Not done: a store already stuck keeps `payment_required` (its authorised webhook was already processed). It needs a data fix or a fresh signup.

## Verification
- Ran: `pnpm --filter @bs/domain typecheck` pass; `vitest run test/platform-billing-cashfree.int.test.ts` 17 passed (real Postgres), including the percent-off and 100% cases; `pnpm gate:quick` result noted in the session.
- NOT verified: live sandbox signup with the fix deployed; that a store in this state keeps full tier access for the free period (not read or tested); the Activate screen was not viewed in a browser.

## Docs updated
- [ ] ARCHITECTURE, ADR, DEPLOYMENT not needed
- [ ] `progress.md` not updated (kept local)

## Follow-ups and open questions
- Percent-off on a MONTHLY plan discounts only the first month, whatever the coupon's duration (Cashfree has one fixed amount per cycle). Owner decision: keep, or prepay N discounted months.
- Decide how to unlock the already stuck test store (Darjeeling Honey).
- Trial off plus a coupon: consider whether the Activate screen should appear at all, or say that nothing is charged today.

## Definition of done
Gate run (see below); not committed (owner asked to keep work local).
