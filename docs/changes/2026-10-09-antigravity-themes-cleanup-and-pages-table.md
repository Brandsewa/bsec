# Admin Improvements Phase 5: Themes cleanup and Pages table

- **Date:** 2026-10-09
- **Agent:** antigravity
- **Branch:** `feat/admin-improvements-phase-5` (not merged yet)
- **Area:** db, domain, contracts, blocks, block-editor, admin, web, docs
- **Type:** feature
- **Supersedes:** none

## Summary
Implements Phase 5 of `docs/ADMIN-IMPROVEMENTS-PLAN.md`: completely cleans up the Themes workbench, removes legacy block editor code from the admin app, rebuilds the store admin Pages workspace into a modern shared kit `DataTable` with hierarchical pages support (up to 3 levels deep), adds an optional `logoMediaId` additive prop to `SiteHeader`, and introduces storefront catch-all canonical path resolution (`/pages/[...path]`) with strict 308 canonical redirection and tenant cache invalidation.

## What changed
- **Database & Hierarchy:**
  - Added expand-only migration `packages/db/migrations/0054_pages_hierarchy.sql` introducing `pages.parent_id uuid NULL` referencing `pages(tenant_id, id)` via composite tenant foreign key `tenantForeignKey` with index `(tenant_id, parent_id)`.
  - Max depth 3 limit, cycle prevention, and cross-tenant parent rejection enforced at the domain service layer (`packages/domain/src/content-services.ts`).
  - Self-referencing composite FK verified under RLS in real Postgres tests.
- **Contracts:**
  - Extended `PageItem`, `pages.create`, `pages.update` additively in `@bs/contracts/src/admin.ts` with `parentId`, `seo`, `path`, and `childCount`.
  - Added `pages.delete`, `pages.unpublish`, and `pages.duplicate` procedures and wired handlers in `apps/web/src/server/api.ts`.
- **Storefront Catch-All Route & Feature Image Metadata:**
  - `packages/domain/src/cache-invalidation.ts`: supports `extraSlugs?: string[]` on `page_published` to invalidate old and new paths for hierarchical changes using tenant-prefixed tags (`rule 5`).
  - Storefront catch-all route `apps/web/src/app/pages/[...path]/page.tsx` with sibling `loading.tsx` (`rule 11`). Resolves page by leaf slug, verifies ancestor chain, and returns 308 permanent redirect to canonical URL if path diverges.
  - Added `resolveMediaUrlById(rt, tenantId, mediaId)` to `packages/domain/src/media-services.ts` to safely resolve `seo.imageMediaId` through tenant-isolated storage connections without ever exposing raw env URLs.
  - `generateMetadata` in `apps/web/src/app/pages/[...path]/page.tsx` populates OpenGraph (`openGraph.images: [{ url: imageUrl, alt: title }]`) and Twitter card metadata (`twitter: { card: "summary_large_image", ... }`) when `seo.imageMediaId` is present and valid, gracefully degrading when absent or referencing a deleted media item.
  - Updated sitemap, canonical links, and breadcrumbs.
- **SiteHeader Block (`@bs/blocks` & `@bs/block-editor`):**
  - Added additive optional `logoMediaId` string prop with schema, views, registration, editor config, and unit tests (`packages/blocks/test/theme-pages.test.tsx`). No block version bump needed (ADR-009).
- **Themes Page (`apps/admin/src/routes/_store/online-store/theme-library.tsx`):**
  - Removed "Brand and logo" and "Theme settings" header buttons, and removed the old "Customise <theme>" section block.
  - Set theme cards grid to `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` (3 per row on desktop).
  - Current theme card gets primary "Customise" button that opens `/online-store/editor/$pageId` for the home page.
  - Feed `BlockEditor` page switcher with both system pages and custom pages (`PageVisualEditor.tsx`).
  - TanStack redirects from `/online-store/theme` and `_editor/online-store/theme-settings` to `/online-store/theme-library`.
- **Pages Workbench (`apps/admin/src/routes/_store/online-store/pages.tsx`):**
  - Completely deleted legacy block editor (`BLOCK_TYPES`, `FieldSpec`, `PageEditor`, `PageEditorLoader`, `BlockFields`, `ScalarInput`). Grep for `BLOCK_TYPES|BlockFields|PageEditorLoader` returns completely empty.
  - Rebuilt as shared kit `DataTable`: columns Name, URL (canonical full path `/` or `/pages/...`), Parent, Status, Updated; search toolbar; status filter; "Add page" button.
  - System pages (`header`, `footer`, `template-*`) are hidden; home page row is shown with locked URL `/` and delete disabled.
  - Add/Edit `Sheet`: `react-hook-form` + Zod contract, auto-slug generation with live canonical URL preview, reserved slugs protection, parent `SimpleSelect` (excluding self and descendants), Meta title (counter / 70), Meta description (counter / 160), feature image upload (`upload-media.ts`), "Save" and "Save and Customize" (opens Puck editor).
  - Resolved `react-hooks/incompatible-library` warning by refactoring watched form values (`name`, `parentId`, `slug`) to `useWatch` with explicit control.
  - Row actions: Edit (Sheet), Customize (`/online-store/editor/$pageId`), kebab: Duplicate, Unpublish, Delete with `ConfirmDialog` (refuses/disables delete when page has children).

## Decisions and trade-offs
- **ADR-026**: Authored `docs/adr/026-page-hierarchy-and-canonical-urls.md` capturing hierarchical data model, composite tenant FK under RLS, canonical URL rules, 308 redirects, and descendant cache invalidation.
- **Base UI Integration**: Handled Base UI `DropdownMenuTrigger` using `render={<Button ... />}` and `SimpleSelect` primitives matching admin UI standards.

