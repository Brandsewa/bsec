# Tabs widget, and the product page reviews can be moved

- **Date:** 2026-11-24
- **Agent:** claude
- **Branch:** `feat/tabs-widget-review-position`  (not merged yet)
- **Area:** blocks, block-editor, web
- **Type:** feature
- **Supersedes:** none

## Summary
Two requests from the owner. (1) A Tabs widget with full control of the titles and body, rich-text content, and an option that turns the tabs into an accordion on phones (or keeps tabs whose title row scrolls sideways). (2) On the product page the reviews always appeared in one fixed place and could not be moved below other sections.

## What changed
- **New block `TabsSection` ("Tabs", category BCOM, version 1).** Settings are grouped: Tabs (title, optional icon, markdown content per tab, up to 12), Heading and section, Layout (titles above or beside the content, row alignment or stretch, space between titles and content, tab open first), Tab titles look (simple, underline or cards with a corner radius; text size and weight, padding, spacing, icon position and size), Tab titles colours, Content area (padding, text size and alignment, background, text colour, border, corner radius), On phones (accordion or tabs; accordion: one open at a time, first row open, arrow or plus icon). Files: `packages/blocks/src/views-tabs.tsx`, `views-tabs-client.tsx`, `registry.ts` (`TabsSectionSchema`), CSS `.bsb-tb-*` in `blocks.css`, editor spec in `packages/block-editor/src/config.tsx`, wrap-on-drop list.
- **One copy of each body.** The titles sit in a tablist and every panel also carries an accordion header that only shows in accordion mode. The server renders the first state; `TabsBehavior` flips `data-current` and `data-open` on click and handles arrow keys, Home and End. No React state, so no hydration mismatch (same pattern as `ShowcaseTabsPreview`).
- **Movable reviews.** The theme's `Reviews` block now draws the real reviews where it sits (`ctx.renderProductReviews`, supplied by `apps/web/src/app/products/[slug]/page.tsx`), also inside a Section or Container. It is offered in the block picker on the product page only (`hiddenFromPicker`), has no settings (it was a heading placeholder before) and is labelled "Product reviews". A theme without that block keeps the old behaviour: reviews after the last block that holds the product details.
- **Bug fixed on the way:** the old placement looked for the product blocks at the top level only. When they sat inside a Section > Container the reviews were drawn above the product ("right at the top, before the product details"). The search now looks inside each top-level block.

## Decisions and trade-offs
- Tab bodies use the same markdown as the Text block (bold, italic, links, lists, line breaks) and the same sanitiser, so no raw HTML is possible (ADR-010).
- Existing themes that still contain the old "Reviews" placeholder on the product page will now show the live reviews at that block's position instead of ignoring it.
- Not added to the website's generic block set (`WEBSITE_GENERIC_BLOCK_TYPES`): the website uses its own stylesheet and was not asked for.

## Verification
- Ran: `pnpm --filter @bs/blocks exec vitest run` 303 pass (new `tabs-section.test.tsx`: schema, markup, accordion and default-tab state, sanitising, reviews placement; registry count 48 to 49); `pnpm --filter @bs/block-editor exec vitest run` 41 pass (picker rule for Reviews); typecheck and lint pass.
- Looked at: the generated markup and `blocks.css` in the browser pane as a static page (no editor, no database; Docker was not running), at desktop and 375 px. Desktop: underline and cards titles, vertical titles with a tinted body. Phone: the accordion (one open at a time), the scrolling card tab row (no stacking, no page overflow). The click behaviour on that page was a copy of `TabsBehavior`, not the real component.
- NOT verified: the editor panels, the real `TabsBehavior` (keyboard and click) in the storefront, and the product page with a Reviews block. `pnpm build` and the heavy tests were not run.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (block list, product page reviews)
- [ ] ADR: not needed (no new decision beyond ADR-009 versioning, version 1)
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md` (in flight)

## Follow-ups and open questions
- Add a Tabs preset or a default product page that includes a Reviews block, if the owner wants new stores to start with a visible placeholder.
- The editor's markdown field gets Bold/Italic toggling and a live preview in PR #320; the Tabs content field uses it once both are merged.

## Definition of done
Gate partly run (see Verification). No secrets or generated files in the diff.
