# Owner batch: storefront and admin polish (13 items)

- **Date:** 2026-10-29
- **Agent:** claude
- **Branch:** `feat/storefront-batch-updates` (not merged yet)
- **Area:** blocks, web, admin, domain, contracts, block-editor, ui
- **Type:** fix
- **Supersedes:** none

## Summary
The owner sent thirteen small fixes in one session. They are built together on one branch: a Multi card save error, blog archive header layout, nested menu visibility, blog tab counters, hex colour typing, shared header and link styling, a mobile table of contents bar, removal of the product tabs block, an empty hero slide gap and the empty cart button.

## What changed
1. **Multi card save error.** The card text limit was 400 characters (`packages/blocks/src/registry.ts`, now 1000). The real bug: a failed block validation threw `Validation failed: ...` without the `Bad Request:` prefix, so the API mapped it to a 500 "Internal server error". It now returns a 400 with the field path (`packages/domain/src/content-services.ts`).
2. **Blog archive header.** Title and description, then the category chips below, stacked at every width (`blocks.css`, `.bsb-head-row-filters`). Applies to every blog and category archive.
3. **Nested menu dropdowns.** The storefront renders dropdowns correctly; items linking to an unpublished page are left out on purpose (dead-target rule in `themes/block-data.ts`), and so is everything under them. The menu editor now shows a "Not shown on store" badge on those rows (`menus_.$handle.tsx`). Not reproduced against the owner's live data: this is the cause the code shows, to be confirmed by publishing the pages.
4. **Blog tab counters.** `listBlogPosts` returns `counts` per status (contract `blog.ts`), `ScrollTabs` takes an optional `count`, shown as a small badge. Counts follow the search and category filters, never the open tab.
5. **Colour fields.** New `HexInput` keeps a local draft and only commits a complete `#rgb` or `#rrggbb`; before, every keystroke was committed and the half-typed value was rejected, so the field looked read-only. Used in the theme colour rows and both colour popover inputs.
6. **Transparent backgrounds.** `bsb-tone-default`, collection card media, product card media, `.bsb-card` and bordered showcase cards no longer paint a fixed colour. Blocks with their own background setting are unchanged.
7. **Blog table of contents.** H2 only, in both post layouts. On phones it is open in the post, and a bar sticks above the bottom navigation once it scrolls out of view (`PostMobileToc.tsx`, `--bottom-nav-h`).
8. **Slider dots.** Smaller, thinner, low contrast, theme text colour for "dark" (`.bsb-hs-dotbtn`).
9. **Section header.** 60% title and description, 40% link (right-aligned), stacked under 640px; link has no underline (`.bsb-section-head`, `.bsb-link`, `.bsb-mc-link`).
10. **Links.** No hover underline anywhere in the storefront and shared UI; hover mutes the text (`opacity: 0.7`). Links inside post body text keep their resting underline.
11. **Product tabs removed.** The `ProductInfoTabs` block (schema, view, registration, editor config, default template, web component, tests) is gone. `validateBlockDocument` drops saved copies silently (`REMOVED_BLOCK_TYPES`), so no stored page breaks. The product block's own description (`showDescription`) stays.
12. **Hero slider.** A slide with no title, text or button renders no text panel, so no blank block under the media on phones.
13. **Empty cart.** Button reads "Browse categories" and goes to `/categories` (`MiniCartDrawer.tsx`).

## Decisions and trade-offs
- Item 1: raised the limit rather than only fixing the status code; both were wrong.
- Item 11: removed the block type for good instead of hiding it, and dropped legacy copies in the validator, so nothing keeps rendering or fails to save.
- Item 10: also changed `packages/ui` link variants (shared with the admin); the admin's own `hover:underline` classes were left alone.

## Verification
- Ran: `pnpm typecheck` pass (15/15), `pnpm lint` pass, `pnpm build` pass, `pnpm docs:check` ok.
- Ran: `@bs/blocks` 264 pass, `@bs/web` 238 pass (includes the production bundle budget tests after `pnpm build`), `@bs/domain test:fast` 489 pass, `@bs/block-editor` 26 pass, `@bs/ui` 45 pass.
- Ran with a real database: `blog.int.test.ts` 22 pass (new counts test), `themes.int.test.ts` and `commerce-templates.test.ts` 31 pass.
- NOT verified: nothing was looked at in a browser (no dev server run), so the CSS changes (items 2, 6, 7, 8, 9, 10, 12) and the sticky bar are checked by reading and by the bundle budgets only. Item 3's cause is from the code, not from the owner's store data. Full `test:heavy`, the platform suites and e2e were not run; e2e selectors for "Browse collections" were not searched beyond a grep of `apps/web`.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (block list, product page section, last verified)
- [x] ADR: not needed (no architectural decision)
- [x] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md`: in-flight line added

## Follow-ups and open questions
- Owner to confirm: should body-text links in posts keep their resting underline (kept for now)?
- Owner to confirm: the blog archive wants everything stacked at every width (built that way); the first message mentioned a two-column desktop header.
- Check on the live store that the pages used in the header menu are published.
- Dots tap target and contrast should be looked at on a phone.

## Definition of done
Gate (typecheck, lint, build, docs:check) passes; tests added for counts and the retired block; docs updated; no secrets or generated files in the diff.
