# Homepage versions: duplicate the homepage and choose which one is live

- **Date:** 2026-11-20
- **Agent:** claude
- **Branch:** `feat/homepage-versions`  (merged in #294, ba1192e)
- **Area:** domain, contracts, web, admin
- **Type:** feature
- **Supersedes:** none

## Summary
Ruttl ticket (store admin, Pages): "add option to duplicate homepage so that we can have multiple homepage but only one homepage should be active one at a time". A store can now duplicate its home page into homepage versions and make any one of them the live homepage; the previous one stays as a version.

## What changed
- `packages/domain/src/content-services.ts`: `duplicatePage` on the home page (or a version) creates a `home_variant` page (draft, slug `home-version-N`, title "Home (Version N)") instead of refusing. New `activateHomePage` swaps the version with the live home page in one transaction, audits `page.home_activated`, refreshes the home cache after commit. `publishPage` and `rollbackPage` refuse a version; `updatePage` keeps a version's slug and parent fixed; a version cannot be a parent.
- `packages/contracts/src/admin.ts`, `apps/web/src/server/api.ts`: `admin.pages.activateHome` (`theme.publish`).
- `packages/content-admin`: Pages screen shows "Active homepage" and "Homepage version" badges, "Not live" as the version's URL, a Duplicate action on the home row and a "Make active homepage" action with a confirmation. Behind a new `homeVersions` host flag turned on only in `apps/admin/src/lib/content-host.ts` (Super Admin's website pages are unchanged).
- No migration: `pages.type` is a free text column; `home_variant` is a new value.

## Decisions and trade-offs
- Versions are rows of type `home_variant` and always drafts, so nothing public (page lookup, sitemap, menus' page links) can see them without extra filters. Identity swaps on activation (type and slug), instead of copying content into the live row, so each version keeps its own history and the "one active" rule is structural (the slug `home` is unique per store).
- The swap looks for the current home page by type or slug `home`, as the rest of the code does.
- Editing a version uses the normal page editor; its Publish button is refused with a message pointing to "Make active".
- Markets (`marketId`) are not involved: the home page content is per store, as before.

## Verification
- Ran: `packages/domain` `home-versions.int.test.ts` 5 pass and `isolation.int.test.ts` pass (1,847 tests together, real Postgres via the local test DB), `tsc --noEmit` for contracts, domain, web, content-admin; `pnpm --filter @bs/admin typecheck`; `pnpm gate:quick` (see PR).
- NOT verified: the Pages screen was not driven in a browser (no local admin stack was started); the Puck editor's Publish message on a version was not seen.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (pages API list and a Homepage versions paragraph)
- [ ] ADR: not needed (small extension of the pages model)
- [ ] `DEPLOYMENT.md`: not needed
- [x] `progress.md`: in-flight line added, removed at merge

## Follow-ups and open questions
- Ruttl ticket id `3775533d-3545-4f30-812d-4a334b404407`: owner to move it to done after the merge (no Ruttl tool changes ticket status).
- Not built: scheduling a switch, or A/B splitting traffic between versions.

## Definition of done
Gate run before push; no secrets or generated files in the diff.
