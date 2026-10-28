# Blog templates in the editor, archive and post layout, docked cart

- **Date:** 2026-10-28
- **Agent:** claude
- **Branch:** `feat/blog-templates-cart-dock` (merged in #147, fdfe825)
- **Area:** blocks, block-editor, domain, contracts, web, admin
- **Type:** feature
- **Supersedes:** none

## Summary
Follow-up to the owner fix batch (#145). The blog archive and blog post layouts are now always reachable from the theme editor's page list, the archive and category headers are two-column, the post sidebar shows related posts, a subscribe box and a vertical category list, blog text follows the theme font sizes, bullet lists are tighter, the subscribe form no longer opens a new tab, and on desktop the cart is docked on the right edge instead of sitting in the header.

## What changed
- **Editor page list:** "Blog archive template" and "Blog post template" always appear. A store with no such page (its theme predates them, like the dev demo store) gets one created on first open: new `admin.pages.ensureTemplate` (contract, handler, `ensureThemeTemplatePage` in `content-services.ts`). The page is a draft holding the built-in layout and is audited as `page.template_created`; the storefront is unchanged until it is published.
- **Blog archive header:** title and description on the left, subscribe form on the right (desktop; stacked below 1024px). New `BlogListing` props `subscribeTitle`, `subscribeText`, editable in the template settings.
- **Category pages:** title and description left, the category filters on the right in one row on desktop (scrolls sideways if long); tablet and phone unchanged.
- **Post sidebar:** removed the "Blog / All posts" card (`showAboutCard` and `showFeatured` now default to off); added vertical related posts (the bottom related grid shows only when there is no sidebar), a subscribe box with its own title, text, placeholder and button (new `BlogPostContent` props `showSubscribe`, `subscribeTitle`, `subscribeText`, `subscribePlaceholder`, `subscribeLabel`), and categories as a vertical list.
- **Fonts:** blog sections and post body use the theme's heading and body sizes per device (`--f-h1..h4`, `--f-body`, derived from `--bs-h*-m/t/d` and `--bs-body-*`), not fixed sizes.
- **Bullets:** list items sit closer together in blog posts and rich text (item paragraph margin removed, gap 0.125rem); other spacing is unchanged.
- **Subscribe forms:** one shared `NewsletterForm` (packages/blocks) is used by the footer, the Newsletter block (its button used to go nowhere), the blog archive and the blog post. A small inline script in `app/layout.tsx` (`newsletterScript`, a delegated submit listener; inline so it adds nothing to the JS bundle) sends it in the background and shows the reply under the form instead of opening the raw JSON. Without JavaScript it still posts normally. The fallback `StoreFooter` and status-screen forms get the same behaviour from the script.
- **Review drawer:** cards no longer stretch to the full drawer height (the grid's `h-full` was applied inside the scroll area). New sort control (Latest, Oldest, Highest rated, Lowest rated) and star filter (All, 5 to 1 stars) at the top. Both are applied by `getStorefrontReviews` in the database (new `sort` and `rating` query params, new `matching` count in the reply, ties broken by id) so "Load more" pages keep one order. The drawer moved to its own lazily loaded files (`ReviewsDrawer.tsx`, `ReviewsDrawerLazy.tsx`, shared bits in `reviews-shared.tsx`) so it adds nothing to the product page's JS.
- **Product listing on phones:** Filter and Sort are one row fixed at the bottom of the screen just above the mobile navigation (`FacetedFilters.tsx`); the top row keeps only the product count and the grid/list switch. Tablet keeps the Filters button at the top. Both sheets are at least 50% of the screen height and sit over the navigation (z-70). New sort choices for collections and categories: Best selling (units sold in non-cancelled orders) and Highest rated (average, then review count), done in `catalog.ts` (`popularityOrder`, `ratingOrder`) with `sort=popularity|rating` in the address.
- **Product card rows** (`catalog/ProductCard.tsx`, collection and category listings, all screen sizes): row 1 is reviews on the left and the category on the right (either one alone keeps its side), row 2 the title, row 3 the price. The rating moved up from under the title. The home-page product blocks in `packages/blocks` have their own cards and were not changed.
- **Docked cart:** from 1024px the cart is a fixed tab on the right edge (icon, "Cart", count) that opens the cart drawer; the header drops its cart there. Tablet and phone keep the header or bottom-bar cart.

## Decisions and trade-offs
- Reused the existing theme-page mechanism instead of a new table or migration: no schema change.
- Existing stores that saved the sidebar settings keep their saved values; only stores relying on defaults lose the about card and featured list.
- The docked cart is also shown on the cart and checkout pages (hiding it by path cost bundle size; the product page JS budget is now 50.0 KB of 50, with almost no headroom).
- `ensureTemplate` supports `blog` and `blog-post` only. The collection archive and cart templates have the same gap but were not asked for.

## Verification
- Ran: `pnpm typecheck` (15 of 15), `pnpm lint` (0 errors), `pnpm docs:check`, `test:fast` for blocks (261), block-editor (26), web (234); `storefront-isolation.int.test.ts` (18 pass, including rating and popularity sorting), `reviews.int.test.ts` (12 pass, including the new sort, star filter and paging test), `themes.int.test.ts` blog template tests against real Postgres (2 pass, including the new ensure test: created once, draft until published, audited, needs `content.write`); `isolation.int.test.ts` 1600 pass (new procedure mapped); production build plus `perf-budget-bundle.int.test.ts` pass.
- Exercised by hand (local `demo-store`, browser pane, DOM checks): archive header layout, in-place subscribe message, category header (one row, 60px h1 from the theme), post sidebar sections, dock restyle and drawer open.
- NOT verified: best selling ordering with real sales (the test has no orders; only that it runs and ties fall back to newest), the filter sheet and sort sheet on a real phone; the admin page switcher creating a template (admin login is in `.env.dev`, unreadable to agents; covered by the real-database test only); the editor settings panels for the new props; bullet lists on a post that has them (demo posts have none); tablet width.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (section 10, last verified line)
- [x] ADR: not needed
