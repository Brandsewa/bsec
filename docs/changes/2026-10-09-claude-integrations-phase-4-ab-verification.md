# Verification of Phase 4 slices A+B (integrations hub, email channel page): accepted with notes

- **Date:** 2026-10-09
- **Agent:** claude
- **Branch:** `docs/admin-improvements-plan` (verifies `feat/admin-improvements-phase-4` at `a8ee3d2`, slices A and B plus the Phase 3 follow-up commit `3bdd640`)
- **Area:** superadmin, platform, domain
- **Type:** test
- **Supersedes:** none

## Summary
Slices A and B accepted. Slices C and D are not started. Three notes below must be handled in the next slices; the Payments page must not ship as it is.

## Verification
- `pnpm docs:check` pass; typecheck (all cached) and lint (11 of 15 cached) pass.
- `integrations-hub.int.test.ts` + `quotas-phase3.int.test.ts` (real Postgres): 14 of 14 pass. `apps/platform` rbac + read-endpoints + audit-coverage: 80 of 80 pass.
- Read: hub and channel pages, router and nav changes, `platform/integrations-hub.ts`, the platform handlers, the Phase 3 follow-up commit (product limit key fixed, tier row locking).
- Not re-run by me: whole heavy suite, build, the browser walkthrough script.

## Passed
Hub, notifications and channel routes exist with skeletons; `/email` and `/storage` redirect to the new URLs; nav and command palette updated; all new procedures require platform staff (`requirePlatformStaff`) and are read-only; email stats are computed from `platform_email_log` with a test comparing them to direct SQL counts for 24h, 7d and 30d; transactions support status, template, tenant, failed-only and search filters and never return bodies or passwords; the existing ZeptoMail form, test send and deliveries now live in a provider Sheet. No e2e selector referenced the renamed nav item.

## Notes (handle in the next slices)
1. **Payments page is a non-functional mock.** `PaymentsIntegrations.tsx` keeps the Razorpay and Stripe switches in React state (Razorpay starts "Enabled"), and the overview hardcodes `enabledProviders: ["razorpay"]`. Nothing is saved. Slice D must replace both with `platform_payment_providers`; do not ship or merge a state where these switches look real but do nothing.
2. **Dead code.** `apps/superadmin/src/pages/EmailSettings.tsx` is no longer imported anywhere; delete it in slice C or D.
3. **Day bucketing timezone.** Daily stats group with `date_trunc('day', created_at)` in the database session timezone but label days with `toISOString()` (UTC). If the database is not UTC the chart buckets can be off by one day. Use `AT TIME ZONE 'UTC'` in the query.
4. The change record for the whole phase is still to be written at the end (plan section 6.5 ticked with evidence).

## Docs updated
- [ ] none needed for this record
