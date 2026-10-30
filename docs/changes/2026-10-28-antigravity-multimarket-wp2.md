# Multi-Market WP-2: Settings > Markets Admin UI & PayPal Connect

- **Date:** 2026-10-28
- **Agent:** antigravity
- **Branch:** `feat/multimarket-wp2` (merged in #150, a23f5a7)
- **Area:** admin, web, contracts
- **Type:** feature
- **Supersedes:** none

## Summary
Implements WP-2 of the multi-market feature (ADR-040, `docs/MULTIMARKET-PLAN.md` §6-7). Store merchants can now configure regional markets under Settings > Markets, manage countries, pricing exchange rates, price adjustments, rounding, catalog product overrides, payment gateways, returns and cancellation policy terms, and tax rules. Also adds PayPal gateway connection support to Settings > Payments with live/test mode configuration and live checkout indicators.

## What changed
- **Settings Navigation:**
  - Added Markets item (`/settings/markets`, icon `Globe`, permission `markets.manage`) under the `selling` group in `apps/admin/src/components/settings/settings-nav.ts`.
- **Settings > Payments (`apps/admin/src/routes/_store/settings/payments.tsx`):**
  - Added PayPal blurb to `GATEWAY_BLURB`.
  - Added "Checkout live" badge when `provider.checkoutLive` is true and provider is active.
  - Added full PayPal credentials form in `GatewaySheet`: Client ID (`keyId`), Client Secret (`keySecret`), Webhook ID (`webhookSecret`), and environment mode selector (`test` vs `live`).
- **Markets Admin UI Routes:**
  - `apps/admin/src/routes/_store/settings/markets.tsx`: Markets list view showing base badge, status badges, countries, currency, URL prefix, plan limit ("n of m extra markets used"), add market wizard modal trigger, and delete confirmation dialog (with order check).
  - `apps/admin/src/routes/_store/settings/markets_.$id.tsx`: Market details workspace with header actions, activate/disable action with readiness confirmation, readiness checklist card, and tabs:
    - **General:** Market name, currency, target countries (`MultiSelect`), URL path prefix, unit system, tax display, and rounding rules.
    - **Pricing & Currency:** Exchange rate with last-updated note, markup adjustment %, rounding rules, variant price overrides table from `listPrices` with inline fixed price editing and clear action, and CSV export/import for variant pricing.
    - **Catalog:** All products vs selected products toggle (`catalogMode`), product search, and per-product market visibility switches.
    - **Payments:** Connected store payment gateways with blocking or warning details from gateway rules, and switches to enable/disable methods for the market.
    - **Shipping:** Market shipping rate count and explanatory banner with deep-link to `/settings/shipping`.
    - **Returns & Cancellation:** Merchant policy textarea with character counter and copyable, labelled example templates for returns and cancellation terms.
    - **Taxes:** Tax collection toggle, shipping tax toggle, dynamic tax rates table (country, region, tax name, rate %), and compliance responsibility acknowledgement card with Plan 8.1 legal checkbox.
- **Components:**
  - `apps/admin/src/components/markets/types.ts`: Preset definitions (USA/USD, Canada/CAD, India/INR, International/USD) and options.
  - `apps/admin/src/components/markets/market-badge.tsx`: Status and Base Market badges.
  - `apps/admin/src/components/markets/market-readiness.tsx`: Readiness checklist card.
  - `apps/admin/src/components/markets/add-market-dialog.tsx`: Market creation wizard with presets.
  - `apps/admin/src/components/markets/compliance-ack-card.tsx`: Regulatory responsibility confirmation.
  - `apps/admin/src/components/markets/market-general-tab.tsx`, `market-pricing-tab.tsx`, `market-catalog-tab.tsx`, `market-payments-tab.tsx`, `market-shipping-tab.tsx`, `market-policies-tab.tsx`, `market-taxes-tab.tsx`.
- **Tests & Verification:**
  - Route tests in `apps/admin/test/routes.test.ts` updated to assert `pendingComponent` for `/settings/markets` and `/settings/markets/$id`.
  - E2E specification in `e2e/markets.spec.ts` covering market creation, readiness check, fixed pricing, and activation prerequisites.

## Decisions and trade-offs
- Used `client.admin.markets.*` from `@bs/contracts` for direct RPC mutations to ensure clean TypeScript contract matching without type discrepancies.
- Strictly preserved the Ponytail invariant and admin UI standards: no native `<select>`, no `window.confirm`, no un-formatted currency figures (all formatted via `@bs/contracts/money`), and Geist tokens used throughout.
- Kept policy text and tax rates merchant-driven without publishing default rates or policies, in adherence with ADR-040.

## Verification
- `pnpm --filter @bs/admin test`: 17 test files passed, 102 tests passed.
- `pnpm --filter @bs/admin build`: vite build passed (4,633 modules transformed, 7.08s).
- `pnpm typecheck`: 15 packages successful (including `@bs/admin`, `@bs/contracts`, `@bs/domain`, `@bs/ui`).
- `pnpm lint`: 15 packages successful (0 errors, 0 warnings in `@bs/admin`).
- `pnpm docs:check`: docs:check ok.

## Docs updated
- [ ] `docs/ARCHITECTURE.md` (Deferred to primary coding agent / verifier per prompt guidelines)
- [ ] ADR (ADR-040 already present; follows specifications)
- [ ] `DEPLOYMENT.md` (No infrastructure or env var changes required)
- [ ] `progress.md` (Deferred to verifier)

## Follow-ups and open questions
- The UI surfaces the full readiness checklist, but note that shipping zones and rates are managed under Settings > Shipping. An in-place banner with deep link is provided to guide the merchant seamlessly.

## Definition of done
- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (pendingComponent route tests in `routes.test.ts` and E2E in `e2e/markets.spec.ts`).
- [ ] `docs/ARCHITECTURE.md` updated if you changed structure (reserved for Claude).
- [ ] ADR written or updated (ADR-040 followed).
- [ ] `DEPLOYMENT.md` / `infra/coolify/RUNBOOK.md` updated if env vars change (none changed).
- [x] A change record in `docs/changes/` (this file).
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: what you verified live, what you only read, what you did not do.
- [ ] After merge: change record updated with PR/commit.
