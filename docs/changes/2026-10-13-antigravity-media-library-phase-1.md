# Media Library Phase 1: Online Store > Media

- **Date:** 2026-10-13
- **Agent:** antigravity
- **Branch:** `feat/media-library-phase-1` (not merged yet)
- **Area:** db, domain, contracts, admin, worker, docs
- **Type:** feature
- **Supersedes:** none

## Summary
Implements Phase 1 of the multi-tenant Media Library for Online Store > Media according to `docs/MEDIA-LIBRARY-PLAN.md` and `docs/prompts/media-library-phase-1.md`. Adds schema and migrations for media metadata, tracking usages via a tenant-isolated `media_usages` table, per-kind upload quota checks (images 5 MB, videos 10 MB, documents 5 MB) linked to plan quotas, trash and restore lifecycle with a 30-day scheduled purge worker job, HeadObject real byte verification at upload finalization, magic-byte format validation refusing SVGs and disguised files, and a rich, accessible Admin UI with Grid and Table views, search, kind and usage filters, upload queue with progress and error handling, detail sheet, and storage gauge.

## What changed
- **Database & Migrations (`packages/db`)**:
  - Added migration `0056_media_library.sql` adding `kind`, `filename`, `duration_ms`, `alt`, `caption`, `status`, `trashed_at`, `trashed_by`, `thumbnail_url` to `media`, backfilling existing rows, and adding partial indexes for non-trashed and trashed items.
  - Added `media_usages` table using `tenantTable`, composite `tenantForeignKey`, and `forceRlsSql(name)`. Added index on `(tenant_id, media_id)`.
  - Added quota keys `media_image_mb`, `media_video_mb`, `media_document_mb` to `tenant_plan_quotas` for all tiers (seeded at 5 / 10 / 5) and legacy `plan_tiers` columns.
  - Granted `app_rw` permissions and verified via `b2-grants.int.test.ts`.
- **Validation & Formats (`packages/domain`, `packages/contracts`)**:
  - Implemented `packages/domain/src/media/types.ts` defining allowed media MIME types across images (PNG, JPEG, WebP, GIF, AVIF), videos (MP4, QuickTime, WebM), and documents (PDF, CSV, plain text, DOC, DOCX, XLS, XLSX). Refuses SVG and untrusted executable types.
  - Added magic-byte inspection matching signatures against buffer headers (`validateBufferMagicBytes`) and file size checks. Exported `ALLOWED_MEDIA_TYPES` and `MEDIA_ACCEPT_ATTRIBUTE` from contracts.
- **Quotas (`packages/domain/src/system/quotas.ts`)**:
  - Added `media_image_mb`, `media_video_mb`, `media_document_mb` to `PlanQuotaKey` and `DEFAULT_TIER_TABLE`.
  - Implemented `assertMediaUploadQuota` asserting storage quota + per-kind limit with support for tenant-level overrides.
  - Implemented `getTenantMediaUsageStats` calculating active bytes, trash bytes, file count, and per-kind quota limits.
- **Contracts (`packages/contracts/src/admin.ts`)**:
  - Defined media contract endpoints: `media.list`, `media.get`, `media.usage`, `media.requestUpload`, `media.create`, `media.upload`, `media.update`, `media.trash`, `media.restore`, `media.deletePermanent`, and `media.delete` (alias to trash).
- **Domain Services (`packages/domain/src/media-services.ts`)**:
  - Implemented `finalizeUpload` handling HeadObject real byte lookup from storage, magic byte verification, sharp dimension extraction for images, quota assertion, database row insertion, and audit logging.
  - Wired `syncMediaUsages` to catalog service mutation paths (product media attach/detach, variant images, collections, categories, and brands).
  - Implemented `listMedia` with stable cursor pagination, search across filename/title/alt, kind/usage/status filters, and sorts.
  - Implemented `trashMedia` (soft-delete with warning of attached usages), `restoreMedia`, and `deleteMediaPermanent` (refusing deletion when usages exist, enqueuing `media.purge` upon success).
  - Implemented `runMediaTrashSweep` sweeping items trashed > 30 days with no active usages.
