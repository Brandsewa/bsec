# Multi-Market WP-6: Market-aware SEO, sitemap, canonicals and structured data

- **Date:** 2026-10-28
- **Agent:** antigravity
- **Branch:** `feat/multimarket-wp6` (merged in #150, a23f5a7)
- **Area:** domain, web
- **Type:** feature
- **Supersedes:** none

## Summary
Made the storefront SEO endpoints, metadata, structured data and sitemap generation fully market-aware according to WP-6 of the multi-market specification. The sitemap now queries products, collections and categories under each active non-base market's scope via `withMarketScope`, emitting prefixed URLs (e.g. `/us/...`) only for items the market actually sells. Product structured data (JSON-LD) now reflects the market currency, and canonical URLs on product, collection, and category pages include the market path prefix without duplication.

## What changed
- `packages/domain/src/storefront/seo.ts`:
  - `getStorefrontSitemapUrls`: Loads active markets (`loadStorefrontMarkets`); for each active non-base market with a path prefix, scopes catalog queries with `withMarketScope(db, { tenantId, marketId })` and emits market home (`/us`), product (`/us/products/[slug]`), collection (`/us/collections/[slug]`), and category (`/us/categories/[slug]`) URLs. Never exposes draft/disabled markets.
  - `buildProductSeoMetadata`, `buildCollectionSeoMetadata`, `buildCategorySeoMetadata`: Support optional `prefix` parameter; canonical URLs cleanly include the market prefix (`https://${cleanHost}${prefix}/...`).
  - `generateProductJsonLd`: Accepts optional `currency` parameter (defaults to `"INR"`), setting `priceCurrency` on variant offers to the active market's currency.
- `apps/web/src/app/products/[slug]/page.tsx`:
  - `generateMetadata`: Resolves market context via `getMarketContext(access.tenantId)` and passes `prefix` to `buildProductSeoMetadata`.
  - `ProductDetailPage`: Passes `marketCtx.currency` to `generateProductJsonLd`.
- `apps/web/src/app/collections/[slug]/page.tsx`:
  - `generateMetadata`: Resolves market context and passes `prefix` to `buildCollectionSeoMetadata`.
- `apps/web/src/app/categories/[slug]/page.tsx`:
  - `generateMetadata`: Resolves market context and passes `prefix` to `buildCategorySeoMetadata`.
- `apps/web/src/app/layout.tsx`:
  - Verified hreflang links emission: already outputs alternate links with full URL (including path prefix) per market and self-referencing `x-default` pointing to the base URL.
- `apps/web/src/app/robots.txt/route.ts`:
  - Verified robots behavior: unaffected, stores in `noindex` or blocked status modes remain disallowing crawling across all markets.

## Acceptance Criteria Checklist (WP-6)
- [x] Output validated for an INR + USD store (real-DB test in `packages/domain/test/markets-storefront.int.test.ts` and unit tests in `packages/domain/test/storefront-seo.test.ts`).
- [x] Canonical for a prefixed page points to the prefixed URL (`/us/...`).
- [x] Base page canonical points to the unprefixed URL; no duplicate canonical tags.
- [x] Product structured data (JSON-LD) uses the market's price and `priceCurrency`.
- [x] Product hidden in the USD market is absent from `/us` sitemap URLs, but present in base URLs.
- [x] Only active markets with prefixes are listed in the sitemap; draft or disabled markets are never exposed.
- [x] `x-default` in hreflang alternate tags points to the base URL.
- [x] `robots.txt` unaffected; noindex stores stay noindex in every market.

## Verification
- `pnpm typecheck`: 15 of 15 packages successful (clean cache miss execution for `@bs/domain` and `@bs/web`).
- `pnpm lint`: All 15 packages passed (0 errors; warnings only in pre-existing files).
- `pnpm docs:check`: Passed (`docs:check ok`).
- `pnpm --filter @bs/domain vitest run test/storefront-seo.test.ts`: 33 passed (33 tests).
- `pnpm --filter @bs/domain test:heavy test/markets-storefront.int.test.ts` (against real Postgres): 8 passed (8 tests).
- `pnpm --filter @bs/web vitest run test/seo-endpoints.test.ts`: 6 passed (6 tests).
- `pnpm --filter @bs/web vitest run test/product-page.test.ts`: 8 passed (8 tests).
- NOT verified: Live e2e browser runs with real domain traffic (requires deployment/running stack, deferred to WP-7 test round).

## Docs to update (for WP-8 / Claude post-merge)
- `docs/ARCHITECTURE.md`: Note in section 7/11 that `getStorefrontSitemapUrls` is market-scoped and emits market-prefixed URLs for active markets.
- `progress.md`: Mark WP-6 completed in multi-market tracking table.
- `docs/MULTIMARKET-HANDOFF.md`: Update WP-6 status in Section 1.

## Follow-ups and open questions
- None for WP-6. All requirements and acceptance criteria have been verified with real database integration tests.

## Definition of done
- [x] Code follows rules and conventions from `AGENTS.md`.
- [x] Tests added and verified (real-DB integration test for market-scoped sitemaps and unit tests for canonical / JSON-LD).
- [x] Docs to update listed above (per wave rules, docs are updated by WP-8 / Claude).
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Local commit only on branch `feat/multimarket-wp6`.
