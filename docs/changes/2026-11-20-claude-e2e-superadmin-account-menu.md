# e2e: find the Super Admin staff email in the account menu

- **Date:** 2026-11-20
- **Agent:** claude
- **Branch:** `fix/e2e-superadmin-no-banner`  (merged in #295, 46bb7f6)
- **Area:** e2e
- **Type:** fix
- **Supersedes:** none

## Summary
PR #293 removed the Super Admin top banner. `e2e/superadmin.spec.ts` ("first sign-in forces authenticator setup...") asserted the staff email was visible after sign-in, and that text was only in the banner, so the `main` staging smoke test failed and the production deploy was skipped (production was never touched). The test now opens the "Staff account menu" and checks the email there.

## What changed
- `e2e/superadmin.spec.ts`: one click on the account menu before the email assertion.

## Decisions and trade-offs
- The e2e suite runs only on pushes to `main`, so this PR cannot prove the fix; the first `main` run after the merge does. My PR #293 should have updated the selector (AGENTS.md section 4): I grepped for the banner's words but not for the email it showed.

## Verification
- Ran: `pnpm gate:quick` (see PR). NOT verified: the Playwright test itself, which needs the full stack.

## Docs updated
- [ ] ARCHITECTURE / ADR / DEPLOYMENT / progress.md: not needed

## Follow-ups and open questions
- Watch the next `main` run's staging smoke test.

## Definition of done
Gate run before push; no secrets or generated files in the diff.
