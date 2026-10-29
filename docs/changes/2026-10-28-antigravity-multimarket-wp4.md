# Multi-Market WP-4: Signup by Country and Unit-System Settings

- **Date:** 2026-10-28
- **Agent:** antigravity
- **Branch:** `feat/multimarket-wp4` (not merged yet)
- **Area:** web, domain, contracts, admin
- **Type:** feature
- **Supersedes:** none

## Summary
Implements WP-4 of the multi-market roadmap. Merchant signup now supports selecting a country (backed by enabled entries in `platform_countries`, including India, United States, and Canada). Provisioning initializes the store's currency, timezone, locale, unit system (metric/imperial), default weight unit, country-aware base market (with inclusive tax display for India and exclusive for non-India), and default country shipping zone linked to the base market with native-currency rates. In store settings, merchants can view their registered country and configure their unit system and default weight unit, and admin product/variant weight inputs round-trip seamlessly between display units and canonical grams in the database.

## What changed
- **Contracts (`packages/contracts/src/admin.ts`):** Added `unitSystem` (`"metric" | "imperial"`) and `weightUnit` (`"g" | "kg" | "oz" | "lb"`) to `StoreSettings` schema and settings `update` route contract.
- **Domain (`packages/domain`):**
  - Updated `packages/domain/src/admin/store-config.ts` to read, audit, and update `unitSystem` and `weightUnit` settings as well as expose `country`.
  - Updated `packages/domain/src/saas/provisioning.ts` to accept `country` on `ProvisionTenantInput`, dynamically look up country defaults from `platform_countries`, provision country-specific base market (`taxDisplay: "inclusive"` for India, `"exclusive"` for US/CA), set initial `unitSystem` and `weightUnit`, create default shipping zone linked to the base market (`market_id`), and seed default shipping rates in the country's native currency.
  - Updated `packages/domain/src/saas/signup.ts` to accept `country` in signup completion, expose `priceMonthlyUsdCents` and `priceYearlyUsdCents` on public plans, and provide `listPlatformCountries`.
- **Storefront / Signup (`apps/web`):**
  - Added `GET /api/saas/countries` endpoint in `apps/web/src/server/api.ts` to list enabled signup countries.
  - Updated `apps/web/src/app/signup/page.tsx` with country selection on step 1, dynamic region/province/state dropdowns and country-specific postal code validation on step 3, and country-driven plan pricing (INR for India, USD for US/CA) on step 4 using `formatMoney`.
- **Store Admin UI (`apps/admin`):**
  - Updated `apps/admin/src/routes/_store/settings/store-details.tsx` to display store country, and added accessible select controls for `unitSystem` and `weightUnit`.
  - Updated `apps/admin/src/components/product/variant-drawer.tsx` to read the store's `weightUnit`, render converted display weights with appropriate step sizes (1 for g, 0.01 for oz, 0.001 for kg/lb), and convert back to canonical grams via `@bs/contracts/units` on save.
  - Updated `apps/admin/src/components/product/variant-builder.tsx` to format variant weight cells using `formatWeight(v.weightGrams, weightUnit)`.
- **Database / Migrations:** No migration 0091 needed; existing columns in `platform_countries`, `store_settings`, and `shipping_zones.market_id` cover all schema requirements.

## Decisions and trade-offs
- **Grams canonical representation:** Integer grams (`variants.weight_grams`) remain the single source of truth in the database. Unit conversions are performed at the UI boundary using `@bs/contracts/units` helpers (`gramsToUnit`, `unitToGrams`, `formatWeight`).
- **Base market tax display:** In line with ADR-040 and local regulations, Indian stores default to `inclusive` tax display, while US and Canada default to `exclusive` tax display.
- **Shipping Zone linkage:** Initial shipping zones link to the newly created base market via `shipping_zones.market_id`.

## Verification
- `pnpm typecheck`: Passed cleanly across all 16 packages.
- `pnpm lint`: Passed cleanly across all 16 packages (0 errors, 0 warnings in modified files).
- `pnpm docs:check`: Passed (`docs:check ok`).
- `pnpm --filter @bs/contracts test`: 4 test files, 32 passed.
- `pnpm --filter @bs/admin test`: 17 test files, 102 passed.
- `pnpm --filter @bs/web build`: Production build succeeded.
- `pnpm --filter @bs/web test test/perf-budget-bundle.int.test.ts`: 3 passed (client JS bundles verified under budget limits).
- `pnpm --filter @bs/web test`: 32 test files, 246 passed.
- `pnpm --filter @bs/domain test test/provisioning.int.test.ts`: 6 passed (including atomic provisioning of India, US with USD/imperial/exclusive tax, and Canada with CAD/metric/exclusive tax).
- `pnpm --filter @bs/domain test test/signup-pipeline.int.test.ts`: 5 passed.
- `pnpm --filter @bs/domain test test/isolation.int.test.ts`: 1,670 passed against real PostgreSQL.
- **NOT verified:** Live production deploy (deferred per rules; local branch only).

## Docs updated
- [ ] `docs/ARCHITECTURE.md` (Deferred to Claude per handoff instructions: "DO NOT TOUCH docs/ARCHITECTURE.md")
- [ ] ADR (ADR-040 already documents market model; no new ADR needed)
- [ ] `DEPLOYMENT.md` / RUNBOOK (Not needed; no new infrastructure or env vars)
- [ ] `progress.md` (Deferred to Claude per handoff instructions: "DO NOT TOUCH progress.md")

## Follow-ups and open questions
- Once WP-4 is verified by Claude, Claude will update `progress.md` and `docs/ARCHITECTURE.md` and merge to `main`.

## Definition of done
- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (real-DB test for country provisioning and market/shipping zone defaults).
- [ ] `docs/ARCHITECTURE.md` updated (Claude owns doc updates per handoff instructions).
- [x] ADR written or updated if you made or changed an architectural decision (existing ADR-040 covers this).
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: what you verified live, what you only read, what you did not do.
- [x] Change record created and ready for verification.
