# Phone header is logo + account; bottom bar loses Account; store auth pages restyled

- **Date:** 2026-10-26
- **Agent:** claude
- **Branch:** `ci/speedup` (not merged yet)
- **Area:** blocks, ui, web
- **Type:** feature
- **Supersedes:** none

## Summary
On phones the store header now shows only the logo and an account pill ("Login", or the shopper's first name when signed in). Explore, Search and Cart live only in the bottom bar, which drops Account. Store sign-in, create-account and forgot-password pages lose the brand label, show their explanatory text under the card, and the form button takes the theme builder's button colour.

## What changed
- `packages/blocks/src/blocks.css`: below 768px hides the hamburger toggle and the header cart link (both stay mounted so the bottom bar can open the menu drawer and mini cart); `.bsb-site-account` pill.
- `packages/blocks/src/types.ts`, `views.tsx`: new optional `renderAccount` render hook, used by `SiteHeaderView` when set (editors without it keep the icon link).
- `apps/web/src/components/storefront/AccountLink.tsx` (new), `ThemeChrome.tsx`: client link reading `GET /api/storefront/customer/profile`.
- `MobileBottomNav.tsx`: Home, Explore, Search, Cart.
- `packages/ui/src/layout/auth-shell.tsx`: `variant="store"` omits the brand name and renders the description below the card.
- `apps/web/src/app/account/layout.tsx`: sets `--primary` / `--primary-foreground` from the theme's `--bs-btn-bg` / `--bs-btn-fg`; default colour when unset or outline style.

## Decisions and trade-offs
- Desktop header is unchanged (search and cart stay); the request was read as the phone layout shown in the screenshots.
- The account pill shows on desktop too, with the same Login/name text.

## Verification
- Ran: `pnpm --filter @bs/blocks --filter @bs/ui --filter @bs/web typecheck` pass; `pnpm --filter @bs/blocks test` 253 pass.
- Also ran: lint on blocks, ui, web (0 errors); searched `e2e/` for header and bottom-bar selectors (none affected).
- Exercised by hand at 375px on the seeded `demo-store` (local dev DB): header shows logo + "Login" pill, hamburger/search/cart hidden, bottom bar Home/Explore/Search/Cart, Explore still opens the drawer; sign-in, create-account and forgot-password show no brand label, text under the card, theme-coloured buttons.
- Fixes found while testing: the phone rules lost to the later `.bsb-site-icon` rule (raised specificity, which also fixes the old search-hide rule); a header with the account icon off now still shows the pill on phones only (`.bsb-phone-only`).
- Follow-up: `LoginForm` takes `phoneLogin` (default false), so the Phone Code tab and OTP form are hidden until phone sign-in is set up; email and password only. Tests that cover the OTP form pass `phoneLogin: true`. `AccountLink` refetches on route change.
- Local login test: seeded customer `aarav.sharma@demo.example` got a local-only password (`DEV_CUSTOMER_EMAIL` / `DEV_CUSTOMER_PASSWORD` in the gitignored `.env.dev`). API login, wrong-password rejection, form login at `/account/login` and the account dashboard all worked; the header pill then read the first name.
- NOT verified: horizontal fit of the account dashboard at 375px (the pane's width emulation was unreliable), desktop width, and a store with a custom button colour.

## Docs updated
- [ ] `docs/ARCHITECTURE.md` not needed (no structure change)
- [ ] ADR not needed
- [ ] `DEPLOYMENT.md` not needed
- [ ] `progress.md` not needed
