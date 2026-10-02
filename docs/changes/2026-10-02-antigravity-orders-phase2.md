# Orders Phase 2: Create Order Parity (Decisions D1-D7)

- **Date:** 2026-10-02
- **Agent:** antigravity
- **Branch:** `feat/orders-phase2` (not merged yet)
- **Area:** db, domain, contracts, web, admin
- **Type:** feature
- **Supersedes:** none

## Summary
Implements full feature parity for Admin Create Order (`/orders/new`) according to `docs/ORDERS-ALL-ORDERS-PLAN.md` §4.2 decisions D1 through D7. Merchants can now create draft orders with automatic GST tax calculation (intra-state CGST+SGST or inter-state IGST), store shipping rates or custom capped shipping overrides, line price overrides and order discounts with mandatory audit reasons, inventory reservations with shortage validation, customer selection/creation, and flexible payment outcomes ("Payment received", "Payment pending", or COD).

## What changed
- **Database & Migration:** Added `0021_order_tags.sql` adding `tags text[] DEFAULT ARRAY[]::text[] NOT NULL` to `orders` with GIN index on `tags`. Updated `packages/db/src/schema/orders.ts`.
- **Contracts:** In `packages/contracts/src/admin.ts`:
  - Added `admin.customers.create` contract for creating customers inline with default address.
  - Added `admin.orders.estimateDraft` for real-time totals, tax breakdowns, and shipping rate estimates.
  - Overhauled `admin.orders.createDraft` with full D1-D7 input fields (discounts, overrides, shipping methods, payment outcome, tags).
  - Added `tag` filter to `admin.orders.list` and `tags` field to `admin.orders.get`.
- **Domain Services:**
  - `packages/domain/src/admin/customers.ts`: Added `createAdminCustomer` with permission assertion (`customers.write`) and audit logging.
  - `packages/domain/src/admin/orders.ts`: Implemented `estimateAdminDraftOrder` and overhauled `createAdminDraftOrder` with inventory reservation (`reserveInventory`), audit logging for draft creation, price overrides, shipping overrides, and discounts, plus customer total spend updates when payment is received. Added tag filtering in `listAdminOrders` and detail enrichment in `getAdminOrderDetail`.
- **API Handler:** Mounted `admin.orders.estimateDraft` and `admin.customers.create` in `apps/web/src/server/api.ts`.
- **Admin UI:** Overhauled `apps/admin/src/routes/_store/orders_.new.tsx` with customer search/create dialog, item selection with stock warnings, inline price overrides, flat/% discount, live shipping rate calculator or custom override, payment terms, internal notes, tags, and sticky live summary.

## Decisions and trade-offs
- **D1 (GST Tax):** Line items are assumed tax-inclusive per standard Indian retail convention. Tax is extracted and broken down into CGST+SGST or IGST based on origin state (`store_settings`) and shipping state.
- **D2 (Shipping Override):** Capped at ₹10,000 (1,000,000 paise). Requires a mandatory non-empty reason that is persisted in `audit_logs` and `order_events`.
- **D3 (Price Overrides & Discounts):** Requires non-empty reasons persisted in `audit_logs` and `order_events`.
- **D4 (Payment Choice & Stock):** "Payment received" immediately captures payment and commits inventory (`reserveInventory` + `commitInventoryReservation`), updating customer lifetime spend. "Payment pending" creates an active reservation.
- **D5 (Order Tags):** Saved to `orders.tags text[]` and filterable in `listAdminOrders`.
- **D6 (Customer Picker & Create):** Inline dialog creates customer, default shipping address, and optional tags/notes via `admin.customers.create`.
- **D7 (Inventory Reservations):** Draft order creation verifies availability and holds stock. If stock is insufficient, throws descriptive error preventing overselling.

## Verification
- Ran `pnpm --filter @bs/domain exec vitest run test/order-phase2.int.test.ts`: 9 passed on real Postgres 18.
- Ran `pnpm --filter @bs/domain exec vitest run test/order-phase1.int.test.ts`: 11 passed on real Postgres 18.
- Ran `pnpm --filter @bs/domain test:fast`: 26 test suites passed (205 tests).
- Ran `pnpm typecheck`: 15 packages passed cleanly.
- Ran `pnpm lint`: 15 packages passed cleanly.
- Ran `pnpm build`: 6 packages built cleanly.
- Ran `pnpm docs:check`: ok.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (section 7 migration table updated with `0021_order_tags`)
- [ ] ADR: not needed (follows PLAN decisions D1-D7)
- [ ] `DEPLOYMENT.md` / not needed (no new runtime infrastructure)
- [x] `progress.md` (updated In flight and milestones)

## Follow-ups and open questions
- Next task in hierarchy is Quotes (`docs/ORDERS-QUOTES-PLAN.md`).

## Definition of done
- [x] Code follows rules; verification gate passes.
- [x] Real-DB tests verify isolation, GST extraction, discounts, overrides, payment choices, and stock shortage rejection.
- [x] `docs/ARCHITECTURE.md` updated with migration `0021_order_tags.sql`.
- [x] Change record created; progress updated.
- [x] No secrets, no generated files in diff.
