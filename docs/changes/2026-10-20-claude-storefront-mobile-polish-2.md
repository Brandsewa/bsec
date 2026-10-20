# Storefront mobile polish 2: checkout, sign-in, search, variants, related products, footer

- **Date:** 2026-10-20
- **Agent:** claude
- **Branch:** `feat/storefront-mobile-polish-2`  (not merged yet)
- **Area:** web, blocks, ui
- **Type:** fix
- **Supersedes:** none

## Summary
Second round of the owner's phone review of the live Modern Commerce store, plus one real bug: variants added to an older product did not appear on its product page.

## What changed
- **Variants not shown (bug):** the product page only offered option pickers when the product's option definitions (or option values derived from its variants) covered every variant. A variant added later without a value for an option, with a value outside the option's list, or next to a variant with no values, could not be picked at all. `buyModel` (`apps/web/src/lib/buy-model.ts`) now falls back to one "Variant" picker that lists each variant by its title when the options cannot reach them all; the quick-buy endpoint uses the same model. Unit tests in `apps/web/test/buy-model.test.ts`.
- **Cart drawer** now sits above the bottom bar and the sticky add-to-cart bar (z-index 80).
- **Product page on phones:** the highlight cards stack icon-over-text; the extra bottom padding reserved for the sticky bar (the blank gap above Customer Reviews) is gone.
- **Sign-in:** customer pages (account, sign-in, order, unsubscribe, privacy) are always light and `AuthShell` hides the theme switcher for the store variant; only the platform's `/signup` page still follows the visitor's theme (`themed-paths.ts`, test updated).
- **Search:** results page is 2 per row on phones, 3 on tablets, 4 on desktop, with a tighter header. The popup already shows "Add to cart" for a single-variant product and "Choose options" only when there is something to choose (unchanged logic, `quickAdd.singleVariantId`).
- **You may also like:** takes the home page's product carousel design (card, arrows, dots settings copied from the home page's first Product showcase) and lists related products; an older plain Product carousel on a product page is replaced by that related carousel at render time.
- **Footer:** the mobile footer grid used a plain `1fr` column that grew to its widest content (the newsletter row) and ran past the right edge; columns are now `minmax(0, 1fr)` and the newsletter form shrinks.
- **Checkout:** centred, smaller heading and tighter spacing; Contact, Billing and shipping address, Shipping method and Payment are grey panels (`.bs-panel`, the text colour mixed into the page colour so it is clearly visible on any theme), the same as the order summary; white fields with full-strength borders; smaller section headings on phones.

## Decisions and trade-offs
- The "Variant" fallback shows variant titles, not option values, so it works for any data shape; products with proper options keep the Size/Colour pickers.
- Related-carousel design is copied at render time from the home page, not written into the store's saved theme, so a store without a home carousel keeps the block's own settings.
- Checkout keeps the earlier no-border, no-shadow decision (test updated to expect `bs-panel`).

## Verification
- Ran: web typecheck, lint, tests (230 pass incl. new buy-model and updated checkout and themed-path tests), ui tests (45), blocks tests (210), root lint.
- Exercised by hand: the product page on a phone-sized view (renders, breadcrumb hidden), the footer (right padding present, no horizontal overflow).
- NOT verified: the checkout, search results and sign-in pages visually on a phone; the related carousel taking the home design on a store whose home page has a carousel; the "Variant" picker against the owner's real product; `pnpm build` and the perf-budget test for this change.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed (no structure, route or table change)
- [ ] ADR / DEPLOYMENT: not needed
- [ ] `progress.md`: not needed

## Follow-ups and open questions
- Search popup: the owner saw "Choose options" on every result because those tea products do have several variants; if single-variant products still show it, tell me the product.

## Definition of done
- [x] Gate items run for the touched packages (above); full `pnpm build` runs in CI.
- [x] Tests added or updated.
- [x] No secrets or generated files (`apps/web/AGENTS.md` is rewritten by `next dev`; not committed).
