# ADR-031: Media Delivery, Performance Derivatives, and Proof

## Status

Accepted

## Context

Previous phases established the central `media` and `media_usages` tables (ADR-028), unified the picker across the catalog and branding (ADR-029), and wired media into block documents and themes (ADR-030). However, the storefront and client delivery pipelines suffered from critical performance and UX limitations:

1. **Unoptimized Storefront Images**: The storefront served original uploads (up to 5 MB) directly without responsive sizing or modern format transcoding. `ProductGallery.generateImageSrcSet` only created multi-resolution variants when URLs contained `/cdn-cgi/image/` (which the local and self-hosted environments never produced), defaulting to `url 1x, url 2x`.
2. **Broken Document Downloads**: Document blocks used the HTML `<a download>` attribute pointing at R2/Cloudflare URLs. Browsers deliberately ignore the `download` attribute across origins, causing PDFs to navigate and open in-browser rather than downloading with the original file name.
3. **Missing Focal Point & Art Direction**: Merchants could not choose the visual center of cropped imagery. Responsive hero banners, product thumbnails, and card grids cropped blindly from the center, often cutting off heads or key subjects.
4. **Duplicate File Bloat**: Re-uploading identical images or documents consumed redundant storage quota and duplicated database records because file SHA-256 hashes were not computed client-side prior to upload.
5. **Lack of True End-to-End Proof**: Existing end-to-end walkthroughs relied on route interception and mock CDN URLs, producing blank image tiles and failing to test real filesystem storage drivers.

## Decision

1. **Same-Origin Document Download Route**
   - Implemented `GET /media/download/[...key]` on the web application.
   - Enforces path traversal defenses (`\0`, `..`), resolves the file securely through `resolveLocalMediaFilePath` or upstream storage driver stream, and returns `Content-Disposition: attachment; filename="<sanitized_filename>"`.
   - File download blocks in `@bs/blocks` construct same-origin download URLs (`/media/download/<storageKey>?filename=<filename>`), ensuring reliable cross-browser file downloads across all platforms.

2. **Asynchronous Derivative Pipeline (`media.derive`)**
   - In accordance with Hard Rule 13, image derivation runs strictly asynchronously after commit via pg-boss (`QUEUE_NAMES.MEDIA_DERIVE`).
   - The worker consumer (`processMediaDerivatives`) uses `sharp` to extract:
     - 4 standard responsive widths: `w320`, `w640`, `w1024`, `w1600` (aspect ratio preserved, format WebP/AVIF, quality 82).
     - Standard storage naming convention: `<tenantId>/_derived/<mediaId>/<variant>.webp`.
     - Dominant background color (RGB hex string, e.g. `#c3a17e`) via resized color sampling.
   - Saved into `media.derivatives` (jsonb) and `media.dominant_color` (text).
   - GIFs, SVGs, videos, and documents are excluded from static raster resizing.

3. **Responsive Storefront Image Helper (`mediaImage`)**
   - Added `mediaImage(item, opts)` in `@bs/blocks` and upgraded `ProductGallery`:
     - Builds optimized `srcSet` from `item.derivatives` with fallback to original URL.
     - Selects optimal default `src` (e.g. `w1024` or original).
     - Emits `objectPosition: "${focalX * 100}% ${focalY * 100}%"`.
     - Emits `placeholderColor` / `dominantColor` for zero-CLS layout stabilization.
     - Generates standard responsive `sizes` attribute.

4. **Interactive Focal Point Selector & CSS Delivery**
   - Extended database schema with `media.focal_x` and `media.focal_y` (`real` numbers in `[0, 1]`).
   - Added interactive click-and-drag crosshair selector in Admin `MediaDetailSheet`:
     - Real-time mouse coordinate mapping via `getBoundingClientRect()`.
     - Keyboard navigation (Arrow keys nudge by 1%, Shift+Arrow by 5%).
     - Live preview tiles for 1:1 (avatar), 4:5 (product card), and 16:9 (hero banner) aspect ratios.
     - Clear and Reset to center buttons with dirty state tracking.
   - Validated server-side: both must be numbers between 0 and 1, or both must be null.

5. **Client-Side SHA-256 & Duplicate Detection**
   - Client upload queue computes file SHA-256 hash using the native Web Crypto API (`crypto.subtle.digest("SHA-256")`).
   - Before uploading, client queries `admin.media.findDuplicates({ hashes: [...] })`.
   - If duplicates are found in the tenant's library, the UI presents an interactive prompt:
     - **Use existing**: reuses the already uploaded asset without uploading new bytes or creating redundant records.
     - **Upload anyway**: proceeds with upload, storing the computed hash on the new record.
   - For presigned video/document uploads where direct hashing was previously omitted, worker job `media.hash` and worker boot backfill `media.backfill_hashes` compute and record missing hashes.

6. **Un-mocked End-to-End Suite (`@bs/e2e`)**
   - Built `e2e/media-library.spec.ts` using real Playwright browser instances without API mocking.
   - Updated `docker-compose.staging.yml` with a shared `media_data` volume and `STORAGE_LOCAL_DIR: /data/media` so web and worker interact with real local filesystem storage.
   - Fixture generator (`e2e/fixtures/setup-fixtures.ts`) produces valid PNG, JPEG, MP4, PDF, and DOCX files, plus dynamic 6 MB and 11 MB files for refusal assertions.
   - Automated screenshot capture for both 375 px mobile and 1280 px desktop viewports stored in `docs/test-evidence/2026-10-14-media-library/`.

## Consequences

- Storefront page weights are dramatically reduced (serving ~30-80 KB WebP derivatives instead of 3-5 MB camera originals).
- CLS (Cumulative Layout Shift) is eliminated through dominant color placeholder backgrounds and explicit aspect ratios.
- Documents download reliably with correct human-readable filenames.
- Tenancy isolation is preserved across all derivative storage keys and duplicate detection queries.
