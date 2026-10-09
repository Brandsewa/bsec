# Verification of Phase 3 (quota tiers with pricing): changes requested

- **Date:** 2026-10-08
- **Agent:** claude
- **Branch:** `docs/admin-improvements-plan` (verifies `feat/admin-improvements-phase-3` at `e077a92`)
- **Area:** platform, domain, superadmin
- **Type:** test
- **Supersedes:** none

## Summary
Not accepted yet: one blocker, one smaller fix. Everything else matches the plan.

## Verification
- `pnpm docs:check` pass; typecheck and lint pass (typecheck from turbo cache, lint 12 of 15 cached).
- `quotas-phase3.int.test.ts`, `orders-archive-delete.int.test.ts`, `rate-limiting.int.test.ts` (real Postgres): 35 of 35 pass.
- `apps/platform` `audit-coverage.int.test.ts` and `rbac.int.test.ts`: 50 of 50 pass.
- Read: migration 0051, `platform/quotas.ts`, the `resolveEffectiveQuota` change, contracts, platform handlers, `TenantsList.tsx` tier dialog.
- Not re-run by me: whole heavy suite, build, browser walkthrough.

## Passed (read from code)
Expand-only migration with backfill from the legacy columns and `app_rw` read-only grants; legacy `tier_xs/s/m/l` kept in sync by write-through; resolution order unchanged with unknown tier falling back to XS; prices are non-negative integer paise; every mutation needs platform admin, writes before/after audit rows and is in the audit-coverage and RBAC suites; ADR-015 invariant test (hard quotas at 0 do not block checkout); the Phase 2 follow-ups were done (cascade-delete test added, unused `order` cache tag removed).

## Must fix
1. **A new tier cannot actually be assigned to a store.** The test "adding tier XL ... assigning a tenant works end-to-end" assigns by writing `tenant_size_tiers` directly. The real paths still only know the four built-in tiers: the bulk assignment contract is `z.enum(["XS","S","M","L"])` (`packages/contracts/src/platform.ts` near line 334), the Super Admin dialog in `TenantsList.tsx` hardcodes the four options and their text, and plan changes map through `tierForPlan`. So "add a tier" has no effect on any store. Fix: accept a tier code string, validate in the domain service that it exists and is active (refuse otherwise), build the dialog options from the live tier list (names, prices and limits shown), keep the typed-confirmation behaviour, and change the test to go through the real service function rather than a raw update.
2. **Deactivation check is outside the transaction.** `updatePlatformQuotaTier` counts stores on the tier, then opens the transaction, so a store assigned in between could end up on an inactive tier. Do the count and the update in one transaction (and have the assignment in item 1 check `is_active` in its own transaction).

## Also
- Please add one test for item 2's race path if practical (assign to a tier being deactivated), otherwise note the transaction ordering in the change record.
- Record in the next change record that tier prices are display-only (not billed), as the plan says.

## Docs updated
- [ ] none needed for this record
