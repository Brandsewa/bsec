# Orders Archive and Delete, Returns Full Page Route

- **Date:** 2026-10-08
- **Agent:** antigravity
- **Branch:** `feat/admin-improvements-phase-2` (not merged yet)
- **Area:** admin, db, domain, auth, contracts, ui, docs
- **Type:** feature
- **Supersedes:** none

## Summary
Implements Phase 2 of `docs/ADMIN-IMPROVEMENTS-PLAN.md` (SE-1 and SE-2). Adds soft-archive and permanent archive-first delete capabilities to Store Admin Orders, including domain-level enforcement of all 10 financial and order-state invariants, permission gating (`orders.delete` restricted to owner/admin only), audit trails, and bulk action bar controls. Refactors the Returns detail experience from a transient `Sheet` drawer in `returns.tsx` into a dedicated full page route at `apps/admin/src/routes/_store/returns_.$returnId.tsx` with mobile sticky action controls and 375 px responsive design.

## What changed
- **Database (`packages/db`)**:
  - Expanded `orders` table with `archivedAt` (`timestamptz`) and `archivedBy` (`uuid`) plus composite index `(tenantId, archivedAt)` in `packages/db/src/schema/orders.ts`.
  - Added migration `packages/db/migrations/0050_orders_archive.sql` and registered in `_journal.json`.
- **Auth & Permissions (`packages/auth`, `packages/domain`)**:
  - Added `"orders.delete"` permission to `STORE_PERMISSIONS` in `packages/auth/src/permissions.ts`.
  - Added `"orders.delete"` to `SUPPORT_WRITE_DENIED` in `packages/domain/src/context.ts` (support staff cannot delete orders even if configured).
  - Added `"order"` to `TagKind` in `packages/domain/src/cache-tags.ts` for tenant cache invalidations.
- **Contracts (`packages/contracts`)**:
  - Added `closed` view to `orders.list` view enum (`all`, `unfulfilled`, `unpaid`, `cod_to_confirm`, `rto`, `open`, `closed`, `archived`).
  - Added `archivedAt` to list items, `archivedAt` and `archivedBy` to detail output.
  - Added `orders.archive`, `orders.unarchive`, and `orders.delete` contracts returning `{ successCount, skippedCount, results: Array<{ id, ok, reason? }> }`.
- **Domain Services (`packages/domain`)**:
  - Implemented `archiveOrders`, `unarchiveOrders`, and `deleteOrders` in `packages/domain/src/admin/orders.ts`.
  - Implemented all 10 refusal checks for deletion:
    1. Must be already archived (`archivedAt IS NOT NULL`).
    2. Status must be `cancelled` or `draft`.
    3. Payment status must NOT be captured/paid/partially_refunded/refunded.
    4. No invoices issued (`invoices` table).
    5. No active/fulfilled shipments or tracking numbers (`shipments` table).
    6. No return requests (`returns` table).
    7. No finance ledger entries (`ledger_entries` table).
    8. No refunds recorded (`refunds` table).
    9. Not referenced as replacement in an exchange (`returns.exchangeOrderId`).
    10. Tenant isolation and permission check (`assertPermission(ctx, "orders.delete")`).
  - Dependent cascading rows cleaned up explicitly in one transaction: `orderItems`, `orderNotes`, `orderEvents`, `inventoryReservations`, `paymentAttempts`, `paymentIntents`, `discountRedemptions`, unlinking `quoteRequests.orderId`.
  - Emits audit log rows (`order.archived`, `order.unarchived`, `order.deleted`) and timeline `order_events`.
  - Mapped `orders.archive`, `orders.unarchive`, and `orders.delete` in `packages/domain/test/isolation.int.test.ts`.
