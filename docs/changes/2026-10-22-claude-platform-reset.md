# Super Admin "Reset platform data" (wipe test stores, keep platform setup)

- **Date:** 2026-10-22
- **Agent:** claude
- **Branch:** `feat/platform-reset`  (not merged yet)
- **Area:** domain, contracts, platform, superadmin
- **Type:** feature
- **Supersedes:** none

## Summary
The owner built test stores and accounts on production and wants a clean start. Added an owner-only reset that deletes all store and customer data and keeps the platform's own setup.

## What changed
- `packages/domain/src/platform/platform-reset.ts`: `previewPlatformReset` and `resetPlatformData`; contract `tenants.resetPreview` (GET `/platform/reset-preview`) and `tenants.resetAll` (POST `/platform/reset`), both `platform_owner`.
- Deleted: every store with all its rows, media objects, custom domains (Cloudflare), provider subscriptions, invoices, exports, notes, deletion records; organizations; every non-staff user; signup leads and slug reservations.
- Kept: platform staff and their logins, plans, theme templates (theme builder), feature flags, quotas, platform settings and integrations, reserved slugs, platform audit trail (which records `platform.reset` with the deleted slugs).
- Super Admin System page: "Reset platform data" card and dialog (lists what will go, typed phrase).
- `deleteFromR2` is now exported from `deletion-steps.ts`.

## Decisions and trade-offs
- **Guards:** owner role, `PLATFORM_RESET_ENABLED=true` env switch (off by default, the owner turns it on in Coolify, then off again), typed phrase `RESET ALL STORES`, and the store count the operator saw must still match.
- **Fail closed:** outside systems (billing, Cloudflare, R2) are cleaned first; any failure aborts before the database is touched. All database deletes plus the audit row run in one transaction.
- Not a per-store soft delete: this is a one-off tool, separate from the 30-day deletion flow.

## Verification
- Ran: typecheck (contracts, domain, platform, superadmin) pass; `platform-deletion.int.test.ts` 8 pass including a real-DB reset test (gating, wipe, staff/plans/templates kept, audit row); platform `audit-coverage` + `rbac` 71 pass; `@bs/domain test:fast` 457 pass.
- NOT verified: the dialog in a browser, R2/Cloudflare/billing cleanup against real providers (mocked in tests), `pnpm build`.

## Docs updated
- [x] `docs/ARCHITECTURE.md`: updated in the docs PR (2026-10-22)
- [x] ADR: not needed
- [x] `DEPLOYMENT.md`: `PLATFORM_RESET_ENABLED` documented
- [x] `progress.md`: M14 added

## Follow-ups and open questions
- Owner must set `PLATFORM_RESET_ENABLED=true` in Coolify on the platform service to use it, and remove it afterwards.

## Definition of done
Not complete: ARCHITECTURE/DEPLOYMENT docs and a browser check remain.
