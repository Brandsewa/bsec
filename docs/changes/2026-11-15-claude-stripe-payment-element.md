# Stripe Payment Element inline at the store checkout

- **Date:** 2026-11-15
- **Agent:** claude
- **Branch:** `feat/stripe-payment-element` (not merged yet)
- **Area:** payments, domain, web
- **Type:** feature
- **Supersedes:** the Stripe Embedded Checkout part of `2026-11-15-claude-embedded-checkout-build.md` (ADR-046 point 2)

## Summary
The owner saw the old redirect text on the checkout and asked for Stripe's card fields inside the Payment Method section, like Shopify, for conversion. Stripe with a publishable key now shows the Payment Element there (ADR-048); Place Order validates it, places the order, creates a PaymentIntent and confirms it on the page. Without a key, the hosted redirect is unchanged. Why it did not show before: the embedded path only switched on when the store saved a publishable key, and the panel opened after Place Order.

## What changed
- `StripeProvider`: `uiMode: "elements"` creates a PaymentIntent (automatic payment methods, order metadata, idempotency key `bsec-pi-<order>`); `retrievePaymentIntent`; `cancel` handles `pi_` ids; the webhook parser returns the PaymentIntent id for `payment_intent.*`. The Embedded Checkout session code is removed.
- `online-checkout.ts`: `startHostedPayment` returns `stripeElements`, reuses a payable PaymentIntent, replaces a cancelled one under a new key, refuses a paid one; `confirmHostedReturn` settles from the PaymentIntent (amount, currency and order match); `getStripeElementsConfig` gives the checkout page the public key; `StartedPayment` kind `stripe_elements`. `getStorefrontCheckoutOptions` returns `stripeElements`.
- `system/webhooks.ts`: `payment_intent.succeeded` settles the order.
- Web: `stripe-client.ts` (Payment Element), `StripePaymentElement`, `StripePayOverlay` (Pay now), `CheckoutForm` (fields under the Stripe option, validate, place, confirm, retry and start-over), `PayNowButton`. `StripeEmbeddedOverlay` is deleted.
- Docs: ADR-048, ARCHITECTURE checkout paragraph, DEPLOYMENT webhook events (add `payment_intent.succeeded`).
- Cleanup of the merged `feat/embedded-checkout` branch and worktree; its change record Branch line updated.

## Decisions and trade-offs
- Deferred intent (fields before the order exists) rather than placing the order first, so a shopper who only looks at the payment section leaves no unpaid order.
- A declined card keeps the order and the PaymentIntent for a retry; "Cancel this order and start over" uses the existing abandon route.
- The merchant must subscribe their Stripe webhook to `payment_intent.succeeded`; the return route settles first, the webhook is the backstop.

## Verification
- Ran: `@bs/payments` Stripe unit tests (14 pass); `@bs/domain` `stripe-payment-element.int.test.ts` on real Postgres (8 pass: create, reuse, replace after cancel, paid refused, hosted fallback, settle only with right amount and order, wrong-order refused, public config only with a key); `pnpm typecheck` (17 tasks), `pnpm lint` (0 errors), `pnpm build` and `pnpm docs:check` pass; `@bs/web` unit tests 268 pass (incl. the page-weight budget); `@bs/domain` payment-providers, admin-refund-gateway and razorpay-checkout real-DB suites 32 pass with the new one.
- NOT verified: the fields in a browser against a real Stripe test account (all Stripe calls are faked); 3-D Secure and wallet paths; the `payment_intent.succeeded` webhook settle path (no test of its own); the full `@bs/domain` heavy suite, apps/platform and db suites, and e2e (left to CI); any browser run (no Stripe test key was available here).

## Docs updated
- [x] `docs/ARCHITECTURE.md`
- [x] ADR-048 and `docs/adr/README.md`
- [x] `DEPLOYMENT.md` (webhook events)
- [x] `progress.md` In flight line

## Follow-ups and open questions
- Owner: save a Stripe test publishable key under Settings, Payments, Stripe, subscribe the test webhook to `payment_intent.succeeded`, and place one test order with `4242 4242 4242 4242` and one with a 3-D Secure test card.
- R1 (expiry of unpaid online orders) is still not built.

## Definition of done
Gate parts run locally are listed under Verification; the rest runs in CI. No secrets or generated files in the diff.
