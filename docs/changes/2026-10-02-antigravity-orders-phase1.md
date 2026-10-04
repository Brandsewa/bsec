# Orders Phase 1: Order numbering fix, All orders upgrades, Orders sidebar group

- **Date:** 2026-10-02
- **Agent:** antigravity
- **Branch:** `feat/orders-phase1`
- **Area:** admin, domain, web, contracts
- **Type:** feature
- **Supersedes:** none

## Summary
Fixed the order numbering configuration defect where checkout and admin draft orders ignored store settings and hardcoded `ORD-` with 5 digits. Implemented the dedicated Settings > Orders configuration page (prefix, padding, next value validation, live preview, unsaved guard), All orders Phase 1 upgrades (Open/Archived tabs, Channel filter for online vs admin draft, five-card stats strip via `admin.orders.stats`, Products column showing first item title with +N count, and Carrier / Tracking number inputs on ship confirmation), and regrouped store navigation under an Orders group.

## What changed
- **Order Numbering Defect Fix (Step 0):**
  - Created `packages/domain/src/admin/order-settings.ts` with `getOrderSettings`, `updateOrderSettings` (with `settings.write` permission enforcement and audit logs before/after diff), `readOrderSettingsInternal`, and `allocateOrderNumber`.
  - Updated `packages/domain/src/orders/checkout.ts` and `createAdminDraftOrder` in `packages/domain/src/admin/orders.ts` to call `allocateOrderNumber(tx, tenantId)`.
  - Added `orderSettings: { get, update }` to `packages/contracts/src/admin.ts` and mounted in `apps/web/src/server/api.ts`.
  - Created `apps/admin/src/routes/_store/settings/orders.tsx` with live preview, lower number validation, and unsaved changes blocker. Added Orders link in `components/settings/settings-nav.ts`. Made General settings' prefix field read-only with a direct link.
- **All Orders Upgrades (Step 1):**
  - Added `open` and `archived` views to `VIEWS` and `orders.list` contract and domain filters.
  - Added Channel filter (`orders.source`), with draft orders created via `createAdminDraftOrder` explicitly writing `source: "admin"` and checkout writing `source: "web"`.
  - Added five-card stats strip (`admin.orders.stats`) computing `totalOrders`, `openOrders`, `paidOrders`, `totalRevenue`, `avgOrderValue` in a single SQL aggregate query.
  - Added `Products` column in orders list showing first line item title + `+N more` without per-row queries (using single batch `SELECT DISTINCT ON (order_id)`).
  - Added Carrier and Tracking Number (AWB) inputs in Mark shipped dialog, passing them through to `admin.orders.advance`.
  - Updated `useBulkRunner` toast format to report updated, skipped, and failed counts (`N orders done, M skipped, K failed.`).
- **Orders Navigation Group (Step 2):**
  - Updated `apps/admin/src/routes/_store.tsx` to group `All orders` and `Returns` under an `Orders` sidebar section, keeping individual permissions.
- **Components & Testing:**
  - Updated `apps/admin/src/components/field.tsx` to support `hint?: ReactNode` and `error?: string`.
  - Added comprehensive real-Postgres integration test suite `packages/domain/test/order-phase1.int.test.ts` (11 tests covering sequence allocation, settings update, admin draft order numbering, lower next value rejection, multi-tenant isolation, concurrency uniqueness, permission checks, source/view filters, product title query, and order stats).

## Decisions and trade-offs
- `allocateOrderNumber` reads `store_settings.order_prefix` (fallback `ORD-`) with padding 5 when `number_sequences` has not yet been initialized for the tenant, ensuring zero regressions on default or newly provisioned stores while respecting store settings.
- The stats strip runs in its own query boundary (`orpc.admin.orders.stats.queryOptions`) with skeleton cards so that the main table loading is not blocked.

## Verification
- Ran `pnpm typecheck`: passed across all 16 monorepo packages.
- Ran `pnpm lint`: passed across all 16 monorepo packages.
- Ran `pnpm build`: passed across all apps and packages (including web Next.js standalone and admin Vite build).
- Ran `pnpm docs:check`: passed (`docs:check ok`).
- Ran `pnpm --filter @bs/contracts test`: 15/15 passed.
- Ran `pnpm --filter @bs/domain test:fast`: 26 files, 205/205 passed.
- Ran `pnpm --filter @bs/domain test test/order-phase1.int.test.ts` against real Postgres: 11/11 passed.
- Ran `pnpm --filter @bs/admin test`: 3 files, 25/25 passed.
- Exercised by code: verified RLS isolation, concurrency safety under parallel allocation, audit logging diffs, and exact filter partitioning.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (sections 8 and 9 updated; last verified commit bumped)
- [x] ADR: not needed (follows existing ADR-002, ADR-004, ADR-006, and approved ORDERS plans)
- [x] `DEPLOYMENT.md`: not needed (no new env vars or services)
- [x] `progress.md` (updated In flight status)

## Follow-ups and open questions
- Proceed to Pre-orders task ("Task: Pre-orders (simple 'ships on' model)") per user roadmap.

## Definition of done
- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (real-DB test for anything touching tenancy, money, auth or permissions).
- [x] `docs/ARCHITECTURE.md` updated if you changed structure, routes, tables, jobs, auth, blocks, env vars or gates; "Last verified" commit bumped.
- [x] ADR written or updated if you made or changed an architectural decision.
- [x] `DEPLOYMENT.md` / `infra/coolify/RUNBOOK.md` updated if env vars, services, ports or the deploy pipeline changed.
- [x] A change record in `docs/changes/` (required) and `progress.md` status/known-gaps/in-flight updated.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: what you verified live, what you only read, what you did not do.
