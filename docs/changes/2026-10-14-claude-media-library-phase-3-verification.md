# Media Library Phase 3: Claude verification and fixes

- **Date:** 2026-10-14
- **Agent:** claude
- **Branch:** `feat/media-library-phase-3` (not merged yet)
- **Area:** domain, block-editor, docs
- **Type:** fix
- **Supersedes:** none

## Summary
Verified Antigravity's Phase 3 (head `e9629a2`) against `docs/prompts/media-library-phase-3.md`. The extractor, block picker, Video and FileDownload blocks, page and theme usage tracking, backfill job and cache fan-out are in place and the database suite passes. Review found three defects and one regression, fixed here with tests.

## Defects found and fixed
1. **Backfill could abort a whole tenant.** The backfill used the strict extractor, which throws on a media field holding a non-UUID value. One legacy value would roll back that tenant's backfill. Lenient mode now skips malformed values and records the valid ones (`media/document-usages.ts`).
2. **Rollback was blocked by later changes to files.** Restoring an old page version re-validated its media as if newly added, so a file trashed or deleted since made the rollback fail. Rollback now tolerates it (`content-services.ts`).
3. **Publish had the same problem for a version saved earlier.** Publishing a version already validated at draft-save time now tolerates files trashed or deleted since.
4. **Regression: the "no store media" message was replaced.** The Super Admin theme template editor used to say stores add their own images after activating a theme; it said "Media picker not configured". Restored the wording ("Stores add their own media after activating this theme.") and updated the test.

## Tests added
- `media-document-usages.int.test.ts`: restore and publish of history whose files were trashed and deleted since; backfill with a legacy non-UUID value next to a valid one.
- `media-field.test.tsx`: updated for the restored message.

## Verification (Claude, local, final tree)
- `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`: pass.
- `pnpm --filter @bs/blocks test`: 7 files, 130 tests. `pnpm --filter @bs/block-editor test`: 2 files, 17 tests.
- `pnpm --filter @bs/domain test:fast`: 48 files, 410 tests.
- Full heavy suite, serial, local Postgres: 101 of 102 files passed in one run (2074 of 2078 tests). The 102nd, `owner-invites.int.test.ts`, never started because of an intermittent Windows worker crash (exit 3221226505); run on its own with the other files that crashed in earlier attempts (`catalog`, `customer-account-settings`, `return-photos`) and `media-document-usages`, all 5 files / 45 tests pass. The crash hit different files each run and did not recur on re-run; it looks environmental (worker start-up) and I could not find the cause.
- `pnpm --filter @bs/db test` with `TEST_PG_ADMIN_URL`: 5 files, 41 tests.
- `pnpm --filter @bs/admin test:fast -- --no-file-parallelism`: 12 files, 74 tests pass. Right after `pnpm build` the same command failed 8 route tests once (slow dynamic imports); it passes on re-run.

## Not verified
- **No end-to-end UI run.** I did not run the admin editor or storefront in a browser. The block editor picker, Video and FileDownload rendering, and cache refresh are verified by code review and database tests only.
- **Earlier "walkthrough" screenshots are not end-to-end.** `e2e/walkthrough-media-library.mjs` (Phases 1 and 2 evidence) intercepts the API and serves mocked items with fake CDN URLs, which is why image tiles are blank in those screenshots. The change records did not say so. Phase 3 supplied no walkthrough at all, though the prompt required one.
- `FileDownload` uses the HTML `download` attribute. Browsers ignore it for files on a different origin (the media domain), so PDFs and text open in the browser instead of downloading, and storage does not set `Content-Disposition`. Word and Excel files download by content type. Left as is; see follow-ups.
- Cache invalidation is checked as computed tags; whether Next.js serves fresh pages after a change was not exercised.

## Docs updated
- [x] ADR-030, `docs/ARCHITECTURE.md` (reviewed, no further change needed), `progress.md`.

## Follow-ups and open questions
- Phase 4 candidates: serve documents with `Content-Disposition: attachment` (set on upload for non-PDF, or a signed download link), and a real end-to-end walkthrough (seeded store, real files) for the media library, picker, block editor, replace and trash flows.
- Owner: a manual click-through on staging or local is still the real confirmation of the editor flows.
