# Merchant analytics: plan, ADR-046, date presets, cookieless event collector

- **Date:** 2026-11-15
- **Agent:** claude
- **Branch:** `feat/merchant-analytics`  (not merged yet)
- **Area:** db, domain, web, ui, docs
- **Type:** feature
- **Supersedes:** none

## Summary
First slice of merchant analytics. There is now a plan and an ADR (first-party, cookieless, orders as the source of truth), the date range picker can take analytics presets with comparison and granularity helpers, and the storefront records cookieless pageviews into a new tenant table. No dashboard yet.

## What changed
- `docs/ANALYTICS-PLAN.md` (reports by phase, architecture, slices with acceptance criteria) and `docs/adr/046-first-party-analytics.md`.
- `packages/ui`: `lib/date-presets.ts` (`ANALYTICS_PRESETS`, `comparisonRange`, `autoGranularity`); `DateRangePicker` gains optional `presets` and `today` props. Existing screens are unchanged.
- `packages/db`: `analytics_events` tenant table (migration `0106_analytics_events`, forced RLS, CHECKs on type and device).
- `packages/domain/src/analytics/collect.ts`: `recordAnalyticsEvent` drops bots, Do Not Track and Global Privacy Control requests, unknown types and bad paths; HMAC visitor hash per tenant per UTC day; no raw IP stored.
- `apps/web`: `POST /api/storefront/analytics/collect` (always 204, in-memory per-IP limiter, live stores only) and `public/bsa.js` (async script tag in the storefront layout head).

## Decisions and trade-offs
- No new env var: the hash is keyed by `BETTER_AUTH_SECRET` plus the UTC day.
- The collector uses an in-memory limiter, not the database-backed storefront quota, so analytics cannot spend the store's request budget. It is per instance and best-effort.
- `add_to_cart` and `begin_checkout` are allowed event types but are not wired yet; they will be recorded server-side (slice 2) so they cost no client JS.
- The product-page JS budget was not raised: the beacon is a separate static file outside the bundle.

## Verification
- Ran: `packages/ui` date-presets test 6 pass; `packages/domain/test/analytics-collect.int.test.ts` 4 pass on the local Postgres (migration applied by the test harness); `packages/db` schema and roles tests 27 pass (forced RLS asserted for the new table); `pnpm typecheck` pass; `pnpm lint` pass after fixing two errors in `bsa.js`.
- NOT verified: the bundle budget test (`perf-budget-bundle.int.test.ts`, needs a full web build with env), `pnpm build`, the beacon in a real browser, the picker UI in the admin, the full heavy suite, CI.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (schema file table only; the "Last verified" line and the routes section are not updated yet)
- [x] ADR 046
- [x] `DEPLOYMENT.md` / RUNBOOK: not needed (no env var, service or port)
- [x] `progress.md` (in flight line)

## Follow-ups and open questions
- Slices 2 to 5 in the plan. Retention (90 days raw, 25 months rollups) and sales by market in Phase 1 were decided by the owner on 2026-11-15; both are in the plan.

## Definition of done
Partly met: code, tests and docs for slice 1 are in; build, bundle budget, ARCHITECTURE routes section and browser checks are still to do before merge.
