# Media Library Phase 4: Claude verification, real stack run and fixes

- **Date:** 2026-10-14
- **Agent:** claude
- **Branch:** `feat/media-library-phase-4` (not merged yet)
- **Area:** domain, web, admin, worker, docker, e2e, ci, docs
- **Type:** fix
- **Supersedes:** none

## Summary
Verified Antigravity's Phase 4 (head `1748816`). Its code passed review for most slices (download route, focal point, duplicate flow, `mediaImage`), but the work had never been run as a whole: the change record lists no end-to-end run and no full database run. I built the six production images from the tree, started the staging compose stack and ran the real browser suite against it. That found defects no unit or database test could, several of which would have **stopped the worker and platform from starting** or **blocked every production deploy** (the e2e step sits inside the `staging-smoke-test` job that deploy waits for). All are fixed here with tests, and the real suite now passes.

## Defects found and fixed
**Would have broken the deploy**
1. **Worker and platform crashed at start-up.** `derivatives.ts` imported `sharp` at the top, and `media-services.ts` re-exports it, so any service importing the domain loaded the native module, which is not in the worker image (a single bundled file, no `node_modules`). Now `sharp` is external to the esbuild bundles, loaded lazily, and installed beside the worker bundle in `worker.Dockerfile`. Verified: both services start, `sharp` works inside the worker image.
2. **The new e2e spec failed on a real stack** (5 of 6 tests failed; the sixth passed without checking anything, as most assertions sat behind `if (visible)`). Rewritten: 9 strict tests, no guards, unique data per run. Because the job it lives in gates deploys, a failing or flaky spec would have blocked production.
3. **Every upload on the staging stack failed** with `EACCES` (the shared volume is root-owned, the services are not). The web and worker images now create `/data/media` owned by the runtime user. The merchant UI also showed the server path in that error.
4. **`isolation.int.test.ts` failed**: the new `admin.media.findDuplicates` procedure was not mapped (CI's heavy job would have failed). Mapped.

**Wrong behaviour in production paths**
5. **The web service never queued media jobs** (its runtime has no `_jobs`): new uploads were never derived or hashed, and permanent delete never removed stored files (this one is live since Phase 1). Added a send-only job client for media (`Runtime._mediaJobs`), queuing after commit and best effort; delete and replace fall back to removing files directly; the worker also sweeps every minute (derivatives) and five minutes (hashes).
6. **Derived files were never deleted** and could not be: they are stored as a map but purge, replace and the sweep read a list. Fixed with `collectDerivativeKeys`.
7. **Replace reused the same derived keys**: after a replace the old file's purge could delete the new derived files and browsers or a CDN could keep the old image. Derived keys now include the source file id.
8. **Portrait phone photos came out sideways** with swapped width/height (no EXIF auto-orient). Fixed on derive, upload and replace.
9. **Backfills could loop or starve**: unreadable images were re-selected forever and re-enqueued without delay; unreadable rows blocked the hash backfill. Unreadable images are now recorded as having no derivatives; hash backfill pages by cursor.
10. **A browser-supplied hash was stored unverified**, and videos/documents were "hashed" from their first 4 KB. The client hash is now advisory only; only whole-file hashes are stored.
11. **Replace failed on local storage and on any bucket without CORS** (it only supported a direct PUT). It now falls back to the server, like a normal upload (`replaceMediaDirect`, `replaceId` on the proxy route).
12. **Thumbnails and storefront images were broken on the local storage driver** (relative `/media/…` URLs, derived URLs losing the path prefix). `MEDIA_PUBLIC_URL` added for local and staging stacks; `buildDerivativeUrl` keeps any path prefix.
13. **After a blocked permanent delete the confirmation stayed open**, and the message did not say where the file is used. It now closes and names the owners.
14. **The product page broke its performance budget** (found by CI's web heavy job, not by my local runs of the domain suite): `ProductGallery` is a client component and imported one pure helper from the `@bs/blocks` barrel, which put every block, schema and view in the browser bundle (177 KB gzipped against the 100 KB budget in `perf-budget-bundle.int.test.ts`). It now imports `@bs/blocks/media-image` (new subpath export).

**Found by CI on the first push (my own new tests):** CI runs every test file against one shared database, so an active storage connection left by an earlier file made directly inserted rows (no connection id) resolve to a different directory than the one the test wrote to. Reproduced locally by leaving an active connection in a shared database; the test fixture now records the connection id, as a real upload does.

## What changed (files that matter)
- `packages/domain`: `media/derivatives.ts`, `media/hashing.ts`, `media-services.ts` (`collectDerivativeKeys`, `enqueueMediaJob`, `replaceMediaDirect`, inline purge fallback), `runtime.ts`, `system/job-sender.ts`, `jobs.ts` (schedules, send options), `media/connection.ts`, `media/storage.ts`.
- `apps/web`: `server/runtime.ts` (media job client), `server/api.ts` (`replaceId`).
- `apps/admin`: `media-detail-sheet.tsx`, `media-upload-queue.ts`.
- `packages/blocks`: `buildDerivativeUrl`. `packages/config`: esbuild externals.
- `infra/docker/web.Dockerfile`, `infra/docker/worker.Dockerfile`, `docker-compose.staging.yml`, `.github/workflows/ci.yml` (seed: storefront host and live status for `ci-store`).
- `e2e/`: `media-library.spec.ts` (rewritten), `playwright.config.ts` (host mapping), `fixtures/setup-fixtures.ts` (`makePatternPng`), `README.md`.
- Removed the mocked-API walkthrough script and its screenshots (`e2e/walkthrough-media-library.mjs`, `docs/test-evidence/2026-10-14-media-library/`): they were not end-to-end and the blank images in them were a symptom of that. Real screenshots are in `docs/test-evidence/2026-10-14-media-library-e2e/`.
- Docs: ADR-031 amendments, `DEPLOYMENT.md`, `docs/ARCHITECTURE.md`.

## Tests added
- `packages/domain/test/media-delivery-fixes.int.test.ts` (9 tests, real Postgres, worker handlers as `app_rw`): derived files removed on permanent delete (through the job path and the web path with no job queue), replace derives to new keys and removes old ones, EXIF portrait, backfill terminates on unreadable images, hash backfill cursor, client hash never stored, replace through the server (same kind only).
- `packages/blocks/test/media-image.test.ts`: derivative URL keeps a path prefix.
- `isolation.int.test.ts`: `media.findDuplicates` mapped.
- `e2e/media-library.spec.ts`: 9 real-stack tests (see the README).

## Verification (Claude, local)
Real stack (images built from this tree, staging compose, seeded like CI):
- Whole e2e suite `pnpm --filter @bs/e2e e2e`: **22 passed** (8 admin, 9 media, 5 super admin). The media spec was also re-run several times on a reused stack and passes (unique data per run).
- Images built for all six apps; `migrate`, `web`, `platform`, `worker`, `admin`, `superadmin` start healthy; `sharp` loads inside the worker image.

Gate on the final tree:
- `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`: pass.
- `pnpm --filter @bs/domain test:fast`: 50 files, 421 tests. `pnpm --filter @bs/blocks test`: 8 files, 137 tests. `pnpm --filter @bs/block-editor test`: 2 files, 17 tests.
- Full heavy suite, serial, local Postgres (`node scripts/test-heavy-local.mjs --no-file-parallelism`): **105 files, 2104 tests, all passed**, no worker crash in this run.
- `pnpm --filter @bs/db test` with `TEST_PG_ADMIN_URL`: 5 files, 41 tests (one file failed once while other work was using the machine, then passed on rerun).
- `pnpm --filter @bs/admin test:fast -- --no-file-parallelism`: 12 files, 74 tests. The first run after source changes fails 8 route-import tests (cold transform cache, 5 s timeouts); the rerun passes. Seen in Phases 2, 3 and 4.

## Not verified
- Production-like storage: the e2e uses the local storage driver. Direct browser-to-R2 upload, R2 presigned downloads and the Cloudflare public domain were not exercised; the unchanged R2 code paths were only reviewed. The worker image `npm install sharp` runs in CI's image build, which I reproduced locally but not in GitHub Actions.
- A real Next.js cache refresh after replace on the production deployment (the e2e proves it on the staging stack).
- Video playback (the video fixture is a minimal MP4 container; only upload, storage and listing are covered).
- The CI heavy job was only run in full by CI itself: locally I ran the domain suite per file (fresh database per file) and in CI-style shared-database mode, and the web performance-budget test separately. Lesson for later phases: run `pnpm exec turbo run test:heavy --concurrency=1 -- --no-file-parallelism` with `TEST_DATABASE_URL_SUPERUSER` before pushing.
- Windows worker crashes (exit 3221226505) appear intermittently in local heavy runs, in different files each time; they do not reproduce when a file is run alone and look environmental.

## Docs updated
- [x] `docs/ARCHITECTURE.md`, ADR-031 (amendments), `DEPLOYMENT.md`, `e2e/README.md`, `progress.md`.

## Follow-ups and open questions
- **Owner:** other `if (rt._jobs)` paths in the web service (finance posting, customer metrics, webhook processing) are likewise skipped there because the web runtime has no job client. Not changed here; worth a separate look.
- **Owner:** derived files are not counted in `storage_mb` (as proposed); enabling Cloudflare Image Transformations (`CDN_BASE_URL`) remains optional.
- The upload error shown to merchants can still contain a server path for unexpected storage errors; a generic message would be safer.
- Phase 5 candidates: video poster frames (needs ffmpeg), folders, HEIC.