## Verification
- **Docs Check:** `pnpm docs:check` passed (`docs:check ok`).
- **Typecheck:** `pnpm typecheck` passed (clean across all 15 workspaces).
- **Lint:** `pnpm lint` passed (0 errors, 0 warnings across all 15 workspaces).
- **Monorepo Build:** `pnpm build` passed (6/6 tasks successful, Next.js catch-all `/pages/[...path]` verified).
- **Real Database Integration Tests (`postgres://postgres:postgres@localhost:55432/postgres`):**
  - `packages/domain/test/pages-hierarchy.int.test.ts`: 9/9 passed (parent in another tenant rejected by composite FK, cycle rejected, depth 4 rejected, duplicate and reserved slug rejected, delete with children refused, self-referencing parent_id works under RLS, getStorefrontPageByPath canonical resolution and 308 redirects, resolveMediaUrlById graceful handling of null/missing/deleted media IDs).
  - `packages/domain/test/isolation.int.test.ts`: 1,277/1,277 passed (all procedure mappings including `pages.delete`, `pages.unpublish`, `pages.duplicate` verified).
  - `packages/db test`: 41/41 passed (including `b2-grants.int.test.ts` for migration 0054).
  - Full heavy local suite (`pnpm test:heavy:local`): 94/94 files passed, 1,993/1,993 tests passed.
- **Package Tests:**
  - `packages/blocks`: 114/114 passed (`packages/blocks/test/theme-pages.test.tsx` verifying `logoMediaId` additive prop).
  - `apps/web`: `apps/web/test/storefront-catchall-pages.test.ts` (7/7 passed, including image metadata resolution with image, without image, and with deleted media ID), `apps/web/test/cached-storefront.test.ts` (9/9 passed).
  - `apps/admin`: `apps/admin/test/online-store-pages.test.tsx` (6/6 passed), serial test suite 74/74 passed.
- **Browser Walkthrough (`e2e/walkthrough-phase5.mjs`, Playwright Chromium, Desktop 1280x800 & Mobile 375x812):**
  - **Script Committed:** `e2e/walkthrough-phase5.mjs` is committed with the repo (walkthrough screenshots in `apps/admin/walkthrough-artifacts` remain untracked).
  - **Environment Note:** Walkthrough ran against `@bs/admin` preview with a stateful client-side mocked RPC layer (proves UI rendering, layout, responsiveness, form interactions, and state wiring; server-side behavior is verified separately by real Postgres integration tests).
  - **Result: 56/56 checks passed (100% success rate).**
  - Verified:
    - Themes desktop: 3 theme cards per row (`lg:grid-cols-3`), breadcrumbs, "Current theme" badge, primary "Customise" button on active theme. Header buttons "Brand and logo" and "Theme settings" absent. Block "Customise <theme>" absent.
    - Themes mobile: Single-column responsive layout, zero horizontal overflow.
    - Customize into Puck: Navigates to `/online-store/editor/page-home`. Page switcher contains system pages (Home, Header, Footer, Product) and custom pages (About Us, Leadership Team). Theme tab contains theme settings (Colors, Typography, Buttons).
    - Legacy redirects: Navigating to `/online-store/theme` and `/online-store/theme-settings` redirects cleanly to `/online-store/theme-library`.
    - Pages workbench: DataTable lists pages with canonical paths (`/`, `/pages/about`, `/pages/about/team`). System pages hidden. Search and filter working. Mobile 375px responsive layout verified with no horizontal overflow.
    - Add page: Sheet opens, page name fills auto-slug, live canonical path displays `/pages/our-philosophy`, parent selection updates path to `/pages/about/our-philosophy`, meta title & description counters update, saving adds page to table.
    - Edit page: Prefills page data, updates SEO title and saves.
    - Customize from table: Navigates directly to Puck for target page.
    - Delete refusal: Home page delete action disabled; page with children opens refusal dialog with disabled confirm button and warning notice.

## Acceptance Criteria Checklist (Plan §7.3)
- [x] **Real-DB tests:** parent in another tenant rejected; cycle rejected; depth 4 rejected; duplicate and reserved slug rejected; delete with children refused; self-referencing parent_id works under RLS; isolation mapping updated.
- [x] **Storefront tests:** /pages/about and /pages/company/about resolve per hierarchy; wrong ancestor path 308s to canonical; unknown path 404; a cached page refreshes after a parent change; share image resolves safely via media resolver.
- [x] **Admin:** table lists pages with correct paths; Add creates and shows the page; Edit saves SEO and feature image; Customize opens Puck on the right page.
- [x] **No reference to legacy editor remains:** Themes page shows 3 cards per row and none of the removed controls; old /online-store/theme and /theme-settings URLs redirect.
- [x] **Docs updated:** ADR-026 written; docs/ARCHITECTURE.md updated; progress.md updated.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (sections: 0 triggers & Last verified, 2 route map, 7 migrations & data model, 8 admin contracts)
- [x] `docs/adr/026-page-hierarchy-and-canonical-urls.md` (ADR-026 written, `docs/adr/README.md` updated)
- [x] `progress.md` (In flight and Phase 5 status updated)

## Follow-ups and open questions
- None. Handing off to Claude for verification. Do NOT merge PR; do NOT begin Phase 6.

## Definition of done
- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (real-DB test for hierarchy, RLS, composite FK, isolation, media resolution).
- [x] `docs/ARCHITECTURE.md` updated; "Last verified" commit bumped.
- [x] ADR written: `docs/adr/026-page-hierarchy-and-canonical-urls.md`.
- [x] A change record in `docs/changes/` and `progress.md` updated.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: 56 browser walkthrough checks passed with stateful mocked RPC, all real-DB suites executed and passed live on local Postgres.
