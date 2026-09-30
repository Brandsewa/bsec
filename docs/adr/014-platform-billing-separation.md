# ADR-014: Platform Billing Separation from Merchant Customer Billing

- **Status:** Accepted
- **Date:** 2026-09-30
- **Plan reference:** PLAN §5.1, §7, §11.5, ADR-008

## Context
Bs Commerce Platform handles two fundamentally different payment streams:
1. **Merchant-to-Customer Commerce (Store Checkout):** Handled in M4 via `PaymentProvider` / `RazorpayProvider`. Uses merchant-specific credentials decrypted from `tenant_secrets` (or platform shared fallback), processing orders in paise with store-level webhooks.
2. **Platform-to-Merchant SaaS Subscriptions (Platform Billing):** Billed to merchants for software usage, plan tiers (Starter, Growth, Pro), and resource ceilings.

Conflating these two billing paths introduces severe operational risk: merchant credentials could be leaked or misused, webhook processing could misroute a subscription renewal as a store order capture, and rate limits or chargebacks could cascade across stores.

## Decision
1. **Strict Code & Credential Separation:**
   - Platform subscription billing operates through dedicated `SubscriptionBillingProvider` in `packages/domain/src/billing/` (or dedicated billing service).
   - Platform credentials (`RAZORPAY_PLATFORM_KEY_ID`, `RAZORPAY_PLATFORM_KEY_SECRET`, `RAZORPAY_PLATFORM_WEBHOOK_SECRET`) reside exclusively in platform-level environment variables, completely isolated from merchant `tenant_secrets`.
2. **Separate Database Schema:**
   - Platform subscriptions reside in global platform tables: `plans`, `subscriptions`, and `platform_invoices`.
   - Store customer checkouts continue to use tenant-isolated `orders`, `payment_intents`, and `payment_attempts`.
3. **Webhook Isolation:**
   - Subscription lifecycle webhooks (`subscription.charged`, `subscription.halted`, `subscription.cancelled`, `subscription.pending`) are received via `/api/webhooks/platform-billing`.
   - Signature validation uses `RAZORPAY_PLATFORM_WEBHOOK_SECRET` and fails closed. Inbound events are written to `webhook_inbox` with provider `razorpay_platform`.
4. **Honest Provider Interface:**
   - When platform credentials are not provided in environment variables, the platform billing adapter operates in a documented `disabled` state with honest diagnostics, rather than fabricating live subscription success.

## Consequences
- Zero blast-radius between tenant store checkouts and platform merchant billing.
- Platform billing can be swapped, extended (e.g. Stripe Billing), or audited without touching store checkout logic.
