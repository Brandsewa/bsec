# Re-verification of Phase 6 (navigation builder, filter menus): accepted

- **Date:** 2026-10-10
- **Agent:** claude
- **Branch:** `docs/admin-improvements-plan` (verifies `feat/admin-improvements-phase-6` at `beefa25`)
- **Area:** web, domain
- **Type:** test
- **Supersedes:** none (follows `2026-10-09-claude-navigation-phase-6-verification.md`)

## Summary
Accepted. All four requested items are fixed.

## Verification
- `pnpm docs:check` pass; typecheck 15/15; lint 15/15.
- `apps/web` fast tests **183/183** (the failing cache-tag test is fixed); `cache-invalidation.test.ts` 12/12; `packages/db` `b2-grants` 6/6.
- `pnpm test:heavy:local`: **95 of 95 files, 2001 of 2001 tests**, clean on the first run.
- Read the fix diff. Not re-run by me: build, the browser walkthrough.

## Checked
1. The collection loader test and the invalidation matrix now agree, including the `nav` tag.
2. `nav` is now invalidated by page publish, slug, parent, unpublish and delete events, collection updates, product updates (create and update now call `invalidateCache`) and a new `brand_updated` event wired into brand create, update and delete; new unit tests cover the tags.
3. The price facet filter uses one `EXISTS` with both bounds on the same variant; `storefront-menus.int.test.ts` gained a straddling-variants case.
4. `e2e/walkthrough-phase6.mjs` is committed and the record says plainly that the API is mocked (screens and wiring, not the server).

## Docs updated
- [ ] none needed for this record
