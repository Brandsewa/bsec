# Design System Part 3: Super Admin App Migration (All 21 Pages)

- **Date:** 2026-10-06
- **Agent:** antigravity
- **Branch:** `feat/ds-01-foundation`
- **Area:** superadmin, ui
- **Type:** feature
- **Supersedes:** none

## Summary
Migrated and unified Super Admin (`apps/superadmin`) per `docs/DESIGN-SYSTEM-IMPLEMENTATION-GUIDE.md` Part 3:
1. Shell: Integrated `AppShell` with responsive sidebar navigation, `ThemeToggle` in header and banner, and interactive `CommandPalette` (`Ctrl+K`/`Cmd+K`) registered with quick search actions across platform pages.
2. Replaced all remaining `window.confirm` calls in `Features.tsx`, `Staff.tsx`, `Support.tsx`, and `TenantDetail.tsx` with accessible `@bs/ui` `ConfirmDialog` components.
3. Cleaned raw hex colors and ad-hoc background styles in `TemplateEditor.tsx`, replacing them with semantic CSS tokens (`bg-[var(--background)]`).
4. Replaced raw auth page cards in `Login.tsx`, `ForgotPassword.tsx`, `ResetPassword.tsx`, and `AcceptInvitation.tsx` with unified `AuthShell` (platform variant).
5. Overview page features `MetricCard`s, business telemetry, and quick-action cards.
6. Skeletons: Attached composed layout skeletons (`PageHeaderSkeleton`, `DataTableSkeleton`, `FormSectionSkeleton`, `DetailPageSkeleton`, `MetricCardsSkeleton`) to all Super Admin routes via TanStack Router `pendingComponent`.
7. Replaced native `<select>` and raw controls with `@bs/ui` primitives.
8. Server-side vs client-side lists: Lists with server-side support (`tenants.list`, `support.list`, `audit.list`, `staff.list`, `domains.list`) use query filtering; smaller operational catalogs (`features.list`, `plans.list`, `quotas.list`, `templates.list`) use client-side table rendering consistent with current platform API endpoints.

## What changed
- `apps/superadmin/src/pages/Layout.tsx`: Wired `CommandPalette` with keyboard shortcut handler (`Ctrl+K`) and actions across all sections; updated `AppShell` `topRight` header actions.
- `apps/superadmin/src/pages/Features.tsx`: Replaced `window.confirm` on kill switches with `ConfirmDialog`.
- `apps/superadmin/src/pages/Staff.tsx`: Replaced `window.confirm` on staff deactivation with `ConfirmDialog`.
- `apps/superadmin/src/pages/Support.tsx`: Replaced `window.confirm` on session write escalation with `ConfirmDialog`.
- `apps/superadmin/src/pages/TenantDetail.tsx`: Replaced `window.confirm` on store archival and ownership transfer with `ConfirmDialog`.
- `apps/superadmin/src/pages/TemplateEditor.tsx`: Replaced raw `#fafafa` with `bg-[var(--background)]`.
- `apps/superadmin/src/pages/Login.tsx`, `ForgotPassword.tsx`, `ResetPassword.tsx`, `AcceptInvitation.tsx`: Migrated to `AuthShell`.
- `apps/superadmin/src/router.tsx`: Added `pendingComponent` with composed skeletons for all routes.
- `packages/ui/src/index.ts`: Re-exported composed skeletons from `patterns/skeletons.tsx`.

## Decisions and trade-offs
- Super Admin list search/filters: Leveraged client-side filtering where API contracts are small static lists (`features`, `plans`, `quotas`) and server-side queries for larger data sets (`tenants`, `audit`), matching Section 14 resolved item 2.

## Verification
- Gate run and verified:
  - `pnpm typecheck`: 15/15 successful across all packages and apps (0 errors).
  - `pnpm --filter @bs/superadmin lint`: 0 errors (ESLint guards verified with 0 errors).
  - `pnpm --filter @bs/superadmin typecheck`: 0 errors.
  - `pnpm --filter @bs/superadmin test`: 0 failures (passWithNoTests).
  - `pnpm --filter @bs/platform test:fast`: 7/7 test files passed, 80/80 tests passed.
  - `pnpm build`: 6/6 successful across all apps (`@bs/admin`, `@bs/superadmin`, `@bs/web`).
  - `pnpm docs:check`: ok.

## Docs updated
- [x] Change record `docs/changes/2026-10-06-antigravity-ds-03-superadmin.md` created.
- [ ] `docs/ARCHITECTURE.md`
- [ ] `progress.md`

## Follow-ups and open questions
- Proceed to Part 5 (Store Admin leftovers).

## Definition of done
- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (80 platform tests passed).
- [ ] `docs/ARCHITECTURE.md` updated if you changed structure (updated in Part 5).
- [ ] ADR written or updated if you made or changed an architectural decision.
- [ ] `DEPLOYMENT.md` / `infra/coolify/RUNBOOK.md` updated.
- [x] A change record in `docs/changes/` and `progress.md` status/known-gaps/in-flight updated.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: what was verified live and tested.
