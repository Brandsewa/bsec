# Merchant analytics: plan, ADR-047, collector, rollups, 30 reports and the admin dashboard

- **Date:** 2026-11-15
- **Agent:** claude
- **Branch:** `feat/merchant-analytics`  (not merged yet)
- **Area:** db, domain, web, ui, docs
- **Type:** feature
- **Supersedes:** none

## Summary
First slice of merchant analytics. There is now a plan and an ADR (first-party, cookieless, orders as the source of truth), the date range picker can take analytics presets with comparison and granularity helpers, and the storefront records cookieless pageviews into a new tenant table. No dashboard yet.

## What changed
- `docs/ANALYTICS-PLAN.md` (reports by phase, architecture, slices with acceptance criteria) and `docs/adr/047-first-party-analytics.md`.
- `packages/ui`: `lib/date-presets.ts` (`ANALYTICS_PRESETS`, `comparisonRange`, `autoGranularity`); `DateRangePicker` gains optional `presets` and `today` props. Existing screens are unchanged.
- `packages/db`: `analytics_events` tenant table (migration `0108_analytics_events`, forced RLS, CHECKs on type and device).
- `packages/domain/src/analytics/collect.ts`: `recordAnalyticsEvent` drops bots, Do Not Track and Global Privacy Control requests, unknown types and bad paths; HMAC visitor hash per tenant per UTC day; no raw IP stored.
- `apps/web`: `POST /api/storefront/analytics/collect` (always 204, in-memory per-IP limiter, live stores only) and `public/bsa.js` (async script tag in the storefront layout head).

## Slices 2 to 4 (added later on the same branch)
- Migration `0109_analytics_traffic_daily`; queue `analytics.maintenance` (hourly :20): traffic rollup for yesterday and today, 90-day raw retention, 26-month rollup retention.
- `add_to_cart` recorded server-side from `cart/items/route.ts`.
- `admin.analytics.overview` and `admin.analytics.report` (contracts in `packages/contracts/src/analytics.ts`, services in `packages/domain/src/analytics/reports.ts`), `analytics.read` enforced in the route and the domain service; both mapped in `isolation.int.test.ts`. 30 reports, including sales by market.
- Admin: `/analytics` dashboard and `/analytics/reports/$reportId`, sidebar item "Analytics" (needs `analytics.read`), shared range controls (presets, comparison, currency), CSV export for staff with `exports.run`. Charts: `@bs/ui/charts` (Recharts, lazy loaded).

## Slice 5: cookie banner and consent-gated integrations
- Migration `0110_privacy_consent_settings` (`privacy_settings.consent_settings` jsonb, null = off). `ConsentSettings` in `packages/contracts/src/consent.ts`; `getPrivacySettings` and `updatePrivacySettings` carry it; `getStorefrontConsentConfig` feeds the storefront.
- Admin: new card "Cookie banner and tracking" on `/settings/customer-privacy` (needs `privacy.manage`).
- Storefront: `apps/web/public/bsc.js` and a JSON config script in the layout head, only when the banner is on. Choice stored in `bs_consent` (added to the test-locked necessary-cookie inventory).
- Rules: a tracking id requires the banner to be on; ids match strict patterns; GPC counts as a rejection; withdrawing consent reloads the page; `#cookie-settings` links reopen the banner. GA4 and Meta get page views only.

## Shop events for GA4 and Meta (slice 5, part 2)
- `view_item` (product page), `begin_checkout` (checkout page) and `purchase` (thank-you page) are rendered by `components/analytics/ShopEvent.tsx` as inert JSON blobs, only when the store has a GA4 or Pixel id; `add_to_cart` is read by `bsc.js` from the cart request's response. `bsc.js` sends them to GA4 (`gtag event`) and Meta (`ViewContent`, `AddToCart`, `InitiateCheckout`, `Purchase`) only for accepted categories; events before a decision are queued.
- Builders and serialization in `packages/domain/src/analytics/shop-events.ts` (unit tests `shop-events.test.ts`). No customer details are sent. Purchase is de-duplicated per browser and carries the order number as the transaction id and Meta `eventID`.
- Bug fixed on the way: React hoists `bsc.js` into `<head>`, so it could run before the config element existed and silently do nothing; it now waits for the config (found while testing in the browser).

## Server-side conversion APIs (slice 5b)
- Migration `0111_order_tracking`; queue `analytics.conversion`; `packages/domain/src/analytics/conversions.ts`; `PlaceOrderInput.tracking`; `place-order` route decides and passes it; `order.created` consumer enqueues the job; hourly maintenance gives up stale rows and deletes old ones.
- Admin: Meta access token and GA4 API secret on `/settings/customer-privacy` (new procedures `customerPrivacy.saveConversionCredentials` and `clearConversionCredentials`, also exposed on the marketing-site router), Meta test event code, and a 7-day sent, failed, waiting line. Mapped in `isolation.int.test.ts`.
- Rules, all tested: consent required per platform and per revision; no credential, no row; hashed email and phone to Meta only; GA4 gets no personal data; token in the Meta request body, never the URL; failure text redacted; idempotent per platform; retry on network, 429 and 5xx; request details cleared when settled.
- Not verified against live Meta or Google (no real credentials used): the Graph API version constant `META_CAPI_VERSION` (v21.0) and the payload shape follow Meta's documented Conversions API and should be checked once with the merchant's Test events code.

