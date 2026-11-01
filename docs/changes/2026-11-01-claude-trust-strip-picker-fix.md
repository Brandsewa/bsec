# Trust strip was hidden from the widget picker

- **Date:** 2026-11-01
- **Agent:** claude
- **Branch:** `fix/trust-strip-picker` (not merged yet)
- **Area:** block-editor
- **Type:** fix
- **Supersedes:** none

## Summary
The Trust strip never showed in the page builder because I had also listed it in `RETIRED_FROM_PICKER` (the list of old widgets kept only for saved pages). Removed it from that list; added a test that it is offered under BCOM widgets.

## What changed
- `packages/block-editor/src/config.tsx`: `TrustStrip` removed from `RETIRED_FROM_PICKER`.
- `packages/block-editor/test/config.test.ts`: new test for the picker group.

## Verification
- Ran: `config.test.ts` (13 pass). NOT verified in the browser.

## Docs updated
- [ ] ARCHITECTURE.md, ADR, DEPLOYMENT.md, progress.md: not needed

## Definition of done
Gate run by the pre-push hook.
