# Website page builder: header, footer, theme tab, page switcher, generic widgets

- **Date:** 2026-11-03
- **Agent:** claude
- **Branch:** `feat/storefront-builder` (not merged yet)
- **Area:** blocks, block-editor, contracts, domain, platform, superadmin, web
- **Type:** feature
- **Supersedes:** none

## Summary
Slice S3 of Phase 5 (`docs/MARKETING-SITE-CMS-PLAN.md` section 5a). The page builder in Super Admin now works like the store builder: the Layout and Basic widgets are available on website pages, the sidebar has Theme (with the announcement bar), Header and Footer tabs, and the toolbar has a page switcher. A published header, footer or announcement bar replaces the built-in one on bcom.si.

## What changed
- Blocks: new `MkHeader` and `MkFooter` data blocks (defaults are today's header and footer), `isWebsitePageBlockSet`, `isWebsiteHeaderBlockSet`, `isWebsiteFooterBlockSet`, and `WEBSITE_BLOCK_VARS` (maps the store widgets' `--bs-*` variables to the website palette, light and dark). The widgets allowed on a website page are listed in `WEBSITE_GENERIC_BLOCK_TYPES`.
- Block editor: page kinds `marketingHeader` and `marketingFooter`; `WebsiteThemePanel` (announcement bar), `MkHeaderPanel`, `MkFooterPanel`.
- Contracts and domain: `marketing.pages.ensureChrome` creates the Header or Footer page from today's layout (idempotent, audit-logged); `savePlatformSiteDraft` validates by page type (a footer page holds only `MkFooter`, a header page `MkHeader` and `Banner`); `getPlatformSiteChrome` and `getPlatformSiteRenderData`; `getPlatformSitePage` now also returns the render data (images, menus) its widgets need.
- Super Admin: `MarketingPageEditor` loads the header and footer as the frame, keeps their edits with the page (Save draft and Publish save and publish them too), the page switcher lists Header, the pages, Footer, and images use the media library picker.
- Web: the layout reads the published chrome once per request. `HomeNav` takes brand, buttons and menu handle from the Header page and draws the announcement bar; `HomeFooter` draws the published Footer; website pages render their widgets with images and the gallery and banner client helpers.

## Decisions and trade-offs
- The website keeps one fixed design: the Theme tab holds the announcement bar only (no colour or font tokens).
- A header or footer that is missing, draft, or invalid reads as "not set" and the built-in one shows (ADR-011).
- Opening the builder creates the Header and Footer pages as drafts (nothing changes on the site until they are published).

## Verification
Unit: blocks 269, block-editor 28. Real database: `apps/platform/test/marketing.int.test.ts` (15) covers the widgets, `ensureChrome`, the per-page-type block rules and `getPlatformSiteChrome`. Headless Chromium against local Platform, Super Admin and web: the editor shows Theme, Header, Footer, Blocks, Outline and the page switcher; editing the brand, the main button, the footer brand and the announcement bar and publishing changes `/` (announcement bar above a "BCOMX" header with "Try it free").

NOT verified: on the live site, phone widths of the new header and footer, the Pricing widget, Home and blog templates (slice S4).

## Docs updated
- [ ] plan status (done at merge)

## Follow-ups and open questions
- S4: Pricing table widget, Home as a block page, Blog archive and Blog post templates.

## Definition of done
Not done until merged: see `AGENTS.md` section 7.
