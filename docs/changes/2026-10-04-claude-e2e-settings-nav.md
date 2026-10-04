# Fix admin e2e after the Settings nav regrouping

- **Date:** 2026-10-04
- **Agent:** claude
- **Branch:** `fix/e2e-settings-nav`
- **Area:** e2e
- **Type:** fix
- **Supersedes:** none

## Summary
Settings rebuild Phase 0-1 (PR #25) relabelled the Team nav item to "Users". PR CI skips the staging smoke test, so the Playwright spec `team invite` (which clicked the link named "Team") only failed on the `main` run; the production deploy was skipped, so nothing shipped broken. The spec now clicks "Users".

## Verification
- Not run locally (needs the compose stack); the `main` staging smoke test is the check. Change is a one-line locator rename.

## Follow-ups
- Phase 2 moves the route to `/settings/users` with a `/settings/team` redirect; the nav label stays "Users", so the spec stays valid.
- Lesson: a PR that changes admin navigation labels must grep `e2e/` for the old label.

## Definition of done
- [x] Gate unaffected (test-only change); change record written; no secrets or generated files.
