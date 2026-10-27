# Google button under the customer sign-up form

- **Date:** 2026-10-27
- **Agent:** claude
- **Branch:** `feat/google-button-register`
- **Area:** web
- **Type:** feature
- **Supersedes:** none

## Summary
The customer "Continue with Google" button existed only on the sign-in page. It now also appears under the sign-up form (`/account/register`) as "Sign up with Google". It uses the same endpoint: a new Google email creates the customer, a known one signs in. One Tap still shows only on the sign-in page (ADR-038).

## What changed
- `GoogleSignIn` takes `oneTap` and `text` props; the register page renders it with `oneTap={false}`.
- No new route, no migration, no env var. The button appears only where Google sign-in is already enabled (verified custom domain, store switch on).

## Verification
- Ran: typecheck and lint for `@bs/web`, `pnpm docs:check`.
- NOT verified: the button in a browser against a real Google client (no store has been connected end to end yet).

## Docs updated
- [x] ARCHITECTURE/ADR: not needed (same flow); `progress.md`: not needed
