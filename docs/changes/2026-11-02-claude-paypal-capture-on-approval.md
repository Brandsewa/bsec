# PayPal platform billing: capture the approved order, and follow the return, cancel and decline paths

- **Date:** 2026-11-02
- **Agent:** claude
- **Branch:** `fix/paypal-capture-on-approval` (not merged yet)
- **Area:** domain, admin, docs
- **Type:** fix
- **Supersedes:** none

## Summary
A US store paid through the PayPal sandbox, PayPal showed the payment approved, and the owner came back to the Activate screen still showing the plans: the store never opened. Cause: the order is created with intent CAPTURE, but nothing ever captured it. PayPal moves no money on approval, so `PAYMENT.CAPTURE.COMPLETED` (the only event that activates the store and issues the invoice) never arrived. The `CHECKOUT.ORDER.APPROVED` handler only linked the order id. Found while tracing the success and failure routes end to end.

## What changed
- `packages/domain/src/saas/billing.ts` `handlePayPalBillingWebhook`: on `CHECKOUT.ORDER.APPROVED` the server captures the order (`PayPalProvider.captureOrder`, idempotent through `PayPal-Request-Id`) inside the webhook claim, so a duplicate delivery never captures twice. A capture that fails throws: the delivery shows "failed" with PayPal's reason in Super Admin, Recent webhook deliveries, and PayPal retries. An order PayPal says is already captured counts as done. `processBillingWebhook` accepts an async normaliser. Test seam: `captureFn`.
- `apps/admin/src/components/billing/activate-store.tsx`: the billing query now refreshes every 4 s; when PayPal returns the payer with `?token=...&PayerID=...` the page shows "Confirming your payment" at once (the store opens by itself when the capture webhook lands); a return with a token and no PayerID (cancelled) shows a "Payment cancelled, nothing was charged" toast; a declined payment (subscription turns past due) shows "Your payment did not go through" with a button back to the plans. The query string is removed from the address bar.
- Tests: three new cases in `packages/domain/test/platform-billing-paypal.int.test.ts` (captures once, failed capture fails the delivery, already captured is fine).

## Route audit (what is wired, what is not)
| Route | State |
|---|---|
| Create order (USD) and redirect to PayPal | works |
| Payer approves, returns to the admin app | works; page now confirms |
| `CHECKOUT.ORDER.APPROVED` | was link-only, now captures |
| `PAYMENT.CAPTURE.COMPLETED` | activates store, writes invoice (unchanged, tested) |
| `PAYMENT.CAPTURE.DECLINED` / `DENIED` | marks the subscription past due; the Activate screen now says so |
| Payer cancels at PayPal | returns to the Activate screen with a toast; no state changes |
| Payer closes the tab after approving | still paid: the capture is server-side |
| Renewals | not wired: one-time Orders only, nothing charges again (see follow-ups) |

## Decisions and trade-offs
- Capturing in the webhook (not on the return page) so closing the tab does not lose a paid order. It is a provider call inside a webhook handler, not a user request (ADR-006 concerns request-time side effects).
- A failed capture throws instead of recording a "past due": PayPal's own `PAYMENT.CAPTURE.DECLINED` webhook does the state change.

## Verification
- Ran: `tsc --noEmit` for domain and admin pass; `eslint` on the Activate screen passes; `platform-billing-paypal.int.test.ts` 11 pass (real Postgres, PayPal calls faked).
- NOT verified: against the real PayPal sandbox (capture response and timing), the Activate screen in a browser, `pnpm build`, the full gate.

## Docs updated
- [ ] `docs/ARCHITECTURE.md` not needed
- [ ] ADR / `DEPLOYMENT.md` not needed (the PayPal webhook must already subscribe to `CHECKOUT.ORDER.APPROVED`, as documented)
- [x] `progress.md` In flight line; `2026-11-02-claude-activate-plan-cards.md` marked merged in #189

## Follow-ups and open questions
- Recurring billing: PayPal is one-time Orders, so nothing renews. Needs PayPal Subscriptions (own plan).
- The PayPal webhook in the developer dashboard must include Checkout order approved, Payment capture completed and Payment capture declined.

## Definition of done
Not done: sandbox run, browser check, full gate, merge steps.
