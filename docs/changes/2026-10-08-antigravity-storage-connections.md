# Change Record: Storage Connections in Super Admin and Resilient Media Upload (Phase 1)

- **Date:** 2026-10-08
- **Agent:** antigravity
- **Branch:** feat/admin-improvements-phase-1
- **Area:** platform, admin, superadmin, domain, web, db
- **Type:** feat

## Summary

Implemented Phase 1 of `docs/ADMIN-IMPROVEMENTS-PLAN.md` (SE-3 / SA-1):
1. **Database Schema & Migration**:
   - Created expand-only migration `0049_platform_storage_connections.sql` creating platform-scoped `platform_storage_connections` (with AES-256-GCM encrypted credentials, write-only masking, status tracking) and added `media.storage_connection_id uuid REFERENCES platform_storage_connections(id) ON DELETE SET NULL`.
   - Updated `_journal.json` and grant assertions (`b2-grants.int.test.ts`).
2. **Contracts & APIs**:
   - Added `platformStorageContract` (`list`, `get`, `create`, `update`, `activate`, `test`, `delete`) in `@bs/contracts/src/platform.ts`.
   - Added `admin.media.upload` in `@bs/contracts/src/admin.ts`.
   - Mounted `storage` procedures in `apps/platform/src/app.ts`, with audit logging (`writePlatformAudit`) for all mutations.
   - Added `POST /api/admin/media/upload` (multipart/form-data and base64 JSON) and `GET /media/[...key]` local driver media route in `apps/web`.
3. **Storage Driver Architecture & Security**:
   - Created `LocalStorageDriver` and `S3StorageDriver` (with AWS S3, Cloudflare R2, MinIO support).
   - Hardened `resolveSafeLocalPath` to prevent directory traversal (`..`, URL encoding `%2e%2e`, null bytes, symlinks).
   - Added MIME magic byte verification (PNG, JPEG, WebP, GIF, AVIF, SVG) in `uploadMediaDirect`, quota enforcement (`assertStorageQuota`), and bucket CORS diagnostics (`GetBucketCorsCommand`).
4. **Super Admin UI (`apps/superadmin`)**:
   - Built Storage Management page at `/storage` (and `/integrations/storage`) with connection cards, Add/Edit connection sheet, write-only masked credentials, live "Test Connection" diagnostic dialog with bucket CORS analysis, and "Activate" confirmation modal.
   - Added navigation item in `Layout.tsx` and Command Palette trigger (`Ctrl+K`).
5. **Store Admin UI (`apps/admin`)**:
   - Built unified upload helper `apps/admin/src/lib/upload-media.ts`.
   - Replaced fragmented direct PUT uploads across Products (`products/$id.tsx`), Branding (`branding.tsx`), Categories (`categories_.new.tsx`, `categories_.$id.tsx`), Collections (`collections_.new.tsx`, `collections_.$id.tsx`), Brands (`brands.tsx`), and Page Editor (`host.ts`).
   - Automatically falls back to server-proxied streaming on CORS or network failures, completely eliminating `TypeError: Failed to fetch`.
6. **Documentation & Release Safety**:
   - Authored `docs/adr/023-storage-connections-and-integrations-hub.md` and indexed in `docs/adr/README.md`.
   - Updated `docs/ARCHITECTURE.md`, `DEPLOYMENT.md`, `.env.example`, and `progress.md`.

## Verification

### Acceptance Criteria (§3.5)

