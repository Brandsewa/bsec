# Online payment: no order is shown or announced until paid

- **Date:** 2026-10-31
- **Agent:** claude
- **Branch:** `fix/online-payment-no-held-order`
- **Area:** domain (orders, payments, jobs)
- **Type:** fix
- **Supersedes:** none (follows `2026-10-31-claude-abandoned-online-payment.md`)

## Summary
Owner test: cancelling on Razorpay left a Cancelled order in the dashboard and sent a "thank you for your order" email. Now an abandoned online payment leaves no order at all, and the confirmation email and store alert are sent only when the payment settles.

## What changed
- `abandonUnpaidOnlineOrder` deletes the held order and its rows (intents, attempts, reservation, discount use, events, tokens, items) instead of cancelling it; the cart goes back as abandoned.
- `placeOrder` enqueues `order.created` only for COD. `settleProviderPayment` enqueues it after an online order is paid (jobs passed from Razorpay confirm, hosted return and the webhook worker).

## Decisions and trade-offs
- The order number is consumed, so a gap appears in the sequence (same as the admin delete).
- Closed tab with no callback still leaves a held unpaid order (owner decision: no expiry job); it is not announced.

## Verification
- Typecheck clean for domain, web, worker.
- NOT verified: real-database tests (owner), live Razorpay run.

## Docs updated
- [x] ARCHITECTURE.md: not needed
- [x] ADR: not needed
- [x] DEPLOYMENT.md / RUNBOOK: not needed

## Follow-ups and open questions
- Real-database test: abandon leaves no order; settle sends order.created once; COD still sends it at placement.
