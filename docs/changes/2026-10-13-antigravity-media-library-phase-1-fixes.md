# Media Library Phase 1: Fix Round (Send-back Addressing B1–B6)

- **Date:** 2026-10-13
- **Agent:** antigravity
- **Branch:** `feat/media-library-phase-1` (not merged yet)
- **Area:** db, domain, docs
- **Type:** fix
- **Supersedes:** `2026-10-13-antigravity-media-library-phase-1.md`
- **Superseded by:** `2026-10-14-antigravity-media-library-phase-1-fixes-round-2.md`

## Summary
Addresses all blocking defects B1–B6 identified during Claude's verification review of Media Library Phase 1 (`head ea54a3e`), eliminates all `@typescript-eslint/no-non-null-assertion` linter failures in `media-services.ts`, and adds real-database integration test coverage:

1. **B1 (Private Files Isolation)**:
   - Exported `PRIVATE_MEDIA_FOLDERS = ["returns", "expense-receipts"] as const` in `packages/domain/src/media/types.ts`.
   - Applied `libraryScope` predicate (`notInArray(schema.media.folder, PRIVATE_MEDIA_FOLDERS)`) across `listMedia`, `getMedia`, `updateMedia`, `trashMedia`, `restoreMedia`, `deleteMediaPermanent`, `runMediaTrashSweep`, and `getTenantMediaUsageStats`.
   - Mutations on private folder items strictly return "not found".
   - Aligned storage quotas (`assertMediaUploadQuota`, `getTenantMediaUsageStats`, and `Settings > Storage`) to count library files only via a single shared scoped sum.

2. **B2 (Client StorageKey Validation & Duplicate Prevention)**:
   - Added validation before any storage calls in `createMediaRecord`: storage key must start with `${ctx.tenantId}/`, follow strict `tenant/folder/uuid.ext` structure (no `..`, no leading slash), cannot use private folders, and must be unique per tenant in `media`.
   - Added expand-only migration `0057_media_storage_key_uniq.sql` creating unique index `media_tenant_storage_key_uniq` on `(tenant_id, storage_key)` in `packages/db`. Verified existing database has no duplicate storage keys. Registered migration in `_journal.json` and `docs/ARCHITECTURE.md`.

3. **B3 (Memory/DoS Streaming Head & Quota Check)**:
   - In `finalizeUpload`, performed `assertMediaUploadQuota` immediately following `driver.head(input.storageKey)` using `head.size` before reading any object body.
   - If quota check or MIME type validation fails, storage object is purged without downloading into memory.
   - Added `getRange(key, start, end)` to `StorageDriver` interface (with range implementation on S3 and fallback on local driver). Reads only first 4 KB header for magic byte verification; downloads full object only for image sharp dimension extraction.

4. **B4 (Multi-tenant Trash Sweep with RLS)**:
   - Refactored `runMediaTrashSweep` to iterate tenants with `withTenant(db, tId)` using standard `app_rw` connection.
   - Re-checks status, trashed timestamp (> 30 days), and absence of active usages inside atomic `DELETE ... RETURNING`.
   - Audits deletions under `system` actor and dispatches `media.purge` jobs post-commit via `rt._jobs`.

5. **B5 (Untracked System References Check)**:
   - Implemented `findUntrackedReferences` querying `brandSettings` (logo, favicon, square logo, social banner, splash), `storeStatus.backgroundMediaId`, `seoSettings.defaultOgImageMediaId`, `pageVersions.document`, and `themes.tokens`.
   - Refuses permanent deletion and trash sweep if any untracked reference exists, returning descriptive refusal error.

6. **B6 (Usage Sync Tenant Isolation)**:
   - In `syncMediaUsages`, verified all targeted media IDs belong to the caller tenant and are not in `PRIVATE_MEDIA_FOLDERS`. Rejects foreign or private media IDs with `DomainError(NOT_FOUND)`.

7. **Linter Cleanup**:
   - Replaced all 4 non-null assertions in `media-services.ts` with explicit length checks and pattern matching.

## Verification
- `pnpm docs:check`: **PASS** (zero errors).
- `pnpm lint`: **PASS** (15/15 packages clean, 0 errors, no non-null assertions).
- `pnpm typecheck`: **PASS** (15/15 packages clean).
- `pnpm --filter @bs/domain test:fast`: **47 test files passed, 406 tests passed, 0 failed**.
- Real DB test suites:
  - `packages/domain/test/media-services.int.test.ts`: **10/10 passed** (covers B1 private file isolation in queries/mutations/sweeps/quotas, B2 key validation and duplicate rejection, B3 pre-download quota check and rejection, B4 multi-tenant sweep under `app_rw`, B5 untracked reference detection across settings and themes, B6 usage sync tenant validation).
  - `packages/domain/test/storage-connections.int.test.ts`: **10/10 passed**.
  - `packages/domain/test/isolation.int.test.ts`: **1,307/1,307 passed**.
  - `packages/db/test/b2-grants.int.test.ts`: **6/6 passed**.
  - `packages/domain/test/product-images.int.test.ts`: **5/5 passed**.
  - `packages/domain/test/storefront-customer-pages.int.test.ts`: **15/15 passed**.
  - `pnpm test:heavy:local`: **97 test files, 2,045 total integration tests passed**.
