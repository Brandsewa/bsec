# ADR-028: Media library architecture: flat assets, usages tracking, per-kind quotas, trash lifecycle, and SVG ban

- **Status:** Accepted
- **Date:** 2026-10-13
- **Plan reference:** `docs/MEDIA-LIBRARY-PLAN.md`

## Context

Store merchants need a unified media management experience under **Online Store > Media** to view, filter, upload, and inspect images, videos, and documents across their catalog entities (products, variants, collections, categories, brands).

Previous media handling in the platform had several design limitations and correctness bugs:
1. **L1 & L2 (Untracked usages & broken storefront links):** Media rows had no reference tracking. Merchants could delete images currently assigned to active products or collections, breaking storefront rendering.
2. **L3 (Synchronous storage deletion inside transactions):** Deleting media records called S3/R2 storage drivers directly inside the database transaction, risking long delays, failures, and atomicity violations.
3. **Q1, Q2 & Q3 (Quota bypass and single file limit):** Direct presigned uploads bypassed upload quota checks; the server trusted client-declared file sizes; a single `media_file_mb` quota governed both small photos and larger product videos.
4. **Security (SVG XSS risk):** SVG files contain arbitrary XML/JavaScript that can lead to stored cross-site scripting when rendered or served directly.

## Decision

1. **Flat Asset Architecture with `media_usages` Junction Table:**
   - Media is organized as a flat library with searchable filenames, titles, alt text, captions, and derived kinds (`image`, `video`, `document`).
   - A dedicated tenant table `media_usages` (`tenantTable`, `forceRlsSql`, composite `tenantForeignKey`) tracks references to products, product variants, collections, categories, and brands.
   - Catalog service mutations synchronize `media_usages` whenever media associations are added, replaced, or cleared.
2. **Per-Kind Plan Upload Quotas:**
   - Three distinct quota keys (`media_image_mb`, `media_video_mb`, `media_document_mb`) replace monolithic file-size checks for media uploads.
   - Seeded with 5 MB / 10 MB / 5 MB across all subscription tiers, configurable per tier and per tenant in Super Admin.
   - Enforced at `requestMediaUpload` and re-verified against the real `HeadObject` byte length and buffer length during `createMediaRecord` and direct uploads.
3. **Magic-Byte Validation & Complete SVG Prohibition:**
   - File bytes are verified against magic headers (`IMAGE_TYPES`, `VIDEO_TYPES`, `DOCUMENT_TYPES`).
   - Mismatched content (e.g., PDF disguised with a `.png` extension) is rejected.
   - SVG is explicitly prohibited on upload to eliminate XSS vectors.
4. **Two-Stage Deletion & Trash Lifecycle:**
   - Deletion defaults to moving items to **Trash** (`status = 'trashed'`, timestamped with `trashed_at`).
   - Trashed items remain visible on storefronts if still referenced, allowing merchants time to replace them.
   - The legacy `deleteMediaRecord` is maintained as an alias to `trashMedia` for backwards compatibility.
   - `deleteMediaPermanent` permanently deletes records only if they have **no active usages** in `media_usages`. If any selected items are in use, they are refused and returned in a `blocked` list.
5. **Asynchronous Storage Cleanup via pg-boss (`media.purge` & `media.trash-sweep`):**
   - Object deletion from storage is decoupled from web requests and transactional logic.
   - `deleteMediaPermanent` enqueues `media.purge` jobs inside the database transaction (rule 13). The worker asserts tenant key prefixes (`${tenantId}/`) before calling storage drivers.
   - A scheduled daily job `media.trash-sweep` automatically purges unused items trashed for more than 30 days.

## Consequences

- **What becomes easier:**
  - Merchants have clear visibility into where media is used before modifying or removing assets.
  - Storage quotas accurately reflect usage (including trashed bytes until permanently purged).
  - Web requests remain fast and responsive because external bucket deletions are handled asynchronously in background worker queues.
- **What becomes harder:**
  - Every catalog mutation that touches media references must call `syncMediaUsages` to maintain reference integrity.
- **Enforcement:**
  - Database isolation suite (`isolation.int.test.ts`) verifies cross-tenant isolation for all media procedures.
  - `media-services.int.test.ts` asserts that `deleteMediaPermanent` refuses referenced media.
  - `b2-grants.int.test.ts` validates tenant RLS and role grants on `media_usages`.

## Alternatives considered

- **Hierarchical folder structure:** Deferred to future phases; flat tags, searches, and type filtering meet current merchant needs with simpler UX and lower data complexity.
- **Immediate hard deletion with CASCADE:** Rejected because breaking active storefront images degrades buyer trust and store SEO.
- **Synchronous S3 deletion:** Rejected in accordance with ADR-006 (rule 13: side effects happen after commit via pg-boss).
