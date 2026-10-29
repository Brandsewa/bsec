# Multi-Market WP-7 Test Round and Walkthrough

- **Date:** 2026-10-29
- **Agent:** antigravity
- **Branch:** `feat/multimarket-wp7` (not merged yet)
- **Area:** domain, db, contracts, auth, blocks, platform, admin, web, e2e
- **Type:** test
- **Supersedes:** none

## Summary

Automated gate execution and test round for the multi-market feature (WP-7). Full suite checks were executed against real PostgreSQL 18 across packages, bundle budgets verified against production Next.js builds, and local stack runtime behaviors inspected across the pilot store workflows. No source code was modified; all findings and gate results are documented below for Claude's triage.

## Part A: Automated Gate & Test Results

### 1. Static Checks
* `pnpm typecheck`: **PASS** (15 packages in scope, full turbo cache hit, zero errors).
* `pnpm lint`: **PASS** (all packages pass, 5 Next.js image/navigation warnings in `@bs/web`, 2 hook warnings in `@bs/block-editor`, 0 errors).
* `pnpm docs:check`: **PASS** (`docs:check ok`).

### 2. Performance Budget & Bundle Size
* `pnpm --filter @bs/web build`: **PASS** (compiled in 22s, static pages generated successfully).
* `apps/web/test/perf-budget-bundle.int.test.ts`: **PASS** (3 passed).
  * Product page `/products/[slug]` client JS gzip payload: **48.63 KB (49,796 bytes)**, maintaining headroom under the 50 KB gzip ceiling (measured at 48.63 KB, exactly matching prior record).

### 3. Package Test Suites (Real PostgreSQL 18, `--no-file-parallelism`)
* **`@bs/payments`**: **PASS** (6 files, 54 passed).
  * `test/razorpay.test.ts` (10 passed)
  * `test/paypal.test.ts` (11 passed)
  * `test/cashfree.test.ts` (12 passed)
  * `test/stripe.test.ts` (9 passed)
  * `test/cod.test.ts` (6 passed)
  * `test/crypto.test.ts` (6 passed)
* **`@bs/contracts`**: **PASS** (4 files, 32 passed).
  * `test/contracts.test.ts` (14 passed)
  * `test/storefront.test.ts` (7 passed)
  * `test/money-units.test.ts` (10 passed)
  * `test/health.test.ts` (1 passed)
* **`@bs/auth`**: **PASS** (4 files, 15 passed).
  * `test/permissions.test.ts` (8 passed)
  * `test/google.test.ts` (4 passed)
  * `test/auth.test.ts` (2 passed)
  * `test/permissions-pure.test.ts` (1 passed)
* **`@bs/blocks`**: **PASS** (24 files, 265 passed).
  * Layout blocks, theme pages, responsive settings, registry, Bricks hierarchy all clean.
* **`@bs/platform`**: **PASS** (7 files, 138 passed).
  * Audit coverage (72 passed), HTTP MFA (6 passed), RBAC (4 passed), password reset (4 passed), read endpoints (44 passed), create store (5 passed), app (3 passed).
* **`@bs/admin`**: **PASS** (19 files, 108 passed).
  * Settings routes, catalog, customers, domains, checkout, currency hooks (`use-store-currency.test.tsx`), media border tokens, draft variants, policy rich text all pass with `--no-file-parallelism`.
* **`@bs/domain`**:
  * Fast suite (`pnpm --filter @bs/domain test:fast`): **PASS** (63 files, 524 passed).
  * Full heavy suite (`vitest run --no-file-parallelism`): **3,212 passed**, 1 worker exit with code 3221226505 (Windows worker fork crash) during `settings-phase-7.int.test.ts`.
  * Standalone re-run of `settings-phase-7.int.test.ts`: **PASS** (16 passed in 1.3s).
* **`@bs/web`**:
  * 31 files, 243 passed (excluding initial pre-build check that required `.next`).
* **`@bs/db`**:
  * 5 files, 41 passed (`b2-grants.int.test.ts`, `schema.test.ts`, `roles.int.test.ts`, `tenant-table.test.ts`, `with-tenant.test.ts`).
  * `markets-backfill.int.test.ts` (6 failed): Fails due to a migration directory path mismatch when the test attempts to run migrations against a temporary folder where subsequent migrations were sliced out.

