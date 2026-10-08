# ADR-023: Storage connections in Super Admin and resilient media uploads

- **Status:** Accepted
- **Date:** 2026-10-08
- **Plan reference:** `docs/ADMIN-IMPROVEMENTS-PLAN.md` §3 (SE-3 / SA-1)

## Context

bsec stores rely heavily on media storage for product catalogs, brand identities (logos, favicons, social cards), and visual page blocks. Previously:
1. Media storage configuration was entirely static, relying on monorepo environment variables (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`).
2. There was no user interface for platform operators to configure or test storage connections in Super Admin.
3. Local development and air-gapped test setups without active Cloudflare R2 credentials had no local filesystem fallback, preventing image uploads during evaluation.
4. When store merchants uploaded product images from the store admin via browser-direct presigned S3/R2 PUT URLs, missing or misconfigured CORS headers on the bucket caused the browser to abort the request with `TypeError: Failed to fetch`. Forbidden headers like `Content-Length` also triggered browser exceptions.
5. Store admin pages contained duplicated upload snippets with inconsistent error messages.

## Decisions

We implement dynamic storage connections in Super Admin and an error-resilient upload pipeline with the following architectural decisions:

1. **Platform Storage Connections Table (`platform_storage_connections`):**
   - Platform-scoped table managed exclusively by platform staff (`assertPlatformStaff`, role >= `platform_admin`).
   - Supports drivers: `s3` (AWS S3, Cloudflare R2, MinIO, Backblaze B2) and `local` (filesystem storage for development/trials).
   - Segregated by purpose: `public_media` (storefront assets), `private_media` (return photos, proof of delivery), `backups`, and `exports`.
   - Exactly one connection may be active per purpose. Activating a connection deactivates any existing connection for that purpose atomically within a database transaction.
   - Fallback hierarchy: Active connection in `platform_storage_connections` takes precedence. If no active row exists in the database, the runtime seamlessly falls back to environment variables (`R2_*` or `MEDIA_LOCAL_DIR`).

2. **Write-Only Encrypted Credentials:**
   - Storage credentials (`accessKeyId`, `secretAccessKey`) are encrypted at rest using AES-256-GCM authenticated encryption via `TENANT_SECRETS_KEY`.
   - Secret inputs in Super Admin are write-only. Read queries return `hasCredentials: boolean` and masked placeholders (e.g. `••••••••`); secrets are never exposed in logs, API responses, or frontend state.

3. **Safe Local Storage Driver (`LocalStorageDriver`):**
   - Implements local filesystem storage for self-hosted instances or local development.
   - Path resolution strictly enforces containment within the designated directory (`resolveSafeLocalPath`), rejecting path traversal attempts (`..`, URL-encoded `%2e%2e`, null bytes, and non-canonical relative segments).
   - Local media files are served via `GET /media/[...key]` on the web app with long-term caching headers (`max-age=31536000, immutable`), defensive magic-byte MIME sniffing, and `X-Content-Type-Options: nosniff`.

4. **Resilient Direct Upload with Automatic Server Fallback:**
   - Direct presigned PUT uploads in `apps/admin/src/lib/upload-media.ts` strip forbidden browser headers (such as `Content-Length`).
   - If direct browser upload fails due to CORS or network transport errors (catching `TypeError` or non-2xx status), the client automatically falls back to streaming the upload through the server endpoint `POST /api/admin/media/upload` (and `admin.media.upload` oRPC procedure).
   - The server proxy validates file magic bytes (PNG, JPEG, WebP, GIF, AVIF, SVG), enforces store plan storage quotas (`assertStorageQuota`), and uploads the file directly to storage.
   - Raw exceptions like `TypeError: Failed to fetch` are completely eliminated from merchant UI.

5. **Diagnostic Connection & CORS Testing in Super Admin:**
   - Super Admin provides a "Test Connection" diagnostic tool.
   - In addition to standard Put/Head/Delete write verification, the diagnostic checks bucket CORS policies (`GetBucketCorsCommand`) to verify that the `PUT` method and appropriate origins are allowed, warning the operator before activation.

6. **Full Audit Logging:**
   - Every platform mutation (`storage.create`, `storage.update`, `storage.activate`, `storage.test`, `storage.delete`) writes an immutable record to `platform_audit_logs`.

## Consequences

- **Benefits:**
  - Merchants never encounter broken upload states or cryptic "Failed to fetch" browser errors.
  - Platform operators can manage, test, and switch storage providers directly in Super Admin with zero downtime.
  - Local development works out-of-the-box without requiring live cloud credentials.
- **Trade-offs:**
  - Sever-proxied fallback uploads consume temporary server bandwidth when bucket CORS is misconfigured, reinforcing the value of Super Admin CORS warnings.
