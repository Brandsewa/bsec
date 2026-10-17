# Admin and Super Admin polish, phase 1 (bugs and quick fixes)

- **Date:** 2026-10-17
- **Agent:** claude
- **Branch:** `fix/admin-polish-phase-1` (not merged yet)
- **Area:** domain, ui, admin, superadmin, web (signup)
- **Type:** fix
- **Supersedes:** none

## Summary
First phase of `docs/ADMIN-SUPERADMIN-POLISH-PLAN.md` (owner issue log, decisions recorded in its section 3a). Fixes the blank Edit screen on the default Main/Footer menus, makes default menus deletable, adds a show/hide toggle to password fields, widens drawers, and applies small admin and Super Admin UI fixes.

## What changed
- **Menus (N-01, N-02):** `packages/domain/src/menu-defaults.ts` (new) holds starter menu items with ids and types and `normalizeMenuItems`. `getMenu` now repairs legacy items (no id or type) when a menu is opened, so the editor no longer fails on menus seeded by older provisioning. Provisioning seeds full items. `deleteMenu` no longer refuses default menus, and `listMenus`/`getMenu` no longer re-create deleted defaults (`ensureDefaultMenus` removed); delete now invalidates the nav cache. The handle of header/footer stays fixed. UI: delete is enabled for every menu with a warning for default ones.
- **Auth forms (A-01, A-02):** new `PasswordInput` in `@bs/ui` (eye toggle, `type="button"`, `aria-label`, `aria-pressed`, always starts hidden); used in admin login, reset, accept-invite, change-password and Super Admin login, reset, accept-invite, change-password. Public signup page got an equivalent Show/Hide toggle. Label-to-input spacing added in Super Admin auth forms.
- **Shared drawer (P-03, PG-02):** `Sheet` right/left sides use `border-border` (the white line) and default to about 40% width (min 28rem, max 44rem, full width on mobile). Razorpay and Pages edit drawers use the default with more padding.
- **Store visibility (V-01):** option cards are single-line rows.
- **Product page (PR-01, PR-03, PR-05):** breadcrumbs removed (title and actions in one header), status is a dropdown, category pickers show plain names (nested as "Parent > Child") via `apps/admin/src/lib/category-label.ts`. The raw UUID is no longer shown until the friendly ID (phase 2).
- **Pages (PG-01):** row checkboxes with a bulk bar (unpublish, delete); Home and pages with subpages are skipped.
- **Super Admin (SA-03, SA-04, SA-08):** Suspend, Archive and Delete moved into a "More" menu on the tenant page; tab bar border uses the token; sidebar groups open on click only (shared `packages/ui` sidebar, so the store admin too, as decided).

## Decisions and trade-offs
- Legacy menu items are repaired on read; the stored data is corrected the next time the menu is saved. No data migration was added.
- Existing stores that never had default menus will no longer get them lazily (owner decision: deletable, never re-created).
- Customer account forms in `apps/web` already had their own toggle; storefront password gate (`StoreStatusScreens`) and secret-entry fields (payments, storage, integrations) were left alone.

## Verification
- Ran: `pnpm typecheck` pass (15/15), `pnpm lint` pass (15/15, 4 existing web warnings), `pnpm docs:check` ok, `@bs/ui` 45 tests pass, `@bs/admin` 82 tests pass, `packages/domain` `test/menu-defaults.test.ts` 4 pass, real-database `storefront-menus.int.test.ts` + `provisioning.int.test.ts` 13 pass (shared local Postgres).
- NOT verified: no screen was driven in a browser (admin, Super Admin or storefront dev servers were not run), so the blank-screen fix, drawer widths, dark-mode borders and the password toggle are checked by code and tests only. The root cause of the blank screen is from reading the code; it was not reproduced live. `pnpm test:affected` failed to start on an unrelated web `.tsx` parse error in the root vitest run, so tests were run per package. Full `test:heavy` and e2e were not run.

## Docs updated
- [x] `docs/ADMIN-SUPERADMIN-POLISH-PLAN.md` (new, decisions recorded)
- [ ] `docs/ARCHITECTURE.md`: not updated (small additions: `menu-defaults.ts`, `PasswordInput`); to do with phase 2.
- [x] ADR: not needed
- [x] `progress.md` in-flight line

## Follow-ups and open questions
- Phase 2 and 3 of the plan. Friendly IDs (BCPID-/BCSID-) replace the UUID display.
- Optional: run the one-off production check that the default menus open (owner to confirm after deploy).
