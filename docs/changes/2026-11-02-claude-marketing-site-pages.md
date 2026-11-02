# Marketing section: Pages, page builder and website sections

- **Date:** 2026-11-02
- **Agent:** claude
- **Branch:** `feat/marketing-site-cms` (merged in #198, d70fd8d)
- **Area:** blocks, block-editor, contracts, domain, platform, superadmin, admin, web, `content-admin`
- **Type:** feature
- **Supersedes:** none

## Summary
Phase 4 of `docs/MARKETING-SITE-CMS-PLAN.md`. Owners and admins manage bcom.si's pages under Marketing > Pages and edit them in the Puck editor. A published About page replaces the built-in `/about`; unpublishing brings the built-in one back. New pages live at `/pages/<handle>` and in the sitemap.

## What changed
- 12 new blocks (`Mk*`, `packages/blocks/src/marketing-blocks.ts`, `views-marketing.tsx`): hero, included strip, statement, feature grid, steps, dark band, FAQ, final call, page header, text section, three points, company details. Server-rendered only, so they add no JavaScript to a store. The name checker and company details come from the host through `RenderContext`.
- `home.css` moved to `packages/blocks/src/marketing.css` (`@bs/blocks/marketing.css`) so the editor canvas draws the same design.
- `marketing.pages.*` covers the admin pages contract except `ensureTemplate`. `platformSiteContext` now also holds `theme.publish`, because publishing needs it.
- The website and stores do not share blocks: the picker keeps them apart (`blockAllowed`, new kind `marketing`), `savePlatformSiteDraft` refuses store blocks, and `savePageDraft` refuses `Mk*` blocks on a store.
- A new page with the handle `about` starts from the code version (`MARKETING_STARTERS`), so nothing has to be retyped.
- The Pages screen and its helpers (`seo-card`, `toolbar-parts`, `use-bulk-runner`, `use-table-selection`) moved to `@bs/content-admin`. Super Admin has its own small editor, `MarketingPageEditor.tsx`, because the website has no theme, header or footer pages.
- Web: `/about` and `/pages/*` on the marketing host read `getPlatformSitePage`. `/pages/about` redirects to `/about`.

## Decisions and trade-offs
- Website pages are read on each request, not cached. Publishing runs in the Platform service, which cannot clear the web app's cache, and publish must show at once. This costs a few queries on `/about` and `/pages/*` only. A failed read shows the built-in About.
- Website pages use only `Mk*` blocks, with few options, so a page cannot drift from the design (plan section 8).
- `/contact`, `/pricing`, Home and the legal pages stay in code. Tabbed feature, pricing and mockups are Phase 5 work.

## Verification
Gate: typecheck, lint, web build and `docs:check` passed. Tests: blocks 261, block-editor 28, admin 109, web 235, domain fast 585, platform heavy 157, domain heavy 2792, all passing on real Postgres where they use a database. `/pages/about` answers 308 to `/about`. Driven in headless Chromium against local web, platform and Super Admin: created About from the Pages screen, it opened in the editor with the code version's content, published, `/about` showed identical words at 2646 px against 2644 px tall on desktop (3629 against 3623 on a 375 px phone), no horizontal overflow on desktop, dark or phone, `/cart` still 404, no 5xx. Unpublishing restored the code version exactly.

NOT verified: Safari, Firefox and real phones; adding or reordering sections in the editor by hand (publish was run on the starter as created); light and dark switching inside the editor canvas, which is light only; `/pages/*` in a browser (real-database tests cover the read and sitemap); uploads, because no website section uses images yet. The failed-read fallback for `/about` is by code reading only. CI caught one defect the local gate missed: `/about` read the database at build time and crashed with no `DATABASE_URL_RW`. `marketingPage` now waits for a request and catches every failure; `next build` with that variable blank passes and lists `/about` as dynamic.

## Docs updated
- [x] `docs/ARCHITECTURE.md`
- [x] ADR-042
- [x] `docs/MARKETING-SITE-CMS-PLAN.md`
- [ ] `DEPLOYMENT.md`: `VITE_MARKETING_URL` is optional and defaults to `https://bcom.si`, used only for the editor's Preview button

## Follow-ups and open questions
- Phase 5: Home, Pricing and the remaining blocks.
- The Pages list shows `/pages/about` for the About page, whose real address is `/about`.
- Footer links from a menu.

## Definition of done
Merged and deployed 2026-11-02. Phase 5 is still to do.
