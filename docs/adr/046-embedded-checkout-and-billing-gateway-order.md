# ADR-046: Embedded checkout and the gateway order for platform billing

- **Status:** Accepted (owner decisions 2026-11-15)
- **Date:** 2026-11-15
- **Plan reference:** `docs/EMBEDDED-CHECKOUT-PLAN.md`; builds on ADR-008, ADR-014, ADR-037, ADR-040

## Context
Stripe at the store checkout redirected shoppers to stripe.com. Razorpay already opens its own window. Platform billing sent Razorpay subscribers to a hosted page and had one gateway per region with no fallback; stores outside India paid by PayPal one-time orders that never renew.

## Decision
1. **Razorpay stays a window** (Standard Checkout). QuickBuy is a Razorpay-side feature that needs no code and is checked on a real phone, not built.
2. **Stripe Embedded Checkout** replaces the redirect for a store that saved a publishable key. The key is stored beside the secret in `tenant_secrets` (`key_id`), must be the same mode as the secret key, and its absence keeps the hosted redirect. Stripe.js is loaded only at checkout from the release train matching the pinned API version (`STRIPE_JS_TRAIN`); both move together.
3. **Platform billing opens Razorpay's window in the admin app** (the hosted `short_url` stays as a fallback). Only Razorpay's signed webhook activates a plan.
4. **Gateway order per region, with an optional backup:** India: Razorpay then Cashfree. Outside India: PayPal then Razorpay (USD cards). The backup is used when the primary is off, has no keys, or cannot create the payment, and can be switched off per region. A subscription stays on the gateway that created it; one plan is never charged by two gateways.
5. **USD Razorpay plans** are separate Razorpay plans per currency (`platform_razorpay_plans.currency`). USD charges are invoiced in USD with no GST (owner decision; the accountant confirms invoice wording before live).
6. **Admin refunds of Razorpay and Stripe payments go to the gateway** before the refund is recorded.

## Consequences
- Razorpay must enable international payments and recurring cards on the platform account before the USD path can charge; until then PayPal remains the only international path (open question Q1 in the plan).
- The Stripe.js train and `STRIPE_API_VERSION` must be changed together.
- Unpaid online orders are not yet expired automatically (a late payment on an expired order needs a provider-side check first); follow-up.

## Alternatives considered
- Razorpay Magic Checkout or custom card fields: more PCI scope and onboarding, no gain over the window.
- Stripe Connect: Indian cross-border limits and platform liability, against ADR-040 section 4.
- Payment Element on our own PaymentIntent: more code and edge cases than Embedded Checkout.
