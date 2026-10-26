# Razorpay online payment at the storefront checkout (live keys supported)

- **Date:** 2026-10-26
- **Agent:** claude
- **Branch:** `feat/razorpay-checkout` (not merged yet)
- **Area:** domain, payments, web
- **Type:** feature
- **Supersedes:** none

## Summary
A store that activated Razorpay (own keys, platform enabled, live mode allowed for live keys) now shows "Pay online" at checkout and takes real payments. Before, `ONLINE_PAYMENT_AVAILABLE = false` and an adapter stub hid it for every store, so a merchant with live keys and COD off could not sell. The owner explicitly asked for this on 2026-10-26, lifting the deferral in `progress.md` for Razorpay (live keys included).

## What changed
- `packages/domain/src/payments/razorpay-checkout.ts` (new): `isRazorpayCheckoutReady`, `startRazorpayPayment(ByToken)`, `confirmRazorpayPayment`, `settleRazorpayPayment`, `verifyRazorpaySignature`. Only the store's own keys are used (no env fallback).
- `orders/checkout.ts`: no fake `rzp_test_key` order; place-order route creates the Razorpay order after the order commits and returns `razorpay` params. Removed `ONLINE_PAYMENT_AVAILABLE` and `hasEnabledPaymentAdapter`.
- Routes `POST /api/storefront/checkout/razorpay/start` and `/verify` (rate limited, order token required).
- `system/webhooks.ts`: Razorpay `payment.captured`/`order.paid` settle via the same function (matches by Razorpay order id, checks amount).
- Web: `lib/razorpay-client.ts`, `CheckoutForm` opens the modal, `PayNowButton` on the thank-you page for unpaid orders.
- `packages/payments` Razorpay orders use `payment_capture: true`.

## Decisions and trade-offs
- Provider call happens after the order transaction commits (ADR-006); if Razorpay is unreachable the order exists and its page offers "Pay now".
- Browser signature verification settles immediately; the webhook is only a backstop, so merchants do not have to configure webhooks for payments to complete.
- Abandoned unpaid online orders keep their stock reservation until cancelled; no expiry job exists yet (follow-up).
- Refunds for online orders are still recorded by hand (no Razorpay refund call wired from admin).

## Verification
- Ran: typecheck (payments, domain, web) pass; `pnpm lint` 0 errors; real-DB `razorpay-checkout.int.test.ts` 6 pass; `payment-providers`, `cashfree-store-provider`, `webhook-inbox` (updated to use an intent), `checkout-terms`, `settings-phase-7`, `checkout-place-order`, `payment-methods-catalogue`, `security-fixes`, `integrations-hub` pass.
- NOT verified: a real Razorpay payment (modal, live key, webhook delivery); the checkout UI in a browser; web unit tests and `docs:check` not re-run after the last edits.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (Checkout paragraph, stage line)
- [x] ADR: not needed (follows ADR-008 and 6.4)
- [x] `DEPLOYMENT.md`: not needed (no env vars)
- [ ] `progress.md`: owner to confirm status line

## Follow-ups and open questions
- First live payment should be a small real order by the store owner, then a refund from the Razorpay dashboard.
- Expire unpaid online orders and release stock; Razorpay refunds from admin.

## Definition of done
Gate partially run (see Verification); no secrets or generated files in the diff.
