# Storefront login: go to /account after sign-in

- **Date:** 2026-10-19
- **Agent:** claude
- **Branch:** `fix/storefront-login-redirect` (not merged yet)
- **Area:** web
- **Type:** fix
- **Supersedes:** none

## Summary
A shopper who created an account from the order page, set a password from the email and then signed in at `/account/login` stayed on the form with the button stuck on "Signing in...". The login API succeeded and set the session cookie, but `LoginForm` only called `router.refresh()`. `/account/login` is outside the `(dashboard)` layout that holds `AccountGate`, so the refresh re-rendered the same login page.

## What changed
- `apps/web/src/components/account/LoginForm.tsx`: after a successful password or phone-code sign-in, `router.replace("/account")` then `router.refresh()`.

## Decisions and trade-offs
Redirect in the client form instead of making the login page redirect signed-in users on the server: smallest change, no extra session lookup on the login page. A server-side "already signed in" redirect on `/account/login` is a possible follow-up.

## Verification
- Ran: `pnpm --filter @bs/web typecheck` pass, `pnpm --filter @bs/web lint` pass (0 errors, 4 existing warnings).
- NOT verified: the flow in a browser; no test covers the login form.

## Docs updated
- [ ] `docs/ARCHITECTURE.md` not needed
- [ ] ADR not needed
- [ ] `DEPLOYMENT.md` / RUNBOOK not needed
- [ ] `progress.md` not needed

## Follow-ups and open questions
- Server-side redirect for already signed-in visitors on `/account/login`.

## Definition of done
Gate items run are listed above; no secrets or generated files in the diff.
