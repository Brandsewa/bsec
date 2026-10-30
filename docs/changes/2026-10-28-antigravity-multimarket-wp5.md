# WP-5: Brand Sewa billing by PayPal for global merchants (Phase 4B) and plan limits display

- **Date:** 2026-10-28
- **Agent:** antigravity
- **Branch:** `feat/multimarket-wp5` (merged in #150, a23f5a7)
- **Area:** domain, platform, superadmin, admin, db
- **Type:** feature
- **Supersedes:** none

## Summary
Added PayPal as a third platform billing provider behind the existing billing seam (`packages/domain/src/saas/billing.ts`) following the Cashfree precedent (ADR-037/ADR-040). Indian merchants continue using Razorpay/Cashfree with INR pricing, while global merchants (`tenants.country !== 'IN'`) view USD plan prices (`plans.price_monthly_usd_cents` / `price_yearly_usd_cents`) and subscribe to Brand Sewa via PayPal. In Super Admin, plan USD pricing and `max_extra_markets` quota are displayed, PayPal credentials are stored as encrypted platform billing settings, and quota downgrade enforcement disables excess extra markets newest-first without data loss.

## What changed
- **Database & Migration (`packages/db`)**:
  - Added migration `0090_platform_billing_paypal.sql` adding `paypal_test_client_id`, `paypal_test_secret_ciphertext`, `paypal_test_secret_iv`, `paypal_test_webhook_id`, and live equivalents to `platform_billing_settings`.
- **Contracts (`packages/contracts`)**:
  - `packages/contracts/src/platform.ts`: Added PayPal keys schema (`PayPalKeysInput`) to `PlatformBillingSettingsView`, `updateBillingSettings`, `testBillingConnection`, and allowed `"paypal"` in webhook gateways. Added `priceMonthlyUsdCents` and `priceYearlyUsdCents` to `platformPlansContract.list`.
  - `packages/contracts/src/admin.ts`: Extended `PlanAndBillingView.billing` with `provider: "paypal"` and `currency?: string`. Added USD cents to `AvailablePlanSummary`.
- **Domain Services (`packages/domain`)**:
  - `packages/domain/src/saas/billing.ts`: Implemented `PayPalBillingSubscriptionProvider` implementing `SubscriptionBillingProvider` using PayPal Orders v2 in USD. Implemented `handlePayPalBillingWebhook` for idempotent settlement (`PAYMENT.CAPTURE.COMPLETED`, `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.DECLINED`).
  - `packages/domain/src/markets/service.ts`: Implemented `enforceExtraMarketsQuota(tx, tenantId, maxAllowed)` to disable excess active extra markets sorted newest-first (`createdAt DESC`), recording an audit log entry (`markets.downgrade_disabled`) without deleting markets.
  - `packages/domain/src/platform-services.ts`: Enforces extra market quotas on `changePlatformTenantPlan`.
  - `packages/domain/src/saas/dunning.ts`: Enforces quota (disables extra markets) when a store enters limited dunning stage.
  - `packages/domain/src/saas/trial-expiry.ts`: Enforces quota when a trial lapses.
  - `packages/domain/src/admin/plan-and-billing.ts`: Automatically sets `currency: "USD"` and `provider: "paypal"` for stores with `country !== "IN"`.
  - `packages/domain/src/platform/billing-settings.ts`: Added PayPal credentials management, encryption, connection testing via `PayPalProvider`, and webhook delivery listing.
- **Webhooks & Routes (`apps/web`)**:
  - Added `/api/webhooks/platform-billing/paypal` endpoint handler delegating to `handlePayPalBillingWebhook`.
- **Super Admin UI (`apps/superadmin`)**:
  - `apps/superadmin/src/pages/Plans.tsx`: Shows USD monthly and yearly prices next to INR, displays `max_extra_markets` allowed per plan, and replaces hardcoded currency symbols with `formatMoney`.
  - `apps/superadmin/src/pages/integrations/BillingIntegrations.tsx`: Added PayPal card for entering sandbox/live client ID, client secret, webhook ID, testing connection, copying PayPal webhook URL, and toggling active billing gateway.
- **Store Admin UI (`apps/admin`)**:
  - `apps/admin/src/routes/_store/settings/plan-and-billing.tsx`: Uses `formatMoney` formatted according to `billing.currency` ("USD" or "INR") for plan options, invoices, and modals.
  - `apps/admin/src/routes/_store/settings/payments.tsx`: Added PayPal blurb in gateway blurbs map.

## Decisions and trade-offs
- **PayPal Mechanism Recorded (Subscriptions vs Orders v2)**:
  - **Selected Mechanism**: PayPal Orders v2 hosted approval links per billing cycle (ADR-040 fallback).
  - **Reason**: PayPal Subscriptions does not support INR platform accounts, and accounts registered in India are subject to strict RBI e-mandate cross-border recurring regulations that reject autonomous recurring foreign currency charges. Following the approved ADR-040 fallback, issuing an Orders v2 hosted approval link per billing cycle integrated with our automated dunning engine and webhook capture (`PAYMENT.CAPTURE.COMPLETED`) cleanly accommodates global merchants with zero recurring mandate friction.
- **Extra Markets Quota Downgrade**:
  - Downgrades disable excess extra markets by `createdAt DESC` (newest first). Base market is always preserved and excess markets are set to `status = 'disabled'` rather than deleted, preserving merchant configurations and historical records.

## Verification
- `pnpm typecheck`: 15 of 15 packages passed.
- `pnpm lint`: 15 of 15 packages passed (0 errors; pre-existing warnings in other workspaces).
- `apps/platform/test/audit-coverage.int.test.ts`: Passed (135 passed across 6 test files in platform heavy suite).
- `packages/domain/test/platform-billing-paypal.int.test.ts`: Passed 6/6 tests against real Postgres 18.
- `packages/domain/test/platform-billing-cashfree.int.test.ts`: Passed 17/17 tests against real Postgres 18.
- `packages/domain/test/platform-billing-subscribe.int.test.ts`: Passed 10/10 tests against real Postgres 18.
- `packages/domain/test/platform-billing-dunning.int.test.ts`: Passed 9/9 tests against real Postgres 18.
- `packages/domain/test/billing-lifecycle.int.test.ts`: Passed 7/7 tests against real Postgres 18.
- `packages/domain/test/isolation.int.test.ts`: Passed 1670/1670 tests against real Postgres 18.
- `pnpm docs:check`: Note below for docs to update by Claude.

## Docs to update (for Claude / WP-8)
- `docs/ARCHITECTURE.md`:
  - Section 7 migration table: Add migration `0090_platform_billing_paypal.sql`.
  - Section 5/8/9: Document PayPal platform billing gateway and Orders v2 billing mechanism for global merchants (`country !== "IN"`).
- `progress.md`:
  - Update WP-5 / Phase 4B status and move in-flight item once verified.

## Follow-ups and open questions
- None. Everything in WP-5 scope has been implemented and tested against real PostgreSQL.

## Definition of done
- [x] Code follows `AGENTS.md` sections 2 and 3; the verification gate passes.
- [x] Tests added (`packages/domain/test/platform-billing-paypal.int.test.ts`) and existing real-DB billing tests pass.
- [x] Audit coverage (`apps/platform/test/audit-coverage.int.test.ts`) and tenant isolation (`isolation.int.test.ts`) remain green.
- [x] No secrets or generated files in the diff.
- [x] Ready for verification by Claude.
