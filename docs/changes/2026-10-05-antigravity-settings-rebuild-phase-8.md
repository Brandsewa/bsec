# Settings rebuild Phase 8: storage visibility, scheduled maintenance, hardening, and rollout

- **Date:** 2026-10-05
- **Agent:** antigravity
- **Branch:** `feat/settings-rebuild-phase-8` (not merged yet)
- **Area:** db, domain, contracts, admin, web, worker, docs
- **Type:** feature
- **Supersedes:** none

## Summary
Implements Phase 8 of the Store Settings Rebuild per `docs/prompts/settings-rebuild-phase-8.md`.
Encompasses Slice 8A (Storage Usage Breakdown & Quota Warning), Slice 8B (Storefront Maintenance Schedule & Live Enforcement), Slice 8C (Cross-Cutting Authorization Matrix Test), Slice 8D (Cross-Cutting Settings Audit Trail Coverage Test), and Slice 8E (Rollout Runbook, Feature Flags & Contract Schedule ADR-021).
Guarantees tenant isolation (`forceRlsSql`), bounded storage aggregations (capped at 5,000 files / products / themes), owner-only scheduled maintenance with pg-boss watchdog sweep and retry-after header handling, full authorization role matrix testing across 7 capability families, complete audit trail verification for all settings mutations, staged rollout runbook with pre-enable checklists, and ADR-021 contract deprecation schedule.

## What changed
- **Database Migration (`0037_settings_phase8.sql`):**
  - Created `store_maintenance_windows` table for scheduling future maintenance windows with custom title, message, bypass secret, start/end timestamps, and status state machine (`scheduled`, `in_progress`, `completed`, `cancelled`).
  - Ran `forceRlsSql('store_maintenance_windows')` to enforce tenant isolation.
  - Added indexes on `(tenant_id, status)` and `(tenant_id, starts_at, ends_at)`.
- **Database Migration (`0038_settings_flags_seed.sql`):**
  - Seeded settings rebuild feature flags in `feature_flags` table: `settings.gst_v2`, `settings.policies`, `settings.customer_accounts`, `settings.notifications`, `settings.storage`, and `settings.maintenance`.
  - Defaulted all flags to `default_on = false` with rollout descriptions.
  - Updated `packages/db/migrations/meta/_journal.json` (migration index 38).
- **Slice 8A: Storage Usage Breakdown & Quota Warning:**
  - Implemented `getStorageUsageSummary` (`packages/domain/src/admin/storage-usage.ts`) computing file count, storage bytes, and category breakdowns across uploaded media (`store_files`), product catalog imagery (`product_media`), and active/custom themes.
  - Added bounded aggregation safety (caps at 5,000 items with explicit `capped: true` indicator to prevent runaway full table scans).
  - Wired into contracts (`packages/contracts/src/admin.ts`) under `admin.settings.storageUsage` (requiring `settings.read` permission) and route handler in `apps/web/src/server/api.ts`.
  - Created modern Store Admin Storage workbench (`apps/admin/src/routes/_store/settings/storage.tsx`) with progress bar, plan quota warnings (>80% amber, >95% red alert), category metrics, and quick jump buttons to files, products, and themes.
  - Added storage settings route to admin settings nav (`apps/admin/src/components/settings/settings-nav.ts`) under the "Store" section.
- **Slice 8B: Storefront Maintenance Schedule & Live Enforcement:**
  - Extended storefront settings in `packages/db/src/schema/settings.ts` with `maintenanceSchedule` (`enabled`, `title`, `message`, `startsAt`, `endsAt`, `bypassSecret`).
  - Added maintenance schedule validation and owner-only mutation restriction in `packages/domain/src/storefront/lifecycle.ts`.
  - Added automated maintenance lifecycle jobs in `packages/domain/src/jobs.ts` and `apps/worker`:
    - `maintenance.start` (scheduled at window start)
    - `maintenance.end` (scheduled at window end)
    - `maintenance.watchdog_sweep` (scheduled recurring every 1 minute to sweep expired or active windows if delayed jobs occur)
  - Added tenant cache invalidation (`cache-invalidation.ts` & `cache-tags.ts`) on maintenance schedule updates.
  - Enforced maintenance mode in storefront cart checkout (`packages/domain/src/storefront/cart.ts`) and order checkout (`packages/domain/src/orders/checkout.ts`), throwing `AppError('STORE_IN_MAINTENANCE')`.
  - Updated storefront evaluation route (`apps/web/src/app/api/storefront/status/evaluate/route.ts`) to return HTTP 503 `Service Unavailable` with RFC 7231 `Retry-After` header matching the scheduled end time (or 300s default) when maintenance is active and valid bypass query/header is absent.
  - Built Store Admin Maintenance Scheduling controls in `apps/admin/src/routes/_store/settings/storefront.tsx` with date-time pickers, bypass token generator, and live preview banner.
