# Fix: /api/brand blocked by the storefront gate; smaller Super Admin sidebar logo

- **Date:** 2026-11-06
- **Agent:** claude
- **Branch:** `fix/brand-endpoint-marketing-host`  (not merged yet)
- **Area:** web, superadmin, docs
- **Type:** fix
- **Supersedes:** none

## Summary
After #236 and #238 the logo did not appear on the store admin and Super Admin sign-in pages. Cause: `https://bcom.si/api/brand` answered `404 Store Not Found`. The web middleware's storefront gate treated the platform root host as an unknown store for every `/api/*` path except a short allow-list, so the public brand endpoint (and its `/og` and `/manifest` siblings) never reached the route. The sign-in pages therefore never received the brand.

## What changed
- `apps/web/src/middleware.ts`: `/api/brand` and `/api/brand/*` skip the storefront gate (public, not about any store, same reasoning as the existing admin/webhook exemptions).
- `apps/web/test/middleware-status.test.ts`: the three brand paths are covered by the existing "gate does not apply" case.
- Super Admin sidebar logo smaller (`h-5 max-w-28`, was `h-7 max-w-40`).

## Verification
- Ran: middleware tests 12 pass, `pnpm typecheck` 17/17, `pnpm lint` 0 errors.
- Observed on production before the fix: `curl https://bcom.si/api/brand` gave 404 "Store Not Found" with and without an `Origin` header.
- NOT verified: the sign-in pages after deploy (to check once this ships); the sidebar size in a browser.

## Docs updated
- [x] This record; `progress.md` in-flight line
- [ ] After merge: Branch line and in-flight line (AGENTS.md section 5)
