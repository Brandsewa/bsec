# Multi-market: Phase 1 foundation and the server side of Phases 2 to 6

- **Date:** 2026-10-28
- **Agent:** claude
- **Branch:** `docs/multimarket-phase0` (merged in #150, a23f5a7)
- **Area:** db, domain, contracts, payments, web
- **Type:** feature
- **Supersedes:** none

## Summary
Phase 1 of `docs/MULTIMARKET-PLAN.md` (money and unit helpers, markets tables, base-market backfill, provisioning) plus, because they were small and testable, most of the server side of Phases 2 to 6: markets service, market prices and catalog, market-aware cart and checkout, tax and policy snapshot, Stripe and PayPal hosted payments, admin API, storefront resolution and switcher. The owner then asked to stop and hand the rest to Antigravity in several chats; the remaining work is split in `docs/MULTIMARKET-HANDOFF.md` (work packages WP-1 to WP-8) with a prompt per chat in `docs/prompts/multimarket-wp*.md`.

## What changed
See the table in `docs/MULTIMARKET-HANDOFF.md` section 1 (every row names its files and its test). In short:
- Migrations `0087_markets_foundation`, `0088_markets_config`, `0089_market_scope_functions`.
- `packages/contracts`: `money.ts`, `units.ts`, `markets.ts` (14 `admin.markets.*` procedures), PayPal in provider enums.
- `packages/payments`: PayPal provider. `packages/domain`: `markets/*`, `payments/online-checkout.ts`, market-aware `storefront/cart.ts`, `orders/checkout.ts`, `shipping-rates.ts`, `storefront/catalog.ts`, search and block data, emails and the new-order alert in the order's currency, permission `markets.manage`.
- `apps/web`: middleware prefix rewrite, `server/market.ts`, switcher and suggestion banner, hreflang, market select route, market-aware cart/checkout/product/collection/category/home/search, country-aware checkout form, Stripe/PayPal redirect, `checkout/pay` and `checkout/return` routes, PayPal credentials route.
- `@bs/ui` `Money` takes an ISO currency; `@bs/blocks` `RenderContext` carries currency and locale.

## Decisions and trade-offs
- `formatMoney` drops ".00" on whole amounts, keeps two digits otherwise ("₹1,299", "₹1,299.50").
- Market scope is carried in SQL (transaction-local `app.market_id`, functions and one restrictive RLS policy on `products`) so no storefront query had to be rewritten; it is inert when the setting is empty.
- Prices of non-base markets are materialised (`market_prices`) by one TypeScript function on every variant write path; fixed overrides are never overwritten.
- A store with no markets row behaves exactly as before (legacy fallback in `loadCheckoutMarket`).
- The evaluate route caches market URL prefixes for 30 seconds per process.
- Column names ending `_paise` are kept (minor units of the row's currency).

## Verification
Ran (real Postgres 18 through `TEST_PG_ADMIN_URL`, serial):
- `@bs/contracts` money/units 10 pass; `@bs/payments` PayPal 11 pass; `@bs/db` full suite 47 pass (includes the 0086-to-0089 backfill test, 6).
- `@bs/domain`: `market-rules` 19, `market-addresses` 7, `markets.int` 14, `markets-checkout.int` 8, `markets-storefront.int` 7, `isolation.int` 1670, the 93 existing checkout/cart/payment/webhook/discount/finance-checkout/abandoned tests, `email-templates` 17. Full domain suite result: see "Full domain run" below.
- `pnpm typecheck` all 15 packages pass; domain lint clean; `pnpm docs:check` ok.

NOT verified: any page in a browser (storefront changes are typechecked only; admin screens are not built yet), web and e2e suites, PayPal Subscriptions for an India-registered account, real Stripe/PayPal sandbox calls (mocked `fetch` only).

## Docs updated
- [x] `docs/ARCHITECTURE.md` section 7 (schema files and migrations 0087 to 0089); sections 5, 8, 9 are for WP-8
- [x] ADR-040 (Phase 0)
- [x] `progress.md` (in flight, decisions)
- [x] `docs/MULTIMARKET-HANDOFF.md`, `docs/prompts/multimarket-wp*.md`

## Follow-ups and open questions
All remaining work and its acceptance criteria: `docs/MULTIMARKET-HANDOFF.md` section 3. Key risk: until WP-1 lands, do not enable a second market on a real store (block grids and several client components still format prices as INR).

## Definition of done
Not done for the feature as a whole; this record covers the foundation and server side only.
