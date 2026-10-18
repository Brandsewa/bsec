# Platform billing slice B1: Razorpay keys in Super Admin

- **Date:** 2026-10-18
- **Agent:** claude
- **Branch:** `feat/platform-billing` (not merged yet)
- **Area:** db, domain, contracts, platform, superadmin
- **Type:** feature
- **Supersedes:** none (changes ADR-014 point 1, see ADR-036)

## Summary
First slice of `docs/PLATFORM-BILLING-PLAN.md`. The platform owner can now save the platform's Razorpay test and live keys, switch mode, enable billing, set the grace period and test the connection from Super Admin. Billing code reads the saved keys, falling back to the old env vars.

## What changed
- Migration `0069_platform_billing_settings`: one-row table, secrets encrypted; `app_platform` writes, `app_saas` reads (`saas-grants.ts`), `app_rw` has no access.
- `packages/domain/src/platform/billing-settings.ts` (view, update, test connection, `loadPlatformBillingCredentials`); `saas/billing.ts` `resolveBillingProvider` replaces `new RazorpaySubscriptionProvider()` in the webhook, plan change, cancel and store-deletion paths.
- Platform API `integrations.billingSettings`, `updateBillingSettings`, `testBillingConnection` (owner only, audited with field names only).
- Super Admin page `/integrations/billing` (hub button and command-palette entry): status, enable and live switches, grace days, test and live key forms, copyable webhook URL.
- ADR-036, ARCHITECTURE and DEPLOYMENT notes updated.

## Verification
- Ran: typecheck for db, contracts, domain, platform, superadmin; superadmin lint (0 errors); real-database `platform-billing-settings.int.test.ts` (7 tests: owner-only, prefix and enable rules, encryption and no leak, audit field names only, env fallback, connection test without network, role grants) plus the existing billing webhook, lifecycle and unconfigured suites (19 pass in total); the whole `apps/platform` suite 120 pass (RBAC, audit-coverage and read-endpoint suites extended).
- NOT verified: the page in a browser; a real Razorpay call with test keys; `pnpm build`; the full domain heavy suite and the isolation suite (CI runs them).

## Docs updated
- [x] `docs/ARCHITECTURE.md`, ADR-036 and README, `DEPLOYMENT.md`, `progress.md` (in flight)

## Follow-ups and open questions
- B2 plan sync to Razorpay, B3 subscribe flow, B4 webhook lifecycle and invoices, B5 dunning, B6 GST invoice PDF, B7 Super Admin subscriptions, B8 promotions, B9 end-to-end run. GST details are still needed from the owner.

## Definition of done
Gate partly run (see Verification); CI runs the rest.
