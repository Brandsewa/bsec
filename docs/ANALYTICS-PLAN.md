# Merchant analytics plan

Owner decisions 2026-11-15: build first-party, start with the essentials, leave room to grow, charts with shadcn/Recharts, every report filterable by date with comparison, cookieless collector now, a merchant-configurable consent popup later. Decision record: [ADR-047](adr/047-first-party-analytics.md). Reference: Shopify's Reports categories (Acquisition, Behavior, Customers, Sales, Orders, Inventory).

## Legend
**N** = computed from our tables (exact). **E** = needs the first-party event collector. **G** = possible with Google Analytics 4 (optional later add-on, consent-gated, viewed in Google, not in our dashboard). **x** = blocked or not applicable.

## Reports by phase

### Phase 1 (essentials, about 30 reports)
| Category | Reports | Source |
|---|---|---|
| Sales | Gross sales, net sales, total sales over time; total sales by product; average order value; sales by discount code; sales by channel (`orders.source`); **sales by market** (owner, 2026-11-15; multimarket is live, each market in its own currency, never summed across currencies); new vs returning customer sales; sales reversals | N |
| Orders | Orders over time; items ordered over time; orders fulfilled over time and order to fulfillment time; reversed quantity (over time, rate, by product); order hotspots by shipping location | N |
| Customers | New vs returning customers; new customers over time; returning customer rate; returning customers; one-time customers; customers by location; new customer sales | N |
| Acquisition | Sessions and visitors over time; sessions by referrer and social referrer; sessions by location | E |
| Behavior | Conversion rate over time and breakdown; checkout conversion rate; sessions by device; sessions by landing page; searches by query; searches with no results | E, N (search) |
| Inventory | Inventory sold daily by product; products by days of inventory remaining | N |

### Phase 2 (optional)
Visitors right now, bounce rate, funnel (visit, product, cart, checkout, order), search click and conversion, cohort analysis, RFM, sales by referrer (utm on cart and order), profit margin (needs `cost_price`), items bought together, top returned products with reasons, cancellation reasons, sell-through, ABC analysis, month-end inventory value (snapshot job), inventory adjustments.

### Later or not applicable
Delivery and carrier reports (courier not live; shipping integrations are out of scope, AGENTS rule 14), purchase orders (no module found), subscriptions, bundles, POS staff, agentic sales, Shop Promise, storefront agent, product recommendations, predicted spend tiers, Shop Campaign ROAS (needs ad spend import).

## Architecture
1. **Contracts first:** `admin.analytics.*` procedures in `packages/contracts`, handlers in `apps/web/src/server/api.ts`, services in `packages/domain/src/analytics/`, each calling `assertPermission(ctx, "analytics.read")`. Add every procedure to `packages/domain/test/isolation.int.test.ts`.
2. **Rollups:** a worker job fills a tenant table `analytics_daily` (orders, revenue, items, discounts, refunds, new vs returning, by channel and market) in the store timezone; long ranges read it, short ranges and "today" read live. Traffic rollups (`analytics_traffic_daily`) from `analytics_events`. Both tenant tables with `forceRlsSql`, tenant-prefixed cache tags (rule 5).
3. **Collector (built, slice 1):** `apps/web/public/bsa.js` (async, outside the app bundle) beacons `pageview` to `/api/storefront/analytics/collect`; `recordAnalyticsEvent` in `packages/domain/src/analytics/collect.ts`. `add_to_cart` and `begin_checkout` are recorded server-side from the cart and checkout routes (slice 2). A retention job deletes raw events older than 90 days.
4. **Timezone:** day buckets use the store's timezone (`store_settings`), never UTC or the browser's.
5. **Currency:** reports state their currency; multimarket stores get a market and currency selector, and money is never summed across currencies.

