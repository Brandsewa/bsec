# Remove the 18 old page-builder widgets

- **Date:** 2026-11-01
- **Agent:** claude
- **Branch:** `chore/remove-old-widgets` (not merged yet)
- **Area:** blocks, block-editor, domain, web
- **Type:** removal
- **Supersedes:** none

## Summary
The owner asked for every old ("native") widget to be removed so only the brand widgets remain. A read-only count of production (2026-11-01, by the owner in Coolify) showed the old widgets came only from the seeded theme `modern-commerce` and from stores created from it; the owner confirmed those stores are development stores and updated the live pages by hand.

## What changed
- Removed block types: Hero, ProductGrid, ProductCarousel, Testimonials, RichText, FAQ, Newsletter, UspStrip, Grid, FlexRow, FlexColumn, Spacer, Divider, FileDownload, Icon, Link, CallToAction, BlogPosts (schemas, views, registry entries, editor specs, tests). Registry now has 32 types.
- `packages/blocks/src/document.ts`: all 18 are in `REMOVED_BLOCK_TYPES`, so a saved page that still holds one drops it silently on read instead of failing.
- Kept on purpose: Banner (header announcement bar), CollectionGrid (collection and category archive), CollectionListing (collection page), Reviews (product page reviews heading).
- Default templates and seeds now use the brand widgets: `launch-template.ts`, `commerce-templates.ts`, `templates.ts` (starter pages), `content-services.ts` (default home), `saas/provisioning.ts` (new store home), `admin/demo-store.ts`, and the home fallback in `apps/web/src/app/page.tsx`. Hero becomes Hero slider, ProductGrid/ProductCarousel become Product showcase, UspStrip becomes Trust strip, Testimonials becomes Floating reviews, FAQ becomes FAQ accordion, BlogPosts becomes Blog slider, CallToAction and the story grid become Section > Container > Heading, Text, Button.
- FAQPage JSON-LD (SEO) now attaches to the FAQ accordion (`FaqSection`) in `BlockRenderer`.
- `block-data.ts` no longer resolves product grids or file downloads.

## Decisions and trade-offs
- Migration 0015 (the launch theme row) is untouched; `themes.int.test.ts` updates that row to the current code version in its setup, because the old widgets in it would now be dropped.
- Dead CSS for the removed widgets (`bsb-hero`, `bsb-usp`, ...) is left in `blocks.css`; some classes are shared and need a careful pass later.
- The `file` variant of `BlockData` stays in the type (harmless).

## Verification
- Ran: typecheck for blocks, block-editor, domain, web; `@bs/blocks` 249 tests, `@bs/block-editor` 27 tests, `@bs/domain` fast tests, web storefront page tests; the whole domain heavy suite on a local Postgres (2750 tests) with the one theme test fixed afterwards.
- NOT verified: the builder and storefront were not driven by hand after this change.
- Production data: read-only counts only; no store data was changed by me.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (block list and count)
- [ ] ADR, DEPLOYMENT.md, progress.md: not needed

## Follow-ups and open questions
- Remove the dead CSS of the old widgets.

## Definition of done
Gate run by the pre-push hook.
