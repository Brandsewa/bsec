# Trust strip moved to the BCOM widgets group

- **Date:** 2026-11-01
- **Agent:** claude
- **Branch:** `fix/trust-strip-bcom-group` (merged in #179, f943fe6)
- **Area:** block-editor
- **Type:** fix
- **Supersedes:** none

## Summary
The Trust strip (added in 2026-11-01-claude-trust-strip-category-archive) was listed under "Store widgets", which is collapsed by default, so it looked missing. It now sits in "BCOM widgets" with Multi card, Collection showcase and the other owner-requested widgets.

## What changed
- `packages/block-editor/src/config.tsx`: `TrustStrip.category` is `bcom`.

## Verification
- Ran: block-editor typecheck and lint. NOT verified in the browser.

## Docs updated
- [ ] ARCHITECTURE.md, ADR, DEPLOYMENT.md, progress.md: not needed

## Definition of done
Gate run by the pre-push hook.
