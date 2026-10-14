# Media Library Phase 2: Claude verification and fixes

- **Date:** 2026-10-14
- **Agent:** claude
- **Branch:** `feat/media-library-phase-2` (not merged yet)
- **Area:** domain, docs
- **Type:** fix
- **Supersedes:** none

## Summary
Verified Antigravity's Phase 2 (head `1e52148`) against `docs/prompts/media-library-phase-2.md`. The picker, catalog and branding wiring, usages, cache fan-out, replace and product gallery are in place and the full database suite passed. Review found five defects, fixed here with tests.

## Defects found and fixed (`packages/domain/src/media-services.ts`)
1. **Product gallery could end with a video as the main item.** Removing the last image while videos remained left a video at position 0. Now refused ("Remove the videos first"); the delete rolls back.
2. **Reorder accepted repeated ids.** `[a, a]` for a product with two items passed the "same set" check and left positions inconsistent. Now each item must appear exactly once.
3. **Trashed files could be added to a product.** Now refused ("Restore it before adding").
4. **Replace accepted an undecodable image.** A PNG header with garbage bytes was stored with empty dimensions. Now refused as at upload, the original is kept and the uploaded object is purged.
5. **`sha256` was a hash of the first 4 KB for videos and documents** (upload and replace). It is now stored only when the whole file was hashed, otherwise null, so a later duplicate check cannot match unrelated files.

## Tests added
- `media-product-gallery.int.test.ts`: trashed attach, duplicate reorder ids, last-image removal.
- `media-replace.int.test.ts`: undecodable replacement.

## Verification (Claude, local, on the fixed tree)
- `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`: pass.
- `pnpm --filter @bs/domain test:fast`: 48 files, 410 tests pass.
- Full heavy suite, serial, local Postgres: 101 files, 2070 tests pass.
- `pnpm --filter @bs/db test` with `TEST_PG_ADMIN_URL` set: 5 files, 41 tests pass (without it, the two integration files need Docker/testcontainers and fail to start).
- `pnpm --filter @bs/admin test:fast -- --no-file-parallelism`: 12 files, 74 tests pass. A parallel run right after the build failed 8 tests once; serial runs are clean.
- One heavy run hit a Windows native worker crash (exit 3221226505) in `concurrency-scale.int.test.ts`, which did not recur in the final run. Phase 1 saw the same code once in another file. Intermittent, not reproducible, not understood.

## Not verified
- I did not run the admin or storefront in a browser. The picker, gallery drag and drop, replace flow and video playback are verified by reading the code and by the database tests only. Antigravity's change record has no walkthrough screenshots either (the prompt required them).
- Cache invalidation is verified as tags computed from `media_usages`; whether Next.js actually serves fresh pages after a change was not exercised.
- Status background and SEO image usages are written by their services and backfilled by migration 0058; the migration file's header comment mentions them and the SQL covers them.

## Docs updated
- [x] Antigravity's ADR-029 and `docs/ARCHITECTURE.md` entries reviewed; no further change needed.
- [x] `progress.md`

## Follow-ups and open questions
- Phase 3: block editor and page/theme usages. Walkthrough evidence for Phase 2 is still owed (picker at 375 px, gallery video on the storefront).
