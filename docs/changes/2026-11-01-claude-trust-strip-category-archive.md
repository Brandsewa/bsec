# Trust strip widget; category archive uses the collection archive template

- **Date:** 2026-11-01
- **Agent:** claude
- **Branch:** `feat/trust-strip-category-archive` (not merged yet)
- **Area:** blocks, block-editor, domain, web, superadmin
- **Type:** feature
- **Supersedes:** none

## Summary
New Trust strip widget with Desktop, Tablet and Mobile settings, and `/categories` now renders the same theme template as `/collections` so one theme page drives both.

## What changed
- `TrustStrip` block (`registry.ts`, `views-trust-strip.tsx`, `TrustStripField.tsx`, `blocks.css`): per device items per row, grid or slider, card or plain, icon position, text alignment, paddings, gap, radius, icon, heading and text sizes, strip and card colours. Empty tablet and phone values follow the larger screen; the view resolves them to `--ts-*-d/-t/-m` variables. Slider is CSS scroll-snap, no script.
- The older `UspStrip` stays (saved pages use it) and is now labelled "Simple icon strip" in the builder.
- `/categories` renders the theme's "collections" archive template with every `CollectionGrid` switched to `source: "categories"` (`getCachedCategoriesArchive`); `CollectionGrid` gets a `source` prop (default `collections`) that also changes the card links.
- Theme page labels: "Collection and category archive" and "Collection and category page" (`theme-pages.ts`, superadmin `TemplateEditor`, media usage labels). The builder's page dropdown is wider.

## Decisions and trade-offs
- Multi card icon removal (asked for in the same request) is NOT done: existing pages use Multi card with icons, so it needs a conversion step first. Waiting for the owner.
- The category archive shows the collection template's heading text; a separate heading would need a second template.

## Verification
- Ran: typecheck for blocks, block-editor, domain, web, admin, superadmin; `@bs/blocks` tests (new `trust-strip.test.tsx`, 4 tests).
- NOT verified: not viewed in a browser; the builder tabs UI was not driven by hand.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (block list and count)
- [ ] ADR, DEPLOYMENT.md, progress.md: not needed

## Follow-ups and open questions
- Remove icon settings from Multi card with a conversion of saved icon-only cards.

## Definition of done
Gate run by the pre-push hook.
