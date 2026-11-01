# Storefront polish batch: tablet menus, site width, Multi card, footer, checkout, images

- **Date:** 2026-11-01
- **Agent:** claude
- **Branch:** `feat/storefront-polish-batch` (not merged yet)
- **Area:** blocks, block-editor, domain, web
- **Type:** feature
- **Supersedes:** none

## Summary
A set of owner-requested storefront tweaks, requested in one session and shipped together for a production check.

## What changed
- Tablet (up to 1023px) uses the phone header and bottom bar (`blocks.css`, `MobileBottomNav.tsx`).
- Header, footer, contained hero slider and hero banner content follow the theme site width (`--bs-site-w-*`).
- Multi card: `cardLook` (card or plain), `iconPosition` (top, left, right), `iconAlign`.
- Footer: `bgColor` and `textColor`; the text colour also feeds muted text, titles and lines.
- `readableOn` threshold 0.18 to 0.3: mid-tone brand colours now get white text (test added).
- Checkout cards (`.bs-panel`): white with a light grey border; shipping options full width.
- Blog cards use the media worker's resized copies (`srcset`); blog and collection card image boxes show a CSS shimmer skeleton while loading.
- New optional schema fields all have defaults; no block version bump.

## Decisions and trade-offs
- White text on mid-tone primary is lower contrast than the strict WCAG pick; chosen by the owner.
- Product and collection card images still load originals (follow-up).

## Verification
- Ran: typecheck for blocks, block-editor, domain, admin, web (pass); `@bs/blocks` tests 275 pass.
- NOT verified: nothing was viewed in a browser; no real-DB test for the blog derivatives change.

## Docs updated
- [ ] ARCHITECTURE.md, ADR, DEPLOYMENT.md, progress.md: not needed (no structural change)

## Follow-ups and open questions
- Resized images for product and collection cards; filter bar on tablet in `FacetedFilters.tsx` still hides at 768px.

## Definition of done
Gate run by the pre-push hook.
