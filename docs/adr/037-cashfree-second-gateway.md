# ADR-037: Cashfree as a second payment gateway (platform billing and store connections)

- **Status:** Accepted
- **Date:** 2026-10-19
- **Plan reference:** `docs/PLATFORM-BILLING-PLAN.md`, `docs/ADMIN-IMPROVEMENTS-PLAN.md` section 6.4, ADR-008, ADR-036

## Context
The owner is having trouble with Razorpay for charging merchants' plan subscriptions and wants Cashfree as an alternative, kept alongside Razorpay, for two uses: (1) the platform charging merchants for their plan, and (2) stores connecting their own gateway, the way they already can with Razorpay and Stripe.

## Decision
1. **Platform billing has one active gateway at a time**, `platform_billing_settings.provider` (`razorpay` or `cashfree`), chosen by a platform owner in Super Admin. Keys for both gateways stay saved, so switching is non-destructive. Cashfree keys are an App ID and secret per mode in new columns (migration 0072); Cashfree signs its webhooks with that secret, so there is no separate webhook secret. Secrets are encrypted and never returned, same as ADR-036.
2. **Subscriptions stay on the gateway that created them** (`subscriptions.provider`). Cancel and webhook verification use the subscription's own gateway, never the active one, so switching never strands a paying store. Razorpay webhooks keep arriving at `/api/webhooks/platform-billing`; Cashfree's arrive at `/api/webhooks/platform-billing/cashfree` (signature `base64(HMAC-SHA256(secret, timestamp + raw body))`, fails closed, idempotent on the body hash).
3. **Cashfree defines the plan inline** on each subscription (`PERIODIC`, `MONTH` or `YEAR`, amount in rupees), so there is no plan-sync step and no `platform_razorpay_plans` equivalent. The first debit is deferred past the trial or free period with `subscription_first_charge_time`. A refunded 1 rupee authorisation payment is ignored by the webhook (`payment_type = AUTH`), never invoiced. A mandate becoming `ACTIVE` does not activate the plan; only a successful `CHARGE` does.
4. **One event applier.** Razorpay and Cashfree payloads are normalised into the same internal events (`charged`, `authenticated`, `past_due`, `cancelled`, `resumed`) and one function updates subscriptions, invoices and size tiers, so the two gateways cannot drift apart. Dunning, GST invoices and the restricted tier work unchanged.
5. **Cancel semantics.** Razorpay can cancel at cycle end; Cashfree cannot. For Cashfree the subscription is cancelled at once at the gateway (no further debits) and `cancelAt` records the end of the paid period; the store keeps its plan until then and `endDueCashfreeCancellations` (run with the dunning sweep) moves it to the restricted tier.
6. **Stores connect their own Cashfree account** exactly like Stripe: Super Admin enables the provider for stores (seeded **disabled**, live mode closed), the store saves App ID and secret (encrypted in `tenant_secrets`), runs a read-only connection test, and activates. Webhooks go to `/api/webhooks/cashfree?tenantId=...`, verified with the store's own secret.
7. **`CashfreeProvider`** in `packages/payments` implements the ADR-008 `PaymentProvider` interface (create order, refund, verify webhook, get payment) with `fetch` and a pinned API version (`2026-01-01`), converting paise to rupees only at that boundary. **Online checkout is still not wired for any provider** (owner decision, AGENTS.md rule 14): a store can connect and activate Cashfree, but shoppers still see Cash on Delivery only.

## Consequences
- The merchant's subscribe flow on Cashfree needs a mobile number (Cashfree requires one for the mandate) and loads Cashfree's checkout script from `sdk.cashfree.com` in the admin app, only when Cashfree billing is the active gateway and the owner presses "Continue to payment".
- Cashfree API shapes were taken from Cashfree's published documentation and unit-tested against fakes; they have **not** been exercised against the real Cashfree sandbox yet. The owner's first sandbox run (test keys in Super Admin) is the acceptance check.
- Both gateways must have their webhook registered in their own dashboard.
