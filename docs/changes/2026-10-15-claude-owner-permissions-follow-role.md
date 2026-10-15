# Store owner could lose the Payments menu on stores created before payments.manage

- **Date:** 2026-10-15
- **Agent:** claude
- **Branch:** `fix/owner-permissions-follow-role`
- **Area:** auth, domain
- **Type:** fix
- **Supersedes:** none

## Summary
Owner report: on the live store (Taste of Hills) Settings > Payments is missing from the menu. The menu item needs `payments.manage`, which `settings.write` can never satisfy (owner-only, ADR-020). Permissions come from the stored `roles.permissions` array, and no migration ever added `payments.manage` to owner rows of stores created before it existed, so those owners lose exactly that one item while its neighbours show. `store_owner` is defined as holding every permission, so `systemRoleDefinedPermissions` now tops the stored array up for that role (admin API context and `/me`), the same approach already used for `finance.*`.

## Not confirmed
The live role row was not read (no live database access, per the no-live-testing rule). This is the most likely cause: the symptom matches. If the account on that store is `store_admin` (not owner), Payments is hidden by design and this change will not show it.

## Changed expectation
`finance-roles.int.test.ts` asserted a stale owner row must NOT gain `payments.manage` ("nothing else is invented"). That conflicts with ADR-020 (`store_owner`: all permissions), so it now asserts the owner is topped up. Flagged for the owner: if owners were meant to be able to lack Payments, say so and this should be reverted.

## Tests
- `packages/auth/test/permissions.test.ts`: owner defined as all permissions, other roles nothing.
- `packages/domain/test/owner-permissions-stale-role.int.test.ts` (real Postgres): owner whose stored role lacks `payments.manage` still gets it from `getAdminMe`. Fails without the `me.ts` change.

## Verification
- Auth tests 11 of 11, domain typecheck, the new test passes. Not run in a browser or against the full suite; CI runs the gate.

## Docs updated
- [x] none needed (behaviour follows ADR-020's existing definition).
