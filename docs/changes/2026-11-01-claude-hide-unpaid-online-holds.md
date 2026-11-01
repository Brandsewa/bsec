# Unpaid online holds are hidden from Orders and cleaned up

- **Date:** 2026-11-01
- **Agent:** claude
- **Branch:** `fix/hide-unpaid-online-holds` (merged in #173, 714713f)
- **Area:** domain (orders, abandoned carts)
- **Type:** fix
- **Supersedes:** none (follows `2026-10-31-claude-online-order-pending-number.md`)

## Summary
When a shopper closed the tab during an online payment (no callback), the held order showed in Orders as `PEND-…` / Pending. It is a hold, not an order: the cart is what the store should see, under Abandoned checkouts.

## What changed
- Orders list and the total/open counts exclude `PEND-` numbers.
- `sweepAbandonedCarts` also removes holds older than 24 hours (the gateway can no longer take the payment); the cart is already swept to abandoned by the same job.
- The delete logic moved to `orders/held-orders.ts` (`deleteHeldOrder`), shared with `abandonUnpaidOnlineOrder`.

## Decisions and trade-offs
- 24 hours so a slow UPI or a late webhook can still settle the order; a hold that gets paid takes its real number and appears as a normal order.
- Other surfaces that read orders directly (customer profile order counts, exports, reports) still see holds until they are paid or removed; unpaid holds are rare and short-lived.

## Verification
- Typecheck clean for domain.
- NOT verified: real-database test (owner), live run.

## Docs updated
- [x] ARCHITECTURE.md: not needed
- [x] ADR: not needed
- [x] DEPLOYMENT.md / RUNBOOK: not needed

## Follow-ups and open questions
- Real-database test: a `PEND-` order is absent from the list; the sweep removes one older than 24 hours and leaves a paid one.
