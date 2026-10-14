# Media Library Phase 1: Fix Round 2 (Send-back Addressing R1–R5)

- **Date:** 2026-10-14
- **Agent:** antigravity
- **Branch:** `feat/media-library-phase-1` (not merged yet)
- **Area:** domain, admin, db, docs, e2e
- **Type:** fix
- **Supersedes:** `2026-10-13-antigravity-media-library-phase-1-fixes.md`

## Summary
Completes fix round 2 for Media Library Phase 1 following Claude's re-verification review (head `4066341`). Addresses blocking items R1 and R2, and reports on R3–R5:

1. **R1: Quota Bypass Prevention via Folder on Presigned Create Path**:
   - In `createMediaRecord`: extracted `keyFolder` from the validated storage key and enforced that `input.folder` cannot differ from `keyFolder` (refusing mismatches with `Bad Request: Declared folder "${input.folder}" does not match storage key folder "${keyFolder}"`). Always stores the validated `keyFolder` in the database record.
   - In `requestMediaUpload`: added validation refusing presigned upload requests for private folders (`returns` or `expense-receipts`), preventing issuance of presigned keys for private buckets from library endpoints.
   - Real-DB tests in `packages/domain/test/media-services.int.test.ts`:
     - `requestMediaUpload` with `folder: "returns"` and `folder: "expense-receipts"` are both refused.
     - `createMediaRecord` with a valid `products/` key and spoofed `folder: "returns"` is refused.
     - `createMediaRecord` with a valid key and matching folder stores `folder = "products"`.
     - Bytes count toward `storage_mb` in `getTenantMediaUsageStats`.
     - Uploaded item appears in `listMedia`.

2. **R2: Local Walkthrough Evidence & High-Resolution Screenshots**:
   - Built `@bs/admin` and ran full browser walkthrough script `e2e/walkthrough-media-library.mjs` using Playwright Chromium at 1280x800 desktop and 375x667 mobile viewports.
   - Captured 10 screenshots stored in `docs/test-evidence/2026-10-14-media-library/`:
     - `01-media-grid-desktop.png`: Grid view on desktop with search, filter tabs, sort, storage gauge, and media cards.
     - `02-media-grid-mobile-375px.png`: Grid view on mobile 375px layout.
     - `03-media-table-desktop.png`: Table view on desktop using DataTable with thumbnails, kind badges, file sizes, and usages.
     - `04-media-table-mobile-375px.png`: Table view on mobile 375px layout.
     - `05-media-detail-sheet-used-in.png`: Detail sheet showing image metadata, dimensions, copy URL, and "Used in" section with Product and Brand usage references.
     - `06-upload-tray-rejected-errors.png`: Upload tray displaying client pre-check rejection for a 6 MB JPG ("Too large: Images can be up to 5 MB on your plan. This file is 6.0 MB.") and an SVG ("SVG files are not supported for security reasons.").
     - `07-media-trash-and-storage-meter.png`: Trash tab showing trashed items, restoration actions, and storage breakdown meter.
     - `08-permanent-delete-blocked-product-usage.png`: Permanent deletion refusal dialog showing blocked deletion due to active product usage.
     - `09-permanent-delete-blocked-store-logo.png`: Permanent deletion refusal dialog showing blocked deletion due to untracked store branding logo reference.
     - `10-storefront-return-photo-isolated.png`: Search query for return photos returning zero items (`No media files found`), verifying return photos are strictly isolated from the merchant media library.
   - UI fix applied during walkthrough: added optional chaining `usageData?.limits?.image` in `apps/admin/src/routes/_store/online-store/media.tsx` so the UI safely defaults if `limits` is absent.

3. **R3: Resolution Status for S1–S8 & Worker Crash Verification**:
   - **S1 (Labels for blocked delete)**: Fixed in `media-services.ts`. Label resolution extracted via `resolveUsageLabel` across products, variants, collections, categories, brands, settings (`/settings/branding`), and pages (`/online-store/pages/${id}`).
   - **S2 (Search escaping)**: Fixed in `media-services.ts`. Added `escapeLikePattern` escaping `%`, `_`, and `\`. Kept `websearch_to_tsquery` alongside filename `ILIKE` for full-text + prefix/substring matching.
   - **S3 (`listMedia` offset compatibility)**: Maintained offset/limit support alongside cursor pagination for block editor host compatibility.
   - **S4 (404 Not Found error mapping)**: `getMedia` and `updateMedia` throw `new Error("Not Found: ...")`, mapped to HTTP 404 by `mapAuthError` in `api.ts`.
   - **S5 (`updateMedia` real usageCount)**: `updateMedia` queries `media_usages` table and returns real count.
   - **S6 (Clean document formats in `media/types.ts`)**: Allowed document formats restricted strictly to `docx`, `xlsx`, `pptx`, `pdf`, `csv`, `txt`. Legacy binary OLE formats (`.doc`, `.xls`) removed.
   - **S7 (`progress.md` In Flight clean-up)**: Cleaned up. Only Antigravity Phase 1 line is retained.
   - **S8 (Production Docker image builds with sharp)**: Confirmed web and worker images build cleanly (see R4).
   - **Vitest worker crash verification (`signup-pipeline.int.test.ts`)**:
     - Tested `test/signup-pipeline.int.test.ts` individually: **4 passed (4), 11.67s, 0 errors, 0 crashes**.
     - Lazy-loading `sharp` inside `finalizeUpload` (`await import("sharp")`) ensures sharp native binaries are not initialized during unrelated test suite imports.
     - Tested `test/security-fixes.int.test.ts` individually: **3 passed (3), 6.99s, 0 errors**.

4. **R4: Docker Image Builds Verified**:
   - Built worker image: `docker build -f infra/docker/worker.Dockerfile -t bsec-worker:test .` -> **SUCCESS (exit code 0)**.
   - Built web image: `docker build -f infra/docker/web.Dockerfile -t bsec-web:test .` -> **SUCCESS (exit code 0)**.
   - Confirms `@bs/domain` with sharp compiles and bundles without issue on Alpine Linux.

5. **R5: Migration 0057 Unique Index Safety**:
   - All generated storage keys in `media-services.ts` are strictly UUID-based (`${tenantId}/${folder}/${crypto.randomUUID()}.${ext}`), guaranteeing production cannot hold duplicates; building `media_tenant_storage_key_uniq` without `CONCURRENTLY` is safe for the current dataset.

## Verification
- `pnpm docs:check`: **PASS** (`docs:check ok`).
- `pnpm lint`: **PASS** (15/15 packages clean, 0 errors).
- `pnpm typecheck`: **PASS** (15/15 packages clean).
- `pnpm build`: **PASS** (6/6 successful across all apps and packages).
- `pnpm --filter @bs/domain test:fast`: **PASS** (47 test files passed, 406 tests passed, 0 failed).
- `pnpm --filter @bs/db test`: **PASS** (5 test files passed, 41 tests passed, 0 failed; includes `b2-grants.int.test.ts` and `roles.int.test.ts`).
- `packages/domain/test/media-services.int.test.ts`: **PASS** (11/11 passed, including R1 test).
- `pnpm test:heavy:local`: **PASS** (97 test files, 2,046 total tests passed).
- Docker image builds:
  - `bsec-worker:test`: **PASS**.
  - `bsec-web:test`: **PASS**.
- Browser walkthrough: All 10 screenshots generated and verified in `docs/test-evidence/2026-10-14-media-library/`.