- **Worker Jobs (`apps/worker`)**:
  - Registered `media.purge` job (tenant-prefix key assertion, multi-object deletion with retry) and `media.trash_sweep` cron job (daily 03:30 IST).
- **Store API Handlers (`apps/web/src/server/api.ts`)**:
  - Mounted all `admin.media` contract procedures and proxy `POST /admin/media/upload` handler with `QuotaExceededError` mapping to 403 `QUOTA_EXCEEDED`.
- **Admin UI (`apps/admin`)**:
  - Added nav item `Online Store > Media` under `_store.tsx` with `content.write` permission guard.
  - Implemented `apps/admin/src/routes/_store/online-store/media.tsx` with `pendingComponent`, Grid / Table view toggle (persisted in `localStorage`), URL search params synchronization, storage progress meter, sticky bulk action bar, full-page drag-and-drop overlay, and empty state.
  - Implemented `apps/admin/src/lib/media-upload-queue.ts` supporting client pre-checks, max 4 concurrent uploads, and XHR progress events. Preserved backward compatibility for `uploadMedia()` in `apps/admin/src/lib/upload-media.ts`.
  - Implemented `MediaUploadTray` floating drawer reporting per-item progress, cancel, retry, and specific error toasts.
  - Implemented `MediaDetailSheet` with preview, editable title/alt/caption, read-only file info, copy link, and linked "Used in" catalog references.

## Decisions and trade-offs
- **ADR-028 Media Library Architecture**: Authored `docs/adr/028-media-library.md`. Standardized on a shared `media_usages` table rather than querying individual catalog tables, enabling zero-latency usage counts, referential integrity guards, and instant lookups.
- **Trash lifecycle**: Deleting a media item in the UI performs a soft delete to Trash (`status: 'trashed'`). Live storefronts continue displaying trashed items to prevent immediate broken images until merchant removes catalog usage. Permanent deletion is blocked if references remain in `media_usages`.
- **SVG Disabled**: SVGs are disallowed in Phase 1 to eliminate stored XSS risks in multi-tenant contexts.
- **Direct presigned vs proxy**: Browser uploads directly via presigned S3/R2 PUT when CORS allows; proxy fallback available. Real file size is verified via HeadObject at `create` time, defeating client-spoofed file size attacks (Bug Q2).