- **Store Admin UI (`apps/admin`)**:
  - `apps/admin/src/routes/_store/orders.tsx`:
    - Renamed former terminal statuses tab to "Closed"; updated "Archived" tab to filter `archived_at IS NOT NULL`.
    - Updated `BulkBar` to ALWAYS show Archive (or Unarchive in Archived view), enabled whenever at least one row is selected; shows per-order skip reason toast for ineligible rows.
    - Added Delete button in `BulkBar` in Archived view when at least one selected row qualifies (`isOrderEligibleForDelete`).
    - Added Delete modal with typed order number confirmation ("DELETE" for bulk, order number for single).
    - Updated row overflow menus with Archive / Unarchive and Delete.
  - `apps/admin/src/routes/_store/orders_.$orderId.tsx`:
    - Added Archive / Unarchive and Delete actions to header overflow menu with typed confirmation modal.
  - `apps/admin/src/routes/_store/returns_.$returnId.tsx`:
    - Created full page route with `pendingComponent`, breadcrumbs (`Returns > RET-...`), 2-column desktop layout, photo proof gallery, customer & order cards, and all 7 action dialogs.
    - Added responsive sticky bottom actions bar for mobile viewports (< lg).
  - `apps/admin/src/routes/_store/returns.tsx`:
    - Removed `Sheet` and drawer components; row and card clicks navigate directly to `/returns/$returnId`.
- **Shared UI Kit (`packages/ui`)**:
  - Added `confirmDisabled?: boolean` prop to `ConfirmDialog` in `packages/ui/src/components/confirm-dialog.tsx`.

## Decisions and trade-offs
- **Archive-First Deletion Policy**: Deleting orders that moved money, incurred GST, or hold stock creates irreversible accounting holes. Delete is therefore archive-first, allowed strictly for cancelled or draft orders with no payments, shipments, invoices, returns, exchanges, or ledger entries.
- **Always-Visible Archive in Bulk Bar**: Per owner decision, Archive is always shown in bulk selection rather than conditionally hidden; ineligible orders are skipped with a human-readable explanation in the toast ("3 archived, 2 skipped: still open").
- **Full Page Returns Route**: Returns workflow involves multi-step inspection, photo review, and refund/exchange decisions that were constrained in a drawer. The full page route allows deep linking, browser history preservation, and clean two-column desktop / stacked mobile layouts.
- Documented in [ADR-024: Order Archive vs Delete](../../docs/adr/024-order-archive-and-delete.md).

## Verification
- **Test Gate & Commands**:
  - `pnpm docs:check`: Passed (`docs:check ok`).
  - `pnpm typecheck`: Passed (15/15 packages clean).
  - `pnpm lint`: Passed (15/15 packages clean).
  - `pnpm build`: Passed (Clean builds across monorepo packages, Next.js standalone, Vite apps).
  - `pnpm --filter @bs/db test:fast`: Passed (27/27 passed).
  - `pnpm --filter @bs/auth test`: Passed (3 files, 10/10 passed).
  - `pnpm --filter @bs/contracts test`: Passed (3 files, 20/20 passed).
  - `pnpm --filter @bs/domain test:fast`: Passed (45 files, 374/374 passed).
  - `pnpm --filter @bs/admin test`: Passed (12 files, 74/74 passed, including `orders-bulk-bar.test.tsx`).
  - `pnpm test:heavy:local` (real PostgreSQL container on port 55432):
    - **89 files passed (89), 1,910 tests passed (1,910), 0 failed** (Duration: 257.80s).
    - Includes `packages/domain/test/orders-archive-delete.int.test.ts` (13/13 passed) testing:
      - Archiving delivered order hides from default list and preserves financial totals.
      - Explicit proof that money, GST, and ledger entries remain identical before and after archiving.
      - Refusal of delete for unarchived orders, paid orders, invoiced orders, shipped orders, orders with returns, orders linked to exchanges.
      - Successful deletion of cancelled unpaid COD order with explicit cascade cleanup.
      - Permission enforcement (`orders.delete`) rejecting unauthorized callers.
      - Cross-tenant deletion returning not-found.
    - Includes `packages/domain/test/isolation.int.test.ts` (1,237/1,237 passed).
    - Includes `packages/domain/test/returns.int.test.ts` (12/12 passed) and `return-photos.int.test.ts` (14/14 passed).
