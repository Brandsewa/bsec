# See billing webhook deliveries; notice the first Cashfree payment without a webhook

- **Date:** 2026-10-25
- **Agent:** claude
- **Branch:** `fix/billing-webhook-visibility`
- **Area:** domain, contracts, platform, superadmin
- **Type:** feature
- **Supersedes:** none

## Summary
After a successful Cashfree sandbox payment on a store with the trial off, the store still showed "first payment has not come through" and no invoice. There was no way to tell whether Cashfree's webhook was arriving, being refused (secret mismatch), or never sent, and the page depended on that webhook alone.

## What changed
- Super Admin, Platform billing: a "Recent webhook deliveries" card (latest 25 platform billing webhooks: gateway, event, processed / failed / refused). A webhook refused for a bad signature keeps one bounded row per gateway (updated each time, event type only), so a secret mismatch becomes visible without letting anyone grow the table.
- Plan and billing now also asks Cashfree directly (best effort, 5 s cap) whether the merchant authorised and whether a real payment (at least 10 rupees; the 1 rupee mandate check is ignored) has been taken for an unpaid subscription; if so it activates the store and invoices it once, exactly as the webhook would (one invoice per payment id). The webhook stays the primary route.
- Platform API `integrations.billingWebhooks` (platform staff, read only).

## Decisions and trade-offs
- The payments-list call (`GET /subscriptions/{id}/payments`) is from Cashfree's docs, not yet run against the sandbox; if it fails the page behaves as before.
- If Cashfree does not actually collect the plan price at authorisation (only a mandate), the first payment would be taken a cycle later (the first debit date we send). The deliveries card and the Cashfree dashboard will show which.

## Verification
- Ran: typecheck (contracts, domain, platform, superadmin); real-database `platform-billing-cashfree` (15, two new), `platform-billing-subscribe`, `b4-billing-webhook`, `billing-lifecycle`, `webhook-inbox`: 40 pass; platform app tests.
- NOT verified: against the Cashfree sandbox; the card in a browser.

## Docs updated
- [x] ARCHITECTURE: not needed (no new table or route group). ADR: extends ADR-037.

## Follow-ups and open questions
- Decide from the first real sandbox result whether the first payment is collected at authorisation.

## Definition of done
Pending CI and the owner's sandbox run.
