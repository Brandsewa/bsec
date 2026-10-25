# Free trial is a platform setting: on or off, and the number of days

- **Date:** 2026-10-25
- **Agent:** claude
- **Branch:** `feat/trial-setting`
- **Area:** db, domain, contracts, web, superadmin
- **Type:** feature
- **Supersedes:** none

## Summary
The 14-day trial was hard-coded. The owner wants to switch it off and change the length, partly so a first real charge can be tested straight away on a store with no trial.

## What changed
- Migration `0079_platform_trial_policy`: `platform_billing_settings.trial_enabled` (default true) and `trial_days` (default 14, 1 to 90).
- Super Admin, Integrations, Platform billing: a "Free trial" card (switch and days). Owner only, audited (field names and the resulting values, no secrets).
- `provisionTenant` reads the setting for every new store (signup and platform-created). With the trial off the store's trial end is "now": it is `trialing` with the period already over, so the trial sweep puts it on the restricted tier until its owner pays, and the subscribe flow charges at once instead of deferring.
- Public `GET /api/saas/trial`; the signup page shows the real number (or "choose your plan" when off).

## Decisions and trade-offs
- Stores already on a trial keep their end date; a single store's trial is extended on its Tenant page (existing feature).
- Static marketing and legal copy (home, pricing, about, terms, refund policy, landing) still says "14-day free trial". Left alone on purpose: legal wording is the owner's call. It needs updating by hand if the number changes or the trial is turned off.

## Verification
- Ran: typecheck (db, contracts, domain, web, superadmin); real-database `platform-trial-policy` (3 new), `provisioning`, `platform-billing-settings`: 14 pass.
- NOT verified: the Super Admin card and signup page in a browser; Cashfree's behaviour for a first charge with no deferral (needs a sandbox run).

## Docs updated
- [x] ARCHITECTURE (migration 0079). ADR not needed.

## Follow-ups and open questions
- Update the static "14-day" copy and terms if the trial changes.

## Definition of done
Pending CI and the owner's sandbox check.