## Acceptance Criteria Checklist (Plan §11)
- [x] **Criterion 1 (Schema & grants)**: Migration `0056_media_library.sql` is append-only; `media_usages` uses `tenantTable`, `forceRlsSql`, `tenantForeignKey`; `packages/db/test/b2-grants.int.test.ts` passes (6/6 tests).
- [x] **Criterion 2 (Backfill)**: Backfill script in migration populates `kind`, `filename`, and scans existing catalog links into `media_usages`.
- [x] **Criterion 3 (Per-kind quotas & overrides)**: `media_image_mb` (5 MB), `media_video_mb` (10 MB), `media_document_mb` (5 MB) seeded; tested tier change and tenant overrides in `media-quotas.int.test.ts` (4/4 tests).
- [x] **Criterion 4 (Presigned quota enforcement)**: Refuses 6 MB image and 11 MB video; HeadObject real byte mismatch detected; verified in `media-quotas.int.test.ts` & `media-services.int.test.ts`.
- [x] **Criterion 5 (Format & magic-byte check)**: PDF disguised as PNG is refused with `INVALID_FILE_TYPE`; SVG refused at upload request; verified in `test/media-types.test.ts` (16/16 tests) and `media-services.int.test.ts`.
- [x] **Criterion 6 (List & cursor paging)**: Verified correct `total`, cursor stability with intermediate insertions, search by prefix/word, and sorts in `media-services.int.test.ts`.
- [x] **Criterion 7 (Get & usages)**: Returns "Used in" references with admin paths and labels across products, variants, collections, categories, and brands.
- [x] **Criterion 8 (Trash & permanent delete)**: Round-trip trash and restore verified; permanent delete refuses referenced files; `media.purge` enqueued after commit; verified in `media-services.int.test.ts`.
- [x] **Criterion 9 (Trash sweep)**: Scheduled daily sweep purges only items trashed > 30 days and with zero active usages; verified in `media-services.int.test.ts`.
- [x] **Criterion 10 (Tenant isolation)**: All media procedures mapped in `test/isolation.int.test.ts` (1307/1307 tests pass); purge job asserts tenant key prefix.
- [x] **Criterion 11 (Audit logs & cache)**: Every mutation records an `audit_logs` row; caches invalidated after transaction commit.
- [x] **Criterion 12 (Nav entry)**: Media nav link in `apps/admin/src/routes/_store.tsx` guarded by `content.write` permission; route has `pendingComponent`.
- [x] **Criterion 13 (Grid & Table views)**: Both views implemented with persisted preference in `localStorage` (`bs.media.view`); full search, sort, and filter URL synchronization.
- [x] **Criterion 14 (Upload queue & tray)**: Queue processes up to 4 concurrent uploads, reports XHR progress, supports cancellation/retry, and surfaces specific errors.
- [x] **Criterion 15 (Detail sheet)**: Displays preview, editable title/alt/caption, image accessibility warnings, and clickable "Used in" links.
- [x] **Criterion 16 (Bulk bar)**: Bulk download, trash, restore, and permanent delete with `ConfirmDialog` and usage warnings.
- [x] **Criterion 17 (Storage meter)**: Storage progress bar linked to `admin.media.usage`, shifts color at 80% / 95% capacity.
- [x] **Criterion 18 (Responsive layout)**: Responsive grid (2 cols at 375 px, 4 at 768 px, 6 at 1280 px, 8 at 1600 px); mobile-friendly action bar and sheet.
- [x] **Criterion 19 (Uploader compatibility)**: `uploadMedia()` retained in `upload-media.ts` wrapping queue for seamless backward compatibility.
- [x] **Criterion 20 (Verification Gate)**: All full test gates and typechecks pass cleanly.

## Verification
- `pnpm typecheck`: Passed (15/15 packages green).
- `pnpm lint`: Passed (15/15 packages green).
- `pnpm build`: Passed (6/6 projects built successfully).
- `pnpm docs:check`: Passed (`docs:check ok`).
- `pnpm --filter @bs/domain test:fast`: Passed (47 test files, 406 tests passed).
- `pnpm --filter @bs/db test`: Passed (5 test files, 41 tests passed including `b2-grants.int.test.ts`).
- `packages/domain/test/media-quotas.int.test.ts`: Passed (4/4 real Postgres tests).
- `packages/domain/test/media-services.int.test.ts`: Passed (5/5 real Postgres tests).
- `packages/domain/test/isolation.int.test.ts`: Passed (1307/1307 tests).

## Docs updated
- [x] `docs/ARCHITECTURE.md` (Updated `media_usages` table, migration 0056, `/online-store/media` route, `media.purge` & `media.trash_sweep` jobs, and bumped commit hash header).
- [x] `docs/adr/028-media-library.md` (Created ADR-028 and linked in `docs/adr/README.md`).
- [x] `progress.md` (Updated In flight section marking Phase 1 ready for Claude verification).

## Follow-ups and open questions
- **Phase 2 Hand-off**: Phase 1 is fully completed and ready for Claude Code verification. Phase 2 will introduce the reusable modal picker (`openMediaPicker`), replace older direct uploaders, and wire drag-and-drop reordering for product galleries.

## Definition of done
- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (real-DB tests for tenancy, quotas, usages, sweep, and isolation).
- [x] `docs/ARCHITECTURE.md` updated and "Last verified" commit bumped.
- [x] ADR written: `docs/adr/028-media-library.md`.
- [x] Change record in `docs/changes/` and `progress.md` updated.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: all commands executed and verified with local Postgres and storage driver.