## UI
- Admin route `/analytics` (lazy loaded) with a report list grouped by category (as in Shopify) and a dashboard of KPI tiles, sales over time, sales breakdown, sales by channel, AOV over time, sales by product.
- **Charts:** `ChartContainer` and friends from `@bs/ui` (Recharts, already installed and themed with `--chart-1..5`). KPI sparklines are a small hand-rolled SVG path. The cohort heatmap is a CSS grid. No second chart library.
- **Date filter (helpers built, slice 1):** `DateRangePicker` accepts `presets` and `today` (the store's today). `ANALYTICS_PRESETS`: Today, Yesterday, Last 7/30/90 days, This/last month, This/last quarter, Year to date, Last year. `comparisonRange(range, mode)` gives previous period or same period last year, `autoGranularity` gives day, week or month. Range and comparison live in the URL as `yyyy-MM-dd`; the server validates and caps the range. Still to build: a comparison selector and currency selector component, optional merchant-event presets (Black Friday, Cyber Monday).

## Slices and acceptance criteria
**Status 2026-11-15:** all five slices are built on `feat/merchant-analytics` (PR #267; see `docs/changes/2026-11-15-claude-analytics-foundations.md`): foundations and collector (1), server-side `add_to_cart` and retention (2), rollups and the sales, orders and customer reports (3), traffic, behavior and inventory reports (4), and the cookie banner with consent-gated GA4 and Meta Pixel (5), including browser shop events, server-side Purchase to Meta CAPI and GA4 (5b) and server-side Meta AddToCart and InitiateCheckout (5c). Intentional differences from the slice text: the first-party funnel counts `begin_checkout` from a `/checkout` pageview instead of recording a separate event (same result, one fewer write); GA4 receives add to cart and begin checkout from the browser only, because its server API cannot de-duplicate them. What is left is under "Remaining work" below.

1. **Foundations (this branch):** date presets, comparison and granularity helpers with tests; `analytics_events` table with forced RLS; collector service and route; beacon script. Accept: real-database test passes (stores a clean event; drops bots, Do Not Track, unknown types, bad paths; another store cannot read it); `pnpm typecheck` and `pnpm lint` pass; `bsa.js` is not part of the `.next` chunks.
2. **Server-side funnel events:** record `add_to_cart` and `begin_checkout` from the cart and checkout routes; retention job. Accept: one event per action, none for bots or closed stores.
3. **Rollups and Sales/Orders/Customers reports:** `analytics_daily`, `admin.analytics.*` contracts, dashboard with KPI tiles and the Phase 1 sales, orders and customer reports, date and comparison controls. Accept: totals equal a direct SQL sum over `orders` for the same range and timezone (real-database test); a staff user without `analytics.read` is refused at the domain service.
4. **Traffic and behavior reports:** Acquisition and Behavior reports from the traffic rollup and `search_queries`; inventory Phase 1 reports. Accept: numbers reconcile with raw events for a seeded day; empty states for a new store.
5. **Consent popup and optional integrations (built):** merchant-configurable consent banner and GA4 or Meta pixel through a curated settings field (ADR-010). Not required for slices 1 to 4.

## Remaining work (2026-11-15)
**Before merge (not features):** visual checks at phone widths and in dark mode for the dashboard, report pages, banner and settings cards; the date picker popover and CSV export by hand; one test purchase with the merchant's Meta test event code and a GA4 debug view to confirm live delivery (the Graph API version `META_CAPI_VERSION` and payload follow the docs but were never sent to Meta or Google); CI and e2e on PR #267; review.

**Phase 2 reports (optional, each its own slice, in this order):**
1. ~~**Attribution:**~~ **built** (`order_attribution`, migration 0113): same-day, cookieless attribution on the order; sales by referrer, sales by campaign, items sold by referrer, visitors right now. Not on the cart. Multi-day attribution would need a first-party cookie and consent: a separate decision.
2. ~~**Customers:**~~ **built:** cohort analysis and RFM segments.
3. ~~**Orders and inventory:**~~ **built:** cancellation reasons, returned products with reasons, items bought together, sell-through, ABC, inventory adjustments and movements, inventory value now. Not built: a month-end inventory snapshot job (needs a snapshot table and a monthly job); the report shows the value now instead.
4. ~~**Profit:**~~ **built:** profit by product and profit over time (needs `cost_price` filled in by merchants; profit by single order is not built).

**Optional follow-ups for the ad integrations:** server-side Meta `ViewContent`, Meta `external_id`, a per-order delivery log in the admin, per-region banner rules.

**Owner decisions still open:** none blocking; the 90-day raw retention and sales by market were decided on 2026-11-15.

## Go-live checklist and parked work (2026-11-15)
**Parked by the owner on 2026-11-15** while the Google Analytics 4 and Meta accounts are connected and live data comes in. Everything below is optional or a check; nothing is half-built.

**When connecting the accounts** (Settings, Customer privacy):
1. Switch the cookie banner on and enter the GA4 measurement ID and the Meta Pixel ID. Add a `#cookie-settings` link to the footer or menu. Mention Google and Meta in the store's privacy policy.
2. **Meta:** in Events Manager generate a Conversions API access token and paste it under Server-side events. Enter the Test events code in the settings while testing. Place a test cash-on-delivery order after accepting the banner and confirm Purchase, AddToCart and InitiateCheckout appear under Test events, and that the browser and server copies show as deduplicated. Then clear the test code. Also confirm the Graph API version in `META_CAPI_VERSION` (`packages/domain/src/analytics/conversions.ts`) is still current.
3. **GA4:** create a Measurement Protocol API secret (Admin, Data streams, your stream) and paste it. Use DebugView to confirm `view_item`, `add_to_cart`, `begin_checkout` and `purchase`, and that a purchase is counted once. Server-side GA4 needs the visitor's `_ga` cookie; without it GA4 is skipped for that order.
4. Watch the "last 7 days sent, failed, waiting" line on the settings card; a failed count means a rejected token or ID (the reason is stored on the order's tracking row).

**Before merging PR #267:** visual checks at phone widths and in dark mode (dashboard, report pages, banner, settings cards); the date picker popover and CSV export by hand; the 15-second refresh of "Visitors right now"; CI and e2e; review.

**Parked features, in the order I would build them:**
1. Month-end inventory value snapshot (a snapshot table and a monthly job; "Inventory value now" exists).
2. Profit by single order; an RFM customer list (lists individuals, so needs a permission decision).
3. Ad integrations: server-side Meta `ViewContent`, Meta `external_id`, GA4 server-side add to cart and begin checkout (only if the browser stops sending them for the same visitor), a per-order delivery log in the admin, per-region banner rules.
4. Multi-day attribution: needs a first-party cookie and consent, so an owner decision first (today attribution is same-day and cookieless).
5. Merchant-event date presets (Black Friday, Cyber Monday) and a comparison and currency selector on report pages.

## Risks and open questions
- Write volume: one row per pageview. If it grows, batch beacons client-side or buffer in the worker; do not move to a second database before measuring.
- Visitor counts undercount by design (Do Not Track, bots, ad blockers). The UI says "measured visitors".
- JS budget: not raised. Analytics costs the product page nothing; the owner offered to raise it if ever needed.
## Retention (owner delegated to best practice, 2026-11-15)
- **Raw `analytics_events`: 90 days.** Enough to re-run recent reports and fix rollup bugs, short enough to limit storage and the privacy surface. Pruned in daily batches by a worker job.
- **Daily rollups: keep at least 25 months**, so "same period last year" and year-over-year comparison always have data; rollups hold only aggregate counts, no visitor hash. Older rollup rows may be thinned to monthly later.
- **Orders-based reports read the orders tables**, which are kept as long as the store's order records.
- **Store deletion:** events and rollups are removed with the tenant by the existing tenant-deletion job (add both tables to it in slice 2).
- Revisit the 90-day figure only if a rollup bug needs a longer replay window.
