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
- `packages/db`: `analytics_events` tenant table (migration `0107_analytics_events`, forced RLS, CHECKs on type and device).
- `packages/domain/src/analytics/collect.ts`: `recordAnalyticsEvent` drops bots, Do Not Track and Global Privacy Control requests, unknown types and bad paths; HMAC visitor hash per tenant per UTC day; no raw IP stored.
- `apps/web`: `POST /api/storefront/analytics/collect` (always 204, in-memory per-IP limiter, live stores only) and `public/bsa.js` (async script tag in the storefront layout head).

## Slices 2 to 4 (added later on the same branch)
- Migration `0108_analytics_traffic_daily`; queue `analytics.maintenance` (hourly :20): traffic rollup for yesterday and today, 90-day raw retention, 26-month rollup retention.
- `add_to_cart` recorded server-side from `cart/items/route.ts`.
- `admin.analytics.overview` and `admin.analytics.report` (contracts in `packages/contracts/src/analytics.ts`, services in `packages/domain/src/analytics/reports.ts`), `analytics.read` enforced in the route and the domain service; both mapped in `isolation.int.test.ts`. 30 reports, including sales by market.
- Admin: `/analytics` dashboard and `/analytics/reports/$reportId`, sidebar item "Analytics" (needs `analytics.read`), shared range controls (presets, comparison, currency), CSV export for staff with `exports.run`. Charts: `@bs/ui/charts` (Recharts, lazy loaded).

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
