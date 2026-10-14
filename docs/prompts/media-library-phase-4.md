<USER_REQUEST>
Media Library Phase 4: delivery, performance and proof (builder prompt)
Paste this whole file as the first message of a new coding session in the bsec repo. You are the builder for Phase 4 only. Claude Code verifies against section 9 and merges; you never merge your own PR.

0. Read first, in order
AGENTS.md (hard rules, gate, multi-agent rules).
docs/MEDIA-LIBRARY-PLAN.md (owner decisions in section 0 still apply: flat library, SVG off, limits 5/10/5 MB, 30-day Trash, video on all plans).
ADRs 028, 029, 030 and every change record docs/changes/*media-library*, including the two Claude verification records for Phases 2 and 3 (they list what was found in review and what was never run).
docs/ARCHITECTURE.md, docs/admin-ui-standards.md, docs/migrations.md, docs/FAST-LOCAL-TESTS.md, progress.md "In flight".
Code you will touch: packages/domain/src/media-services.ts, packages/domain/src/media/{connection,storage,types}.ts, packages/domain/src/jobs.ts, packages/domain/src/storefront/catalog.ts, packages/domain/src/themes/block-data.ts, packages/blocks/src/{views.tsx,types.ts,registry.ts}, apps/web/src/components/product/ProductGallery.tsx, apps/web/src/app/media/[...key]/route.ts, apps/admin/src/components/media/*, apps/admin/src/routes/_store/online-store/media.tsx, apps/admin/src/lib/media-upload-queue.ts, e2e/*, .github/workflows/ci.yml (the e2e job), docker-compose.staging.yml.
1. Setup
Phases 1-3 are merged to main. git fetch, create your own worktree ../bsec-media-p4 on branch feat/media-library-phase-4 from origin/main.
Add to progress.md "In flight": Antigravity · feat/media-library-phase-4 · media library · <date> · Phase 4: real e2e, document downloads, responsive images, focal point, duplicates.
Check docs/changes/ and open branches for overlap with the storefront image components, e2e/ and the worker.
2. Why this phase exists
Phases 1-3 have database tests but no real end-to-end proof. The earlier "walkthrough" (e2e/walkthrough-media-library.mjs) intercepts the API and serves mocked items on a fake CDN, which is why every image tile in its screenshots is blank. Do not reuse that approach. This phase starts by building real proof, then fixes what delivery to shoppers still lacks:

The storefront serves original files (up to 5 MB) at full size: ProductGallery.generateImageSrcSet only builds variants when the URL already contains /cdn-cgi/image/, which the storefront never produces, so srcset is url 1x, url 2x.
Document links use the HTML download attribute, which browsers ignore across origins (media domain vs store domain), so PDFs open instead of downloading.
media.sha256 is only stored for images and direct uploads; videos and documents uploaded through presigned URLs have none.
No focal point, no placeholder colour, no duplicate detection, Image block ignores the library alt text.
Out of scope (owner decisions needed, do not start): video poster frames (needs ffmpeg in the worker image), transcoding/HLS, HEIC conversion, folders, AI alt text, crop/rotate editor.

3. Slices (small commits, contracts first, in this order)
S0. Real end-to-end suite (first, so the rest is proven)
The repo already has a real Playwright harness: e2e/playwright.config.ts, e2e/admin.spec.ts, and a CI job that runs it against docker-compose.staging.yml with a seeded owner (E2E_EMAIL, E2E_PASSWORD, "Demo Store"). Extend that, no API mocking.

Add e2e/media-library.spec.ts and real fixtures in e2e/fixtures/ (a valid PNG, JPEG, MP4 of a few KB, a PDF, a DOCX, plus an SVG, a 6 MB image and an 11 MB video for the refusal cases; generate large ones at test time instead of committing megabytes).
Make the stack able to store files: the staging compose must run with a local storage connection (see STORAGE_LOCAL_DIR, resolveLocalMediaFilePath, apps/web/src/app/media/[...key]/route.ts) so uploads, previews and storefront images are real. Add a seed step if needed. Document how to run the suite locally in e2e/README.md (new) and docs/FAST-LOCAL-TESTS.md.
Flows, each with assertions (not only screenshots):
Upload PNG + MP4 + PDF + DOCX; SVG, 6 MB image and 11 MB video are refused with the specific message; item previews actually load (assert the <img> has naturalWidth > 0).
Grid/Table toggle persists after reload; search, type filter, usage filter, sort.
Detail sheet: edit title/alt/caption, reload, values persist.
Product: open the picker from the gallery, select 2 library images, upload an MP4 in the Upload tab, reorder, save; storefront product page shows both images and a playable <video>; listing shows the primary image.
Collection, category, brand image and Settings > Branding logo via the picker; Media shows "Used in" for each.
Trash a used file; permanent delete is refused and the blocked result with the owner's name is visible; unused file deletes.
Replace a file used by a product; storefront shows the new file (assert the bytes or dimensions changed) without a redeploy.
Page editor: add Image, Gallery, Video (library + poster) and File download blocks via the picker, save, publish; storefront renders them; Media shows "Used in: ".
Storefront cache: change alt text in Media and see it on the storefront page after refresh.
A user without content.write sees read-only media fields.
Screenshots come from this real run, one per step, saved as test artifacts (not committed in bulk; commit a small curated set under docs/test-evidence/<date>-media-library-e2e/ for the change record). 375 px and desktop projects both run.
CI: the e2e job runs on pushes to main only (see AGENTS.md). Do not widen the trigger; make the new spec pass in that job and keep the run time reasonable (target under 6 minutes added).
Anything the suite finds broken in Phases 1-3: fix it in this phase (small, separate commits) and list each in the change record.
S1. Document downloads that really download
Add a same-origin route on the storefront, e.g. GET /media/{mediaId}/download (store resolved from the host as other storefront routes do). It serves ready, non-private, library media only, any kind but intended for documents; looks up the row under the tenant (RLS), then:
S3/R2 driver: respond 302 to a short-lived (60 s) presigned GET with ResponseContentDisposition=attachment; filename*=UTF-8''<safe name>.
Local driver: stream the file with Content-Disposition: attachment, correct Content-Type, X-Content-Type-Options: nosniff.
Sanitize the file name (no CR/LF, quotes or path separators). Rate limit like other public storefront routes. 404 for unknown, trashed-and-purged or foreign ids.
FileDownload block links to this route (keep the download attribute as a hint). No object rewrites and no backfill needed.
Tests: route unit/integration tests (headers, foreign tenant, private folder, trashed item still downloadable while it exists, missing file), plus the e2e flow (download event fires with the right file name).
S2. Responsive images that do not ship the original
Decision (owner can change later): generate resized derivatives with sharp in the worker, independent of Cloudflare. An optional CDN_BASE_URL (Cloudflare Image Transformations) still overrides when set.

Migration 0059_media_derivatives.sql (next free number; append-only, expand-only): media.derivatives jsonb null (list of { w, h, bytes, key }), media.dominant_color text null, media.focal_x real null, media.focal_y real null (check 0..1 and both-or-neither), index media_tenant_sha256_idx (tenant_id, sha256) where sha256 is not null. Update the schema file, grants test if needed.
Worker job media.derive (queue in packages/db/src/queues.ts, handler in jobs.ts): for kind = image (not gif), generate WebP at widths [320, 640, 1024, 1600] capped at the original width (never upscale), strip metadata, store at ${tenantId}/_derived/${mediaId}/w{width}.webp, set derivatives and dominant_color (use sharp().stats(), no new dependency). Enqueue it inside the transaction that creates or replaces the media row (rule 13). Idempotent, app_rw, tenant-prefix guard.
Block clients from registering derived keys as library files: validateClientStorageKey must refuse folders starting with _.
media.purge must also remove the derivatives of a deleted or replaced file. Replace regenerates them. Derived objects are not counted in storage_mb (state this in ADR-031 and list it as an owner question: they add roughly a third to stored bytes).
Backfill job media.backfill_derivatives: existing images in batches (e.g. 50 per run, re-enqueue until done, singletonKey), throttled so it cannot starve the worker; started once from worker boot like media.backfill_usages.
One shared helper mediaImage(item, { widths, sizes }) in packages/domain (pure, tested) returning { src, srcSet, sizes, width, height, placeholderColor, objectPosition }:
derivatives exist → srcSet from them, src = the largest ≤ 1024 px;
else CDN_BASE_URL set → /cdn-cgi/image/ variants;
else the original URL, no srcSet.
Use it everywhere a shopper or merchant sees an image: product gallery and cards, collection/category banners, Image, Gallery and Hero blocks (packages/blocks), and the admin Media grid/picker thumbnails (320 px derivative instead of the original). Always output intrinsic width and height (no layout shift), decoding="async", loading="lazy" except the first/LCP image (fetchPriority="high", not lazy), and a background-color from dominant_color while loading.
The storefront payloads (StorefrontMedia, block render data) gain width, height, focal, dominantColor, derivatives additively (no breaking contract change). The render-data media map stays URL-only for old consumers; add a parallel mediaMeta map.
Measure and report, in the change record, from the real e2e stack: bytes transferred for a product page with a 5 MB original before and after (browser network panel or Playwright response.body() sizes).
S3. Focal point
Contract + service admin.media.update accepts focalX, focalY (0..1, both or neither, null clears). Audit + cache fan-out as for other media edits.
Detail sheet: click on the preview to set the point (visible marker, keyboard arrow adjustment, "Reset"), with small crop previews (1:1, 4:5, 16:9) using object-position. Images only.
Storefront: mediaImage returns objectPosition: "{x}% {y}%"; cover-cropped images (Hero background, product cards, collection banners, Image block with ratio) apply it. No server-side cropping.
S4. Duplicate detection
Hash: in the upload queue compute SHA-256 in the browser (crypto.subtle.digest, files are ≤ 10 MB) before uploading. New admin.media.findDuplicates({ hashes: string[] }) (max 20) returns existing library items (ready, non-private) with the same sha256.
UI: if a match exists, the upload tray row shows "Already in your library" with Use existing (selects it in the picker, or opens it in the library) and Upload anyway. Never block silently.
Authoritative hash: a worker job media.hash (enqueued in the create/replace transaction) streams the object and stores sha256 for videos and documents that have none; a backfill job fills old rows (same throttling rules). The client hash is advisory only and must never be trusted for storage decisions.
Media page: optional filter "Duplicates" listing items that share a hash (uses the new index).
S5. Alt text and housekeeping from earlier phases
Image block: when the block's alt is empty, render the library item's alt (via mediaMeta); an explicit block alt wins. Same precedence note in ADR-031.
admin.media.list at scale: add a heavy test that seeds 10,000 media rows for one tenant and asserts the first page and a search page return correctly and fast (generous bound, e.g. under 500 ms each on the CI database) and that cursor paging stays stable. If it is slow, fix the query/index, do not loosen the test.
Remove dead code left by Phases 1-3 that you can prove unused (old uploadMedia consumers, legacy listMedia in the block editor host if nothing uses it).
S6. Docs
docs/ARCHITECTURE.md (routes, jobs, columns, env CDN_BASE_URL semantics, e2e), ADR docs/adr/031-media-delivery.md (derivatives vs Cloudflare transforms, quota treatment of derived files, download route, focal point, duplicate hashing, alt precedence), DEPLOYMENT.md (worker memory/CPU note for derivation, CDN_BASE_URL), e2e/README.md, change record, progress.md.

4. Rules that matter most
AGENTS.md rules 1-6, 8, 10, 11, 13 and the verification gate. Real-database tests for tenancy, jobs, quota and permissions.
Expand-only migration; new jobs run as app_rw under withTenant, never the platform role; enqueue inside the business transaction; every object key stays under ${tenantId}/.
No ! non-null assertions, no eslint-disable, no @ts-ignore.
No new dependencies (sharp, Playwright and Web Crypto are enough). If you believe you need one, stop and write the reason in the change record first.
Do not touch payments, shipping or return photos. Do not widen the CI e2e trigger.
Evidence honesty: never mock the API for evidence; never tick a checklist item you did not run; screenshots must come from the real stack and each must show a different step. Report failures and skipped tests with output.
Test only locally or in the ephemeral compose. Stage files by explicit path; never git add -A.
Commit trailer: Co-Authored-By: Antigravity <noreply@google.com>.
5. Tests you must add
Unit: mediaImage (all three source modes, never upscales, focal and placeholder output), file-name sanitising for downloads, validateClientStorageKey refusing _ folders, client hash helper.
Real DB (*.int.test.ts, run the worker handlers as app_rw): media.derive creates the expected derivatives and colour, is idempotent, skips gif/video/document, purges on delete and replace, never writes outside the tenant prefix; derived objects excluded from quota; media.backfill_derivatives and media.hash are idempotent and batch-limited; findDuplicates is tenant-scoped and ignores private-folder and trashed rows; focal validation (both-or-neither, range); the 10,000-row list test.
Storefront: download route tests; payloads carry width/height/focal/dominantColor; old consumers still work.
E2E: section S0 flows, passing in the real stack.
6. Acceptance criteria (Claude checks each)
A real, un-mocked Playwright suite covers every S0 flow on the compose stack at 375 px and desktop, passes, and its screenshots are real (images visible).
Everything the suite found broken in Phases 1-3 is fixed and listed.
Document links download with the right file name from the storefront origin; the route is tenant-safe.
Shoppers receive resized responsive images (srcset, width/height, lazy/LCP rules, placeholder colour); measured byte reduction is reported from the real stack; CDN_BASE_URL override still works.
Derivatives are created by an idempotent app_rw job, purged with the file, regenerated on replace, backfilled in throttled batches, and cannot be registered as library files.
Focal point edits persist and change cropping on the storefront.
Duplicate detection offers "Use existing" without blocking uploads; hashes for videos and documents are filled by the worker.
Image alt falls back to the library alt; the 10,000-row list test passes.
Gate with real counts pasted: pnpm typecheck, pnpm lint, pnpm build, pnpm docs:check, pnpm --filter @bs/domain test:fast, whole heavy suite serial (pnpm test:heavy:local; if a Windows worker crash (exit code 3221226505) appears, rerun that file alone and say so), pnpm --filter @bs/db test with TEST_PG_ADMIN_URL set, pnpm --filter @bs/blocks test, pnpm --filter @bs/block-editor test, pnpm --filter @bs/admin test:fast -- --no-file-parallelism (run it not right after a build), the new e2e suite.
ADR-031, ARCHITECTURE, DEPLOYMENT, e2e README, change record (checklist ticked only for what ran), progress.md.
7. Owner questions to raise in the change record (do not decide alone)
Count derived files toward storage_mb? (proposed: no)
Enable Cloudflare Image Transformations and set CDN_BASE_URL later, or rely on worker derivatives only?
Video poster frames: add ffmpeg to the worker image, or capture a frame in the browser at upload?
8. Hand back
Rebase on the latest origin/main, run the full gate and the e2e suite, push the branch, open a PR, mark your "In flight" line [Ready for Claude verification]. State plainly what you ran, what failed, what you did not test.
</USER_REQUEST>
<ADDITIONAL_METADATA>
The current local time is: 2026-10-14T13:05:31+05:30.
</ADDITIONAL_METADATA>