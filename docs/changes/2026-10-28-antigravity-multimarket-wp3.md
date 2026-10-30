# Multi-Market WP-3: Shipping Admin and Policy Surfaces

- **Date:** 2026-10-28
- **Agent:** antigravity
- **Branch:** `feat/multimarket-wp3` (merged in #150, a23f5a7)
- **Area:** contracts, domain, admin, web
- **Type:** feature
- **Supersedes:** none

## Summary
Implements Work Package 3 (WP-3) of the Multi-Market feature for bsec. Shipping administration is now fully market-aware: shipping zones attach to a specific market (`shipping_zones.market_id`), zone editor displays and validates countries based on the market's assigned countries, zone rates and tier thresholds are displayed in the market's currency (`formatMoney` from `@bs/contracts/money`), and weight tiers accept and display values in the market's unit system (`@bs/contracts/units` converting between stored grams and lbs/kg).
Additionally, order policy surfaces now display the order's immutable policy snapshot (`orders.policy_snapshot`), which is preserved and rendered across customer order status pages, transactional emails, and the return request flow, guaranteeing that merchant edits to active policies never alter past order agreements.

## What changed
- **Contracts (`packages/contracts/src/admin.ts`)**:
  - Appended `marketId: z.string().uuid().nullable().optional()` to `ShippingZoneItem`, `UpdateShippingInput`, `SaveShippingZone`, and `ShippingPreviewInput`.
- **Domain Services**:
  - `packages/domain/src/orders/shipping-rates.ts`: Replaced hardcoded `₹` with `formatMoney(rate.thresholdPaise, currency)`. Updated `getAdminShippingSettings`, `updateAdminShippingSettings`, and `saveAdminShippingZones` to accept and persist `marketId`. Updated `previewShippingRate` to resolve currency and weight limits from the selected market.
  - `packages/domain/src/admin/return-settings.ts`: Implemented `resolveMarketReturnSettings(base, overrides, policyTextOverride)`.
  - `packages/domain/src/orders/manual-lifecycle.ts`: Updated `requestReturn` and `getOrderReturnsByToken` to resolve return rules from `order.policySnapshot` (falling back to market policies if absent). Replaced hardcoded `₹` with `formatMoney(amount, order.currency)`.
  - `packages/domain/src/customers/orders.ts`: Extended `CustomerOrderDetail` and return values with `policySnapshot`.
  - `packages/domain/src/system/email-context.ts` & `email-templates.ts`: Populated `policyText` from `order.policySnapshot?.text` and rendered the policy section in transactional order emails when present.
- **Admin Shipping UI**:
  - `apps/admin/src/lib/shipping-draft.ts`: Added `marketId` to `ZoneDraft`. Updated `draftsFromSettings` and `draftsToPayload` to convert weight tier values between stored integer grams and the zone's market unit system (`gramsToUnit` / `unitToGrams`).
  - `apps/admin/src/routes/_store/settings/shipping.tsx`: Added market selector (`SimpleSelect`) to zone cards. Constrained country selection to the market's configured countries. Dynamically rendered currency symbol prefixes and weight unit labels according to the market. Updated the rate calculator preview to accept and display rates in the selected market and currency.
- **Storefront Order Status UI**:
  - `apps/web/src/app/orders/[token]/thank-you/page.tsx` & `apps/web/src/app/o/[token]/page.tsx`: Removed `toLocaleDateString("en-IN", ...)`. Rendered immutable policy section displaying `order.policySnapshot.text` and `marketName`.

## Decisions and trade-offs
- **Weight Unit Conversions**:
  - Stored database values in `shipping_rates.min_weight_grams` and `max_weight_grams` remain strictly integer grams.
  - The admin UI translates grams to/from the market's unit system using `@bs/contracts/units` (`gramsToUnit` and `unitToGrams`), ensuring 1 lb entered stores as 454 g and roundtrips back cleanly without precision loss.
- **Policy Snapshot Immutability**:
  - `orders.policy_snapshot` is loaded directly by customer order queries (`getOrderByActionToken`, `getCustomerOrderDetail`) and email rendering (`loadEmailOrder`). Merchant updates to `market_policies` affect only subsequent orders; existing order snapshots remain completely unchanged.
- **Zero Migrations in WP-3**:
  - Leveraged existing `shipping_zones.market_id` and `orders.policy_snapshot` columns; no new database migrations were introduced, matching WP-3 constraints.

## Verification
- **Test Suite Results**:
  - `pnpm typecheck`: Clean pass across all monorepo packages.
  - `pnpm lint`: Clean pass across all 16 packages.
  - `pnpm docs:check`: Clean pass (`docs:check ok`).
  - Unit tests:
    - `pnpm --filter @bs/admin test test/shipping-draft.test.ts`: Passed (2 tests).
    - `pnpm --filter @bs/admin test --no-file-parallelism`: Passed (18 test files, 104 passed).
    - `pnpm --filter @bs/web test`: Passed (32 test files, 246 passed).
  - Real PostgreSQL DB Integration Tests (`TEST_PG_ADMIN_URL=postgres://postgres:postgres@localhost:55432/postgres`):
    - `packages/domain/test/shipping-multimarket.int.test.ts`: Passed (2 tests).
      - Verifies US zone with USD rate and lb weight tier saves and prices a US order.
      - Verifies order policy snapshot is preserved and rendered after merchant edits market policy.
    - `packages/domain/test/shipping-zones.int.test.ts`: Passed (4 tests).
    - `packages/domain/test/shipping-zones-tiers.int.test.ts`: Passed (5 tests).
    - `packages/domain/test/markets-checkout.int.test.ts`: Passed (8 tests).
    - Combined shipping suite: Passed (4 test files, 19 tests total).
    - `packages/domain/test/isolation.int.test.ts`: Passed (1 test file, 1,670 tests passed).
  - Web Bundle & Client Performance:
    - `pnpm --filter @bs/web build`: Clean build.
    - `pnpm --filter @bs/web test test/perf-budget-bundle.int.test.ts`: Passed (Product page client JS gzip: 48.63 KB, below 50.00 KB limit).
- **Exercised by hand**:
  - Inspected admin shipping page components and responsiveness at 375 px and desktop widths.
  - Verified currency symbol formatting and unit conversions in the shipping zone drafts and preview calculator.
- **NOT verified**:
  - Live external payment gateways or courier integrations (deferred per project rules; test/sandbox mode only).

## Docs to update (for Claude during hand-off / merge)
- [ ] `docs/ARCHITECTURE.md`: Document `marketId` on shipping zone contracts and settings procedures, and policy snapshot surfaces on customer order views.
- [ ] `progress.md`: Mark WP-3 Multi-Market Shipping & Policies complete under multi-market milestones.
- [ ] ADR 040 (`docs/adr/040-markets.md`): Note completed shipping zone market affiliation and policy snapshot flow.

## Follow-ups and open questions
- None. All requirements of WP-3 completed cleanly within prompt and AGENTS.md rules.

## Definition of done
- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (real-DB test for US shipping zone, lb tiers, and policy snapshot immutability).
- [ ] `docs/ARCHITECTURE.md` updated if you changed structure, routes, tables, jobs, auth, blocks, env vars or gates (listed above for Claude).
- [ ] ADR written or updated if you made or changed an architectural decision (noted above for Claude).
- [ ] `DEPLOYMENT.md` / RUNBOOK / not needed (no infra or env changes).
- [x] A change record in `docs/changes/` created (`docs/changes/2026-10-28-antigravity-multimarket-wp3.md`).
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: what you verified live, what you only read, what you did not do.
