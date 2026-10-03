# Pre-orders: simple "ships on" model

- **Date:** 2026-10-02
- **Agent:** antigravity
- **Branch:** `feat/preorders-simple` (not merged yet)
- **Area:** db, domain, contracts, admin, web, worker
- **Type:** feature
- **Supersedes:** none

## Summary
Implements the pre-orders feature per `docs/ORDERS-PREORDERS-PLAN.md` using the simple dispatch date ("ships on") model. Pre-orders are standard orders for normal products at regular price with promised dispatch dates, with no deposits, waitlists, or quota complexity. Pre-order lines are purchasable at zero inventory stock; whole orders dispatch on the latest line item ship date. Admin includes a dedicated Pre-orders workbench with 5 status views, 4 metric cards, batch ship-date rescheduling, and early fulfillment release.

## What changed
- **Database (`packages/db`)**:
  - Migration `0020_preorders.sql` (expand-only): added `preorder_enabled`, `preorder_ships_on`, `preorder_message` to `variants`; added `ships_on`, `preorder_released_at` to `orders` (with partial index `orders_tenant_ships_on_idx`); added `ships_on` to `order_items`.
  - Added queues `order.preorder_date_changed` and `order.preorder_reminder_sweep` in `packages/db/src/queues.ts`.
- **Domain Services & Jobs (`packages/domain`)**:
  - `orders/checkout.ts`: Excluded preorder variants from inventory stock reservations at checkout; snapshotted `shipsOn` on items and set `order.shipsOn` to the latest date. Added mixed cart calculation.
  - `orders/manual-lifecycle.ts` & `admin/orders.ts`: Enforced pre-order hold preventing advancement to `shipped`/`fulfilled` prior to promised dispatch date unless `preorderReleasedAt` is set.
  - `admin/preorders.ts`: Implemented `listPreorders` (filtering `all`, `waiting`, `ready`, `shipped`, `cancelled`), `getPreorderStats` (open preorders, ready to ship, due next 14 days, overdue), `changePreorderShipDate` (transactional date updates, timeline events, audit logs, notification enqueue), and `releasePreorderNow` (unblocks early shipping, timeline event, audit log).
  - `jobs.ts`: Added date changed email notification handler, daily idempotent 2-day reminder sweep (`runPreorderReminderSweep`), worker consumers, and cron schedule (`"0 6 * * *"`).
  - `system/email-templates.ts`: Added email templates for date changed (`order_preorder_date_changed`) and 2-day reminder (`order_preorder_reminder`).
  - Catalog services & storefront: exposed pre-order status and variant flags in product admin and storefront queries.
- **Admin App (`apps/admin`)**:
  - Created `/preorders` route (`apps/admin/src/routes/_store/preorders.tsx`) with 5 tabs, 4 metric cards, DataTable with selection, search, pagination, CSV export, "Change ship date" dialog, and "Release early" confirm dialog.
  - Updated sidebar navigation (`apps/admin/src/routes/_store.tsx`): added `Pre-orders` navigation item under the `Orders` group.
  - Updated `orders.tsx` & `orders_.$orderId.tsx`: added pre-order pill tags on order lines, pre-order status banner, disabled mark shipped during hold, and "Release pre-order now" action.
  - Updated product edit & creation forms (`products/$id.tsx`, `products/new.tsx`, `products/index.tsx`): added pre-order toggle, future date picker, optional message (max 200 chars), and listing badge indicators.
- **Storefront App (`apps/web`)**:
  - Updated `AddToCartButton.tsx` and `VariantSelector.tsx`: dynamic button label ("Pre-order") and "Pre-order, ships on <date>" notification banner.
  - Updated `CartItemRow.tsx` and `OrderSummary.tsx`: line item pre-order badges and mixed-cart shipping disclosure.
  - Updated confirmation pages (`/orders/[token]/thank-you`, `/o/[token]`): estimated dispatch date display.

## Decisions and trade-offs
- Used simple "ships on" model as decided by the owner: no balance collection, partial deposits, or inventory reservation on pre-order lines before stock is physically received.
- Enforced pre-order fulfillment hold at both manual lifecycle level (`advanceAdminOrder`) and admin order fulfillment service (`fulfillOrder`), requiring explicit staff release (`releasePreorderNow`) for early dispatch.
- Daily reminder sweep is idempotent, tracking `order.preorder_reminder_sent` timeline events on the order.

## Verification
- Ran `pnpm --filter @bs/domain test preorders.int.test.ts`: 7/7 tests passed against real PostgreSQL (zero stock checkout, mixed carts, fulfillment hold, early release, ship date modification, reminder sweep idempotency, tenant isolation).
- Ran `pnpm --filter @bs/domain test order-phase1.int.test.ts`: 11/11 tests passed.
- Ran `pnpm typecheck`: all 15 workspaces passed.
- Ran `pnpm lint`: all 15 workspaces passed.
- Ran `pnpm build`: all apps and packages compiled and optimized successfully.
- Ran `pnpm docs:check`: ok.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (sections: 7 Migrations, 11 Jobs and queues)
- [x] `docs/changes/2026-10-02-antigravity-preorders.md`
- [x] `progress.md` (cleared in-flight entry for preorders)

## Follow-ups and open questions
- Email delivery providers are currently disabled/deferred per `progress.md` decisions on record; email jobs safely log or enqueue without failing.

## Definition of done
- [x] Code follows rules and standards; verification gate passes.
- [x] Tests added in `packages/domain/test/preorders.int.test.ts` (real-DB tests for inventory, hold, early release, isolation).
- [x] `docs/ARCHITECTURE.md` updated with migration `0020_preorders.sql` and queues.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status reported.
