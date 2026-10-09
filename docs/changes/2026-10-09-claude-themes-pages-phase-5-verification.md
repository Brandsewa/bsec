# Verification of Phase 5 (themes cleanup, pages table with hierarchy): changes requested

- **Date:** 2026-10-09
- **Agent:** claude
- **Branch:** `docs/admin-improvements-plan` (verifies `feat/admin-improvements-phase-5` at `8143c8c`, built on `feat/admin-improvements-phase-4d`)
- **Area:** admin, web, domain, db, blocks
- **Type:** test
- **Supersedes:** none

## Summary
Not accepted yet: two small items. The design and most of the build match the plan.

## Verification
- `pnpm docs:check` pass; typecheck 15/15; lint 15/15 (one react-hooks "incompatible library" warning in `pages.tsx` line 176, from `watch()`).
- `pnpm test:heavy:local` (whole `@bs/domain` heavy suite, shared local Postgres): run 1 had 92 of 94 files (2 files lost to the usual Windows worker crash), run 2 passed **94 of 94 files, 1992 of 1992 tests**. This includes `pages-hierarchy.int.test.ts` and the isolation suite.
- `apps/web` catch-all and cached-storefront tests 13/13; `apps/admin` 74/74; `packages/blocks` 114/114.
- Read: migration 0054, hierarchy validation, delete/duplicate/unpublish services, the new `/pages/[...path]` route, sitemap change, cache invalidation change.
- `packages/db` `b2-grants.int.test.ts` could not run on my first attempt because the shared Postgres was down; the whole heavy run then started it and no new tables are involved in 0054.

## Passed
Expand-only migration with a composite tenant foreign key (`ON DELETE RESTRICT`); depth limit 3 including the moved subtree, cycle check, home and system pages cannot be parents, slug format and a reserved list matching the storefront route names (plus `template-*`, `media`); delete refused when the page has children or a menu item links to it; catch-all route redirects non-canonical ancestor paths with `permanentRedirect` (308); sitemap uses canonical paths and skips theme system pages; descendants' cache tags invalidated; legacy editor code removed from `pages.tsx`; Themes page grid, buttons and routes redirected; `logoMediaId` added to `SiteHeader` additively; ADR-026 written.

## Must fix
1. **Feature image is saved but never used.** The Add/Edit sheet stores `seo.imageMediaId`, but nothing on the storefront reads it (`generateMetadata` in `apps/web/src/app/pages/[...path]/page.tsx` sets only title, description and canonical). The plan says it is the Open Graph / share image. Resolve the media URL (through the media connection resolver, never a raw env URL) and add `openGraph.images` and `twitter` image metadata when present, with a test for a page with and without an image and with a deleted media id.
2. **The browser walkthrough evidence is missing.** The change record cites `e2e/walkthrough-phase5.mjs` (56 of 56 checks), but that file is not in the commit or the worktree, so the claim cannot be checked. Commit the script (artifacts stay untracked), and state in the record whether the API was mocked, as the earlier walkthroughs were. Do not describe a mocked run as "live".

## Smaller notes
- Fix or consciously suppress the `pages.tsx` lint warning (use `useWatch` or move the `watch` calls).
- Menu references are matched by URL text today (menu items store `url`); that is fine until Phase 6 switches page items to store the page id, which must keep this delete check working.

## Docs updated
- [ ] none needed for this record
