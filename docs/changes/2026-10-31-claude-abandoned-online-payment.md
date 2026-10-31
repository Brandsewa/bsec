# Abandoned online payment returns to checkout

- **Date:** 2026-10-31
- **Agent:** claude
- **Branch:** `fix/abandoned-online-payment` (merged in #167, 92318d0)
- **Area:** domain (orders, payments), web (checkout)
- **Type:** fix
- **Supersedes:** none

## Summary
Closing, cancelling or failing the gateway page (Razorpay, Stripe, PayPal) no longer leaves an unpaid order with "Pay now". The held order is cancelled, the cart is restored and logged as abandoned, and the shopper returns to checkout with a "payment cancelled / failed, no order was placed" notice. COD is unchanged (order created, payment pending).

## What changed
- `abandonUnpaidOnlineOrder` (`orders/manual-lifecycle.ts`): cancels the unpaid online order (stock and discount returned), puts the items back in the cart, marks it `abandoned` with email and phone. Never touches a paid or COD order.
- `/api/storefront/checkout/abandon` (POST for Razorpay, GET for the Stripe/PayPal cancel URL); place-order keeps the cart token in an httpOnly `bs_pending_cart` cookie for online methods.
- `placeOrder`: for online methods the cart stays open with the shopper's details; `settleProviderPayment` converts and empties it once paid.
- `/checkout?payment=cancelled|failed` notice.

## Decisions and trade-offs
- Gateway success we cannot confirm yet keeps the order (never cancel a possibly captured payment).
- Closed tab with no callback: no expiry job and no action (owner decision); the open cart is swept to abandoned with the shopper's details.

## Verification
- Typecheck clean for domain and web; `pnpm lint` 0 errors.
- NOT verified: real-database tests (owner will run), browser walkthrough, gateway flows end to end.

## Docs updated
- [x] ARCHITECTURE.md: not needed (no new tables, jobs or env vars)
- [x] ADR: not needed
- [x] DEPLOYMENT.md / RUNBOOK: not needed

## Follow-ups and open questions
- Real-database test for abandon, settle-converts-cart, and COD unchanged.
