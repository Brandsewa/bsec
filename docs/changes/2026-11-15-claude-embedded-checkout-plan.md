# Embedded checkout plan (Stripe and Razorpay for merchants; Razorpay for platform billing)

- **Date:** 2026-11-15
- **Agent:** claude
- **Branch:** `docs/go-live-hardening-plan` (docs only, not committed)
- **Area:** docs, payments, platform billing
- **Type:** plan
- **Supersedes:** none

## Summary
Research and plan for (1) Stripe Embedded Checkout and Razorpay on-page checkout at the merchant storefront, and (2) Razorpay on-page checkout for platform billing, India (INR) and international (USD). Plan is in `docs/EMBEDDED-CHECKOUT-PLAN.md`. No code changed.

## What changed
- New `docs/EMBEDDED-CHECKOUT-PLAN.md` (current state, provider research, design, slices S0–P3, risks, owner questions).

## Decisions and trade-offs
- Razorpay store checkout is already an on-page window; proposed work is hardening (expiry, admin refunds), not a rebuild.
- Stripe moves from hosted redirect to Embedded Checkout behind a per-store flag; needs a stored publishable key.
- Platform billing: replace the `short_url` redirect with the Razorpay window; add Razorpay USD subscriptions as an international option beside PayPal, which does not auto-renew.

## Verification
- Read: payments providers, online-checkout, razorpay client, platform billing code and plans. Provider claims come from web search results of official docs, not from running anything.
- NOT verified: any provider behaviour, Razorpay international recurring availability, Stripe `ui_mode`/method naming for the pinned API version, `pnpm docs:check`.

## Docs updated
- [x] new plan doc; [ ] `progress.md` In flight and ADR deferred until the owner answers section 8 of the plan.

## Follow-ups and open questions
See plan section 8 (Q1–Q6).
