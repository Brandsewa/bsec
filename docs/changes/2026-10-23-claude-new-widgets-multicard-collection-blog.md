# New widgets: Multi card, Collection products, Blog slider; flat slider dots

- **Date:** 2026-10-23
- **Agent:** claude
- **Branch:** `feat/widgets-multicard-collgrid-blog`  (PR to main; PR 107 is already merged)
- **Area:** blocks, block-editor, domain (block data), web
- **Type:** feature
- **Supersedes:** none

## Summary
Owner request "New Widget and Updates". Adds three widgets (Multi card, Collection products, Blog slider) and changes the slider pagination to flat rounded lines that show on phones only.

## What changed
1. **Multi card** (`MultiCard`): section background colour, margin, padding, radius and width; 1 to 4 cards per row on desktop, grid or slider on tablet and phone; each card has icon or picture, heading, text, link (each can be switched off), spacing between elements and between cards, padding, border width and colour, radius, background and text colour, optional background picture with darkening, vertical alignment (top, middle, bottom) with a minimum height.
2. **Collection products** (`CollectionProducts`, collection page): the product grid with sort and filters and the same card options as "Collection page", without the built-in heading and descriptions (each can be switched on), plus a section box, width and background. Recommended values are in the field labels and the defaults.
3. **Slider dots** (hero slider, product showcase and so the product page's related products, Multi card, Blog slider): flat small rounded lines, the current one stretches; hidden from 768px up because arrows take over, unless "show dots on desktop and tablet too" is on (`dotsDesktop`). Arrows were already off on phones by default.
4. **Blog slider** (`BlogShowcase`): copy of Recent posts with the store's slider navigation; cards per row for desktop, tablet and phone; phone layout slider, grid or list with or without a small thumbnail.
- Files: `packages/blocks/src/views-multi-card.tsx`, `views-blog.tsx`, `views.tsx`, `registry.ts`, `types.ts`, `blocks.css`; `packages/block-editor/src/config.tsx`; `packages/domain/src/themes/block-data.ts`; `apps/web/src/components/catalog/CollectionListingSection.tsx`, `app/collections/[slug]/page.tsx`, `server/cached-storefront.ts`.
- No migration, no env var, no new dependency, no new client script (the sliders reuse `ProductShowcaseClient`).

## Decisions and trade-offs
- "Collect Grid" was read as the collection page's product grid (owner confirmed), not the grid of collection cards.
- The three dot styles are now one look, so the style picker is gone; saved values stay valid.
- Slider widgets reuse the product showcase's behaviour instead of adding a script, so they cost no extra JavaScript.
- Recommended settings are the defaults plus "(recommended N)" in labels; there is no one-click preset button, to keep the editor light.

## Verification
- Ran: `pnpm typecheck`, `pnpm lint`, `pnpm docs:check`, block unit tests (new `new-widgets.test.tsx`, registry count), see the gate result in the PR.
- Exercised by hand: rendered the three widgets with the real block CSS as a static page and looked at desktop and a 375 px phone: grids, dark tone, phone list, and phone slider track measured in the browser pane.
- NOT verified: the full store admin and storefront with a database (Docker would not start), so the editor panels, drag and drop, and the live slider behaviour (arrows, page lines, autoplay) were not driven; the static page has no script.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (new widgets section)
- [x] ADR: not needed
- [x] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md` (in flight)

## Follow-ups and open questions
- Test the three widgets in the theme editor and a live store at 375 px and desktop before relying on them.
- "Also update related product widget": it is the Product showcase with the "related" source, so it picked up the dots change; nothing else was needed.

## Definition of done
- [x] No secrets, generated files or unrelated edits; no raw HTML or merchant code (rule 8).
- [ ] Heavy real-database tests: unaffected by this change, run in CI.
