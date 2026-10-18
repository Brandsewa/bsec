# Signup wizard: live promo check, business details, default theme, real plans

- **Date:** 2026-10-18
- **Agent:** claude
- **Branch:** `fix/signup-flow` (not merged yet)
- **Area:** web, domain, db
- **Type:** fix
- **Supersedes:** none

## Summary
Found while the owner walked the sign-up (checklist step B). The "Launch my store" button stayed disabled, the promo code was never validated, the theme step offered hard-coded themes, the business step collected almost nothing, and plans on the last step were hard-coded.

## What changed
- **Launch button:** it stays disabled until the Cloudflare Turnstile check returns a token. On production the widget fails with Turnstile error 110200 (hostname not allowed on the widget), so no token ever arrives. The page now shows a plain message when the widget fails. **Owner action:** add `bcom.si` (and `www.bcom.si`) to the widget's hostnames in the Cloudflare Turnstile dashboard.
- **Promo code:** moved to the plan step; checked on blur and again when the plan changes (`POST /api/saas/promo/check`, `previewPromoCode` in `packages/domain/src/platform/promotions.ts`, rate limited, never redeems). Shows "Valid: 3 months free." or the reason it cannot be used; launching is blocked while an invalid code is entered.
- **Theme step removed.** New stores get the platform default: the template flagged `is_signup_default` (migration `0068`), else `essential-commerce`, else the oldest published one (`resolveSignupTemplateCode`). The client can no longer pick a theme. There is no Super Admin toggle for the flag yet.
- **Business step:** business name (defaults to the store name), industry, address line, city, state (Indian states list, same as the admin), optional PIN. Saved into Settings, Store details (legal name, address) and the GST seller state.
- **Plans** on the last step come from `/api/saas/plans` (names, prices and chips from the real limits and flags); no hard-coded copy.

## Verification
- Ran: `pnpm --filter @bs/web build` pass, `pnpm docs:check` ok, `pnpm --filter @bs/web typecheck`, `@bs/domain typecheck`, web lint (0 errors), `@bs/web test:fast` 213 pass, `@bs/db test:fast` 27 pass, signup-pipeline, provisioning and promotions real-database suites (14 pass; run serially against a fresh database).
- NOT verified: the signup pages in a browser after the change; the Turnstile fix (needs the owner's Cloudflare change).

## Docs updated
- [x] `docs/ARCHITECTURE.md` (migration table)
- [x] ADR not needed: small additive column
- [ ] `DEPLOYMENT.md` not needed
- [ ] `progress.md` (not yet)

## Follow-ups and open questions
- Super Admin control to choose the default signup theme.
- Platform billing: signup takes no payment (trial only) and the platform's own Razorpay subscription keys are env vars (`RAZORPAY_PLATFORM_*`) with no Super Admin screen. Needs a plan.
- Self-service stores are still seeded with a flat shipping zone (₹99, free above ₹999); decide whether new stores should start with none.

## Definition of done
Gate partly run (see Verification); `pnpm build` for @bs/web passed.
