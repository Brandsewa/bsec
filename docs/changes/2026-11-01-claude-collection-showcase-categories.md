# Collection showcase can list categories

- **Date:** 2026-11-01
- **Agent:** claude
- **Branch:** `feat/collection-showcase-categories` (not merged yet)
- **Area:** blocks, block-editor, domain, web, admin
- **Type:** feature
- **Supersedes:** none

## Summary
The Collection showcase widget could only list collections. It now has a "Show" setting (Collections or Categories) with a searchable multi-select picker for each, so merchants can feature categories in the same layout.

## What changed
- `CollectionShowcaseSchema` gains `source` (default `collections`) and `categorySlugs`; old documents parse unchanged, no block version bump.
- `packages/block-editor`: `collectionsField` takes a `kind`; host gains optional `listCategories` (store admin implements it from `admin.categories.list`, active only).
- `packages/domain/src/themes/block-data.ts`: `loadCategoryCards` resolves active categories (picked order, or all with `showAll`, max 48).
- View links cards to `/categories/<slug>` when source is categories.
- `cached-storefront.ts` also tags `category` so category edits refresh pages with these widgets.

## Decisions and trade-offs
Both pickers show at once, labelled by source; Puck conditional fields were not used to keep the change small.

## Verification
- Ran: typecheck for blocks, block-editor, domain, admin (pass); `collection-showcase.test.tsx` (5 pass).
- NOT verified: editor and storefront were not driven by hand; no new test for the category path.

## Docs updated
- [ ] `docs/ARCHITECTURE.md` not needed (no structural change)
- [ ] ADR not needed
- [ ] `DEPLOYMENT.md` not needed
- [ ] `progress.md` not needed

## Follow-ups and open questions
- Add a real-DB test for `loadCategoryCards`.

## Definition of done
Gate run before push via the pre-push hook.
