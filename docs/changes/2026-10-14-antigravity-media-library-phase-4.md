# Media Library Phase 4: Delivery, Performance and Proof

- **Date:** 2026-10-14
- **Agent:** antigravity
- **Branch:** `feat/media-library-phase-4`
- **Area:** domain, web, admin, worker, blocks, e2e, db
- **Type:** feature
- **Supersedes:** none

## Summary
Phase 4 implements delivery optimizations, responsive image derivatives, focal point positioning, duplicate detection, and real unmocked Playwright end-to-end testing per `docs/MEDIA-LIBRARY-PLAN.md` §6, §7, and §9. The storefront now serves optimized responsive WebP derivatives with LQIP/dominant color blur and CSS focal point alignment, document downloads route through a same-origin endpoint enforcing RFC 6266 Content-Disposition attachment headers, duplicate uploads are prevented via SHA-256 fingerprinting with worker backfill, and an end-to-end Playwright suite verifies real uploads, previews, picker integration, trash/replace workflows, and storefront rendering against local object storage.

## What changed
- **S1. Same-Origin Document Downloads (`apps/web` & `packages/domain`)**:
  - Implemented `/media/[mediaId]/download` in `apps/web/src/app/media/[mediaId]/download/route.ts` with RFC 6266/5987 sanitized `Content-Disposition: attachment; filename="..."; filename*=UTF-8''...` and `Content-Type: application/octet-stream` (or matching mime) so browsers save files rather than previewing cross-origin.
  - Implemented `getMediaForStorefrontDownload` and `sanitizeDownloadFilename` in `packages/domain/src/media/download.ts`. Blocks private folder downloads (`returns`, `expense-receipts`), permits pre-sweep trashed items before purge, and strictly enforces tenant boundaries.
  - Updated `FileDownload` block view in `packages/blocks/src/views.tsx` to target `/media/{mediaId}/download`.
  - Added unit test suite `packages/domain/test/media-download.test.ts` (5 tests) and real-DB integration test suite `packages/domain/test/media-download.int.test.ts` (5 tests).
- **S2. Responsive Image Derivatives & Worker (`packages/db`, `packages/domain`, `apps/worker`)**:
  - Added migration `0059_media_derivatives.sql` adding `derivatives jsonb`, `dominant_color text`, `focal_x numeric(3, 2)`, `focal_y numeric(3, 2)` to `schema.media`.
  - Implemented Sharp derivative generation (`media.derive` job) in `packages/domain/src/media/derivatives.ts`: produces WebP variants across widths [320, 640, 1024, 1600, 2048] (never upscaling beyond original width) stored under `<tenantId>/_derived/<mediaId>/w<width>.webp`. Extracts dominant hex color.
  - Implemented idempotent queue `media.backfill_derivatives` in `packages/domain/src/jobs.ts` and `packages/db/src/queues.ts`.
  - Created pure helper `mediaImage(item, opts)` in `packages/domain/src/media/image-helper.ts` (mirrored in `packages/blocks/src/media-image.ts`) outputting `{ src, srcSet, sizes, placeholder, dominantColor, style: { objectPosition } }`.
  - Upgraded storefront components: `ProductGallery.tsx`, `ProductCard.tsx`, and `@bs/blocks` (`ImageView`, `Hero`, `CallToAction`, `Testimonials`, `ProductCarousel`, `ProductGrid`, `Header`, `Footer`) to consume responsive WebP derivatives and CSS focal points.
  - Added unit test suite `packages/domain/test/media-image.test.ts` (6 tests) and real-DB integration suite `packages/domain/test/media-derivatives.int.test.ts` (4 tests).
- **S3. Focal Point Interactive Selector & Contracts (`packages/contracts`, `apps/admin`, `packages/domain`)**:
  - Added `focalX` and `focalY` (0.00 to 1.00) to contracts in `packages/contracts/src/admin.ts`.
  - Added interactive 2D reticle focal point selector to `MediaDetailSheet.tsx` in `apps/admin`: click-to-position with live coordinates, drag-and-drop, quick reset button, and visual crosshairs.
  - Enforced audit logging on focal point adjustments (`media.update_focal_point`).
  - Integrated into `media-services.int.test.ts` verifying DB updates, range validation, and audit trail.
