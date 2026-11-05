# Platform Branding, phase 1 (Super Admin page, API, Super Admin shell)

- **Date:** 2026-11-05
- **Agent:** claude
- **Branch:** `feat/platform-branding`  (not merged yet)
- **Area:** db, domain, contracts, platform, superadmin, docs
- **Type:** feature
- **Supersedes:** none

## Summary
New **Branding** item in Super Admin (Administration group): logos (dark/light x logo/icon), favicon, primary and secondary colour, dark and light button colours. Phase 1 of `docs/PLATFORM-BRANDING-PLAN.md`; Super Admin itself consumes the brand (sidebar logo, favicon, primary colour). Website, store admin, auth pages and emails are phase 2.

## What changed
- Migration `0099_platform_branding` (single-row platform table, empty by default, `app_platform` writes, `app_rw` reads).
- `packages/domain/src/platform/branding-tokens.ts` (pure validator, contrast guard, CSS builder) and `branding.ts` (get/update, audited, `platform_admin`+).
- Contract `platform.branding.get/update`; handler in `apps/platform/src/app.ts`; rbac/audit/read test maps updated.
- `apps/superadmin/src/pages/Branding.tsx`, route `/branding`, sidebar + command palette entry, brand applied in `Layout.tsx`.

## Decisions and trade-offs
Owner defaults (2026-11-05): "dark" = asset for dark surfaces; platform_admin may edit; existing email branding wins until reset; all platform surfaces to follow the primary colour; name/tagline/font deferred. Save is refused whole when any value is invalid (no partial save). Logos come from the existing media library picker. Version history is not built yet (a `version` counter is stored).

## Verification
- Ran: `pnpm --filter @bs/superadmin|domain|platform typecheck` pass; `branding-tokens.test.ts` 5 pass.
- NOT verified: lint, `pnpm build`, `docs:check`, platform real-DB suites (rbac/audit), and the page in a browser.

## Docs updated
- [ ] `docs/ARCHITECTURE.md` (route, table, contract) - to do before merge
- [x] Plan `docs/PLATFORM-BRANDING-PLAN.md`
- [ ] `progress.md` in-flight line

## Follow-ups and open questions
Phase 2 (public brand endpoint, website, store admin, auth pages, email defaults) and phase 3 (history, OG, fonts).

## Definition of done
Not done: gate not fully run (see Verification).
