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

## Header and footer menus, builder frame and preview (follow-up)
- The theme builder and the store's page editor now draw the theme's header and footer around the page being edited (`BlockEditor` `frame` prop, `FrameContext`, `FrameBlocks` in `config.tsx`), read-only; the header and footer pages themselves are edited as before. In the store editor the frame is resolved through `admin.pages.blockData`, so the store's own menus show.
- The Modern Commerce template's footer columns now point at the store menus `footer` and `footer-help`, and its header at `header` (fallback links stay for stores without those menus). The Modern home swaps the static Testimonials for Floating reviews. The shared launch template (`launch-template.ts`) is unchanged because migration 0015 must match it (`themes.int.test.ts`); my earlier commit had changed it and broke that test, now restored.
- Preview: the toolbar button already existed in Super Admin; locally it pointed at `https://localhost` and `/preview/<code>` was not served on `localhost`. `apps/web/src/middleware.ts` now serves `/preview/` on `localhost`, and the dev setup needs `PREVIEW_BASE_URL=http://localhost:3000`. The store admin editor gets a Preview button that saves the draft and opens the storefront (`<slug>.localhost:3000` in dev). If the browser blocks the pre-opened tab, the editor now says where the preview is.
- Local seed (not committed): header, footer and footer-help menus in the demo store, a `demo-store.localhost` domain and live status.
- Not verified: a real mouse click on Preview in a normal browser (the embedded pane cannot open new windows; I checked the link creation, the preview page and the store editor's `window.open` target).

## Header and Footer tabs, layouts and the theme preview dialog (follow-up 2)
- The editor's left rail gets **Header** and **Footer** tabs (`HeaderFooterPanels.tsx`, `BlockEditor` `onFrameChange`): they edit the theme's `SiteHeader` / `SiteFooter` block props from any page. Header: five layouts (logo left with menu beside it, menu centred, logo centred, logo right, stacked), menu choice, logo image or text, search / account / cart icons, sticky, background. Footer: three layouts (columns, centred, compact), logo or brand name, about text, up to four link columns each tied to a menu from Online Store > Navigation, mobile accordion switch, newsletter, copyright, background. Super Admin keeps the edits in the theme draft; the store editor saves them as drafts of the header and footer pages with Save draft and publishes them with Publish.
- Schema (additive, defaults keep old documents valid): `SiteHeader.layout` gains `navCenter`, `logoCenter`, `logoRight`; `showAccount`. `SiteFooter` gains `layout`, `logoText`, `logoMediaId`, `mobileAccordion`. On phones each footer column folds into an accordion (a second copy of the links in the markup, swapped by CSS), so long menus do not stretch the page.
- Store admin > Themes > Preview: the dialog is 80% of the screen and the Home / Collection / Product and Desktop / Mobile tabs now show their selected state (they were indistinguishable).
- The "Men collection is narrower than New Arrivals" report could not be reproduced: both pages render the same `max-w-7xl` container in the demo store. Left unchanged; if it comes back, note the URL and whether the store's collection template page exists.

## Fixes and features after live testing (follow-up 3)
- **MP4 upload rejected:** the magic-byte check only accepted files whose first box is `ftyp`; many encoders and screen recorders start with `free`, `skip`, `wide`, `moov` or `mdat`. `packages/domain/src/media/types.ts` now accepts those (test in `media-types.test.ts`). The 10 MB per-video plan limit (`media_video_mb`) is unchanged: a bigger video still fails with "Videos can be up to 10 MB on your plan" (owner decision to raise it).
- **Hero slider banner images missing on the live site:** `.bsb-lay` had `width: var(--w)` with auto side margins; in the storefront's flex-column block list that shrank the slider to 0px wide (all slides are absolutely placed), so the image existed but was invisible. Now `width: var(--w, 100%)` (`layout-css.test.ts`). Local dev also needs `MEDIA_PUBLIC_URL` for any image to resolve.
- **Product page (storefront):** "Write a review" opens a pop-up (Escape, click outside, focus return); reviews are cards, two rows of three, then "Show more reviews" opens a right-hand drawer with every review and "Load more" (`ProductReviewsSection.tsx`).
- **Product admin:** custom fields are collapsible rows (required and empty ones open); Stock & Inventory and Shipping moved to the right column with Taxes & GST on the edit page, Shipping on the new-product page.
- **Logo size per device** (`logoSize` on `SiteHeader` and `SiteFooter`, width and height in px for desktop, tablet and mobile; smaller screens inherit) in the Header/Footer tabs and the block fields.
- **General tab** in the editor's left rail with an **Announcement bar** accordion: on/off (hides the Banner block), up to six messages that rotate in CSS (interval, pause on hover, reduced motion shows the first), alignment, background and text colour, font, weight and size. The `Banner` block gained `messages`, `rotate`, `interval`, `align`, `bgColor`, `textColor`, `fontSize`, `fontWeight`, `font` (all with defaults).
- Dev note: after changing a block schema, restart the web dev server; it kept the old schema and silently dropped the new `messages` prop on save.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (block list)
- [x] ADR: not needed (new block on the existing pattern)
- [x] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md`: not needed

## Follow-ups and open questions
- Owner may want per-product or per-category filtering of the reviews shown.

## Definition of done
Gate partly run (see Verification); no secrets or generated files in the diff.
