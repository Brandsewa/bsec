# ADR-029: Shared Media Picker, Usage Tracking, and Cache Fan-out

- **Status:** Accepted
- **Date:** 2026-10-14
- **Plan reference:** PLAN §5.2, MEDIA-LIBRARY-PLAN §5–§7, ADR-028

## Context
Phase 1 established the flat Media Library, per-kind quotas, trash lifecycle, and the `media_usages` junction table. However, catalog entities (products, variants, collections, categories, brands) and store branding settings still used bespoke `<input type="file">` uploaders or raw storage keys. Usages for store branding were not synced in `media_usages`, file replacements had no dedicated endpoint, and storefront caches were not fanned out when media assets were edited or replaced.

## Decision
1. **Shared Media Components**: Provide `<MediaField>` for single-slot media selection (collections, categories, brands, variants, branding) and `<MediaGalleryField>` for multi-item product media galleries with drag-and-drop reordering. Both components open `<MediaPickerDialog>`, allowing selection from the library or uploading directly into the tenant's media library via the central upload queue.
2. **Canonical Usage Tracking**: Catalog entities and store branding records (`logo`, `logo_dark`, `favicon`, `apple_touch_icon`, `social_image`) sync their references in `media_usages` inside the business transaction. Unstructured block documents (page versions, theme tokens) continue to be detected via `findUntrackedReferences`.
3. **Cache Fan-out**: Mutating or replacing a media item invokes `invalidateMediaCache`, which looks up all active usages (tracked and untracked) and emits tenant-scoped cache tags for referencing entities (`product`, `collection`, `category`, `nav`, `store-shell`, `seo`, `theme`, `storage`).
4. **Physical Media Replacement (`replaceMedia`)**: Replaces the underlying storage key and file metadata (mime, bytes, width, height) while preserving the media record ID, usages, and title/alt/caption fields. The old storage key is enqueued for physical deletion via `media.purge` job (Rule 13).
5. **Product Gallery Invariants**:
   - Primary position (`position: 0`) must be an image to safeguard listings, carts, and social cards. Videos are allowed at positions > 0.
   - Reordering (`reorderProductMedia`) requires a gap-free permutation of existing product media IDs.
   - Detaching the primary image automatically promotes the next image to position 0.

## Consequences
- Every image or video uploaded anywhere in the admin is accounted for in `media` and constrained by plan quotas.
- Merchants can replace an image in the library and have it immediately reflect across all catalog and branding surfaces without broken links.
- Moving or deleting media is strictly guarded against in-use assets.

## Alternatives considered
- **In-place file overwriting on S3/R2**: Overwriting the existing storage key was rejected because CDN edge caching (Cloudflare) and client browser caching would delay updates, and Cloudflare Images transform URLs require unique source keys.
- **Separate media picker per entity**: Rejected to avoid UI fragmentation and duplicate upload logic.
