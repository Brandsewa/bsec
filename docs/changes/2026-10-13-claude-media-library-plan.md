# Media library plan, Phase 1 prompt and Phase 1 verification send-back

- **Date:** 2026-10-13
- **Agent:** claude
- **Branch:** `docs/media-library-plan` (not merged yet)
- **Area:** docs
- **Type:** docs
- **Supersedes:** none

## Summary
Adds the plan for the store Media library (Online Store > Media) with the owner's decisions, the Phase 1 builder prompt for Antigravity, and the fix-round prompt written after verifying Antigravity's Phase 1 branch (`feat/media-library-phase-1` at `ea54a3e`). Phase 1 was **not accepted**.

## What changed
- `docs/MEDIA-LIBRARY-PLAN.md`: owner decisions (name "Media", flat library, SVG off, grid + table views, limits image 5 MB / video 10 MB / document 5 MB on all plans, 30-day Trash), schema design (`media` columns, `media_usages`), per-kind quota keys linked to plan tiers (ADR-025), API, jobs, UI, Phase 1 acceptance criteria, later phases.
- `docs/prompts/media-library-phase-1.md`: builder prompt for Phase 1.
- `docs/prompts/media-library-phase-1-fixes.md`: send-back prompt for the fix round.

## Decisions and trade-offs
- Found while planning: presigned uploads skipped quota checks, and the client's declared file size was trusted. Phase 1 must fix both.
- Planning gap (Claude's): the plan did not say to exclude private `media` rows (`returns`, `expense-receipts` folders) from the library, and Phase 1 permanent delete did not cover images used by branding and page blocks. Both are now blocking items in the fix prompt.

## Verification
Verification of `feat/media-library-phase-1` at `ea54a3e`:
- `pnpm typecheck`: pass.
- `pnpm lint`: **fail**: 4 `no-non-null-assertion` errors in `packages/domain/src/media-services.ts`.
- `pnpm --filter @bs/domain test:fast`: 47 files, 406 tests passed.
- Heavy suite, local Postgres, serial: 97 files (94 passed, 2 failed); 2040 tests (2027 passed, 9 failed); 1 worker crash.
  - Failures: `product-images.int.test.ts` 6, `storage-connections.int.test.ts` 3.
  - Worker crash: `signup-pipeline.int.test.ts`.
- Code review findings B1-B6 and S1-S8 are in the fix prompt.

Not verified: the admin UI was not run in a browser.

On this branch: `pnpm docs:check` passes.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed, no code change.
- [ ] ADR: not needed now; ADR-028 comes with the Phase 1 code.
- [ ] `DEPLOYMENT.md`: not needed.
- [ ] `progress.md`: Antigravity's Phase 1 branch claims the "In flight" line.

## Follow-ups and open questions
- Antigravity runs the fix round. Claude re-verifies before Phase 1 merges.

## Definition of done
Docs only: `docs:check` passes. No secrets, generated files or code in the diff.
