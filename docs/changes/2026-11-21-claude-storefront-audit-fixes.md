# Storefront audit fixes (phase 1 and most of phase 2)

- **Date:** 2026-11-21
- **Agent:** claude
- **Branch:** `fix/storefront-audit-fixes` (not merged yet)
- **Area:** web, domain, blocks, block-editor, docs
- **Type:** fix
- **Supersedes:** none (builds the plan in `docs/changes/2026-11-21-claude-storefront-audit-fixes-plan.md`)

## Summary
Fixes the platform-caused defects found by three external quality audits of live stores: breadcrumbs and starter links that led to 404s, a free-shipping banner that disagreed with the cart, product pages with no description, products with no `brand` in structured data, a staging host in a banner link, and empty alt text on thumbnails. Plan: `docs/STOREFRONT-AUDIT-FIXES-PLAN.md` (section 9 lists every difference from the plan).

## What changed
- `/products/all` shows every product with the collection page's filters, sort, Load more and market scope (built-in listing `getStorefrontAllProducts`, page `apps/web/src/app/products/all/`; canonical and sitemap entry at `/products/all`).
- `/collections/all` shows the list of collections and `/categories/all` the list of categories; `/products` goes to `/products/all`; Shopify `/blogs/<blog>/<post>` goes to `/blog/<post>`. All are single 308s in `apps/web/src/middleware.ts` (`lib/legacy-paths.ts`), inside the market prefix.
- Starter templates, block defaults, the brand-menu link and the demo store point at `/products/all`; the product breadcrumb "Products" links there.
- Announcement bar token `{{free_shipping_threshold}}` (starter templates, block default, editor default); the amount comes from the store's shipping rates through `resolveBlockData`; the message is dropped if there is no threshold. Feature rows no longer quote a fixed amount.
- Store block links (`storeHrefSchema`): own `<store>.bcom.si` links become relative; a URL pasted after a path prefix keeps only the URL. Applies when old content is rendered too, so no data migration.
- Meta description: `deriveMetaDescription` (an empty string no longer wins, HTML stripped, 155 cap) for products, categories, collections; the JSON-LD description is cleaned the same way.
- Product JSON-LD `brand` falls back to the store name.
- Alt text on the card hover image, gallery thumbnails, viewer thumbnails.
- "Write a Review" is no longer `disabled` in server HTML.
- No migration, no env var, no new queue.

## Decisions and trade-offs
- `/products` is a middleware redirect, not a page: under Cache Components a redirect inside a page became a meta refresh (seen on the local store), which is not a real redirect for crawlers.
- Owner decision: `/collections/all` and `/categories/all` mean "the list of", `/products/all` means all products. Stored content that still links to `/collections/all` now lands on the collections list.
- A product with the slug `all` is shadowed by `/products/all` (not guarded yet).
- Not done (plan section 9): thin page, blog and policy descriptions, banner chevron (not reproduced), menu link tidy, redirect manager, www guidance, new SEO health checks; Cloudflare and mojibake items need owner decisions.

## Verification
- Ran: `pnpm typecheck` pass; `pnpm lint` 0 errors (7 warnings, one of them new: `window.location` in `ProductReviewsSection.tsx`); `pnpm docs:check` ok; `pnpm --filter @bs/web build` ok; `@bs/web` tests 304 pass (includes the real-build JS budget test); `@bs/blocks` 296 pass; `@bs/block-editor` 40 pass; `@bs/domain test:fast` 803 pass (run before the last test additions; the new file passes on its own).
- Real database (shared test Postgres on 55432, serial): `markets-storefront.int.test.ts` 14 pass (new: all-products listing, price filter, market scope, sitemap, banner token data); `blog`, `themes`, `storefront-isolation`, `reviews` int tests 80 pass.
- Exercised by hand on the local seeded `demo-store` (desktop only): `/products/all` renders 21 products with filters and, with `?price=100000-500000&sort=price_asc`, 10 products with the slider and Category facets; canonical is `/products/all`; `/products`, `/collections/all`, `/categories/all` and `/blogs/x/y` return 308 to the right place; `/collections` and `/categories` return 200; the product page HTML has the breadcrumb to `/collections/all`, an enabled review button, brand "Demo Store" in JSON-LD, and a meta description.
- NOT verified: the full heavy suite (all domain int tests), e2e, any live store, 375 px layout, the banner token end to end inside a theme (unit and data tests only).

## Docs updated
- [x] `docs/ARCHITECTURE.md` (storefront routes, blocks paragraph, last verified)
- [x] ADR: not needed (the redirect manager will need one)
- [x] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md` (in-flight line)

## Follow-ups and open questions
Phases 3 and 4 of the plan; owner decisions in plan section 5 (redirect manager, Cloudflare email obfuscation, data repair for mojibake).

## Definition of done
Gate partly run (see Verification); no secrets or generated files in the diff (`.env.dev` was copied into the worktree and is gitignored).