## Server-side add to cart and begin checkout (slice 5c)
- Migration `0112_conversion_events` (named so after finding `tracking_events` already exists for shipments); queue `analytics.conversion_event`; `packages/domain/src/analytics/server-events.ts` (`recordServerEvent`, `handleServerEventJob`); `decideEventTracking` and `buildMetaEventPayload` in `conversions.ts`.
- Cart route returns `analyticsEventId`; checkout page records `InitiateCheckout` and passes the id in the `begin_checkout` blob; `bsc.js` uses it as the Meta `eventID`.
- Meta only. GA4 cannot de-duplicate non-purchase events, so it stays browser-only for these two; sending both would inflate GA4.
- Tested: unit (decision matrix, payload without personal data), real database (record, repeat, send, retry, permanent failure, removed token, stats, retention), and a production build in a browser (event rows and matching ids; no row for analytics-only or no-choice visitors; a checkout refresh adds no second row).
- Not verified against live Meta.

## Phase 2: attribution
- Migration `0113_order_attribution`; `packages/domain/src/analytics/attribution.ts` (`resolveOrderAttribution`); `PlaceOrderInput.attribution`; the place-order route resolves and passes it.
- Cookieless: the collector's daily visitor hash finds the visitor's same-day page views; the last visit from a referrer or utm link is stored on the order (host and utm values only, never the hash). Different day, Do Not Track, bot or blocked beacon means direct.
- Four new reports (34 in all): sales by referrer, sales by campaign, items sold by referrer, and visitors right now (live: ignores the date range, refreshes every 15 s).
- Tested: real database (last non-direct visit wins, direct and unseen visitors store nothing, other visitor or store or day is not linked, report totals equal the order totals, visitors right now counts only the last 5 minutes); production build in a browser (a utm-tagged visit and a real order through the route produced the attribution row; both reports render).
- Not verified: the 15-second auto refresh of visitors right now (code only), and attribution for orders placed just after midnight UTC.

## Phase 2: customers, orders, inventory and profit reports
- Eleven reports added (45 in all), all computed from existing tables, no migration: customer cohorts, RFM segments, cancellation reasons, returned products with reasons, items bought together, sell-through, ABC analysis, inventory adjustments and movements, inventory value now, profit by product, profit over time.
- Profit: sales are after discounts and before tax (taxable value when the order recorded one), cost is the `cost_price` copied onto the order line at placement; lines without a cost are left out and counted in the report note.
- Deliberately not built: month-end inventory snapshot (the report shows value now), profit by single order, RFM customer list (it would list individuals; use the Customers page).
- Tested: real database with seeded orders, returns and stock movements and exact expected numbers (cohort percentages including blank future months, RFM segments cover every customer once, cancellation and return reasons, bought-together pairs, sell-through, ABC classes, movement totals, inventory value and missing costs, profit and margin, another store sees nothing). Browser: cohorts and RFM render on the demo store.
- Not verified: profit and ABC pages in a browser (the demo orders have no cost prices), and the RFM segment boundaries on large stores.

## Decisions and trade-offs
- No new env var: the hash is keyed by `BETTER_AUTH_SECRET` plus the UTC day.
- The collector uses an in-memory limiter, not the database-backed storefront quota, so analytics cannot spend the store's request budget. It is per instance and best-effort.
- `add_to_cart` and `begin_checkout` are allowed event types but are not wired yet; they will be recorded server-side (slice 2) so they cost no client JS.
- The product-page JS budget was not raised: the beacon is a separate static file outside the bundle.

## Verification
- Ran: `pnpm typecheck` pass; `packages/domain` `analytics-reports.int.test.ts` and `analytics-collect.int.test.ts` plus `isolation.int.test.ts` pass on local Postgres (1,825 tests in the two largest files); date-presets unit test 6 pass; db schema and roles tests 27 pass; `pnpm docs:check` pass; `pnpm lint` pass; `@bs/web` build and `perf-budget-bundle.int.test.ts` pass (the product-page budget is untouched); `@bs/admin` build pass, analytics code in its own lazy chunks.
- Exercised by hand (local stack, copied dev database with seeded demo orders and synthetic traffic, owner login): dashboard shows KPI tiles with comparison, sales over time with dashed comparison line, breakdown, channel donut, sessions chart, product bars; the Sessions by referrer report shows Direct, Search and Social rows with a chart and table.
- NOT verified: dark mode and phone widths, the date picker popover by hand, CSV export, the beacon in a real storefront page, the sidebar entry visually, the full heavy suite beyond the analytics and isolation files, e2e, CI. Screenshots timed out in the hidden browser pane, so checks used page text.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (schema file table only; the "Last verified" line and the routes section are not updated yet)
- [x] ADR 046
- [x] `DEPLOYMENT.md` / RUNBOOK: not needed (no env var, service or port)
- [x] `progress.md` (in flight line)

## Follow-ups and open questions
- Slice 5 (consent popup, GA4 or Meta pixel) and the Phase 2 reports. Retention (90 days raw, 25 months rollups) and sales by market in Phase 1 were decided by the owner on 2026-11-15; both are in the plan.

## Definition of done
Partly met: code, tests and docs are in; the visual checks listed above, e2e and CI are still to do before merge.
