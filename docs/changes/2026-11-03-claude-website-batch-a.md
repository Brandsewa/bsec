# Website revisions: settings layout, hold screens, policies removed, theme settings, builder rail, footer folds

- **Date:** 2026-11-03
- **Agent:** claude
- **Branch:** merged in #211, c007b41
- **Area:** blocks, block-editor, contracts, domain, platform, superadmin, web
- **Type:** feature
- **Supersedes:** none

## Summary
Items 14 to 19 of `docs/UPDATES-BATCH.md`.

## What changed
- Storefront > Settings has an inside sidebar (a chooser on small screens) and the section on the right, like the store admin. `/storefront/settings` opens Website visibility.
- Coming soon and maintenance show only the holding screen: no header, footer or announcement bar (Home, plain pages, blog).
- Policies are removed from Super Admin: screen, route, `marketing.policies` contract and handlers, and the public Terms, Privacy, Refund and Delivery pages go back to their built-in text only. Existing policy rows on the website record are left in place and ignored.
- Builder: the Header and Footer tabs are gone (switch pages from the toolbar). The Theme tab now has Colours (light and dark: primary, text on primary, page background, text) and Font, next to the announcement bar. They live in a `MkTheme` block on the Header page and apply site-wide once published (`websiteThemeCss`, read through `getPlatformSiteChrome`). The colour fields accept a typed hex value.
- The website footer (Footer block and built-in) folds its link columns on tablets and phones.

## Decisions
- Theme settings are colours and a font list (Geist default, Inter, DM Sans, Poppins, Lora, Playfair Display). Corner radius, card styles and layout width are not included: the website's CSS hard-codes its radii. Ask if they are wanted.
- Coming soon hides header and footer as well as maintenance.

## Verification
Unit tests (blocks, block-editor), real-database platform tests (18), lint, docs:check, web build with blank `DATABASE_URL_RW`. NOT verified in a browser: the settings sidebar, hold screens, theme colours and fonts on the live page, footer folds on a phone.
