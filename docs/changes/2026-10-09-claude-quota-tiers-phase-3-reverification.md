# Re-verification of Phase 3 (quota tiers): accepted with two small follow-ups

- **Date:** 2026-10-09
- **Agent:** claude
- **Branch:** `docs/admin-improvements-plan` (verifies `feat/admin-improvements-phase-3` at `e536910`)
- **Area:** platform, domain, superadmin
- **Type:** test
- **Supersedes:** none (follows `2026-10-08-claude-quota-tiers-phase-3-verification.md`)

## Summary
Accepted. The blocker is fixed; two small items go into the first commit of the next phase.

## Verification
- `pnpm docs:check` pass; typecheck and lint pass (14 of 15 packages from turbo cache).
- `quotas-phase3.int.test.ts` + `isolation.int.test.ts`: 1247 of 1247 pass. `apps/platform` audit-coverage + RBAC: 50 of 50 pass.
- Read the fix diff: contract, `bulkChangePlatformTenantTier`, `updatePlatformQuotaTier`, `TenantsList.tsx`.
- Not re-run by me: whole heavy suite, build, browser walkthrough.

## Fixed
1. Bulk assignment accepts any tier code, validates in the service (exists and active, inside the transaction), dialog options come from the live tier list with name, price and product limit; the XL test now goes through the real service, plus a refusal test for unknown and inactive tiers.
2. The in-use count for deactivation now runs inside the update transaction.

## Follow-ups (do first in Phase 4, one small commit)
1. **Wrong quota key in the dialog.** `TenantsList.tsx` reads the product limit from key `products_max`; the real key is `products` (`system/quotas.ts`). The product count never shows. Use `products`.
2. **Race is narrowed, not closed.** Both the deactivate and the assign transactions read the tier row without locking, so at default isolation they can still interleave. Lock the tier row (`SELECT ... FOR UPDATE` in deactivate, `FOR SHARE` in assign). Consequence today is mild (the store keeps its limits), so this is not blocking.

## Docs updated
- [ ] none needed for this record
