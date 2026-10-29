# WP-1c: Multi-Market Admin & Super Admin Money Sweep

- **Date:** 2026-10-29
- **Agent:** antigravity
- **Branch:** `feat/multimarket-wp1c` (not merged yet)
- **Area:** admin, superadmin, contracts, domain
- **Type:** feature
- **Supersedes:** none

## Summary
Replaced hardcoded rupee signs (`₹`) and money-related formatting across `apps/admin`, `apps/superadmin`, and `packages/ui` with currency-aware helpers (`formatMoney`, `currencySymbol`) from `@bs/contracts/money`. Added a lightweight `useStoreCurrency()` hook in `apps/admin` backed by `orpc.admin.markets.list` (resolving base market currency with fallback to store settings and default "INR"). Extended admin order contracts and handlers with `currency`, `baseGrandTotal`, and `baseCurrency` in an append-only manner, enabling dual-currency rendering (charged total + approx base total) in multi-market order workflows.

## What changed
- **New Hook & Tests**:
  - `apps/admin/src/lib/use-store-currency.ts`: Queries base market currency and settings to provide the store's primary currency.
  - `apps/admin/test/use-store-currency.test.tsx`: Unit tests verifying base market selection, fallback to store settings, and default fallback.
- **Contracts & Domain (Append-Only)**:
  - `packages/contracts/src/admin.ts`: Added optional `currency`, `baseGrandTotal`, and `baseCurrency` to `orders.list` output items and `orders.get` output order schema.
  - `packages/domain/src/admin/orders.ts`: Populated `currency`, `baseGrandTotal`, and `baseCurrency` in `listAdminOrders` and `getAdminOrderDetail`.
- **Admin Store Views**:
  - `apps/admin/src/components/order-parts.tsx`: Made `money()` currency-aware (`money(minor, currency)`).
  - `apps/admin/src/routes/_store/orders.tsx` & `_store/orders_.$orderId.tsx`: Render charged currency and, when different from store base currency, display the base total in parentheses (`~formatMoney(baseGrandTotal, baseCurrency)`). CSV exports include Total, Currency, Base Total, and Base Currency columns.
  - `apps/admin/src/routes/_store/products/index.tsx`, `variant-builder.tsx`, `variant-drawer.tsx`, `draft-variant-builder.tsx`, `product-picker-dialog.tsx`: Dynamic currency formatting and symbol labels (`Price (${sym})`).
  - `apps/admin/src/routes/_store/discounts.tsx`, `_store/discounts_.new.tsx`, `_store/discounts_.$id.tsx`: Replaced hardcoded `₹` with store currency; added tooltip note for fixed-amount discounts: "Fixed-amount discounts only apply to orders placed in the store's base currency ({storeCurrency})."
  - `apps/admin/src/routes/_store/customers.tsx`, `_store/segments_.$segmentId.tsx`, `_store/abandoned-checkouts.tsx`, `_store/preorders.tsx`, `_store/returns.tsx`, `_store/returns_.$returnId.tsx`, `_store/quotes.tsx`, `_store/finance.tsx`, `_store/finance_.expenses.tsx`, `_store/finance_.reports.tsx`: Converted metric cards, data tables, dialogs, drawers, and CSV exports to currency-aware formatting.
  - `apps/admin/src/components/billing/activate-store.tsx`: Dynamic pricing using each plan's currency.
- **Super Admin**:
  - `apps/superadmin/src/pages/TenantCreate.tsx`, `TenantDetail.tsx`, `TenantPromotions.tsx`, `TenantsList.tsx`, `Quotas.tsx`, `Overview.tsx`: Swapped hardcoded INR formatting to format according to plan currency or tenant currency.

## Decisions and trade-offs
- **Remaining ₹ hits:**
  1. `apps/admin/src/components/markets/types.ts`: Market currency dropdown option `{ value: "INR", label: "INR - Indian Rupee (₹)" }`.
  2. `apps/admin/src/lib/csv.ts`: Code comment documenting Excel UTF-8 BOM encoding for Indian Rupee symbol.
  3. `apps/superadmin/src/pages/Kit.tsx`: Typographic design kit sample text (`Geist Mono: ORD-9284-X · ₹12,450.00`).
- **Remaining `en-IN` hits:**
  - Date/time formatters (`new Date().toLocaleDateString("en-IN")`) for staff IST display, and digit formatters for customer/row counts (`total.toLocaleString("en-IN")`). These represent non-monetary localization and are intentionally retained.

## Verification
- Ran `pnpm typecheck`: Passed (15/15 successful across all packages).
- Ran `pnpm lint`: Passed (0 errors across monorepo).
- Ran `pnpm docs:check`: Passed (`docs:check ok`).
- Ran `pnpm --filter @bs/admin test -- --no-file-parallelism`: 19 test files passed, 107 tests passed (including `test/use-store-currency.test.tsx`).
- Ran PostgreSQL integration test: `TEST_PG_ADMIN_URL=postgres://postgres:postgres@localhost:55432/postgres pnpm --filter @bs/domain test test/isolation.int.test.ts` (1 passed test file, 1670 tests passed).
- NOT verified: E2E browser tests (e2e suite only runs in CI on pushes to `main`).

## Docs updated
- [ ] `docs/ARCHITECTURE.md` (not touched per prompt instructions)
- [ ] ADR (not needed, adheres to ADR-040)
- [ ] `DEPLOYMENT.md` / RUNBOOK (not needed)
- [ ] `progress.md` (not touched per prompt instructions)

## Follow-ups and open questions
- None. Ready for Claude verification.

## Definition of done
- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (unit tests for `useStoreCurrency`, integration tests for isolation).
- [ ] `docs/ARCHITECTURE.md` updated if you changed structure (prompt instructed DO NOT TOUCH).
- [ ] ADR written or updated (prompt instructed DO NOT TOUCH).
- [ ] `DEPLOYMENT.md` / RUNBOOK updated (no infra/deploy changes).
- [x] A change record in `docs/changes/` created (`progress.md` not touched per prompt).
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: what you verified live, what you only read, what you did not do.
- [ ] After merge: follow-up cleanup after PR verification and merge.