---

## Part B: Pilot Stores & Walkthrough Analysis

### 1. Pilot 1: Indian Store Selling Abroad (INR base, USD Market)
- **Setup & Signup:** Indian signup provisions default base market (India/INR) with GSTIN enabled, metric weight unit defaults (`kg`), and INR currency formatting.
- **Markets Wizard & Pricing:**
  - Settings > Markets wizard (`/settings/markets`) creates USD "International" market with exchange rate (e.g., 0.012), `charm_99` rounding, US country assignment.
  - Variant pricing recalculates based on exchange rate and rounding rules while preserving any explicit manual fixed overrides in `market_prices`.
- **Storefront & Currency:**
  - Storefront market switcher and suggestion banner activate upon detecting country context (`CF-IPCountry: US` / `cf-ray`), displaying a recommendation banner without silently forcing a market switch.
  - Prefixed routes (`/us/...`) render prices in `$` across catalog, product detail, collections, search, mini-cart, and checkout.
  - Page source correctly outputs `hreflang` alternate tags and canonical link tags matching the resolved market prefix.
- **Checkout & Payments:**
  - COD available for domestic base market; disabled for international USD market.
  - PayPal sandbox payment flow: **BLOCKED** from end-to-end execution due to lack of live/sandbox client credentials in the local environment; verified up to provider invocation and credential check.

### 2. Pilot 2: US-Based Store (USD base, Canada CAD Market)
- **Signup:** Country United States sets currency to USD, unit system to imperial (`lb`), and hides the Indian GSTIN tax-ID field.
- **Canada Market & Taxes:**
  - Canada market (CAD) configures manual GST/PST tax rows per province.
  - Address validation verifies Canadian postal codes (`A1A 1A1`) and provinces.
  - Stripe Sandbox: **BLOCKED** due to unset local Stripe test keys.

### 3. Pilot 3: Canada-Based Store (CAD base, Metric)
- **Signup & Plan Limits:**
  - Canada signup configures CAD base currency and metric default units.
  - Adding 1 extra market succeeds (Starter tier allows 1 extra market).
  - Attempting to add a 2nd extra market correctly triggers the plan quota limit error in domain service.

---

## Defects & Findings

### Defect 1 (Medium): Migration Test Path Resolution Flake in `markets-backfill.int.test.ts`
- **Steps to reproduce:** Run `pnpm --filter @bs/db test` or `vitest run test/markets-backfill.int.test.ts`.
- **Expected:** Migration 0087 backfill test constructs temporary directory, slices migrations 0087-0089, migrates to 0086, seeds old-shape stores, then applies 0087 from the source folder.
- **Actual:** `runMigrations` without explicit parameter resolves to `defaultMigrations` which evaluates relative to `dist/` rather than the temporary folder, throwing `relation "markets" does not exist`.
- **Severity:** Medium (test harness path resolution only; runtime migrations run via `node dist/migrate.js` succeed cleanly).

### Defect 2 (Low): Vitest Worker Exit Code 3221226505 on Windows in Domain Heavy Run
- **Steps to reproduce:** Execute `pnpm exec vitest run --no-file-parallelism` across all 194 domain test files simultaneously on Windows.
- **Expected:** Full suite executes to completion without node child-process exit faults.
- **Actual:** Forked worker running `test/settings-phase-7.int.test.ts` exited unexpectedly with code 3221226505; re-running the single file alone immediately passes (16/16).
- **Severity:** Low (known Windows child-process flake documented in handoff instructions).

---

## Blocked Items (Awaiting Sandbox Credentials)
1. **PayPal Sandbox End-to-End Capture/Return:** Requires sandbox client ID, secret, and webhook ID to complete live OAuth approval and capture webhook calls in local store walkthrough.
2. **Stripe Test Mode Elements/Redirect:** Requires Stripe test publishable/secret keys to complete payment modal submission.

---

## Definition of Done Checklist
- [x] Code follows AGENTS.md section 2 and 3; gate in section 4 executed.
- [x] Automated tests executed across all workspace packages with real Postgres.
- [x] Performance bundle budget verified (< 50 KB gzip product page payload).
- [x] No source files edited; commit contains only change report and test records.
- [x] Change report written with exact counts, defects, and blocked items.
