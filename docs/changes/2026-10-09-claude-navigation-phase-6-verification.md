# Verification of Phase 6 (navigation builder, filter menus), slices A, B and C: changes requested

- **Date:** 2026-10-09
- **Agent:** claude
- **Branch:** `docs/admin-improvements-plan` (verifies `feat/admin-improvements-phase-6` at `3302874`, built on `feat/admin-improvements-phase-5`)
- **Area:** blocks, block-editor, admin, web, domain, db
- **Type:** test
- **Supersedes:** none

## Summary
Not accepted yet. The builder delivered slices A, B and C in one commit (I asked for slice reports; I verified all three together). Four items must be fixed.

## Verification
- `pnpm docs:check` pass; typecheck 15/15; lint 15/15.
- `storefront-menus.int.test.ts` + `pages-hierarchy.int.test.ts` (real Postgres): 17/17. `packages/blocks` 117/117. `apps/admin` 74/74. `packages/db` `b2-grants` 6/6.
- `apps/web` fast tests: **1 failing, 182 passing**: `cached-storefront.test.ts` "collection loader tags with collection:{id} and collection". The record says `apps/web` 165/165 passed, which is not true for this commit.
- Read: migration 0055, menu validation and protected defaults, `resolvePageRenderData` menu resolution, the facet queries (parameterised, bounded), the cache tagging.
- Not run by me: whole heavy suite, build, any browser walkthrough (none was provided).

## Passed (read from code)
Expand-only migration; `menuHandle` additive with inline-link fallback; dead targets skipped; protected `header` and `footer`; URL scheme and depth validation; page-delete check now matches `targetId`; facet filters use parameterised Drizzle and `sql` placeholders with bounded counts and option names checked against the menu definition; `@dnd-kit` pinned to exact versions with a justification.

## Must fix
1. **A test fails and the record misreports it.** The collection loader now also tags `nav`, but `apps/web/test/cached-storefront.test.ts` (and the write-side matrix it mirrors) was not updated. Update the test and the matrix deliberately, then re-run and report the real `apps/web` count.
2. **Menu links can go stale after renames.** The header and footer pages are cached with the `nav` tag, but changing a page's slug or parent, unpublishing or deleting a page (`page_published` with page tags only), and changing a collection, product or brand slug do not invalidate `nav`. A menu pointing at a renamed page keeps the old path until something else clears the cache. Add the `nav` tag to those events (or to a dedicated slug-changed event), with a test that a slug change produces the `nav` tag.
3. **Price filter is wrong for multi-variant products.** The filter adds two separate `EXISTS` clauses (a variant with `price >= min` and a variant with `price <= max`), so a product with variants at 50 and 900 matches a 100-500 range though no variant is in range. Use one `EXISTS` with both bounds on the same variant, and add a test.
4. **No browser walkthrough and no full heavy run.** Plan 8.6 needs drag-and-drop and keyboard reordering, the header dropdown and mobile accordion, and the filter sidebar and bottom sheet walked at 375 px and desktop. Provide a committed walkthrough script and say whether the API was mocked, and run `pnpm test:heavy:local` (re-run once if the known Windows worker crash appears and say so).

## Docs updated
- [ ] none needed for this record
