# Platform Branding, phase 3 (history, identity, font, shade ramp, preview, share image, manifest)

- **Date:** 2026-11-06
- **Agent:** claude
- **Branch:** `feat/platform-branding-phase3`  (not merged yet)
- **Area:** db, domain, contracts, platform, superadmin, web, ui, docs
- **Type:** feature
- **Supersedes:** none

## Summary
Finishes `docs/PLATFORM-BRANDING-PLAN.md`: version history with restore, brand name + tagline + font, a derived primary shade ramp, a live multi-surface preview, and the share image and web manifest for the platform site.

## What changed
- Migration `0100_platform_branding_versions` (append-only history, `app_platform` only; last 20 kept by the app).
- Tokens: `identity { name, tagline }` (HTML stripped, 60/140 chars) and `font` from an enumerated list (`system`, `rounded`, `serif`, `mono`; system stacks only, no webfont loading, no merchant CSS). Old rows without them parse to defaults.
- `shadeRamp()` and `--brand-primary-50..900`, `--brand-font` in `buildBrandCss`.
- `platform.branding.history` (staff read) and `platform.branding.restore` (`platform_admin`+, audited as `platform_branding.restore`). Restore saves the old tokens as a NEW version, history is never rewritten.
- Super Admin Branding page: Identity card (name, tagline, font), History sheet with restore confirm, sticky live preview (website header, dashboard, sign-in card, email header, shade strip; light/dark toggle).
- `@bs/ui` `PlatformLogo` falls back to the brand name as a text wordmark; the brand font applies to the dashboards and the marketing site when not `system`.
- `GET /api/brand/og` (1200x630 PNG via `next/og`, brand colours, dark logo, name, tagline) and `GET /api/brand/manifest`; marketing metadata links both once a brand is saved.

## Decisions and trade-offs
- Fonts are enumerated system stacks. Real webfonts would add requests to the 50 KB-budget product page path and need self-hosting; deferred.
- The client preview has its own copy of `shadeRamp` (a dozen lines); the server output is authoritative.
- Invoices/PDFs: no platform-branded PDF exists today (store invoices are store-branded), so nothing to wire. Not done.
- Super Admin sign-in pages still use the built-in look (pre-login, different API origin). Not done.

## Verification
- Ran: `pnpm typecheck` (17/17), `pnpm lint` (0 errors), `branding-tokens.test.ts` 11 pass.
- Written but NOT run locally (no Postgres/Docker here): `packages/domain/test/platform-branding.int.test.ts` (round trip, support refused, invalid input writes nothing, restore as new version, 20-version cap) and the updated platform rbac/audit/read maps. CI runs them.
- NOT verified: any screen in a browser; the OG image and manifest routes were not requested live.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (0100 row)
- [x] Plan `docs/PLATFORM-BRANDING-PLAN.md` status
- [x] `progress.md` in-flight line
