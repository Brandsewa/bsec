# ADR-030: Media in Block Documents and Themes

## Status

Accepted

## Context

Phase 1 (ADR-028) introduced the centralized `media` and `media_usages` tables, flat storage, per-kind quotas, and 30-day trash lifecycle. Phase 2 (ADR-029) wired the shared picker and usage tracking into catalog entities (products, variants, collections, categories, brands) and store branding settings.

However, block documents (Puck editor documents stored in `page_versions.document` for custom pages, home pages, and theme templates like header, footer, product, and collection layouts) and theme design tokens (`themes.tokens`) stored media references purely inside unstructured JSON. This left several critical gaps:
1. Media references inside block trees were untracked in `media_usages`. Deletion safety relied on a brute-force JSON text scan (`findUntrackedReferences`), which was slow, unindexed, and couldn't distinguish active references from legacy strings.
2. The block editor (`packages/block-editor/src/MediaField.tsx`) used a hardcoded, unpaginated 100-image dropdown without search, kind filtering, or upload capabilities.
3. Videos and documents lacked first-class block representations; merchants had to paste external URLs or host files off-platform.
4. When a file was updated or replaced in the Media library (e.g., updating alt text or replacing an asset), storefront caches for pages and theme templates were not invalidated.

## Decision

1. **Deterministic Media Reference Extractor (`@bs/blocks` & `@bs/domain`)**
   - Implemented `collectMediaIds(document)` in `packages/blocks/src/media.ts` and `extractMediaReferences(document, ownerType)` in `packages/domain/src/media/document-usages.ts`.
   - The extractor walks the entire block document or theme token tree recursively. Any property whose key is `mediaId`, ends with `MediaId`, is `mediaIds` (or array containing `mediaId`), or contains `media` (case-insensitive) is extracted and classified by expected kind (`image`, `video`, or `document`).
   - Guarded by a registry test that dynamically iterates every block schema to guarantee future blocks with media properties are never missed.

2. **Block Editor Shared Picker Integration**
   - Extended `BlockEditorHost` with an optional `pickMedia` capability.
   - Refactored `MediaField.tsx` in `packages/block-editor` to use the host's `pickMedia` modal when available, offering complete library search, kind filtering, cursor pagination, and instant drag-and-drop upload.

3. **First-Class Video & File Download Blocks**
   - Updated `Video` block to accept `mediaId` (video file) and optional `posterMediaId` (image thumbnail), rendering HTML5 `<video controls preload="metadata">`.
   - Introduced `FileDownload` block accepting `mediaId`, `label`, and optional `description`, rendering a semantic download card with file metadata and download action.

4. **Tenancy and Usage Tracking Convention**
   - Custom pages, home pages, and system templates (`header`, `footer`, `product_template`, `collection_template`, `cart_template`) track usages under `ownerType: "page"` and `ownerId: page.id`.
   - The `field` discriminator distinguishes drafts from live content: `field: "draft"` tracks media in the current draft version, while `field: "published"` tracks media in the live storefront version.
   - Themes track design tokens under `ownerType: "theme"`, `ownerId: theme.id`, and `field: "tokens"`.
   - Page version drafts, publications, rollbacks, unpublications, duplications, and deletions maintain `media_usages` rows transactionally in the same business transaction.

5. **Validation of Newly Added Media References**
   - When saving drafts or updating themes, newly added media references are validated against the database:
     - Must exist in the tenant's media library (cross-tenant references strictly rejected).
     - Must not be in the trash.
     - Must not be in private folders (e.g., return photos or customer uploads).
     - Must match the expected kind for the block property (e.g., video in Video blocks, image in Hero backgrounds).
   - Unchanged media references that were trashed *after* being linked do not block unrelated page edits (tolerant validation).

6. **Worker Backfill Job (`media.backfill_usages`)**
   - Registered `QUEUE_NAMES.MEDIA_BACKFILL_USAGES` in `packages/db/src/queues.ts` and worker consumer in `packages/domain/src/jobs.ts`.
   - `backfillDocumentMediaUsages` runs idempotently across all tenants on deployment/startup to populate `media_usages` for existing pages and themes under standard `app_rw` permissions.

7. **Storefront Cache Fan-Out for Pages and Themes**
   - Enhanced `invalidateMediaCache` to resolve page metadata (`slug`, `type`) for all affected page owners.
   - Invalidation fans out tenant-prefixed cache tags:
     - `page:<slug>` for custom and landing pages.
     - `page:home` and `store-shell` for home pages.
     - `store-shell` and `nav` for header and footer templates.
     - `product` for product templates.
     - `collection` for collection templates.
     - `theme` for theme design tokens.

## Consequences

- Full referential integrity: files used in any page, template, or theme are protected from permanent deletion in `media` (`deleteMediaPermanent` reports blocked usages).
- Instant storefront cache invalidation when media assets or metadata are modified in the library.
- Merchant experience in the page builder is seamless, supporting the full library search, upload queue, and multi-format media.
