# Show that automatic payment is set up, and keep the trial when it is stopped

- **Date:** 2026-10-25
- **Agent:** claude
- **Branch:** `fix/cashfree-authorized-state`
- **Area:** db, domain, contracts, admin
- **Type:** fix
- **Supersedes:** none

## Summary
After a successful Cashfree sandbox authorisation the owner came back to an unchanged Plan and billing page, because the page only knew "paying" or "not paying". A trial store with a created subscription looked identical to one with none. Also, stopping automatic payment during a trial would have ended the trial (Cashfree's cancelled event moved the store to the restricted tier).

## What changed
- Migration `0078_subscription_authorized_at`: `subscriptions.authorized_at`.
- Cashfree `SUBSCRIPTION_STATUS_CHANGED` with `ACTIVE` now records the authorisation (it still does not activate the plan); a successful charge also sets it.
- `getPlanAndBilling` checks Cashfree directly (best effort, 4 s limit) for a created-but-unconfirmed subscription, so the page is right even if no webhook arrived. It returns `billing.authorized` and `billing.firstChargeAt`.
- Plan and billing shows "Automatic payment is set up" with the trial end date and "Stop automatic payment"; a started-but-unfinished set-up says so.
- Stopping automatic payment while nothing was charged drops the subscription link and keeps the trial and the store's plan (both gateways).

## Verification
- Ran: typecheck (db, contracts, domain, admin); real-database tests: `platform-billing-cashfree` (10, two new/extended), `platform-billing-subscribe`, `b4-billing-webhook`, `billing-lifecycle`, `platform-billing-dunning`: 38 pass.
- NOT verified: against the real Cashfree sandbox, and the page in a browser.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (migration 0078)
- [x] ADR: not needed (extends ADR-037)

## Follow-ups and open questions
- The trial date shown is the trial end; with a free-months promotion the real first charge date can be later.
- Still open: invoice email, Super Admin invoices list.

## Definition of done
Pending CI and the owner's sandbox check.
