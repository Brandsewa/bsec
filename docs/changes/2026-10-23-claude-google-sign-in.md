# Google sign-in: platform client for staff and store owners, store-owned app for customers

- **Date:** 2026-10-23
- **Agent:** claude
- **Branch:** `feat/google-signin` (merged in #109; branch deleted)
- **Area:** db, auth, domain, contracts, web, platform, admin, superadmin
- **Type:** feature
- **Supersedes:** none

## Summary
Super Admin can now configure one platform Google client (Authentication hub) so staff and store owners can sign in or sign up with Google. Stores with a verified custom domain can connect their own Google app so their customers can sign in with Google and One Tap on the customer sign-in page. Customers never go through the platform Google client. Plan: `docs/GOOGLE-SIGNIN-PLAN.md`; decision: ADR-038.

## What changed
- **Migrations** `0076_platform_google_auth` (`platform_auth_providers`, `platform_google_client`, marks existing platform staff emails verified) and `0077_customer_google_signin` (`store_social_auth`, `customer_identities`, forced RLS).
- **Super Admin:** fourth Integrations card and `/integrations/auth` (`AuthHub.tsx`): Email, Phone and Google sections; platform client form with connection test (Google token endpoint probe), enable, owner signup, One Tap, customer switch. Platform API `integrations.authOverview`, `updateGoogleAuth`, `setGoogleClient`, `testGoogleClient` (audited, `platform_admin`).
- **Tier A:** `packages/auth/src/google.ts`; staff and platform Better Auth instances get Google and One Tap (existing accounts only), rebuilt when settings change; Continue with Google and One Tap on admin login, button on Super Admin login; store owner signup with Google on `/signup` (`saas/google-signup.ts`, `owner.googleTicket`).
- **Tier B:** `customers/social/google.ts`, `admin/social-auth.ts`, `admin.socialAuth.*`, storefront `/api/storefront/customer/google` and `/verify-setup`, `/account/google-verify`, button and One Tap in `LoginForm`, Settings, Customer accounts card with setup steps and test.
- Erasure removes linked identities; export includes them.

## Decisions and trade-offs
- Customer Google is tied to a live custom domain and the store's own Client ID; the platform client is never used for customers (ADR-038).
- Google sign-in is refused for any account with two-factor, because Better Auth 1.7.10's two-factor hook does not cover social sign-in. Super Admin members who enrolled an authenticator therefore keep password plus authenticator.
- Customer Google sign-in is rate limited per (tenant, IP) only. A first version reused the per-email bucket with a fixed key and locked all shoppers out after five sign-ins; the test caught it.
- Cookie inventory (`TEST_LOCKED_COOKIE_INVENTORY`) is unchanged: Google's cookies are third-party, set by Google's script; the admin card tells the owner to mention Google in the privacy policy.

## Verification
- `pnpm typecheck` pass (15 packages). `pnpm lint` pass for the touched packages.
- Real database: `platform-auth-providers.int.test.ts` 16 pass, `customer-google-signin.int.test.ts` 19 pass, `isolation.int.test.ts` 1510 pass (new `admin.socialAuth.*` mapped), `b2-grants.int.test.ts` 6 pass, `apps/platform` `audit-coverage.int.test.ts` 70 pass, `packages/auth` 15 pass.
- Full domain heavy suite (`pnpm test:heavy:local`): 121 of 123 files pass; 2 files (`media-derivatives`, `order-cancel-stock`) crashed their Windows worker (exit 3221226505) and pass when run alone (8 of 8). `test:fast` pass for domain (460), web (230), admin, superadmin, auth, db, contracts. `pnpm build` and `pnpm docs:check` pass.
- Exercised by hand: Super Admin sign-in, Integrations hub, `/integrations/auth` on the local dev stack (desktop width); saved a fake Google client and ran the connection test, which Google answered with `invalid_client` and the page showed the plain-English failure and kept Enable switched off. The dev rows were removed afterwards.
- NOT verified: any live Google round trip (no Google client exists yet), the Store Admin Google card and the customer sign-in and setup-test pages in a browser, the Better Auth redirect callback end to end, FedCM behaviour. These need the owner's Google Cloud client and a manual walkthrough on a custom domain. The connection test calls Google's token endpoint with a deliberately invalid code; the audit-coverage test makes that call too (offline it records a failed test).

## Docs updated
- [x] `docs/ARCHITECTURE.md` (sections 7, 8, 12, last verified)
- [x] ADR-038
- [x] `DEPLOYMENT.md` / RUNBOOK: Google Cloud setup is documented in the Super Admin page and the plan; no new env vars
- [x] `progress.md`