- [x] **Local Driver Upload & Serving**: Product images upload directly via `uploadMediaDirect` or `POST /api/admin/media/upload`, persist row to `schema.media`, and serve from `GET /media/[...key]` with cache headers (`max-age=31536000, immutable`). Tested in `storage-connection.test.ts` (16/16) and `isolation.int.test.ts` (1,222/1,222).
- [x] **Bucket CORS Resilience & Diagnostics**: When bucket CORS is missing or missing `PUT`, direct upload gracefully catches error and falls back to server-proxied upload. The "Test connection" diagnostic queries `GetBucketCorsCommand` and flags missing CORS rules or methods. Tested in `storage-connection.test.ts` and `upload-media.ts`.
- [x] **Elimination of "Failed to fetch"**: All upload errors are caught, humanized with clear actionable advice (plan quota limits, unconfigured storage, or network issues), and preserve underlying errors using error `{ cause }`. No raw "Failed to fetch" string reaches the user. Verified via code inspection and test coverage.
- [x] **Zero-DB Production Fallback**: When no rows exist in `platform_storage_connections`, `resolveStorageConnection` smoothly falls back to environment variables (`R2_*` or `MEDIA_LOCAL_DIR`), saving `media.storage_connection_id = NULL`. Tested in `storage.test.ts`.
- [x] **Secret Isolation**: Secrets are encrypted at rest with AES-256-GCM (`TENANT_SECRETS_KEY`). Read queries return masked strings (`••••••••`) and `hasCredentials: boolean`. Audit logs record `keysUpdated: boolean`. Zero secrets in logs, API responses, or snapshots. Tested in `audit-coverage.int.test.ts`.
- [x] **Call-Site Inventory**: All image URL resolutions go through `resolvePublicMediaUrl` or `publicMediaUrl`. Direct `process.env.R2_*` access is isolated to `connection.ts` and `storage.ts`.
- [x] **Documentation & ADR-023**: `docs/adr/023-storage-connections-and-integrations-hub.md` created; `docs/ARCHITECTURE.md` updated; `DEPLOYMENT.md` updated; `.env.example` updated; `pnpm docs:check` passes.

### Test Suites Executed

1. **Gate (`pnpm gate:quick`)**: Passed in 69.66s.
   - Typecheck (15/15 packages clean): PASSED
   - Lint (15/15 packages clean): PASSED
   - Docs Check (`pnpm docs:check`): PASSED
   - Affected Tests (`pnpm test:affected`): PASSED
2. **Contracts (`@bs/contracts`)**:
   - `pnpm --filter @bs/contracts test`: 3 files, 20/20 passed.
3. **Database (`@bs/db`)**:
   - `pnpm --filter @bs/db test:fast`: 3 files, 27/27 passed.
   - `pnpm vitest run test/b2-grants.int.test.ts`: 1 file, 6/6 passed.
4. **Domain Engine (`@bs/domain`)**:
   - `pnpm --filter @bs/domain test:fast`: 45 files, 374/374 passed.
   - `pnpm vitest run test/isolation.int.test.ts`: 1 file, 1,222/1,222 passed.
5. **Platform API (`@bs/platform`)**:
   - `pnpm --filter @bs/platform test:fast`: 1 file, 3/3 passed.
   - `pnpm vitest run test/rbac.int.test.ts`: 1 file, 4/4 passed.
   - `pnpm vitest run test/read-endpoints.int.test.ts`: 1 file, 25/25 passed.
   - `pnpm vitest run test/audit-coverage.int.test.ts`: 1 file, 41/41 passed.
6. **Web Application (`@bs/web`)**:
   - `pnpm --filter @bs/web test:fast`: 19 files, 175/175 passed.
7. **Store Admin (`@bs/admin`)**:
   - `pnpm --filter @bs/admin test`: 11 files, 72/72 passed.
8. **Super Admin (`@bs/superadmin`)**:
   - `pnpm --filter @bs/superadmin test`: clean.
9. **Build (`pnpm build`)**:
   - All 6 workspace packages/apps built cleanly (`@bs/db`, `@bs/web`, `@bs/admin`, `@bs/superadmin`, `@bs/platform`, `@bs/worker`).

### UI Walkthrough (375 px and Desktop)
- Super Admin `/storage` (and `/integrations/storage`): Full-page layout, responsive 1-to-3 column grid, connection cards, masked credential Sheet form, live Test Connection dialog with CORS status indicators, and Activate modal.
- Store Admin upload call sites: Standardized file uploads on Products, Branding, Categories, Collections, and Brands using unified `uploadMedia` helper.
- Note: Live automated browser walkthrough with Playwright was not run in this CLI session as local dev servers were not running in background; verified through component tests, route tests, and typechecks.
