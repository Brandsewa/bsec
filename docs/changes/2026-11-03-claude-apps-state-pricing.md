# Apps framework, Super Admin marketplace and the State Pricing app

- **Date:** 2026-11-03
- **Agent:** claude
- **Branch:** `feat/apps-state-pricing` (not merged yet)
- **Area:** db, domain, contracts, auth, web, admin, superadmin, platform, docs
- **Type:** feature
- **Supersedes:** none

## Summary
An Indian customer needs different product prices per state, detected automatically. This adds a small first-party Apps framework (stores install and configure apps; Super Admin controls who sees them) and ships State Pricing as its first app. Plan: `docs/STATE-PRICING-PLAN.md`; decisions: ADR-043 and ADR-044.

## What changed
- Migration `0096_apps_state_pricing`: `platform_apps`, `platform_in_states`, `platform_in_pincodes`, `tenant_apps`, `state_prices`, `carts.price_region`, `orders.price_region`; `market_variant_price` replaced (identical while `app.price_region` is empty).
- Domain `packages/domain/src/apps/` (registry, store service, platform service, state prices, regions, pincodes); `withMarketScope` sets `app.price_region`; catalog product detail, cart add/reprice and checkout order snapshot are state-aware. New permission `apps.manage`.
- Contracts `admin.apps.*` and `marketplace.*`; handlers in `apps/web/src/server/api.ts` and `apps/platform/src/app.ts`.
- Store admin: Settings > Apps (`/settings/apps`, install, on/off, uninstall, mode) and the state price editor (`/settings/apps/state-pricing`). Super Admin: Marketplace (`/marketplace`).
- Storefront: `server/region.ts` (Cloudflare then MaxMind then default; bots get defaults), `server/geoip.ts`, pincode popup (`components/market/pincode-gate.tsx`, no client JS) and `/api/storefront/region`; cached loaders take a `<marketId>@<state>` scope.
- Tools: `pnpm --filter @bs/platform import:pincodes <csv>`, `scripts/build-india-geoip.py`.
- New dependency: `maxmind` 5.0.6 (apps/web), the reader for the GeoLite2 file; lazy-loaded and only used when `GEOIP_DB_PATH` is set.
- New env var: `GEOIP_DB_PATH` (web, optional).

## Decisions and trade-offs
See ADR-043 and ADR-044. In short: apps are our code, price is locked to the detected or entered state (no repricing from the shipping address), no MRP guard and no blocked states (owner decisions), per-variant per-state rows only (no zones).

## Verification
- Ran: `pnpm typecheck` for db, contracts, auth, domain, platform, web, admin, superadmin (pass); `pnpm lint` (pass after fixes); `@bs/domain` `apps-regions.test.ts` (7 pass); `apps-state-pricing.int.test.ts` on real Postgres (16 pass: visibility, install lifecycle, suspension, state prices, SQL function, cart reprice, pincode import and lookup, RLS); `isolation.int.test.ts` with the new `apps.*` procedures mapped (1752 pass); auth, contracts and db unit tests (pass).
- NOT run: the full `pnpm gate:quick`, `pnpm build`, the web/platform/e2e suites, `docs:check` after the last edit; any browser walk-through of Settings > Apps, the price editor, Marketplace or the pincode popup; Cloudflare headers against a real zone; MaxMind lookups (no database file yet); `scripts/build-india-geoip.py` (written, syntax-checked, never run on a real GeoLite2 file).
- Not done: the pincode directory is not loaded (manual mode answers "could not match" until `import:pincodes` is run with the India Post CSV); no bulk CSV for state prices; no price editor link from the product page; product list pages show state prices through the SQL function but this was only tested at SQL level, not through the catalog list queries.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (section 7 migration table, new section 20)
- [x] ADR 043 and 044, `docs/adr/README.md`
- [x] `DEPLOYMENT.md` (`GEOIP_DB_PATH`, and the Cloudflare managed transform to switch on before enabling for the customer)
- [x] `progress.md` (in flight)

## Follow-ups and open questions
- Pincode directory: the owner supplied `pincode_state_map.json` (19,586 pincodes). `import:pincodes` now reads that JSON (or a CSV). Parsed against the real file: 19,472 rows, all 36 states and union territories, 114 rows with a blank state skipped. Ten pincodes are pinned in code by the owner (2026-11-04): 799001 Tripura, 334002 Rajasthan, 504346 Telangana, 612906 Tamil Nadu, 791701 Mizoram, 781131 Assam, 384316 Gujarat, 813208 Jharkhand, 814131 Bihar, 900099 West Bengal (Military Post, Kolkata hub). Not yet imported into any database in this session (Docker was not running); run `pnpm --filter @bs/platform import:pincodes <file>` against each environment.
- 3-digit prefix ranges were considered and rejected as the only source (80 of 405 prefixes span more than one state in the real file); exact pincode lookup is the rule.
- Owner: approve downloading the India Post pincode directory (data.gov.in) and the MaxMind database (terms and credit are the owner's to settle).
- Phase 6 of the plan: benchmark Cloudflare vs MaxMind on real Indian traffic, enable the transform on the customer's zone, then make the app visible to the customer from Super Admin > Marketplace.
- Bulk CSV import/export for state prices; per-product entry point from the product page.

## Definition of done
Not complete: gate and manual walk-through outstanding (see NOT run). No secrets or generated files in the diff.
