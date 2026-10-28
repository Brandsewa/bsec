# Multi-market Phase 1: foundation (in progress)

- **Date:** 2026-10-28
- **Agent:** claude
- **Branch:** `docs/multimarket-phase0` (Phase 1 work stacked locally; owner decision: nothing is pushed or merged until the whole plan is built)
- **Area:** db, domain, contracts
- **Type:** feature
- **Supersedes:** none

## Summary
Phase 1 of `docs/MULTIMARKET-PLAN.md`, no behaviour change for existing stores. Slices done: 1a money and weight-unit helpers; 1b markets tables, base-market backfill, provisioning. Slice 1c (replace hardcoded rupee sign and `en-IN` in about 125 source files) is not done.

## What changed
- `packages/contracts/src/money.ts`, `units.ts` (exported from the package root and `@bs/contracts/money`, `/units`): `formatMoney`, minor-unit exponents, `toMinorUnits`, grams to oz/lb/kg.
- Migration `0087_markets_foundation`: `markets`, `market_countries`, `platform_countries`; `store_settings.unit_system`; `carts.market_id`; `orders.market_id/base_currency/fx_rate/base_grand_total`; one base market per existing store, covering the countries its shipping zones already serve.
- `packages/domain/src/saas/provisioning.ts`: a new store gets its base market (India for now; Phase 1B reads the signup country).

## Decisions and trade-offs
- `formatMoney` drops ".00" on whole amounts and keeps two digits otherwise ("₹1,299", "₹1,299.50"); the old code printed "₹1,299.5". Intentional.
- Backfill sets `base_grand_total = grand_total` for old orders (all INR, so the base total equals the charged total).

## Verification
- Ran: `@bs/contracts` money/units tests 10 pass; `@bs/db` full suite 47 pass (includes the new `markets-backfill.int.test.ts`, 6 tests on a database built at migration 0086 with old-shape stores); `@bs/domain` `provisioning.int.test.ts` 4 pass; typecheck contracts, db, domain pass; `pnpm docs:check` pass.
- NOT run yet: full domain heavy suite and isolation suite; lint on db and domain; UI.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (section 7: schema file and migration 0087)
- [x] ADR-040 (Phase 0)
- [ ] `progress.md`: update when Phase 1 completes

## Follow-ups and open questions
- Slice 1c: move call sites to `formatMoney` with the currency of the order/cart/store; Brand Sewa's own INR plan prices stay rupees via `formatMoney(x, "INR")`.
- Slice 1d: store-level unit system setting in admin (product weight and shipping weight tiers).

## Definition of done
Not yet: slices 1c and 1d outstanding.
