# Next steps hand-off: integration pass, status board and next prompts

- **Date:** 2026-10-04
- **Agent:** claude
- **Branch:** `docs/next-steps`
- **Area:** docs, process
- **Type:** docs
- **Supersedes:** none

## Summary
After the multi-agent sessions (ZCode: Customers Phase 1, Segments, Settings 0-1, local stacks; Antigravity: Settings Phase 2, dev-speed; Codex: Settings plan), Claude merged and verified the open work and updated the status board.

## What was merged this pass (all CI green, in this order)
PR #26 (settings phase plan docs), #25 (Settings 0-1), #21 (Customers Phase 1), #27 and #28 (e2e fixes after the Settings nav regrouping), #23 (Segments), #29 (Settings Phase 2, verified and fixed), #22 (dev-speed, repaired). Production health after the deploy: web, platform and admin `/health` ok with migrations through 0030.

## Defects found by verification (fixed before or right after merge)
Phase 2: red typecheck; `payments.manage` unenforced. Settings 0-1: e2e `team invite` spec broke (only visible on `main`). Dev-speed: invalid `ci.yml`, false-success tooling on Windows, one lint-rule false positive, wrong scaffold test path. Details are in the individual change records.

## Left open on purpose
- PR #30 (theme builder integration): needs the browser walkthrough first.
- Settings Phases 3-8; prompts: `docs/prompts/settings-rebuild-phase-3.md`. Phases 4-8 are blocked on owner decisions (plan §11 items 2-10).
- Browser verification (PR #30 theme builder, Settings Phase 2 roles, Customers/Segments): owner is testing manually on the local stack (see `progress.md`); the earlier tester prompt was withdrawn.
- Branches kept as preservation, not for merge: `claude-ds` (its useful commit was cherry-picked), `test/vmm-local-stack`, `feat/superadmin-themes`, `feat/commerce-page-templates` (superseded by `integrate/theme-builder`), old merged feature branches.

## Verification
Docs only: `pnpm docs:check`.

## Definition of done
- [x] Docs consistent with the repo. [x] No secrets or generated files.
