# Look up the Cashfree authorisation payment the way Cashfree documents it

- **Date:** 2026-10-25
- **Agent:** claude
- **Branch:** `fix/cashfree-payment-lookup`
- **Area:** domain
- **Type:** fix
- **Supersedes:** none

## Summary
The owner's sandbox payment was taken by Cashfree (two successful 2,499 rupee UPI payments) but the store stayed unpaid: no webhook reached us (the deliveries card in Super Admin was empty) and the direct check added in the previous change did not find the payment, because it called `GET /subscriptions/{id}/payments`, a list endpoint that exists only in Cashfree's older API versions.

## What changed
- The direct check now reads the subscription (`GET /subscriptions/{id}`), takes `authorisation_details.payment_id`, then fetches that payment (`GET /subscriptions/{id}/payments/{payment_id}`, documented for the current API version). A successful payment of at least 10 rupees activates the store and issues one invoice (same path as the webhook, one invoice per payment id).
- Confirmed from the owner's Cashfree dashboard: with `authorization_amount_refund: false` Cashfree does take the full plan price at authorisation.

## Decisions and trade-offs
- The webhook remains the primary route and is still not reaching us: the owner must check the webhook in the Cashfree dashboard (see follow-ups).

## Verification
- Ran: typecheck; `platform-billing-cashfree` (15 pass, mocks follow Cashfree's documented single-payment response).
- NOT verified: against the live sandbox (the owner's store is the first real check).

## Docs updated
- [x] none needed

## Follow-ups and open questions
- Why Cashfree sends nothing to `/api/webhooks/platform-billing/cashfree` is unknown: check Cashfree, Developers, Webhooks (sandbox): that the URL is saved for the Subscription events and the delivery log's response codes. The Super Admin deliveries card lists anything that does arrive, including refused ones.

## Definition of done
Pending CI and the owner's retry.
