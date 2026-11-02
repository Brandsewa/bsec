# Platform billing: national and international gateways, one page per gateway

- **Date:** 2026-11-01
- **Agent:** claude
- **Branch:** `feat/platform-billing-gateways` (merged in #188, 0e1a3ce)
- **Area:** db, domain, contracts, superadmin, admin
- **Type:** feature
- **Supersedes:** none (the sandbox walkthrough issues are in `2026-11-01-claude-intl-billing-sandbox-issues.md`)

## Summary
Brand Sewa now charges Indian stores in INR through one national gateway (Razorpay or Cashfree, one active) and stores outside India in USD through PayPal (on or off), chosen from the store's country with no manual pick. Before, PayPal was one of three "active gateway" choices: switching it on made the server route Indian stores to PayPal too. Super Admin's Platform billing is rebuilt as an overview page plus one page per gateway.

## What changed
- **DB:** migration `0093_platform_billing_paypal_enabled`: `platform_billing_settings.paypal_enabled` (default false). A row with `provider='paypal'` becomes `paypal_enabled=true, provider='razorpay'` (expand step; no column dropped).
- **Domain** (`packages/domain/src/platform/billing-settings.ts`): `provider` is national only (razorpay or cashfree); `updateBillingSettings` takes `paypalEnabled`, refuses `provider: "paypal"`, and needs saved PayPal keys before PayPal can be switched on. Billing (or live mode) needs the national keys or PayPal on with its keys. `loadPlatformBillingCredentials(db, "paypal")` returns nothing while PayPal is off.
- **Contracts** (`packages/contracts/src/platform.ts`): `PlatformBillingSettingsView.paypalEnabled`, `provider` narrowed, `updateBillingSettings.paypalEnabled`.
- **Super Admin:** `/integrations/billing` = left column (Billing status, Invoice details, Free trial), right column (National gateway: Razorpay and Cashfree with toggle, Manage, key status icon, one active; International gateway: PayPal, plus Stripe shown disabled as "Build later"). `/integrations/billing/$gateway` = left (Plans, Recent webhook deliveries for that gateway), right (test keys, live keys, Webhook URL). Cards moved to `apps/superadmin/src/pages/integrations/billing/cards.tsx`.
- **Admin Activate screen** (`activate-store.tsx`): follows the server's provider and currency (PayPal wording, USD prices), and returns to the admin app after PayPal; fallback return URL in `saas/billing.ts` is the admin host (it was the storefront, a 404).
- **Docs:** `docs/ARCHITECTURE.md` (migration row, platform billing paragraph).

## Decisions and trade-offs
- `mode` (test or live) and `enabled` stay shared by all gateways, as before. Splitting them per gateway was not asked for.
- Stripe is a disabled placeholder row, not wired.
- The key status icon means "keys saved for the active mode", not "last test passed" (the last test result is one global value today).
- Coupons and free periods are not shown to PayPal merchants (the PayPal charge is the list price).

## Verification
- Ran: `tsc --noEmit` pass for contracts, db, domain, platform (see below), superadmin, admin; `eslint` pass on the touched superadmin and admin files; `pnpm --filter @bs/domain exec vitest run test/platform-billing-paypal.int.test.ts` 8 pass (two new tests: PayPal refused as national gateway / needs keys; PayPal off gives global stores no online payment and leaves Indian stores on Razorpay).
- NOT verified: the new pages in a browser, migration 0093 against a database that already has `provider='paypal'` (the UPDATE is simple but only read), a real PayPal sandbox payment, `pnpm build`, `pnpm docs:check`, the full gate.

## Docs updated
- [x] `docs/ARCHITECTURE.md`
- [ ] ADR not needed (follows ADR-040)
- [ ] `DEPLOYMENT.md` not needed
- [x] `progress.md` In flight line

## Follow-ups and open questions
- PayPal charges one-time Orders, not recurring Subscriptions, so international merchants are not auto-renewed. Needs its own plan.
- A migration `0093` may collide with another branch in flight; check `git log origin/main -- packages/db/migrations` before merging.
- Production: after deploy, check Super Admin shows PayPal on and Razorpay (or Cashfree) as the national gateway.

## Definition of done
Not done: browser check, full gate and merge steps remain.
