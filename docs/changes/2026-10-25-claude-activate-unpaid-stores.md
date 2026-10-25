# Unpaid stores are told to choose a plan; billing page errors show a reason

- **Date:** 2026-10-25
- **Agent:** claude
- **Branch:** `fix/stuck-store`
- **Area:** domain, contracts, web, admin
- **Type:** fix
- **Supersedes:** none

## Summary
A store with no paid plan and no trial left (created from Super Admin, or a test store left half-way when the trial was turned off) had no clear next step, and one such store's Plan and billing page failed to load with a generic error.

## What changed
- `billing.activationRequired` (no paid invoice, trial over or past due): Plan and billing shows "Your store is not on an active plan yet. Choose a plan below and pay to activate it". A store that paid once and is late is not this case (dunning handles it).
- A store with an authorised mandate but no first payment (the half-way case) sees what is happening and can "Stop automatic payment", which drops the link and brings the plan form back; paying then takes the first cycle at once (previous change).
- The billing page no longer fails because of a side lookup: credentials, phone and activation checks fall back safely and are logged; a real failure now shows "Billing problem: <reason>" instead of "Something went wrong" (and is logged server side).

## Decisions and trade-offs
- Super Admin created stores are not blocked: they keep working and see the message on their Plan and billing page (owner decision). Only self-service signups made with the trial off are gated ("Activate your store").
- The cause of the original page failure was not reproduced locally (real-database repro with the same state loads fine under both database roles); the new reason message will name it if it recurs.

## Verification
- Ran: typecheck (contracts, domain, web, admin); real-database `platform-billing-cashfree` (12, one new), `platform-billing-subscribe`, `billing-lifecycle`: 29 pass.
- NOT verified: in a browser; the production failure itself.

## Docs updated
- [x] ARCHITECTURE: not needed (no structure change). ADR: not needed.

## Follow-ups and open questions
- If "Billing problem: ..." appears, its text is the root cause.

## Definition of done
Pending CI and the owner's check of the stuck store.
