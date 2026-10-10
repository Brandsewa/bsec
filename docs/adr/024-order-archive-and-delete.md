# ADR-024: Order archive vs permanent delete and Returns as a full page

- **Status:** Accepted
- **Date:** 2026-10-08
- **Plan reference:** `docs/ADMIN-IMPROVEMENTS-PLAN.md` §4 (SE-1 / SE-2)

## Context

Orders in bsec are financial records carrying GST tax invoices, sequence counters, financial ledger entries, payment transactions, and inventory movements. Previously:
1. There was no explicit order archiving mechanism or timestamp. The "Archived" tab was merely an alias for terminal order statuses (`delivered`, `cancelled`, `returned`).
2. Merchants had no way to purge test, draft, or cancelled unpaid orders without risking orphaned foreign keys or violating accounting integrity.
3. The bulk action bar in `apps/admin/src/routes/_store/orders.tsx` did not expose an Archive action, confusing store operators.
4. Returns detail was rendered in a side `Sheet` drawer in `returns.tsx`, which cramped item lists, photo proof galleries, customer comments, and inspection actions, and prevented deep linking and browser Back navigation.

## Decisions

We implement an archive-first lifecycle for orders, strict validation for permanent deletion, and elevate Returns to a dedicated full page:

1. **Two-Step Lifecycle: Archive First, Then Delete:**
   - Permanent delete is strictly prohibited for active orders. An order must be archived first (`archived_at IS NOT NULL`).
   - Terminal orders (`delivered`, `cancelled`, `returned`) can be archived; open orders cannot be archived until completed or cancelled.
   - **Tab Semantics:**
     - The old "Archived" tab is renamed to **Closed** (orders in terminal states).
     - The **Archived** tab now exclusively displays soft-archived orders (`archived_at IS NOT NULL`).
     - Archived orders are hidden from default views and active KPI counts (`openOrders`, `paidOrders`, `totalOrders`), but preserved in financial reports, total revenue calculations (`totalRevenue`), GST invoices, and the finance ledger.

2. **Strict Invariants for Permanent Deletion (`orders.delete`):**
   - Permanent deletion requires the permission `orders.delete`, granted only to `store_owner` and `store_admin`, and denied to support staff (`SUPPORT_WRITE_DENIED`).
   - The domain service `deleteOrders` enforces all 10 refusal checks within a single transaction:
     1. Order must already be archived (`archived_at IS NOT NULL`).
     2. Status must be `cancelled` or `draft` (unplaced draft).
     3. Payment status must not be `captured`, `paid`, `partially_refunded`, or `refunded` (no money moved; COD pending/failed or unpaid only).
     4. Fulfillment status must be `unfulfilled` (no items shipped or delivered).
     5. No invoices issued (`invoices` table).
     6. No shipments or tracking AWBs exist (`fulfillments` table).
     7. No customer returns exist (`returns` table).
     8. Order is not referenced by an exchange (`returns.exchangeOrderId`).
     9. No finance ledger journal entries exist (`finance_ledger_entries` table).
     10. No refunds or partial refunds exist (`refunds` table).
   - If all checks pass, child records (`order_items`, `order_notes`, `order_events`, `inventory_reservations`, `payment_attempts`, `payment_intents`, `discount_redemptions`) are removed explicitly, `quote_requests` are unlinked, and an immutable audit log row is written (`order.deleted`) storing only order number, grand total, status, and actor (omitting customer PII).

3. **UI / UX Controls for Archive and Delete:**
   - **Bulk Action Bar:** Always displays **Archive** in default views (or **Unarchive** in the Archived view), enabled whenever at least one order is selected. Ineligible orders are skipped with a clear per-order reason in the toast ("X archived, Y skipped: still open").
   - **Delete Action:** Exclusively offered in the **Archived** view (bulk bar and row menu) and on the detail page of an archived order. The bulk bar shows Delete whenever `canDeleteOrders` is true and at least one selected order is eligible.
   - **Confirmation Dialog:** Requires typing the exact order number for single-order delete (e.g. `ORD-1001`), or `DELETE` for bulk deletion.

4. **Returns as a Full Page Route (`/returns/$returnId`):**
   - Returns detail is migrated from the `Sheet` drawer in `returns.tsx` to a flat-route page `apps/admin/src/routes/_store/returns_.$returnId.tsx`.
   - Features `pendingComponent: () => <PageSkeleton />`, breadcrumbs `Returns > R-1042`, two-column layout on desktop, stacked on mobile (375px), photo proof gallery, customer comment and note history, and all 7 lifecycle action dialogs.
   - All `Sheet` imports and drawer state are removed from `returns.tsx`; row clicks navigate directly to `/returns/$returnId`.

## Consequences

- **Financial and Audit Safety:** Paid, invoiced, shipped, or returned orders can never be deleted under any circumstance.
- **Operational Clarity:** Operators can declutter cancelled and draft orders while retaining complete auditability.
- **Improved UX:** Return inspections and exchange processing operate in a spacious, deep-linkable interface with full keyboard accessibility and mobile responsiveness.
