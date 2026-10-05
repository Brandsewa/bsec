# Cancelling an order before it ships gives its stock back

- **Date:** 2026-10-05
- **Agent:** claude
- **Branch:** `fix/cancel-restores-stock` (not merged yet)
- **Area:** domain
- **Type:** fix
- **Supersedes:** none

## Summary
Confirming a COD order (`confirmAdminOrder`) or recording an order as paid commits its inventory reservation: `on_hand` drops and the reservation becomes `committed`. Cancelling only released `active` reservations, so cancelling any confirmed or paid order before it shipped lost those units permanently (found while wiring cancel-to-refund for Finance). Cancel now returns the stock and the books return the cost of the goods.

## What changed
- `packages/domain/src/catalog/inventory-reservations.ts`: `restoreCommittedStock` (committed reservations of the order go back to `on_hand`, one `cancelled` inventory movement per line, reservation closed as `returned_to_stock`; idempotent).
- `packages/domain/src/orders/state-machine.ts`: `order.cancel` calls it after releasing active reservations, notes `stockRestoredUnits` on the cancel event, and enqueues `finance.post` kind `cancel_restock` when stock was restored.
- `packages/domain/src/finance/post-events.ts` and `reconcile.ts`: `postCancelRestockEvent` (debit `inventory`, credit `cost_of_goods`, capped at COGS posted for the order, only if a restore movement exists) and a reconcile replay over cancelled orders.
- No migration; the new reservation status `returned_to_stock` is free text.

## Decisions and trade-offs
Orders cancelled before this fix keep their lost stock (no backfill; the movement ledger shows what happened) and are never given a cost-back posting. A merchant can correct those with a stock adjustment.

## Verification
- Ran: `cancel-restores-stock.int.test.ts` 5/5 on real Postgres (COD confirm then cancel, restore is idempotent, never-confirmed order unchanged, paid order with refund and ledger cost-back, no posting without COGS or without a restore movement). With the fix removed, 3 of 5 fail (on_hand 47 instead of 50), proving the test catches the bug. Gate: typecheck 15/15, lint 15/15, docs:check ok, test:fast 309/309, heavy suite 75 files / 1563 tests on real Postgres (one run lost a worker to the known Windows native crash 3221226505 in an unrelated file; it passes alone, 3/3).
- NOT verified: in a browser; partially fulfilled orders (cancel is refused once any fulfillment is past `label_created`, so not reachable).

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed
- [x] ADR-022 (cancel and stock paragraph)
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [ ] `progress.md`: the known-gap line from PR #40 should be removed once both are merged
