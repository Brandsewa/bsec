# Media Library Phase 2: Shared Picker, Usages, and Cache Fan-out

- **Date:** 2026-10-14
- **Agent:** antigravity
- **Branch:** `feat/media-library-phase-2`
- **Area:** admin, domain, contracts, db, web
- **Type:** feature
- **Supersedes:** none

## Summary
Phase 2 implements the shared media picker (`<MediaField>`, `<MediaGalleryField>`, `<MediaPickerDialog>`) and wires every media-bearing entity across the admin catalog (products, variants, collections, categories, brands) and store branding settings (`logo`, `logo_dark`, `favicon`, `apple_touch_icon`, `social_image`, status background, SEO default OG image). It adds migration 0058 to backfill store branding references into `media_usages`, adds cache fan-out across all referencing owners on media update and replacement, and implements physical storage object replacement (`replaceMedia`) with background worker purging.

## What changed
- **Contracts (`packages/contracts/src/admin.ts`)**:
  - Added `admin.media.replace`: takes `{ id, storageKey, mime, bytes, filename?, durationMs? }` and returns updated `MediaItem`.
  - Added `admin.products.reorderMedia`: takes `{ id, order: string[] }` and gap-free renumbers product media positions.
  - Added `admin.products.updateMedia`: takes `{ id, productMediaId, alt }` to update product-level alt overrides without mutating the library record.
  - Added `ProductMediaItem` to expose `kind: "image" | "video"`, `filename`, and `thumbnailUrl`.
- **Database & Migrations (`packages/db`)**:
  - Migration `0058_media_usages_branding.sql`: backfills existing `brand_settings` media columns (`logo_media_id`, `logo_dark_media_id`, `favicon_media_id`, `apple_touch_icon_media_id`, `social_image_media_id`) into `media_usages` with `owner_type = 'store_branding'`.
- **Domain Services (`packages/domain`)**:
  - `replaceMedia`: replaces storage key and physical metadata (width, height, bytes) while preserving ID, usages, and title/alt/caption. Enforces same-kind replacements, net quota delta checks, and purges the old storage key via `media.purge` worker job (or inline fallback).
  - `reorderProductMedia`: enforces position 0 is always an image (refuses videos at position 0), verifies gap-free permutation, and updates positions.
  - `attachProductMedia`: supports image and video kinds (refuses video at position 0 when no other media exists).
  - `detachProductMedia`: automatically promotes the next available image to position 0 when removing the primary item.
  - `syncMediaUsages`: updated in `brand-services.ts` to sync store branding usages on every update.
  - `invalidateMediaCache`: fans out cache invalidations to all owner entities (`product`, `collection`, `category`, `brand`/`nav`, `store-shell`, `seo`, `theme`, `storage`).
  - Extracted `findUntrackedReferences` into `packages/domain/src/media/untracked-references.ts` to prevent circular dependencies.
- **Admin Components & Routes (`apps/admin`)**:
  - Built `<MediaField>`: single-slot thumbnail picker with change/remove actions and permission fallback.
  - Built `<MediaGalleryField>`: multi-item sortable drag-and-drop gallery with primary badge, position tags, per-item alt modal, and `@bs/ui` empty state.
  - Built `<MediaPickerDialog>`: responsive dialog (< 768 px full screen) with Library tab (search, type/usage filters, infinite scroll) and Upload tab (drop zone, queue integration, quota validation).
  - Wired all catalog and branding admin routes: `collections_.$id.tsx`, `collections_.new.tsx`, `categories_.$id.tsx`, `categories_.new.tsx`, `brands.tsx`, `products/$id.tsx` (gallery + variant image slots), `settings/branding.tsx`.
- **Storefront (`apps/web`)**:
  - Updated `ProductGallery.tsx` and `packages/domain/src/storefront/catalog.ts` to render videos with `<video controls playsinline preload="none">` and thumbnail play overlays without autoplaying with sound.

## Decisions and trade-offs
- **ADR-029 Written**: Captured decisions for shared picker architecture, canonical usage tracking in `media_usages`, cache fan-out mapping, and video gallery invariants (position 0 image requirement).
- **Physical Key Replacement vs In-Place Overwrites**: Always allocates new storage key and purges old object via background job to avoid CDN edge cache staleness and ensure Cloudflare Image Transforms function properly.
- **Deduplication of Usages**: Unified branding `ownerType: "store_branding"` across `brand-services.ts`, `media-services.ts`, and `untracked-references.ts` so usage badges and counts remain clean.

## Verification
- `pnpm typecheck`: Passed (15/15 packages successful).
- `pnpm lint`: Passed (15/15 packages successful).
- `pnpm build`: Passed (6/6 projects built successfully, including `@bs/admin` and `@bs/web`).
- `pnpm docs:check`: Passed (`docs:check ok`).
- `pnpm --filter @bs/domain test:fast`: Passed (48 test files, 410 tests passed).
- `pnpm --filter @bs/db test`: Passed (5 test files, 41 tests passed).
- Integration test suites (`TEST_PG_ADMIN_URL` on local Postgres):
  - `test/media-usages.int.test.ts`: Passed (2/2 tests) — tracks catalog, branding, status fields, and blocks deletion of used media.
  - `test/media-replace.int.test.ts`: Passed (3/3 tests) — image-to-image replacement, physical storage purge, mismatched kind rejection, net quota delta.
  - `test/media-product-gallery.int.test.ts`: Passed (1/1 tests) — image at position 0, video rejection at position 0, reorder gap-free invariant, alt overrides, and promotion on detach.
  - `test/media-cache-fanout.int.test.ts`: Passed (1/1 tests) — fans out cache invalidations to collections, categories, brands, store branding, and status background.
- Admin fast test suite:
  - `pnpm --filter @bs/admin test:fast -- --no-file-parallelism`: Passed (12 test files, 74 tests passed).

## Docs updated
- [x] `docs/ARCHITECTURE.md` (bumped "Last verified against", added migration 0058, updated API surface with `replace`, `reorderMedia`, `updateMedia`).
- [x] `docs/adr/029-media-picker-and-usages.md` (new ADR) and `docs/adr/README.md` (linked ADR-029).
- [x] `progress.md` (updated In flight status to `[Ready for Claude verification]`).

## Follow-ups and open questions
- Phase 3 will wire block-editor and theme page builder blocks to use `<MediaField>` / `<MediaPickerDialog>`.

## Definition of done
- [x] Code follows AGENTS.md section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (real-DB tests for usages, replacement, product gallery, and cache fan-out).
- [x] `docs/ARCHITECTURE.md` updated and "Last verified against" commit bumped.
- [x] ADR 029 written and indexed.
- [x] `progress.md` in-flight updated.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: all test counts and execution commands accurately documented.
