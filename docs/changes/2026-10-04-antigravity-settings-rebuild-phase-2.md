# Settings rebuild Phase 2 — permissions & capability families, Users & accounts, Settings Activity

- **Date:** 2026-10-04
- **Agent:** Antigravity
- **Branch:** `feat/settings-rebuild-phase-2` (stacked on `feat/settings-rebuild-phase-0-1` PR #25 tip `8317347`)
- **Area:** admin settings UI, auth, contracts, domain, web api wiring, documentation & ADR
- **Type:** feature
- **Prompt:** `docs/prompts/settings-rebuild-phase-2.md` / Store Admin Settings rebuild — Phase 2 builder prompt

## Summary

Delivers **Phase 2** of the Store Admin Settings rebuild in full compliance with ADR-020, `docs/SETTINGS-REBUILD-REMAINING-PHASES.md` §3, and `docs/SETTINGS-SCHEMA.md` §3.
1. Implements the 15 granular capability families in `@bs/auth` with check-time aggregate mapping preserving grandfathered `settings.write` custom roles without stored role data migrations.
2. Encodes owner-decided delegation matrix: `payments.manage` is owner-only (`store_admin` does not hold it); `staff.manage`, `audit.read`, `domains.manage`, and all other families are held by both `store_owner` and `store_admin`.
3. Keeps support-session sets in `packages/domain/src/context.ts` completely isolated from all settings capability families (support sessions have zero settings access).
4. Migrates Team to canonical `/settings/users` (Users & accounts) with read-only Store Owner identity summary, preserving last-owner protection and no-self-removal invariants, and establishes tested redirect from legacy `/settings/team`.
5. Builds Settings Activity at `/settings/activity` backed by a narrow contract `settingsActivity.list`, a domain read service gated by `audit.read`, defensive secret-redaction on audit diff payloads, and tenant isolation tests on real PostgreSQL.

## What changed

### Commit 1 — Foundation: ADR-020, Auth Capability Families, and Context Exclusion
- `docs/adr/020-settings-capability-families.md`: Added and registered in `docs/adr/README.md`. Documents capability families, legacy aggregate check-time mapping, rollout, owner-only operations, direct-route/API denials, and future contract phase cleanup.
- `packages/auth/src/index.ts`:
  - Expanded `STORE_PERMISSIONS` with 15 granular capability families (29 total permissions).
  - Configured `SYSTEM_STORE_ROLES`: `store_owner` holds all 29 permissions; `store_admin` holds all except `payments.manage` (owner-only).
  - Implemented check-time aggregate mapping in `hasPermission()`: `settings.write` satisfies all settings families except `payments.manage` (and `staff.manage`).
- `packages/auth/test/permissions.test.ts`: Added unit tests verifying matrix, aggregate mapping, and direct grant behavior.
- `packages/domain/src/context.ts`: Explicitly excluded all settings capability families, `settings.read`, and `audit.read` from `SUPPORT_READ_PERMISSIONS` and `SUPPORT_WRITE_PERMISSIONS`. Tested in `packages/domain/test/context.test.ts`.

### Commit 2 — Users & Accounts at `/settings/users`
- `apps/admin/src/routes/_store/settings/users.tsx`: Created Users & accounts page with Store Owner summary card (read-only, with support/transfer explanation), members table with roles and invitation status, role change dialog, invitation flow, and last-owner/no-self-removal protections.
- `apps/admin/src/routes/_store/settings/team.tsx`: Replaced with an explicit, tested redirect to `/settings/users`.
- `apps/admin/src/components/settings/settings-nav.ts`: Updated navigation item to route to `/settings/users`.
- `apps/admin/test/settings-shell.test.tsx`: Added router-level tests verifying `/settings/users` rendering and `/settings/team` redirect behavior.

### Commit 3 — Settings Activity at `/settings/activity`
- `packages/contracts/src/admin.ts`: Defined `SettingsActivityItem`, `ListSettingsActivityInput`, `ListSettingsActivityArgs`, `ListSettingsActivityOutput`, and mounted procedure `admin.settingsActivity.list`.
- `packages/domain/src/admin/settings-activity.ts`: Implemented `listSettingsActivity` reading from `audit_logs` scoped to `ctx.tenantId`, with area filtering, pagination, and multi-layered defensive diff sanitization (`sanitizeDiff` redacts password, secret, token, key, credential, cvv, card fields).
- `apps/web/src/server/api.ts`: Mounted `admin.settingsActivity.list` handler gated by `requireAdmin` + `requirePermission("audit.read")`.
- `apps/admin/src/routes/_store/settings/activity.tsx`: Built UI using shared table kit, area filter dropdown, pagination, expandable diff inspector, and `pendingComponent`.
- `apps/admin/src/components/settings/settings-nav.ts`: Added "Activity" navigation item under "Compliance & advanced" with `perm: "audit.read"`.
- `packages/domain/test/isolation.int.test.ts`: Mapped `settingsActivity.list` in dispatcher; added assertions and real-Postgres tenant isolation and secret redaction verification test.
- `docs/ARCHITECTURE.md`: Updated API procedures, route inventory, permission constants, and ADR list.

## Verification Gate Output

All checks run locally in the worktree `C:\dev\bsec-settings-phase2`:

```bash
# Documentation check
pnpm docs:check
# Output: docs:check ok

# Monorepo typecheck (15/15 packages)
pnpm typecheck
# Output: Tasks: 15 successful, 15 total (Time: 30.709s)

# Monorepo lint (15/15 packages)
pnpm lint
# Output: Tasks: 15 successful, 15 total (Time: 5.451s)

# Monorepo build (6/6 packages)
pnpm build
# Output: Tasks: 6 successful, 6 total (Time: 1m27.143s)

# Auth tests
pnpm --filter @bs/auth test
# Output: 2 passed (2), 6 passed (6) (Duration: 4.64s)

# Contracts tests
pnpm --filter @bs/contracts test
# Output: 3 passed (3), 17 passed (17) (Duration: 903ms)

# Admin tests
pnpm --filter @bs/admin test
# Output: 4 passed (4), 35 passed (35) (Duration: 10.37s)

# Domain fast tests
pnpm --filter @bs/domain test:fast
# Output: 30 passed (30), 252 passed (252) (Duration: 71.00s)

# Domain real PostgreSQL isolation integration tests
pnpm --filter @bs/domain exec vitest run test/isolation.int.test.ts
# Output: 1 passed (1), 767 passed (767) (Duration: 48.62s)

# Domain real PostgreSQL store settings integration tests
pnpm --filter @bs/domain exec vitest run test/store-settings.int.test.ts
# Output: 1 passed (1), 16 passed (16) (Duration: 16.47s)
```

## Definition of Done Checklist

- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (real-DB test for anything touching tenancy, money, auth or permissions).
- [x] `docs/ARCHITECTURE.md` updated if you changed structure, routes, tables, jobs, auth, blocks, env vars or gates (the trigger table is in its section 0); "Last verified" commit bumped.
- [x] ADR written or updated if you made or changed an architectural decision (`docs/adr/020-settings-capability-families.md`).
- [x] `DEPLOYMENT.md` / `infra/coolify/RUNBOOK.md` updated if env vars, services, ports or the deploy pipeline changed (N/A — no env/infra changes).
- [x] A change record in `docs/changes/` (required) and `progress.md` status/known-gaps/in-flight updated if a milestone item changed state.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: what you verified live, what you only read, what you did not do.
