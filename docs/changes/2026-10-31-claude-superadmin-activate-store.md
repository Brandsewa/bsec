# Super Admin: activate a store that is waiting for payment

- **Date:** 2026-10-31
- **Agent:** claude
- **Branch:** `feat/superadmin-activate-store` (merged in #171, e58cbb1)
- **Area:** contracts, domain, platform, superadmin, docs
- **Type:** feature
- **Supersedes:** none

## Summary
A self-service store created while the free trial is off (or with a 100% first-payment coupon) shows "Activate your store" until its subscription's `payment_required` flag is cleared, which only happens when a platform billing payment is confirmed. Owners could only do this with one-off SQL scripts (`scripts/one-off/2026-10-26-*.sql`). A Canadian test store hit the screen with "Online payment is not available right now" because, for a merchant outside India, billing runs through PayPal and `available` is true only once platform PayPal credentials are saved (Super Admin, Billing integrations). Until that is set up there was no way in. Super Admin now has an "Activate store" action on the store's page that opens it without payment.

## What changed
- `packages/domain/src/platform-services.ts`: `activatePlatformTenantStore`. Requires the store to be waiting (`payment_required`), then sets the subscription to `trialing` for N days, clears `payment_required`, past-due state and dunning, mirrors the end date on `tenants.trial_ends_at`, restores the plan's size tier (the trial sweep had put it on the restricted one), and writes a `tenant.activate` audit row with the reason. The tenant detail now returns `paymentRequired`.
- `packages/contracts/src/platform.ts`: `tenants.activate` (platform_admin, days 1 to 365, reason 3 to 500 characters).
- `apps/platform/src/app.ts`: handler. `apps/platform/test/rbac.int.test.ts` and `audit-coverage.int.test.ts`: new procedure mapped.
- `apps/superadmin/src/pages/TenantDetail.tsx`: "Activate store" button (only while the store is waiting) and a dialog with days and reason.
- `docs/ARCHITECTURE.md`: platform contract line.
- `apps/platform/test/activate-store.int.test.ts`: real-database tests.

## Decisions and trade-offs
- The store opens as a time-boxed trial (default 30 days in the dialog), not as a free paid plan: when the days end the normal trial sweep moves it to past due and the restricted tier until it pays. This keeps a manual activation from becoming a silent permanent free store.
- It refuses a store that is not waiting, so it can never overwrite a paying store's billing.
- It does not enable PayPal. Turning on real self-service payment still needs the platform PayPal credentials (sandbox first, rule 14) in Super Admin, Billing integrations.

## Verification
Ran against real Postgres (shared test database, serial): `activate-store.int.test.ts`, `rbac.int.test.ts`, `audit-coverage.int.test.ts`: 3 files, 80 tests passed. `pnpm typecheck` green (16 packages). Not run in a browser: the Super Admin dialog was compiled and type-checked but not clicked through.

## Open questions
- Owner: when to save PayPal sandbox credentials so Canadian and US merchants can pay themselves.

## Definition of done
- [x] Change record, ARCHITECTURE line, real-database tests
- [x] Gate (lint, build, test:affected) run before push; CI on the PR
- [x] After merge: PR and commit recorded, branch and worktree deleted. The `main` run deployed it, and the owner confirmed on the live Santuals test store that the Activate store button works
