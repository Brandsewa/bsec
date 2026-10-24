# Cashfree subscribe: show the real error, send a valid idempotency key

- **Date:** 2026-10-24
- **Agent:** claude
- **Branch:** `fix/cashfree-subscribe-errors`
- **Area:** payments, domain, web
- **Type:** fix
- **Supersedes:** none

## Summary
The owner's first sandbox "Continue to payment" on a trial store failed with a generic "Something went wrong". Two causes found by reading the code: the `subscribe` and `cancelSubscription` handlers did not map domain errors, so every error (even a clear "Bad Request") showed as generic; and Cashfree requires `x-idempotency-key` to be a UUID while we sent our own `bs_...` subscription id, which Cashfree most likely rejects with a 400.

## What changed
- `cashfreeIdempotencyKey` (packages/payments) turns any id into a stable UUID; used for every Cashfree call.
- `CashfreeSubscriptionProvider` turns a Cashfree rejection into `Bad Request: Cashfree said: <message> (<code>)` and logs it server side.
- `subscribe` and `cancelSubscription` handlers now pass errors through `mapAuthError`.
- Payment methods for the mandate are `upi` and `card`; `enach` removed (Cashfree wants a zero authorisation amount for eMandate, ours is 1 rupee).

## Verification
- Ran: unit tests (12) and the Cashfree billing integration test (9, including a faked 400 whose message must reach the caller). Typecheck passes for payments, domain, web.
- NOT verified: against the real Cashfree sandbox. The idempotency key is the most likely cause but unconfirmed; the new error message will show the real cause if it is something else.

## Docs updated
- [ ] ARCHITECTURE: not needed (no structure change). ADR: not needed.

## Follow-ups and open questions
- Invoices: created and downloadable as PDF after a successful charge; not emailed yet; no Super Admin invoices list yet (billing plan slices B6 email part and B7).

## Definition of done
Pending the owner's retry in the sandbox.
