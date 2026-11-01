# Site width on collection and product pages, hero slider width per device, tablet logo

- **Date:** 2026-11-01
- **Agent:** claude
- **Branch:** `feat/storefront-width-batch2` (not merged yet)
- **Area:** blocks, block-editor, web
- **Type:** feature
- **Supersedes:** none

## Summary
Follow-up to the storefront polish batch (#176): more pages follow the theme site width, the Hero slider can differ in width per device, and tablet headers keep the logo on the left.

## What changed
- `.bsb-w-wide` now uses `--bs-site-w-d/t/m` (80rem fallback): the collections archive and every wide widget follow the theme width.
- New `.bs-site-w` class (`apps/web/src/app/globals.css`) on the collection listing, product detail, product page sections, coupon cards, custom field and their loading skeletons; side padding is a flat 1rem.
- `HeroSlider`: `widthModeTablet` and `widthModeMobile` (`inherit` | `full` | `contained`), defaults `inherit`, so saved sliders are unchanged.
- Header layouts "logo in the middle" and "stacked" fall back to the phone arrangement (logo left) below 1024px.

## Decisions and trade-offs
- Product and collection pages lose the 2rem large-screen padding in favour of aligning with the header.
- No block version bump: new fields have defaults.

## Verification
- Ran: typecheck for blocks, block-editor, web (pass); `@bs/blocks` tests 275 pass.
- NOT verified: nothing viewed in a browser.

## Docs updated
- [ ] ARCHITECTURE.md, ADR, DEPLOYMENT.md, progress.md: not needed

## Follow-ups and open questions
- Trust strip widget and Multi card icon removal are planned, not built.

## Definition of done
Gate run by the pre-push hook.
