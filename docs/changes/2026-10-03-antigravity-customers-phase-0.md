# Customers Phase 0: Truthful Metrics, Guest Customers & Consent History

- **Date:** 2026-10-03
- **Agent:** antigravity
- **Branch:** `feat/customers-phase-0` (not merged yet)
- **Area:** db, domain, web, admin
- **Type:** feature
- **Supersedes:** none

## Summary
Implemented Phase 0 (Foundations) of the Customers upgrade in `bsec` according to `docs/CUSTOMERS-IMPLEMENTATION-PLAN.md` and `docs/CUSTOMERS-SECTION-FINDINGS.md`. This establishes: (1) truthful customer metrics derived from order financial state with asynchronous cached sorting columns and drift sweeps, (2) first-class guest customer handling at checkout without overwriting verified accounts and enabling secure account claim on email/OTP verification, and (3) a single-writer marketing consent engine (`setMarketingConsent`) with full audit history in `customer_consent_events`.

## What changed
- **Database & Migration (`0028_customers_phase0.sql`)**:
  - Added `is_guest`, `marketing_state`, `marketing_source`, and `marketing_updated_at` to `customers` table.
  - Added indexes on `customers (tenant_id, marketing_state)`, `customers (tenant_id, is_guest)`, and `customers (tenant_id, total_spend desc, orders_count desc)`.
  - Created `customer_consent_events` tenant table with RLS, composite foreign key to `customers`, and indexes.
  - Added `customers.refresh_metrics` background queue in `packages/db/src/queues.ts`.
- **Domain Services**:
  - `packages/domain/src/customers/metrics.ts`: Truthful metrics SQL computation `customerMetricsSql(tenantId)` based on order state machine rules (completed/delivered/collected/paid orders count and sum `total_amount`), `refreshCustomerMetrics`, and `runCustomerMetricsSweep` for drift repair.
  - `packages/domain/src/customers/consent.ts`: Single writer `setMarketingConsent` that writes `customer_consent_events`, keeps `accepts_marketing` and `marketing_state` in lockstep sync, and writes `audit_logs` when modified by staff.
  - `packages/domain/src/orders/checkout.ts`: Storefront checkout upserts guest customer (`is_guest = true`) when shopper is not logged in, protects existing customer accounts from name/phone overwrite, and records marketing consent if opted in.
  - `packages/domain/src/customers/auth.ts`: Upon email verification (`verifyCustomerEmail`), claims guest records (`is_guest = false`) and attaches historical guest orders to the verified account.
  - `packages/domain/src/customers/unsubscribe.ts`: Uses `setMarketingConsent(..., state: 'unsubscribed', source: 'unsubscribe_link')`.
  - `packages/domain/src/customers/profile.ts`: Uses `setMarketingConsent(..., source: 'account_page')`.
  - `packages/domain/src/storefront/newsletter.ts`: Uses `setMarketingConsent(..., state: 'subscribed', source: 'storefront_form')`.
  - `packages/domain/src/admin/customers.ts`: Admin customer listing and customer detail query truthful real-time metrics via `customerMetricsSql`.
  - `packages/domain/src/jobs.ts`: Registered `handleCustomerRefreshMetricsJob` on `customers.refresh_metrics` queue and hooked metrics refresh queue triggers on order creation and payment collection.

## Decisions and trade-offs
- **Truthful Metrics vs Cached Sorting Copy**: Following PLAN §0a, customer metrics (orders count, total spend, last order at) are computed directly in real-time from orders using a single lateral SQL fragment `customerMetricsSql(tenantId)`. The columns on `customers` are an asynchronous cache for sorting/filtering kept fresh via pg-boss jobs (`customers.refresh_metrics`) and a periodic drift sweep (`runCustomerMetricsSweep`).
- **Account Protection & Anti-Takeover**: Unauthenticated guest checkouts using an existing customer's email attach to the customer row for order association but never overwrite existing customer passwords, verified flags, names, or phone numbers. Guest accounts convert to full accounts (`is_guest = false`) only upon email verification or OTP verification.
- **Single Consent Writer**: All consent mutations flow through `setMarketingConsent` to guarantee that `accepts_marketing` and `marketing_state` never diverge, and that an immutable audit trail is logged to `customer_consent_events`.

## Verification
- `pnpm typecheck`: **PASSED** (15/15 packages clean).
- `pnpm lint`: **PASSED** (15/15 packages clean).
- `pnpm build`: **PASSED** (all 6 workspace apps/packages built successfully).
- `pnpm docs:check`: **PASSED** (`docs:check ok`).
- `pnpm --filter @bs/domain test:fast`: **PASSED** (28 test files, 238 tests passed).
- `pnpm --filter @bs/admin test:fast`: **PASSED** (3 test files, 25 tests passed).
- `pnpm --filter @bs/web test:fast`: **PASSED** (17 test files, 163 tests passed).
- `pnpm --filter @bs/domain test:heavy` (real PostgreSQL): **PASSED** (63 test files, 1190 tests passed).
  - Includes dedicated `test/customers-phase0.int.test.ts` (3 tests covering Phase 0a truthful metrics, Phase 0b guest checkouts & claim, Phase 0c single consent writer and event history).
- `pnpm --filter @bs/domain test -- test/isolation.int.test.ts`: **PASSED** (1 test file, 755 tests passed).

## Docs updated
- [x] `docs/ARCHITECTURE.md` (updated tables under `customers.ts`, migration `0028_customers_phase0.sql`, and pg-boss queue `customers.refresh_metrics`).
- [x] `progress.md` (recorded Customers Phase 0 milestone and in-flight tracking).

## Follow-ups and open questions
- Ready for Claude verification against acceptance criteria in `docs/CUSTOMERS-IMPLEMENTATION-PLAN.md` before proceeding to Phase 1 (customer detail page, addresses, activity timeline, admin edit forms).
- Store credit and loyalty points remain strictly out of scope.

## Definition of done
- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (real-DB test for anything touching tenancy, money, auth or permissions).
- [x] `docs/ARCHITECTURE.md` updated with new tables, migration, and queues.
- [x] ADR not needed (follows existing architectural blueprints and `docs/CUSTOMERS-IMPLEMENTATION-PLAN.md`).
- [x] `DEPLOYMENT.md` / RUNBOOK: no new environment variables or infrastructure changes required.
- [x] Change record created in `docs/changes/2026-10-03-antigravity-customers-phase-0.md` and `progress.md` updated.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: all tests executed and verified against real Postgres.
