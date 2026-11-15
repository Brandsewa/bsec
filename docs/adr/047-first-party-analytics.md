# ADR-047: First-party merchant analytics, cookieless collector, orders as the source of truth

- **Status:** Accepted
- **Date:** 2026-11-15
- **Plan reference:** `docs/ANALYTICS-PLAN.md` (rules 1, 3, 4, 5, 8, 12; extends ADR-010)

## Context
Merchants need starter analytics (sales, orders, customers, traffic, funnel). `analytics.read` exists but nothing enforces it, `analytics_daily` was planned and never built, and the only data collected is `search_queries`. The production VPS is shared and has no spare memory, the storefront has a 50 KB product-page JS budget, and the storefront sets only strictly necessary cookies. Umami, Plausible, Matomo and OpenPanel were compared (see the plan): none models ecommerce, each needs a second service and a per-store proxy to stay tenant-safe, and the revenue features of Plausible are not in its community edition.

## Decision
- **Sales, orders, customers, inventory and search reports are computed from our own tables** (and a daily rollup), never from client events. Revenue stays exact and server-side (rule 12).
- **Traffic and funnel use a first-party cookieless collector.** A tiny async script (`apps/web/public/bsa.js`, outside the app bundle) beacons `pageview` to `POST /api/storefront/analytics/collect`. `add_to_cart` and `begin_checkout` are recorded server-side from the cart and checkout routes, so they need no client JavaScript and are not blocked by ad blockers.
- **Privacy:** nothing is set on the device. `visitor_hash` is an HMAC of tenant, IP and user agent keyed by the auth secret and the UTC day: not reversible, not linkable across days, never equal across stores. Raw IPs are not stored. Global Privacy Control and Do Not Track requests are honoured, bots are dropped, only live storefronts are measured (not holding pages, password gates or previews).
- **Storage:** tenant table `analytics_events` (`tenantTable`, forced RLS). Raw rows are pruned after 90 days by a worker job; daily rollups (aggregate counts only) are kept at least 25 months so year-over-year comparison works; reports read the rollups. Reports never read raw events for long ranges.
- **Consent:** the cookieless collector needs no banner. A merchant-configurable consent popup is a later, separate feature; it will gate only optional marketing integrations (for example GA4 or a Meta pixel through a curated settings field, per ADR-010), not this collector.
- **Charts:** the existing shadcn chart kit (Recharts, `@bs/ui`), loaded lazily on analytics routes. Date filtering uses the extended `DateRangePicker` with analytics presets, a comparison period and automatic granularity; day buckets use the store timezone.
- **Contract first:** the dashboard is served by our own `admin.analytics.*` procedures guarded by `analytics.read`. The data source behind them can change (more rollups, a columnar store) without changing the UI.

## Server-side conversion APIs (added with slice 5b)
Browser events miss visitors with ad blockers, so a confirmed order's `Purchase` is also sent from the server to the Meta Conversions API and the GA4 Measurement Protocol. Rules: only for visitors who accepted the matching cookie category (read from the `bs_consent` cookie when the order is placed and stored on the order), only when the merchant saved the credential, encrypted in `tenant_secrets` and never shown again; the same event id and transaction id as the browser event so platforms de-duplicate; personal data (hashed email and phone, IP, user agent) goes to Meta only and is cleared once the event settles; sent after commit through a retrying pg-boss job. The merchant's privacy policy must mention these processors; the admin card says so.

## Server-side add to cart and begin checkout (slice 5c)
Meta gets `AddToCart` and `InitiateCheckout` from the server too, with the same consent, credential and clearing rules as purchases and the same event id as the browser pixel so Meta counts them once. GA4 does not: it can only de-duplicate purchases, so it keeps receiving those two events from the browser only.

## Consequences
- No new service or env var; one new table and one public route. The collector writes one row per pageview, so write volume scales with traffic. Batching and the retention job are in the plan.
- The product-page JS budget is not spent by analytics. It stays at 50 KB; raising it is not needed for this design.
- Conversion and funnel numbers cover only visitors who are measured (no Do Not Track, no bots), and are labelled as such.
- A third-party tool can still be adopted later behind the same `admin.analytics.*` contract if traffic analytics outgrows Postgres.
