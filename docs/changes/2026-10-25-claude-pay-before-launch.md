# With the trial off, a new store pays before it opens

- **Date:** 2026-10-25
- **Agent:** claude
- **Branch:** `feat/pay-before-launch`
- **Area:** db, domain, contracts, admin, web
- **Type:** feature
- **Supersedes:** none

## Summary
Testing with the trial off showed two gaps: signup went straight to the dashboard with no payment step, and a paid store showed no change and no invoice. Cause of the second: an autopay mandate (UPI AutoPay, card) cannot be debited at once (a day's pre-debit notice is required), and with no deferral Cashfree charges nothing until its first schedule date. Best practice is to take the first payment when the mandate is authorised and let renewals run on the mandate.

## What changed
- Account first, then pay, then open: signup creates the account and signs the owner in as before, but with the trial off the store has `subscriptions.payment_required` (migration `0080_subscription_payment_required`), and the admin shows a full-page "Activate your store" screen (plan, billing period, pay) instead of the dashboard until the first payment is confirmed. It then opens by itself (polls every 4 s). The phone given at signup is reused.
- When nothing is deferred (no trial or free period left), Cashfree is asked to take the first cycle's price as the authorisation payment (not refunded) and to start automatic debits one cycle later. The webhook treats an AUTH payment of at least 10 rupees as the first plan payment (activates, one invoice per payment id, clears `payment_required`); the 1 rupee mandate check stays a non-charge.
- The signup page says "Create my account and pay" when the trial is off. Plan and billing no longer asks for a phone number the account already has.

## Decisions and trade-offs
- Pay after the account exists (not before) so the lead is kept, the owner is authenticated for the payment, and a failed or abandoned payment can be retried from the same screen. The store is not usable until paid.
- If platform billing is off, an unpaid store sees "contact support": there is no payment path.
- Whether Cashfree accepts an authorisation amount equal to the plan price (and takes it as a real payment) is from its docs, not yet confirmed in the sandbox.
- Razorpay is unchanged (it charges on authorisation when no start date is given).

## Verification
- Ran: typecheck (db, contracts, domain, admin, web); real-database `platform-billing-cashfree` (11, incl. a new pay-first test), `b4-billing-webhook`, `billing-lifecycle`, `platform-billing-dunning`, `saas-runtime-role`, `provisioning`, `platform-trial-policy`, `platform-billing-subscribe`: pass.
- NOT verified: the screens in a browser; the sandbox charge.

## Docs updated
- [x] ARCHITECTURE (migration 0080). ADR not needed (extends ADR-037).

## Follow-ups and open questions
- Missed webhook for the first payment leaves the store on "Confirming your payment" (no direct payment-status check like the mandate one).
- Stores created while the trial was off before this change have no `payment_required` flag; set it by hand if wanted.
- Invoice email and the Super Admin invoices list are still not built.

## Definition of done
Pending CI and the owner's sandbox run.
