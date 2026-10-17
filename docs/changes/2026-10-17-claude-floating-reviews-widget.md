# Floating reviews widget and Product showcase image polish

- **Date:** 2026-10-17
- **Agent:** claude
- **Branch:** `fix/admin-polish-phase-1` (not merged yet)
- **Area:** blocks, block-editor, domain, web
- **Type:** feature
- **Supersedes:** none

## Summary
A new BCOM widget, "Floating reviews" (`ReviewsMarquee`), shows the store's published product reviews as cards that drift upwards on the left, beside an editable heading and description on the right. The Product showcase card image is now the image alone (no card background, no inner padding), filling the card's image area with rounded corners.

## What changed
- `packages/blocks/src/registry.ts`, `views-reviews.tsx`, `types.ts`, `blocks.css`: schema, view, `BlockReview` and the `reviews` block data kind, CSS (two lanes, pause on hover and focus, reduced-motion fallback to a scrollable column).
- `packages/domain/src/themes/block-data.ts`: `recentReviewsTx` (published reviews only, joined to listed products, verified flag from `order_item_id`); `resolveBlockData` resolves it per block.
- `packages/block-editor/src/config.tsx`, `signature.ts`: editor panel (heading, which reviews, movement and size, card) and refetch signature.
- `apps/web/src/server/cached-storefront.ts`: pages with the widget are tagged with the product tags, which `review_updated` already invalidates.
- Product showcase image CSS in `packages/blocks/src/blocks.css` (`.bsb-psc-media`, `.bsb-psc-imglink img`).

## Also in this change
- New BCOM widget "Image banner" (`ImageBanner`, `views-image-banner.tsx`): uploaded image (cover or contain, kept in view top/bottom/left/right, rounded, optional darkening), eyebrow, heading, description, up to two buttons (shown only with a link), the text group placed left/middle/right and top/middle/bottom, text alignment and width, optional colours.
- New BCOM widget "FAQ accordion" (`FaqSection`, `views-faq.tsx`): the FAQ block plus eyebrow, heading and description; split layout (heading right or left of the questions, top/middle/bottom) or stacked (heading alignment); card or plain (soft lines) look; open/close icon in front of or after the question (plus or arrow); optional single-open and first-open. Native `<details>`, no script. The original FAQ block is unchanged.
- New BCOM widget "Collection showcase" (`CollectionShowcase`, `views-collection-showcase.tsx`): Collection grid plus heading left/middle/right, an optional button link ("View all"), 2-6 cards per desktop row (extra collections wrap into more rows), grid or carousel on tablets and phones, and a multi-select of the store's own collections (`CollectionsField.tsx`, fed by the new optional `BlockEditorHost.listCollections`, provided by the store admin host; the Super Admin theme editor has no store, so it falls back to typing slugs). Data is resolved by the existing `loadCollections` (cap raised from 12 to 24 slugs, which also applies to Collection grid).
- Testimonials is hidden from the picker through `categories.other.visible = false` (Puck otherwise lists it under "Other").
- `registry.test.ts` block count corrected (it was stale after Floating reviews).

## Decisions and trade-offs
- The built-in Testimonials block is retired, not deleted: the default templates (`launch-template.ts`) now use Floating reviews, and Testimonials is hidden from the picker (`RETIRED_FROM_PICKER`). Its schema and view stay so saved pages and published themes that contain it keep validating and rendering (`validateBlockDocument` rejects unknown types). Deleting it needs a data migration first (AGENTS.md rule 10).
- No new table or migration: the widget reads the existing `reviews` rows, so moderation (hold/publish) controls what shows.
- The list is rendered twice per lane (second copy `aria-hidden`) for a seamless CSS loop; no JavaScript.
- Clicking a card opens a pop-up with the full review and a product link, with no script: each review has a hidden checkbox, the card is its `<label>`, and the overlay shows while it is ticked (the track also pauses). Trade-offs: no Escape-to-close; keyboard users cannot open it.
- Verified buyers show only a small green tick next to the name. Up to two buttons under the description show only when their link is filled in; "Text position" (top, middle, bottom, split) sets where the heading block sits.
- Phones (<=520px) show one lane (every other review) to keep cards readable.

## Verification
- Ran: `pnpm --filter @bs/blocks|block-editor|domain|web typecheck` pass; `@bs/blocks` tests (new `reviews-marquee.test.tsx`, 5 tests) and `@bs/block-editor` tests pass; `pnpm test:heavy:local` 2304 pass, 1 worker crash (native exit 3221226505) in the unrelated `abandoned-checkouts.int.test.ts`; the new real-DB case in `reviews.int.test.ts` passes.
- Exercised by hand (second round): opening and closing the pop-up and the paused animation checked through the editor preview's DOM; the green tick shows beside the name. Mouse clicks in the editor only select the block, so a real click on a card was not tried.
- Exercised by hand: dragged the widget onto the home page in the Super Admin theme editor (local); it rendered with sample reviews, heading right, panel sections present.
- NOT verified: the Collection showcase's picker against a real store's collections and the real-database path (only type-checked and render-tested; the data function is shared with Collection grid); the movement and hover-pause visually, a live storefront with real reviews, the Product showcase image change in a browser, full `pnpm build`; `pnpm lint` (blocks, block-editor, domain) and `pnpm docs:check` pass.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (block list)
- [x] ADR: not needed (new block on the existing pattern)
- [x] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md`: not needed

## Follow-ups and open questions
- Owner may want per-product or per-category filtering of the reviews shown.

## Definition of done
Gate partly run (see Verification); no secrets or generated files in the diff.