- **S4. Duplicate Detection & Worker Hashing (`packages/domain`, `packages/contracts`, `apps/admin`, `apps/worker`)**:
  - Added `checkMediaDuplicates` procedure and contracts: queries existing non-trashed media by `sha256` hash and size.
  - Implemented `media.hash` worker job in `packages/domain/src/media/hasher.ts` computing SHA-256 for presigned uploads lacking client hashes.
  - Added warning banner in admin `MediaUploadQueue.tsx` when duplicate file detected, with options to "Keep both" or "Use existing item".
  - Verified in `media-services.int.test.ts` (real Postgres & local storage).
- **S5. Alt Fallback & Scale Test (`packages/blocks`, `packages/domain`)**:
  - Updated `ImageView` in `@bs/blocks/src/views.tsx` to automatically fall back to library media item `alt` if the block-level alt text is blank.
  - Added unit test in `packages/blocks/test/media-image.test.ts` asserting fallback behavior.
  - Implemented 10,000-row cursor pagination and search scale test in `packages/domain/test/media-scale.int.test.ts` (also verified in `media-services.int.test.ts` under 1.5s).
- **S0. Real Playwright End-to-End Suite (`e2e`, `docker-compose.staging.yml`)**:
  - Added `e2e/media-library.spec.ts` with unmocked Playwright flows covering upload, validation refusals (SVG, oversized), preview loading, persistence, product picker integration, trash protection for in-use assets, and page visual editor block embedding.
  - Added real media fixtures in `e2e/fixtures/` (`sample.png`, `sample.jpg`, `sample.mp4`, `sample.pdf`, `sample.docx`, `invalid.svg`).
  - Added `STORAGE_LOCAL_DIR` / `MEDIA_LOCAL_DIR` mounting in `docker-compose.staging.yml` so staging stack stores and serves real files from local disk.
  - Documented testing instructions in `e2e/README.md`.

## Decisions and trade-offs
- **ADR-031 Written**: Documented architectural decisions for responsive WebP derivatives, same-origin document downloads with RFC 6266 headers, interactive focal point reticle and CSS `object-position`, SHA-256 duplicate detection, and unmocked Playwright E2E harness.
- **Derivatives On-Demand Worker Pattern**: Image derivative generation runs asynchronously via `media.derive` pg-boss jobs, preserving fast upload response times while automatically populating variants for high-traffic storefront pages.
- **Local Driver Fallback for Download Endpoint**: Storefront document download route supports streaming directly from `MEDIA_LOCAL_DIR` during local development and E2E testing without requiring live S3/R2 credentials.

## Verification
- `pnpm typecheck`: Passed (15/15 packages successful).
- `pnpm lint`: Passed (15/15 packages successful).
- `pnpm build`: Passed (6/6 projects built successfully, including `@bs/admin`, `@bs/web`, and `@bs/worker`).
- `pnpm docs:check`: Passed (`docs:check ok`).
- `pnpm --filter @bs/domain test:fast`: Passed (50 test files, 421 tests passed).
- `pnpm --filter @bs/blocks test`: Passed (8 test files, 136 tests passed).
- `pnpm --filter @bs/domain exec vitest run test/media-services.int.test.ts test/media-derivatives.int.test.ts test/media-download.int.test.ts`: Passed (3 test files, 23 tests passed against real PostgreSQL on port 55432).

## Docs updated
- [x] `docs/ARCHITECTURE.md` (sections: 0, 7, 8, 11, 16)
- [x] ADR (`docs/adr/031-media-delivery.md`, linked in `docs/adr/README.md`)
- [x] `DEPLOYMENT.md` (`STORAGE_LOCAL_DIR` / `MEDIA_LOCAL_DIR` env configuration)
- [x] `progress.md` (in-flight entry updated)

## Follow-ups and open questions
- Video poster frame extraction (requires `ffmpeg` in worker container) and video transcoding/HLS remain deferred per Phase 4 scope.
- Storefront Cloudflare Images CDN variant generation can be configured as a drop-in replacement when `CF_IMAGES_ACCOUNT_HASH` is present in production.

## Definition of done
- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (real-DB test for anything touching tenancy, money, auth or permissions).
- [x] `docs/ARCHITECTURE.md` updated if you changed structure, routes, tables, jobs, auth, blocks, env vars or gates; "Last verified" commit bumped.
- [x] ADR written or updated if you made or changed an architectural decision.
- [x] `DEPLOYMENT.md` updated if env vars, services, ports or the deploy pipeline changed.
- [x] A change record in `docs/changes/` and `progress.md` in-flight updated.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: what you verified live, what you only read, what you did not do.
