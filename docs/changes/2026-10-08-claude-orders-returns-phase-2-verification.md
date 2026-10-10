# Verification of Phase 2 (order archive/delete, returns page): accepted

- **Date:** 2026-10-08
- **Agent:** claude
- **Branch:** `docs/admin-improvements-plan` (verifies `feat/admin-improvements-phase-2` at `1b8cf6e`)
- **Area:** domain, admin, web, db
- **Type:** test
- **Supersedes:** none

## Summary
Accepted. The plan's section 4.3 criteria are met as far as I could check; two non-blocking follow-ups are listed.

## Verification
- `pnpm typecheck`, `pnpm lint` (both served from turbo cache, so they confirm the committed state), `pnpm docs:check`: pass.
- `orders-archive-delete.int.test.ts` + `order-phase1.int.test.ts` against the shared local Postgres: 24 of 24 pass.
- `apps/admin` `orders-bulk-bar.test.tsx`: 2 of 2 pass.
- Read the full domain diff (`archiveOrders`, `unarchiveOrders`, `deleteOrders`), migration 0050, permission wiring, API handlers.
- Not re-run by me: the whole heavy suite (builder reports 89 files, 1,910 tests, 0 failed), build, the browser walkthrough script.

## Checked against the plan
- Migration is expand-only (`archived_at`, `archived_by`, index). Views: `closed` = old archived behaviour, `archived` = `archived_at IS NOT NULL`, all other views exclude archived; stats count only unarchived.
- Archive refuses open orders with a per-order reason; unarchive and archive write audit rows and timeline events; bulk returns per-id results.
- Delete requires archived, status cancelled or draft, no paid/refunded status, no invoice, no fulfillment, no return or exchange link, no refund, no ledger entry, no review; dependents removed in the same transaction; audit row holds number, total, status, actor only.
- `orders.delete` is in the permission list (owner gets all, admin gets all but payments, finance does not), is denied to support sessions, and is checked in the service as well as the route.
- Bulk bar always shows Archive (Unarchive in Archived) and Delete in Archived for eligible orders; tested with a mixed selection.
- Returns open on `/returns/$returnId`; the drawer is gone from `returns.tsx`.
- No e2e selector referenced the renamed tabs or the returns drawer, so none needed updating.

## Non-blocking follow-ups
1. Deleting an order removes its discount redemption rows but leaves `discounts.used_count` unchanged. Cancel does not release usage either, so this is consistent today, but the counter can drift from the redemption rows. Decide whether cancel and delete should release usage and fix both together.
2. Archive, unarchive and delete do not invalidate any cache (a new `order` cache tag kind was added but nothing uses it). Admin order screens read live data, so nothing visible is stale; if a cached storefront order page ever shows archived or deleted orders, wire the tag. Remove the unused tag kind if it stays unused.
3. A real-DB test for archive/delete of an order with a discount redemption and a payment intent (the two dependent tables most likely to hit a foreign key) was not seen; add one when touching this code again.

## Docs updated
- [ ] none needed for this record
