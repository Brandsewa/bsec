# Cashfree as a second payment gateway (platform plan billing and store connections)

- **Date:** 2026-10-19
- **Agent:** claude
- **Branch:** `feat/cashfree-gateway` (cut from `feat/platform-billing-b5-b6`, which holds B5 and B6; not merged yet)
- **Area:** db, payments, domain, contracts, web, platform, admin, superadmin, docs
- **Type:** feature
- **Supersedes:** none

## Summary
The owner is having trouble with Razorpay and asked for Cashfree as an alternative, kept alongside it. Two uses: (1) the platform charges merchants' plan subscriptions through either gateway, chosen in Super Admin; (2) stores can connect their own Cashfree account the way they connect Razorpay or Stripe. Decisions in ADR-037.

## What changed
- Migration `0072_cashfree_gateway`: Cashfree key columns on `platform_billing_settings`, provider check, `cashfree` allowed in `payment_methods`, seeded `platform_payment_providers` row (disabled for stores).
- `packages/payments/src/providers/cashfree.ts`: `CashfreeProvider` (ADR-008 interface), signature check, rupee/paise conversion, read-only connection probe.
- Platform billing: gateway switch and Cashfree keys in Super Admin (Integrations, Platform billing); `CashfreeSubscriptionProvider`; new webhook `/api/webhooks/platform-billing/cashfree`; Razorpay and Cashfree events share one applier; `endDueCashfreeCancellations` (cancel keeps the paid period). Existing subscriptions stay on their own gateway.
- Merchant: Plan and billing "Continue to payment" opens Cashfree checkout (`apps/admin/src/lib/cashfree-checkout.ts`), asks for a mobile number.
- Stores: Cashfree appears in Payments, Online payment gateways once Super Admin enables it; App ID and secret, test, activate; webhook `/api/webhooks/cashfree?tenantId=`.
- Tests: `packages/payments/test/cashfree.test.ts` (11), `platform-billing-cashfree.int.test.ts` (8), `cashfree-store-provider.int.test.ts` (5); `payment-providers.int.test.ts` updated for the third provider.

## Decisions and trade-offs
See ADR-037. Cashfree cannot cancel at the end of a cycle, so cancel is immediate at Cashfree with the plan kept until `cancelAt` by our sweep. No plan sync is needed (the plan is defined inline per subscription). Cashfree webhook signing is documented both with and without a dot between timestamp and body; both are accepted (still HMAC-protected).

## Verification
- Ran: `pnpm typecheck` for payments, db, contracts, domain, web, platform, admin, superadmin: pass. Cashfree unit tests 11 pass. Real-database: `platform-billing-cashfree` 8 pass, `cashfree-store-provider` 5 pass, `payment-providers` 12 pass, `b4-billing-webhook` 2 pass. (Billing regression files: see the section below once the run finished.)
- NOT verified: **no call has been made to the real Cashfree sandbox**; request and response shapes come from Cashfree's published docs and fakes. The checkout script call (`subscriptionsCheckout`) and the cancel body were not exercised in a browser. `pnpm lint`, `pnpm build`, `pnpm docs:check`, the full heavy suite and the e2e suite were not run for this record.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (migration 0072, routes, Cashfree bullet, last verified)
- [x] ADR-037
- [x] `DEPLOYMENT.md` / RUNBOOK: not needed (no new env vars or services)
- [x] `progress.md` (in flight)

## Follow-ups and open questions
- Owner: run the first sandbox pass: Super Admin, Platform billing, Cashfree sandbox keys, Test connection, switch gateway, add the webhook URL in Cashfree, subscribe from a test store.
- Cashfree must have Subscriptions enabled on the account; sandbox may need Cashfree support to activate it.
- Online checkout for shoppers is still not wired for any gateway (unchanged owner decision).
- GST invoice, yearly discount and refund policy decisions from the billing plan are still open.

## Definition of done
Not complete until the gate (`lint`, `build`, `docs:check`, heavy suite) is run and the owner's sandbox pass succeeds.
