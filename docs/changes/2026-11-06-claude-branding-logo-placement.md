# Brand logo on the website header and footer, sign-in pages, logo size, Branding page layout

- **Date:** 2026-11-06
- **Agent:** claude
- **Branch:** `feat/branding-logo-placement`  (not merged yet)
- **Area:** domain, contracts, blocks, web, ui, superadmin, docs
- **Type:** feature
- **Supersedes:** none

## Summary
Owner feedback after phase 3: the saved logo must show on the bcom.si header and footer, on the store admin and Super Admin sign-in pages (logo only, never the icon), with a width/height control, and the Branding page needed a better layout.

## What changed
- **Website header and footer:** `BrandLogoImg` (`@bs/blocks`) draws the saved full logo, both theme variants (the marketing stylesheet shows the right one). Used by the client header (`HomeNav`, desktop and mobile drawer), the published footer and the built-in footer. The logo reaches the blocks as a server-filled, never-stored `brandLogo` prop (header and footer schemas) and through `SiteNavContext`. Until a logo is saved the old "B BCOM" mark shows.
- **Sign-in pages:** `AuthShell` shows the platform logo instead of the old icon and name on staff pages (store admin and Super Admin). Super Admin Login hides its "Bs Commerce Super Admin" title and subtitle once a logo exists (`titleIsBrand`, kept as a screen-reader heading). Super Admin now loads `GET /api/brand` from the website origin before login (`webBase()`, `VITE_WEB_URL` or `VITE_MARKETING_URL` to override).
- **Logos only:** `PlatformLogo` and the website no longer fall back to the icon for the full logo. A single logo serves both surfaces when only one is set (`brandLogoPair`).
- **Logo size:** new token `logoSize { width, height }` (8 to 600 px, null = auto), emitted as `--brand-logo-w` / `--brand-logo-h`, read by the website, sign-in pages and previews. Applies to the two full logos only, not icons.
- **Branding page:** row 1 Dark and Light logo; row 2 Dark icon, Light icon, Favicon as square tiles; logo size inputs below; the preview column is now wider (2fr / 3fr).

## Decisions and trade-offs
- One size for all surfaces (the owner asked for one control). Automatic size uses 32 px (website) or 40 px (sign-in pages).
- Footer and header blocks placed inside a page body (not the site chrome) keep the glyph mark; only the site header and footer take the brand logo.
- The Super Admin sign-in logo depends on the website origin being reachable from the Super Admin origin (CORS is open on `/api/brand`).

## Verification
- Ran: `pnpm typecheck` (17/17), `pnpm lint` (0 errors), `pnpm build`, `branding-tokens.test.ts` 14 pass.
- NOT verified: any screen in a browser (header, footer, both sign-in pages, Branding page); the real-database platform suites run in CI only.

## Docs updated
- [x] This record; `progress.md` in-flight line
- [ ] After merge: Branch line and in-flight line (per AGENTS.md section 5)
