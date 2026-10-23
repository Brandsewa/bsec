# Sprint: theme sizes and colours, footer socials, search popup, descriptions, login-only reviews

- **Date:** 2026-10-23
- **Agent:** claude
- **Branch:** `feat/sprint-storefront-theme-fixes`  (not merged yet)
- **Area:** blocks, block-editor, web, admin, domain, contracts, db
- **Type:** feature
- **Supersedes:** none

## Summary
The owner's 16-item sprint list (screenshots from the live store `tasteofhills`). Theme settings gain body text sizes and a dark background with its own text colour; the footer gains social icons; desktop and tablet search opens the popup; custom pages stop printing their title; the FAQ accordion gets icon size and row height and keeps its heading on top on phones; the category label moves under the product image; categories and collections get a short description plus a rich long description shown below the products; reviews need a signed-in shopper; and publishing a policy now publishes what is in the editor.

## What changed
1. **Body text sizes** (`packages/blocks/src/theme-vars.ts`, `blocks.css`, `ThemeSettings.tsx`): `fontSizes.body` per device (12 to 24 px) in the same grid as the heading sizes; `--bs-body-d/-t/-m` applied to `.bsb`. Reset restores both.
2. **Footer social icons** (`registry.ts` `SiteFooterSchema`, `views.tsx` `FooterSocials`, `HeaderFooterPanels.tsx`, `config.tsx`): up to 8 links (Instagram, Facebook, X, YouTube, LinkedIn, WhatsApp, Email, Website), style (plain, filled, outlined), colour (text, brand) and size. Links use the existing safe-href rule; a link with only `https://` draws nothing. The footer panel's groups are now accordions (Brand open by default).
3. **Search popup on desktop and tablet** (`SearchModal.tsx`): the click listener now runs in the capture phase. Cause: the header icon is a `next/link` on desktop, whose handler calls `preventDefault` first, so the listener (which skips defaulted clicks) never opened the popup. The phone bottom bar used an event and was unaffected.
4. **Custom page title** (`apps/web/src/app/pages/[...path]/page.tsx`): the visible title is gone; an `sr-only` `<h1>` keeps the page heading for screen readers and search engines.
5. **FAQ accordion** (`views-faq.tsx`, `blocks.css`, `registry.ts`, `config.tsx`): heading first in the markup so it is on top on phones (desktop side still chosen by CSS order); new `iconSize` (10 to 48 px) and `rowPadding` (4 to 48 px, the row height).
6. **Category label** (`views.tsx` `ShowcaseCard`, `ProductCard.tsx`): the pill over the image is removed; the label is a small line above the product name, switched by the existing "Label above the product name" option (home product showcase) and "Category label above the product name" (collection page).
7. **Dark background and text colours** (`theme-vars.ts`, `ThemeSettings.tsx`, `common.ts`, `blocks.css`): `colors.dark` and `colors.textOnDark` (defaults `#0f172a` and a readable colour), the existing Text is relabelled "Text on light backgrounds". Every block's Background option, and the header and footer's, now offers **Dark background** (`toneSchema` gained `dark`). Presets carry dark colours.
8. **Preview hard refresh** (`BlockEditor.tsx`): Preview opens the page with a fresh `?_pv=<time>` each click.
9. **Policy publish error:** not a setting. Publish snapshots the saved draft, so edits made after the last Save Draft were ignored and the old banner was still checked. The admin now saves the editor first, then publishes (`settings/policies.tsx`).
10. **Reviews** (`review-services.ts`, `contracts/storefront.ts`, `ProductReviewsSection.tsx`, `customer/profile/route.ts`, `account/login`): only a signed-in customer can submit; the email and order number fields and inputs are removed; verified purchase means a delivered order of that customer with the product; a per-customer rate limit replaces the per-email one. Signed-out visitors see **Log in to review**, which goes to `/account/login?next=<product page>` (same-site paths only). New `GET /api/storefront/customer/profile` returns `{ signedIn, name }`.
11 to 12, 16. **Short and long description** (migration `0075`, `catalog.ts` schema, contracts, `catalog-services.ts`, `storefront/catalog.ts`, admin forms, `RichBlocks.tsx`): the plain `description` is labelled Short description and still shows under the title and on cards; the new `description_json` (policy block format, validated by `cleanRichDescription`, empty stored as null) is edited with the policy rich editor and drawn below the product list. Existing descriptions need no migration.
13 and 15. **Width and padding:** the collection and category pages (and their loading states and the categories index) use the same container as the header and blocks (`max-w-[80rem] px-4`, same as `.bsb-w-wide`), on every screen size.
14. **Filter loading:** the skeleton shows as many cards as are on screen, a label line included, and the grid keeps its measured height while a filter is applied.

Extra fix found on the way: the storefront policy page ignored bold, italic and link marks; it now uses the shared `RichBlocks`.

## Decisions and trade-offs
- Long description reuses the policy block format and editor instead of adding a new editor, so no HTML is stored (rule 8, ADR-010). Headings are limited to H2 and H3, and a paragraph is plain text with marks.
- Existing `description` stays the short description (no data copy), so cards and SEO fallbacks keep working and the migration is expand-only.
- The page title is hidden, not removed, to keep one `<h1>` for accessibility and SEO. If a page's own block also has an H1 there are two; say if the owner wants the hidden title dropped.
- Body size is applied at `.bsb` (block content). Admin and non-block storefront pages keep their own sizes.
- X icon is a plain cross drawn with strokes, not the brand mark (no brand artwork or third-party icon set added).

## Verification
- Ran, in the worktree: `pnpm typecheck` (15/15), `pnpm lint` (0 errors; 4 existing warnings, mine fixed), `pnpm docs:check` ok.
- Fast tests: `@bs/blocks` 219, `@bs/web` 230, `@bs/domain` 460, `@bs/admin` 95, plus contracts, block-editor, db, auth, payments, shipping, config, platform; all pass. New tests: theme-vars (body sizes, dark colours), FAQ (order, icon size, row height), footer socials (render, safety), showcase label placement, `RichBlocks`, `cleanRichDescription`.
- Real-database tests added (`catalog.int.test.ts` long description round trip and tenant isolation; `reviews.int.test.ts` rewritten for login-only reviews): NOT RUN: Docker Desktop was started but its engine never answered, so `pnpm test:heavy:local` could not start Postgres. They type-check but are unrun.
- NOT verified: nothing was driven in a browser. The stack was not running (Docker was down), so the collection page width, skeleton, mobile padding, popup, FAQ and footer visuals are checked by reading the code and rendered markup only. Please eyeball them at 375 px and desktop.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (migration table, "Last verified", sprint notes section)
- [x] ADR: not needed (no architectural change)
- [x] `DEPLOYMENT.md` / RUNBOOK: not needed (no env vars, services or pipeline change)
- [x] `progress.md` (in flight)

## Follow-ups and open questions
- Item 14 said "product category pills" too; I read it as the category label on the cards (now part of the skeleton). If it meant the tab pills in the product showcase, tell me which page.
- Heading in item 12: the short description only shows when the block's "show description" switch is on, as before.
- Old custom-domain or theme documents keep working: `socials` and the body sizes have schema defaults.

## Definition of done
- [x] Code follows rules 1 to 14 (new columns are on existing tenant tables; no new table; domain owns the logic; no raw HTML).
- [x] Gate: typecheck, lint, docs:check, fast tests.
- [ ] Heavy real-database gate: not run (Docker engine unavailable). Run `pnpm test:heavy:local` before merging.
- [x] No secrets, no generated files, no unrelated edits.
