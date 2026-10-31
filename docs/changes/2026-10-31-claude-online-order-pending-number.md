# Online orders get their real number only when paid

- **Date:** 2026-10-31
- **Agent:** claude
- **Branch:** `fix/online-payment-pending-number`
- **Area:** domain (orders, payments)
- **Type:** fix
- **Supersedes:** none (follows `2026-10-31-claude-online-payment-no-held-order.md`)

## Summary
An abandoned online payment consumed an order number and left a gap in the sequence. Online orders now carry a temporary `PEND-XXXXXXXX` number while unpaid; the store's next real number is allocated inside `settleProviderPayment` when the payment is confirmed. COD still takes its real number at placement.

## What changed
- `placeOrder` skips `allocateOrderNumber` for online methods and stores a `PEND-` number (`PENDING_ORDER_NUMBER_PREFIX`).
- `settleProviderPayment` allocates the real number in the same transaction that marks the order paid.

## Decisions and trade-offs
- The gateway receipt, Stripe/PayPal invoice text and Razorpay modal show `PEND-…` (the real number is not known before payment).
- A closed-tab hold stays visible as `PEND-…`, which marks it as unpaid.

## Verification
- Typecheck clean for domain. Heavy integration tests run in CI.
- NOT verified: a new real-database test for this (owner will run), live Razorpay run. Existing tests that read an online order's number before payment may need updating if CI shows them failing.

## Docs updated
- [x] ARCHITECTURE.md: not needed
- [x] ADR: not needed
- [x] DEPLOYMENT.md / RUNBOOK: not needed

## Follow-ups and open questions
- Real-database test: abandon leaves no gap; paid online order gets the next number; COD unchanged.