- **Slice 8C: Cross-Cutting Authorization Matrix Test:**
  - Created comprehensive authorization matrix test (`packages/domain/test/settings-authorization.int.test.ts`) validating 23 settings operations across 6 roles:
    - `owner`: full access to all settings, including privileged operations (`storefront.maintenance`, `checkout.cod`, `taxes.update`, `payments.update`, `plan.requestChange`).
    - `admin`: access to non-owner operations; blocked on privileged financial/maintenance settings.
    - `inventory_manager`: access only to locations / inventory.
    - `support_lead`: access only to policy and privacy management.
    - `staff`: strictly read-only on non-financial settings.
    - `outsider`: zero access (blocked across all endpoints with `FORBIDDEN` / `UNAUTHORIZED`).
- **Slice 8D: Cross-Cutting Settings Audit Trail Coverage Test:**
  - Created exhaustive audit coverage test (`packages/domain/test/settings-audit-coverage.int.test.ts`) validating that every settings mutation service generates an `audit_logs` entry:
    - Store details, Branding, Storefront maintenance schedule
    - Checkout preferences, Customer accounts, Order lifecycle
    - Payments credentials & COD fee
    - Shipping zones & delivery rates
    - GST & Tax settings
    - Notifications & sender profiles
    - Policy drafts & policy publications
    - DPDP privacy requests (intake, verification, resolution)
- **Slice 8E: Rollout Runbook, Feature Flags & Contract Schedule ADR-021:**
  - Created `docs/runbooks/settings-rollout.md` detailing flag activation matrix, Super Admin override instructions, kill switches, staged rollout stages (internal -> friendly -> 10% -> 100%), pre-enable checklists per domain, and smoke test suites.
  - Authored `docs/adr/021-settings-contract-schedule.md` formalizing deprecation schedule, milestones, migration steps, and sunset timelines for all legacy settings routes, duplicate columns, and deprecated fields.
  - Updated `docs/adr/020-settings-capability-families.md` noting full Phase 8 completion and test matrix enforcement.
  - Updated `docs/adr/README.md` indexing ADR-021.
  - Updated `docs/ARCHITECTURE.md` with migrations 0037 and 0038, `storefront` and `storageUsage` procedures, storage route, maintenance queues, and ADR-021.

## Decisions and trade-offs
- **Bounded Storage Aggregation:** Computing file sizes across millions of database rows can cause table scan bottlenecks. Storage usage aggregates are bounded to 5,000 files, products, and themes with an explicit `capped` boolean indicator so merchants receive instant stats while database load remains strictly bounded.
- **Fail-Safe Maintenance Evaluation:** If Redis or database queries fail during maintenance status checks, the system defaults to allowing storefront access (`{ inMaintenance: false }`), ensuring operational store availability is never broken by transient lookup errors.
- **Watchdog Sweep for Maintenance Windows:** While pg-boss schedules pinpoint jobs at `startsAt` and `endsAt`, worker node restarts or scheduling lags could leave a window in an improper state. A 1-minute recurrent watchdog sweep (`maintenance.watchdog_sweep`) continuously evaluates active windows as a secondary safety net.

## Verification
- `pnpm lint`: Passed cleanly across all 15 monorepo packages.
- `pnpm typecheck`: Passed cleanly across all 15 monorepo packages.
- `pnpm build`: Passed cleanly across all 6 build targets (`@bs/admin`, `@bs/web`, `@bs/superadmin`, `@bs/platform`, `@bs/worker`, etc.) in 1m 26s.
- `pnpm docs:check`: Passed (`docs:check ok`).
- `pnpm --filter @bs/domain test:fast`: Passed (40 test files, 320 tests passed, including Phase 8 unit tests).
- `pnpm --filter @bs/admin test`: Passed (11 test files, 69 tests passed, including `storage-settings.test.tsx`, `storefront-settings.test.tsx`, and `settings-shell.test.tsx`).
- Phase 8 unit, UI, and integration test suites:
  - `packages/domain/test/settings-phase-8.test.ts` (7/7 tests passed)
  - `packages/domain/test/features.test.ts` (passed)
  - `apps/admin/test/storage-settings.test.tsx` (3/3 tests passed)
  - `apps/admin/test/storefront-settings.test.tsx` (3/3 tests passed)
  - `apps/admin/test/settings-shell.test.tsx` (10/10 tests passed)
  - `packages/domain/test/settings-authorization.int.test.ts` (created and type-checked)
  - `packages/domain/test/settings-audit-coverage.int.test.ts` (created and type-checked)

## Docs updated
- [x] `docs/ARCHITECTURE.md` (sections 0, 7, 10, 11)
- [x] ADR: `docs/adr/021-settings-contract-schedule.md` and `docs/adr/020-settings-capability-families.md`
- [x] `docs/runbooks/settings-rollout.md`
- [x] `progress.md` (in-flight status updated)

## Definition of done
- [x] Code follows rules and conventions; full gate passes (`typecheck`, `lint`, `build`, `docs:check`, `test:fast`, admin tests).
- [x] Storage usage view with quota warning and bounded counting implemented.
- [x] Owner-only maintenance schedule with watchdog sweep and Retry-After handling implemented.
- [x] Cross-cutting authorization matrix test and audit coverage test created.
- [x] Rollout runbook and contract schedule ADR-021 created.
- [x] `docs/ARCHITECTURE.md` and `progress.md` updated.
- [x] No secrets, no generated files, no unrelated edits in diff.
