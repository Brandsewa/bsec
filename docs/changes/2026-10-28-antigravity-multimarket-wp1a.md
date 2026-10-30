# Multi-market storefront money formatting (WP-1a)

- **Date:** 2026-10-28
- **Agent:** antigravity
- **Branch:** `feat/multimarket-wp1` (merged in #150, a23f5a7)
- **Area:** web, blocks
- **Type:** feature
- **Supersedes:** none

## Summary
Replaced hardcoded Indian Rupee (`₹`) signs, paisek/rupees calculations, and hardcoded `"en-IN"` locale formatting across storefront client and server components and block rendering contexts with market-aware money helpers (`useMoney()`, `formatMoney`, `currency`, and `locale` context props). A USD market now displays `$` and uses its configured locale (e.g. `en-US`), while INR stores remain visually and behaviourally identical to their previous output.

## What changed
- Replaced hardcoded `₹` and `en-IN` in client storefront components:
  - `apps/web/src/components/cart/CartItemRow.tsx`: Uses `useMoney()` and market `locale` from `useMarket()` for line prices, unit price breakdown, and variant details.
  - `apps/web/src/components/cart/CartView.tsx`: Uses `useMoney()` for subtotal, savings, and `FreeShippingBar` remaining amount.
  - `apps/web/src/components/cart/ShippingEstimator.tsx`: Uses `useMoney()` for shipping rate amounts and free shipping threshold copy.
  - `apps/web/src/components/checkout/OrderSummary.tsx`: Uses `useMoney()` and market `locale` for subtotal, discount, shipping, taxes, and total.
  - `apps/web/src/components/product/VariantSelector.tsx`: `formatInr` updated to delegate to `formatMoney`, `PriceBlock` uses `useMoney()`, and preorder dispatch date respects market `locale`.
  - `apps/web/src/components/catalog/CardCartButton.tsx`: Quick-buy dialog and button prices use `useMoney()`.
  - `apps/web/src/components/catalog/PriceSlider.tsx`: Formats slider bounds using market currency exponent and `formatMoney()`.
  - `apps/web/src/components/storefront/MiniCartDrawer.tsx`: Uses `useMoney()` for line items and drawer subtotal.
  - `apps/web/src/components/storefront/SearchModalPanel.tsx`: Uses `useMoney()` for search hit prices.
- Replaced hardcoded formatting in server-rendered catalog and product components:
  - `apps/web/src/components/product/ProductDetailSection.tsx`: Accepts `currency` and `locale` props (defaulting to INR/en-IN) and formats with `formatMoney`.
  - `apps/web/src/components/product/ProductCustomField.tsx`: Accepts `locale` prop for number formatting.
  - `apps/web/src/components/catalog/ProductCard.tsx`: Accepts `currency` and `locale` props for product tile prices and compare-at prices.
  - `apps/web/src/components/catalog/CollectionListingSection.tsx`: Passes `currency` and `locale` through to `ProductCard`.
- Injected market context into theme block rendering:
  - `apps/web/src/components/storefront/ThemeChrome.tsx`: Passes `currency` and `locale` into `renderBlockTree`.
  - `apps/web/src/app/layout.tsx`: Passes `marketCtx.currency` and `marketCtx.locale` into header and footer `ThemeChrome`.
  - `apps/web/src/app/page.tsx`, `apps/web/src/app/pages/[...path]/page.tsx`, `apps/web/src/app/collections/page.tsx`, `apps/web/src/app/collections/[slug]/page.tsx`, `apps/web/src/app/categories/[slug]/page.tsx`, `apps/web/src/app/cart/page.tsx`: Pass `currency` and `locale` from `getMarketContext(tenantId)` into `BlockRenderer` context.
  - `apps/web/src/app/products/[slug]/page.tsx`: Overrides Schema.org Product JSON-LD offers `priceCurrency` with the market currency.
- Tests added:
  - `apps/web/test/market-money-formatting.test.tsx`: Tests `useMoney()`, `formatInrPrice`, and `formatInr` with INR and USD, testing integer prices and fractional cents/paise.
  - `packages/blocks/test/theme-pages.test.tsx`: Verified `ProductGrid` formats prices with currency and locale from `RenderContext`.

## Remaining Grep Hits for `₹` and `en-IN`
`git grep -n -E "₹|en-IN" apps/web/src packages/blocks/src`:
1. `apps/web/src/app/categories/[slug]/page.tsx:121` & `apps/web/src/app/collections/[slug]/page.tsx:133`: Default fallback for SSR before tenant resolve.
2. `apps/web/src/app/layout.tsx:220, 228, 233, 239`: Fallback to `"INR"`/`"en-IN"` when market context is absent.
3. `apps/web/src/app/o/[token]/page.tsx:70` & `apps/web/src/app/orders/[token]/thank-you/page.tsx:97`: Post-checkout order pages (owned by WP-3, explicitly out of scope for WP-1a).
4. `apps/web/src/app/page.tsx:34`: Platform marketing meta description ("plans from ₹999 a month").
5. `apps/web/src/app/page.tsx:66`, `apps/web/src/app/products/[slug]/page.tsx:112`, `apps/web/src/app/search/page.tsx:90`: Default fallbacks.
6. `apps/web/src/app/policies/[type]/page.tsx:84, 160`: Store policy template copy & date formatting fallback.
7. `apps/web/src/app/signup/page.tsx:27, 34`: Platform SaaS pricing (owned by WP-4).
8. `apps/web/src/components/market/MarketProvider.tsx:13`: Default client context `DEFAULT = { currency: "INR", locale: "en-IN" }`.
9. `apps/web/src/components/marketing/**`: Platform marketing landing page, demo data, and pricing copy.
10. `apps/web/src/components/product/CouponCards.tsx:16` & `reviews-shared.tsx:34`: Date formatting (`toLocaleDateString("en-IN")`).
11. `apps/web/src/components/product/ProductCustomField.tsx:5` & `ThemeChrome.tsx:21`: Default prop value `locale = "en-IN"`.
12. `packages/blocks/src/registry.ts:100, 396`, `views-multi-card.tsx:30`: Default demo copy for Announcement and Features blocks.
13. `packages/blocks/src/views-blog.tsx:22`: Blog publish date formatting.
14. `packages/blocks/src/views-product-sample-client.tsx:12`: Isolated sample component.
15. `packages/blocks/src/views.tsx:49, 53`: Money formatting helper fallback comment and logic.

## Verification
- Ran:
  - `pnpm typecheck`: Passed (15/15 packages successful).
  - `pnpm lint`: Passed (0 errors, 5 existing warnings in `@bs/web` unrelated to changes).
  - `pnpm docs:check`: Passed (`docs:check ok`).
  - `pnpm --filter @bs/blocks test`: Passed (24 files, 265 tests passed).
  - `pnpm --filter @bs/web test test/market-money-formatting.test.tsx test/mini-cart.test.ts test/listing-controls.test.ts test/product-page-sections.test.ts test/product-page.test.ts`: Passed (5 files, 40 tests passed).
- NOT verified:
  - End-to-end browser walkthrough with live running database and seeded USD market exchange rate (WP-1a is headless code and tests; Claude will verify or admin UI in subsequent prompt).

## Docs to update (for Claude during hand-off / merge)
- [ ] `docs/ARCHITECTURE.md` (no architectural changes; contracts/services untouched).
- [ ] `progress.md` (check off WP-1a under multi-market milestone).
- [ ] `docs/MULTIMARKET-HANDOFF.md` (record WP-1a completion).

## Follow-ups and open questions
- `generateProductJsonLd` in `packages/domain/src/storefront/seo.ts` hardcodes `priceCurrency: "INR"`. Since WP-1a was forbidden from touching `packages/domain`, `apps/web/src/app/products/[slug]/page.tsx` modifies the generated JSON-LD object offers before emitting it into the page. If desired, domain's `generateProductJsonLd` can accept an optional `currency` parameter in WP-1b/WP-2.

## Definition of done
- [x] Code follows `AGENTS.md` section 2 and 3; the gate in section 4 passes (typecheck, lint, docs:check).
- [x] Unit tests added in `apps/web/test/market-money-formatting.test.tsx` and `packages/blocks/test/theme-pages.test.tsx`.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Change record created; ready for Claude verification.
