# E2E: duplicate-upload test blocked by a toast on CI

- **Date:** 2026-10-14
- **Agent:** claude
- **Branch:** `fix/e2e-duplicate-toast`
- **Area:** e2e
- **Type:** fix
- **Supersedes:** none

## Summary
The main run for PR #74 failed in `staging smoke test` (so the production deploy was skipped): `media-library.spec.ts` "a file already in the library is flagged..." timed out clicking "Upload anyway" on both attempts. The CI page snapshot shows the "Queued 1 file for upload" toast intercepting pointer events over the button. The toast pauses while hovered and the mouse rests there after the previous click, so it never leaves on the smaller CI viewport. The click is now dispatched on the button instead of by pointer.

## Verification
- Local real stack: media spec 10 of 10 before and after. The CI condition (smaller runner viewport) did **not** reproduce locally, so the fix is confirmed only by the CI snapshot reading and the next main run.
- Not changed: product code. The Phase 5 / web queue changes are unrelated to this failure.

## Docs updated
- [x] none needed (test-only).
