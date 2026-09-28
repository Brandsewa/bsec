# ADR-008: Payment provider adapter

- **Status:** Accepted
- **Date:** 2026-09-28
- **Plan reference:** PLAN §11.1, §11.4, §11.5

## Context
V0 needs Razorpay and COD; later Stripe and Razorpay Route. Payment edge cases (duplicate webhooks, retries, partial refunds) are where money is lost. The order model must not depend on one provider.

## Decision
A provider-neutral `PaymentProvider` interface in `packages/payments` (created in M4): `createIntent`, `authorize`, `capture`, `cancel`, `refund`, `verifyWebhook`, `getPayment`, `reconcile`. Implementations: `RazorpayProvider`, `CODProvider`, later `StripeProvider`. Orders reference `payment_intents` / `payment_attempts`, never provider objects. Per-store keys live encrypted in `tenant_secrets`.

Correctness rules: `Idempotency-Key` on checkout; webhooks go to `webhook_inbox` with `unique(provider, event_id)` and are processed by the worker; state changes only through the transition functions (§11.1); daily reconciliation job. Razorpay Route is a later settlement layer, not part of the Order model.

## Consequences
- Adding a provider is additive; the checkout and order code do not change.
- The interface must stay minimal; provider-specific extras go in `settings` jsonb.
- Kill switch: Razorpay off → checkout offers COD only.

## Alternatives considered
- **Razorpay types throughout the order model:** fastest now, expensive to unwind for Stripe/Route later.
