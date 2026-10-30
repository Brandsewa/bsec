# Fix the markets e2e sign-in

- **Date:** 2026-10-30
- **Agent:** claude
- **Branch:** `fix/e2e-markets-login` (merged in #155, 19c5e8a)
- **Area:** e2e
- **Type:** fix
- **Supersedes:** none

## Summary
The multi-market squash (#150) failed `staging smoke test` on `main`: `e2e/markets.spec.ts` checked the URL for `/login` before the page had redirected, skipped signing in, then looked for the Markets page on the sign-in screen. Production was not touched (promote and deploy were skipped by the pipeline). The helper now waits for the login page, signs in and waits to leave it, like `e2e/admin.spec.ts`.

## What changed
- `e2e/markets.spec.ts`: sign-in helper only (unused `ADMIN` const removed).
- `scripts/test-affected.mjs`: leave the Playwright-only `@bs/e2e` package out of the vitest run (a change under `e2e/` made the pre-push gate run Playwright specs under vitest and fail).

## Verification
Ran the spec against a local stack (web on 3001, admin on 5180, dev database with migrations 0087 to 0090): 1 passed. CI on `main` is the real check.

## Definition of done
- [x] Change record
- [ ] After merge: confirm the `main` run deploys, delete this branch