- **Real Browser Walkthrough (`scripts/walkthrough-phase2.mjs`)**:
  - Driven with Microsoft Edge + Playwright against Vite preview (`http://localhost:5173`):
    1. Desktop (1280x800):
       - Verified "Closed" tab and "Archived" tab visible on `/orders`.
       - Selected rows in All view: verified BulkBar renders with Archive button visible & enabled (`true, true`).
       - Clicked bulk Archive: verified RPC mutation `POST /api/rpc/admin/orders/archive` executed and succeeded.
       - Navigated to Archived view: verified archived eligible and ineligible orders rendered.
       - Selected mixed orders in Archived view: verified BulkBar renders Unarchive AND Delete buttons visible (`true, true`).
       - Clicked Delete: verified `ConfirmDialog` modal opens titled "Delete 2 orders?".
       - Verified confirm button is disabled until exact text "DELETE" is entered, and enables once typed.
       - Dismissed modal with "Not now".
    2. Returns Full Page Route:
       - Navigated to `/returns`.
       - Clicked return row: navigated to `/returns/0199a000-0000-7000-8000-000000000301`.
       - Verified full page route URL, breadcrumbs, return header, item details, and photo proof gallery rendered.
       - Clicked "Approve return": verified action dialog opened, cleanly dismissed with Cancel.
    3. Mobile Viewport (375x812):
       - Verified mobile page header and sticky actions bar (`.sticky.bottom-0`) visible on returns detail.
       - Navigated to `/orders` on 375 px: verified responsive mobile order card rendering.
    - **Walkthrough result: 100% checks passed.**

## Acceptance Criteria (Plan Section 4.3)
- [x] Archive, unarchive (single and bulk) work; archived orders leave the default list and appear under Archived; Closed tab shows what Archived used to show.
- [x] Selecting any orders in All / Open / Closed shows an **Archive** button in the bulk bar; in Archived it shows **Unarchive** and, for eligible orders, **Delete**; delete is refused by the service for a non-archived order.
- [x] Delete is refused with a readable reason for a paid order, an invoiced order and an order with a return; works for a cancelled unpaid COD order; the order number is typed to confirm.
- [x] `orders.delete` exists and is enforced in the domain service; staff without it see no Delete action and get a forbidden error if they call the API.
- [x] Money, GST and ledger totals identical before and after archiving a delivered order (`orders-archive-delete.int.test.ts`).
- [x] Returns open on `/returns/<id>`; no `Sheet` left in `returns.tsx`; all seven actions still work end to end; walked at 375 px and desktop.
- [x] ADR-024 "Order archive vs delete" written; `ARCHITECTURE.md` API surface and UI routes updated.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (Updated API surface for `orders.archive`, `orders.unarchive`, `orders.delete`, and UI route `/returns/$returnId`)
- [x] ADR-024 (`docs/adr/024-order-archive-and-delete.md`) and indexed in `docs/adr/README.md`
- [x] `DEPLOYMENT.md` / RUNBOOK / not needed (no new env vars or external services introduced)
- [x] `progress.md` (Updated in-flight section)

## Follow-ups and open questions
- None. Phase 2 implementation is self-contained and ready for Claude verification.

## Definition of done
- [x] Code follows `AGENTS.md` section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (real-DB tests in `orders-archive-delete.int.test.ts` covering tenancy, financial totals, permissions, and refusal checks).
- [x] `docs/ARCHITECTURE.md` updated and ADR-024 written.
- [x] Change record created in `docs/changes/2026-10-08-antigravity-orders-archive-delete-returns.md`.
- [x] `progress.md` updated.
- [x] No secrets, no generated files, no unrelated edits in diff. Untracked plan files preserved uncommitted.
- [x] Honest status: all live walkthrough flows and test suite runs verified with exact counts.
