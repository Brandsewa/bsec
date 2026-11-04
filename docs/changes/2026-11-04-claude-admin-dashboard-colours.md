# Branding: admin dashboard colours (light and dark), Typography card removed

- **Date:** 2026-11-04
- **Agent:** claude
- **Branch:** `feat/admin-branding-colours` (not merged yet)
- **Area:** admin, domain, contracts, db (type only)
- **Type:** feature
- **Supersedes:** none

## Summary
Fonts and website colours are managed in the theme builder, so Settings > Branding drops its Typography card. The Brand colours card gains an "Admin dashboard" section: sidebar colour and sidebar text colour, separately for light and dark mode, applied to the store's own dashboard.

## What changed
- `apps/admin/.../branding.tsx`: Typography card and font fields removed from the form (existing font values stay in the database, untouched; the update omits them). New admin colour fields with colour picker, hex input, Reset and a live preview. Save is blocked when the text would be under 3:1 contrast on the sidebar.
- `apps/admin/src/components/app-shell.tsx`: `useAdminDashboardColors` injects `--sidebar`, `--sidebar-foreground` and `--sidebar-accent-foreground` per mode (`:root` and `:root[data-theme="dark"]`). Nothing is injected when no colour is set, so the default look is unchanged.
- `packages/contracts/src/admin.ts`: `adminColors` on `BrandSettings` and `UpdateBrandSettingsInput` (6-digit hex, null clears).
- `packages/domain/src/brand-services.ts`: stored under `brand_settings.colors.admin` (JSON, so no migration); lower-cased, invalid or empty dropped; kept across unrelated edits.

## Decisions and trade-offs
- No migration: the existing `colors` JSON holds it. A later move to real columns would be an expand step.
- Only the sidebar and its text are customisable (what was asked); page canvas and cards keep the standard tokens.

## Verification
- `pnpm typecheck`, `pnpm lint` pass (17/17); admin 117 and domain fast 597 tests pass; `branding.int.test.ts` (real Postgres) 9 pass, including the new save/keep/clear/isolation test.
- Updated `online-store-pages.test.tsx` (no longer expects fonts on the branding page).
- NOT verified: no screen driven in a browser (form, preview, applied colours in both modes).

## Docs updated
- [x] ARCHITECTURE / ADR / DEPLOYMENT: not needed (no structure, table or env change)
- [x] `progress.md` (in flight)

## Follow-ups and open questions
- None.

## Definition of done
- [x] Gate commands pass; no secrets or generated files
- [ ] After merge: record PR and commit, remove in-flight line, delete branch and worktree
