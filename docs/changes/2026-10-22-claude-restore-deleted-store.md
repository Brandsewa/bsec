# Super Admin can restore a deleted store

- **Date:** 2026-10-22
- **Agent:** claude
- **Branch:** `feat/restore-deleted-store`  (not merged yet)
- **Area:** domain, contracts, platform, superadmin
- **Type:** feature
- **Supersedes:** none

## Summary
A store whose deletion workflow finished (status `deleted`) was a dead end: the lifecycle matrix made `deleted` terminal and the only undo (`cancelDeletion`) works before the workflow starts. Platform admins can now restore a deleted store from its Super Admin detail page.

## What changed
- `restoreDeletedTenant` in `packages/domain/src/platform/deletion-requests.ts`, exposed as `tenants.restoreDeleted` (`POST /platform/tenants/{id}/restore-deleted`, `platform_admin`). Needs the store's slug typed as confirmation and takes an optional reason.
- The store returns as `suspended` (never live), with its platform subdomain row re-created. Slug, owner, invoices, audit trail and the pre-deletion export were never purged, so they are all still there.
- Writes a `platform_audit_logs` row `tenant.restored_from_deleted` (deletion id, export id, `dataRestored: false`).
- Lifecycle matrix: `deleted -> suspended` is now allowed (only transition out of `deleted`).
- Super Admin `TenantDetail`: "Restore deleted store" button and confirm dialog for `deleted` stores.

## Decisions and trade-offs
- **Data is not restored.** The workflow removes products, orders, customers and media, so a restore gives back an empty shell. The export archive is kept and its id is returned/audited. Re-importing an export is not built; it would be a separate feature.
- Restored as `suspended`, not `active`, because billing was cancelled and domains released; staff review, then use the existing "Restore Store" (reactivate) action.
- Separate procedure rather than widening `tenants.restore`, so the generic restore keeps its meaning.

## Verification
- Ran: `pnpm --filter @bs/contracts --filter @bs/domain --filter @bs/platform --filter @bs/superadmin typecheck` pass. `platform-deletion.int.test.ts` + `tenant-lifecycle.test.ts` 20 pass (real Postgres, new restore test included). `apps/platform` `audit-coverage` + `rbac` 70 pass.
- `pnpm lint` 0 errors (4 existing warnings in `apps/web`), `pnpm docs:check` ok.
- NOT verified: the Super Admin dialog in a browser, restoring `tasteofhills` locally, `pnpm build`, full test gate.

## Docs updated
- [x] `docs/ARCHITECTURE.md`: updated in the docs PR (2026-10-22)
- [x] ADR: not needed
- [x] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md`: M14 added

## Follow-ups and open questions
- Owner: should a restored store be offered an "import from export" step? Not built.

## Definition of done
Not complete: lint, docs:check, ARCHITECTURE and a browser walkthrough remain.
