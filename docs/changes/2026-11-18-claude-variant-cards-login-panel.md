# Variant cards, transparent images, image viewer and split admin sign-in page

- **Date:** 2026-11-18
- **Agent:** claude
- **Branch:** `fix/pdp-variant-cards-login-panel` (not merged yet)
- **Area:** web, blocks, block-editor, admin, superadmin, platform, db
- **Type:** feat
- **Supersedes:** none

## Summary
Four owner requests from the 2026-11-18 session. (1) A transparent product image no longer shows a black box: the stored dominant colour was the placeholder behind the picture. (2) The product image viewer renders on `document.body`, so it covers the page from the top instead of sitting under the header. (3) New "Cards" variant style with per-store settings. (4) Store-admin sign-in is a split screen whose content panel is edited in the Super Admin.

## What changed
- `ProductGallery.tsx`: no placeholder colour for png/webp/gif/svg; the colour is cleared once the picture loads; the viewer is a portal at z-1000.
- `variantStyle` gains `cards` (additive enum, no block version bump). New optional settings: `showVariantBadge` (default true), `variantCardBg`, `variantCardActive`, `variantBadgeBg`, `variantBadgeText`. Storefront `VariantCards` in `VariantSelector.tsx` (variant picture, name, price, compare-at price, Save % badge; 2 per row on a phone, 3 on tablet and desktop; swipe, hover arrows on desktop); editor sample and CSS follow.
- Migration `0115_platform_login_panel` (`platform_settings.login_panel`), `packages/domain/src/platform/login-panel.ts`, Platform API `settings.getLoginPanel/updateLoginPanel`, public `GET /api/public/login-panel`, Super Admin page `/login-page`, admin `SplitAuthShell` and `routes/login.tsx` (larger fields).
- `apps/platform/src/app.ts`: added the missing `marketing.pages.version` handler (`getPageVersion`). The page History merge (#284) added `pages.version` to the shared contract, so the platform router no longer typechecked; this blocked the gate.
- Not code: Google sign-in is missing on the sign-in page because the platform Google client is not enabled with a client ID and secret in Super Admin, Integrations, Authentication.

## Decisions and trade-offs
- Sign-in form: only the logo above the form; a small row above the email field has "Forgot password?" on the left and "Sign in" (the page heading) on the right. New panel setting `verticalAlign` (top, middle, bottom; old rows default to middle) in the domain, contract, Super Admin and admin shell.
- Forgot password, reset password and accept-invite screens use the same split shell, floating fields and tall buttons (`SplitAuthShell` takes an optional title and description). The sign-in page has no visible heading; "New registration" (left) and "Forgot password?" (right) sit under the Sign in button.
- Layout (owner, after review): content panel on the left (40%), form on the right (60%); the panel is hidden on phones and tablets; no theme toggle; floating-label fields like checkout (`components/floating-input.tsx`); text "BCOM" wordmark when no platform logo is uploaded.
- Content lives in `platform_settings` (not the website CMS) because the sign-in page has no tenant or session; it is text and colours only (ADR-010). The picture is chosen with the media picker (upload or library) and stored as its URL; the server accepts https, or http on a *.localhost host for local dev.
- Admin app code may not use raw hex, so the built-in fallback panel is written as `rgb()`.

## Verification
- `pnpm gate:quick` passes (typecheck, lint, build, affected tests); `pnpm docs:check` passes. `@bs/platform` typecheck was failing on plain `main` until the `marketing.pages.version` handler was added.
- Lint clean on touched packages. `@bs/blocks` tests: 285 pass. Domain `platform-login-panel.int.test.ts`: 4 pass (real Postgres). `apps/platform` `audit-coverage`: 82 pass. Domain `isolation`: 1837 pass.
- By hand in the browser on local demo data: cards at desktop, tablet and phone widths, the card colours and the badge toggle, a transparent PNG, the viewer position, the sign-in page at desktop and phone widths.
- Super Admin: signed in locally, opened "Sign-in page", saved a new heading; the public endpoint served it, an audit row was written, and the admin sign-in page showed it (admin app pointed at the store host locally).
- NOT verified: real touch swiping; a real production host; the heavy domain suites other than `isolation` and the new test (CI runs them).

## Docs updated
- [x] `docs/ARCHITECTURE.md` (migration table 0115)
- [x] ADR: not needed (no architectural decision change)
- [x] `DEPLOYMENT.md` / RUNBOOK: not needed (no env var, service or port change)
- [ ] `progress.md`

## Follow-ups and open questions
- Owner: enable the Google client in Super Admin if staff Google sign-in is wanted.
- Later: same split layout for Super Admin and customer account pages.

## Definition of done
Gate and checks above; no secrets or generated files in the diff.
