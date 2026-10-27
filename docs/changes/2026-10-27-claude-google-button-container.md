# Fix: Google button never appeared on the customer pages

- **Date:** 2026-10-27
- **Agent:** claude
- **Branch:** `fix/google-button-container`
- **Area:** web
- **Type:** fix
- **Supersedes:** none

## Summary
On the store's Google setup test page (`/account/google-verify`) the instruction text showed but there was no Google button, so the test could not be run. The customer sign-in and sign-up button had the same flaw. Google draws its button into a container element, but the container was rendered only after the page reached its "ready" state, so the draw step ran when the element did not exist and was silently skipped.

## What changed
- `GoogleVerifyClient` and `GoogleSignIn` now always mount the container (the sign-in one stays hidden until Google is on).
- New `apps/web/test/google-button-container.test.tsx` checks the container is present in the first render.

## Verification
- Ran: new test 2 pass; `@bs/web` typecheck and lint (0 errors).
- NOT verified: the button in a browser against a real Google client.

## Docs updated
- [x] ARCHITECTURE/ADR/progress: not needed
