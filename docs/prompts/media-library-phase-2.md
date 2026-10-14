# Media Library Phase 2: shared picker and wiring (builder prompt)

Paste this whole file as the first message of a new coding session in the `bsec` repo. You are the builder for **Phase 2 only**. Claude Code verifies against section 8 and merges; you never merge your own PR.

## 0. Read first, in order
1. `AGENTS.md` (hard rules, gate, multi-agent rules).
2. `docs/MEDIA-LIBRARY-PLAN.md` (owner decisions in section 0 still apply: name "Media", flat library, SVG off, limits 5/10/5 MB, 30-day Trash, video on all plans).
3. `docs/adr/028-media-library.md`, `docs/changes/2026-10-13-antigravity-media-library-phase-1*.md`, `docs/changes/2026-10-14-*media-library*.md` (what Phase 1 shipped, and what Claude found and fixed).
4. `docs/ARCHITECTURE.md`, `docs/admin-ui-standards.md`, `docs/migrations.md`, `progress.md` "In flight".
5. Code you will touch: `apps/admin/src/routes/_store/online-store/media.tsx`, `apps/admin/src/components/media/*`, `apps/admin/src/lib/media-upload-queue.ts`, `apps/admin/src/lib/upload-media.ts`, `packages/domain/src/media-services.ts`, `packages/domain/src/cache-invalidation.ts`, `packages/domain/src/brand-services.ts`, `packages/domain/src/catalog-services.ts`, `packages/contracts/src/admin.ts`, `apps/web/src/components/product/ProductGallery.tsx`, `packages/domain/src/storefront/catalog.ts`.

## 1. Setup
- Phase 1 is merged to `main` (PR #67). `git fetch`, create your **own worktree** `../bsec-media-p2` on branch `feat/media-library-phase-2` from `origin/main`.
- Add to `progress.md` "In flight": `Antigravity · feat/media-library-phase-2 · media library · 2026-10-14 · Phase 2: shared picker, wire all media fields, usages for branding, cache fan-out, replace file`.
- Check `docs/changes/` and open branches for overlap (products page, brands, collections, categories, branding, `ProductGallery`).

## 2. Goal
Every place that takes an image or video uses **one** picker and stores a reference to a `media` row, and editing a file in the library updates every place it is used, on the storefront too. Scope is the **catalog and store branding**. Theme and page builder blocks are Phase 3: do **not** change `packages/block-editor`, `packages/blocks`, `apps/admin/src/components/page-editor/host.ts` or the page/theme save paths.

## 3. Slices (small commits, contracts first, in this order)

### S1. Shared picker (admin)
Build in `apps/admin/src/components/media/`:
```ts
<MediaField value={mediaId|null} onChange accept={Kind[]} label aspect? disabled? />
<MediaGalleryField value={MediaRef[]} onChange accept={Kind[]} max sortable />
openMediaPicker({ accept, multiple, max, selected }): Promise<MediaItem[]>   // or a hook-driven dialog
```
- Dialog (`responsive-dialog`: full screen at < 768 px) with two tabs. **Library**: the same search, type filter, usage filter, sort, grid with cursor "load more" as the Media page, filtered by `accept`. **Upload**: drop zone and file chooser using `media-upload-queue.ts`; finished uploads land in the library and are **pre-selected**; per-file errors (too large, unsupported, quota) shown as in the Media page.
- Selection: single or multi, order numbers shown for multi, keyboard (arrows, space, enter), focus trap, visible focus.
- **Do not copy** the 1,100-line `media.tsx`. Extract the shared pieces (tile, list query hook, filters bar, upload tray wiring) into `components/media/` and have both the Media page and the picker use them. The Media page's behaviour must not change (Phase 1 acceptance criteria still hold).
- Permissions: the library needs `content.write`. A user with `products.write` but not `content.write` sees the field read-only with an info tip ("You need permission to manage media"). Do not add a new permission in this phase.
- `MediaField` shows a thumbnail (original URL unless thumbnails exist), filename, "Change" and "Remove" actions, and an empty state with "Choose or upload".

### S2. Wire catalog fields (collections, categories, brands, variants)
Replace the `uploadMedia`/`<input type=file>` code in: `collections_.$id.tsx`, `collections_.new.tsx`, `categories_.$id.tsx`, `categories_.new.tsx`, `brands.tsx`, and the variant image field in `products/$id.tsx`. Use `MediaField` (images only). Variant image: offer the product's own gallery first, then "Browse library". Folder naming for uploads from a field stays as today (`collections`, `categories`, `brands`, `products`).
- Removing an image clears the reference and the `media_usages` row in the same transaction (the services already call `syncMediaUsages`; add tests, do not trust).
- New-entity forms (`*_.new.tsx`): the chosen media id is sent with create.

### S3. Product gallery: images and video, reorder
- Contract: add `admin.products.reorderMedia({ id, order: productMediaId[] })` (validates the set equals the product's current links, renumbers positions gap-free, `products.write`, audit log, `product_image_updated` invalidation). There is no reorder API today.
- `products/$id.tsx`: replace the uploader with `MediaGalleryField` (accept image + video, max 20), drag to reorder (pointer + keyboard), first item is the primary, remove, per-item alt override. Use the admin kit; no new drag library without a justification in the change record (check what the repo already uses).
- `attachProductMedia` currently assumes images: allow `kind = video`. Rules: the **primary (position 0) must be an image** for listings, cart and share cards; refuse to move a video to position 0 when no image exists, and when the first image is removed promote the next **image**. Videos max 10 MB (already enforced by quota).
- Storefront: `ProductGallery.tsx` and `storefront/catalog.ts` expose `kind` per media item; render videos with `<video controls playsinline preload="none">` plus a poster (use the first image as the poster if no other poster exists), never autoplay with sound; thumbnails strip shows a play badge. Listings, cart, OG tags and JSON-LD only ever use the primary **image**. Add the new field to the storefront contract in the same change.
- Alt text rule (document in the ADR): product-level alt (`product_media.alt`) wins; otherwise `media.alt`; otherwise the product title.

### S4. Branding, store status and SEO usages
- Migration `0058_media_usages_branding.sql` (check the next free number on `main`; **append-only, expand-only**): backfill `media_usages` with `owner_type = 'store_branding'` from `brand_settings` (fields `logo`, `logo_dark`, `favicon`, `apple_touch_icon`, `social_image`), `store_status.background_media_id` (field `status_background`) and `seo_settings.default_og_image_media_id` (field `seo_og_image`). `ON CONFLICT DO NOTHING`. No schema change needed (owner type already allowed).
- `brand-services.ts` (branding), the store-status service and the SEO settings service call `syncMediaUsages` in the same transaction on every write and clear when the slot is emptied.
- `Settings > Branding` and the maintenance/SEO image fields use `MediaField`. The branding page currently loads `media.list({limit:100})`; remove that (the picker handles paging).
- Keep `findUntrackedReferences` for **pages and theme blocks only**; keep the branding/status/SEO checks as a defensive second check, and add a test that both agree (a file used as the logo is blocked by usages and by the defensive check).

### S5. Cache fan-out
Today `media_updated` only invalidates the `storage` tag, so changing alt text or replacing a file leaves storefront pages stale.
- In `cache-invalidation.ts` add change types and tags so that `updateMedia`, `trashMedia`, `restoreMedia`, `deleteMediaPermanent`, `replaceMedia` invalidate, **after commit**, the tenant-prefixed tags of every owner found in `media_usages` for the affected ids: product (and its listing tag), collection, category, brand (nav/filters if applicable), variant → its product, `store_branding` → the store shell/seo/theme tags used for logo, favicon and OG. Never invent a second cache (rule 5); use `tenantTag(...)`.
- Cap work: ids per call ≤ 100 already; dedupe tags.
- Tests: `updateMedia` on a file used by a product, a collection and the logo yields exactly those owners' tags (assert on `computeInvalidationTags`/the returned tags).

### S6. Replace file
- Contract + service `admin.media.replace({ id, storageKey, mime, bytes, filename?, durationMs? })`: the client uploads the new file the normal way (presigned) then calls `replace`. Same `kind` required (image→image, video→video, document→document). Validation = the same `finalizeUpload` path as `create` (key shape, tenant prefix, no private folder, HeadObject real size, magic bytes, quota). **Quota counts the net change** (new size minus old size), so replacing within the limit never fails on `storage_mb`.
- In one transaction: swap `storage_key`, `storage_connection_id`, `mime`, `bytes`, `width`, `height`, `duration_ms`, `sha256`, optionally `filename`; keep `id`, `title`, `alt`, `caption`, usages; audit log (`media.replace`, old and new key). After commit: enqueue `media.purge` for the old object (never inline), then S5 invalidation.
- Not allowed for trashed items. Unique `(tenant_id, storage_key)` must hold.
- UI: "Replace file" button in the detail sheet (and the picker's selected item is unaffected). Progress via the upload queue. Show the new preview after success.

### S7. Cleanup
- `ImageUploader` in `packages/ui` and the old `uploadMedia` call sites you replaced: delete dead code you made unused; keep `uploadMedia()` for the page editor (Phase 3).
- `docs/ARCHITECTURE.md` (components, routes, contract changes, migration, tags), ADR `docs/adr/029-media-picker-and-usages.md` (picker contract, branding usages, cache fan-out, replace semantics, alt precedence, primary-must-be-image), `DEPLOYMENT.md` only if env changes (none expected), change record, `progress.md`.

## 4. Rules that matter most
- Rules 1-6, 10, 11, 13 of `AGENTS.md`. Contract first, then handler, then domain service, then UI. Every new `admin.*` procedure (`products.reorderMedia`, `media.replace`) is mapped in `packages/domain/test/isolation.int.test.ts`.
- **No `!` non-null assertions, no `eslint-disable`.** Phase 1 lint failed on exactly this.
- No new dependencies without a stated reason in the change record.
- Do not touch payments, shipping, return photos or the block editor.
- Test only locally. Stage files by explicit path; never `git add -A`.
- Commit trailer: `Co-Authored-By: Antigravity <noreply@google.com>`.

## 5. Tests you must add
Real DB (`*.int.test.ts`):
- Usages: every wired field (collection, category, brand, variant, product gallery, each branding slot, status background, SEO image) sets and clears `media_usages` correctly, including create, update, empty and delete of the owner; one consistency test recomputes usages from the reference columns after a mixed sequence and compares.
- Product gallery: attach video, reorder, primary-must-be-image (refuse video at 0 without an image; promote next image on removal), reorder rejects a foreign or incomplete id set, cross-tenant denied.
- Replace: same-kind only, net quota (a replace that would exceed `storage_mb` by gross size but not by net succeeds), old object purge enqueued after commit, usages and metadata kept, trashed item refused, key rules (foreign tenant, private folder, duplicate) refused.
- Cache: owner tags computed for update/replace/trash across product, collection, brand and logo.
- Storefront: product with an image + video returns `kind` and the primary is the image; listing uses the image.
Unit/component where the repo already has a pattern; otherwise cover through the walkthrough.

## 6. Local walkthrough (required evidence)
Run the web, admin and worker against local Postgres and a **real local storage driver with real files** (Phase 1 screenshots showed blank previews because seeded rows had no files: seed real small PNG/MP4/PDF files). At **375 px and desktop**, with **a different screenshot per step** (Phase 1 had two identical images):
1. Media page unchanged and working (grid, table, upload, trash).
2. Product: open picker from the gallery, pick 2 library images, upload 1 video in the Upload tab (auto-selected), reorder, set primary, save. Storefront PDP shows images and a playable video; listing shows the primary image.
3. Collection, category, brand, variant: pick, change, remove.
4. Settings > Branding: set logo and favicon from the picker; Media shows "Used in Store branding".
5. Edit alt text in Media; storefront HTML shows the new alt after refresh (cache fan-out).
6. Replace a file used by a product; the storefront shows the new file at the same place; the old object is gone after the worker runs.
7. Trash a used file, try permanent delete: blocked result **visible** in the screenshot with the "used in" labels.
8. Picker as a user without `content.write`: read-only field message.

## 7. Acceptance criteria (Claude checks each)
1. One picker component powers products (gallery), variants, collections, categories, brands, branding, store status background and SEO image; no remaining `<input type=file>` uploaders for those fields.
2. The Media page behaves as in Phase 1 (its tests and acceptance criteria still pass); the picker reuses the shared pieces.
3. `media_usages` is correct for every wired field after create, update, clear and owner delete; migration backfill covers branding, status and SEO.
4. Product gallery supports image + video, reorder via `reorderMedia`, primary is always an image; storefront renders video safely (no autoplay, `preload="none"`).
5. Editing alt/title, replacing, trashing or deleting a file invalidates the storefront tags of every owner; stale pages are not served (test + walkthrough step 5).
6. Replace keeps id and references, counts net quota, purges the old object after commit, audit logged.
7. All new procedures are in the isolation suite; real-DB tests for each item in section 5.
8. Gate: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`, `pnpm --filter @bs/domain test:fast`, whole heavy suite serial (`pnpm test:heavy:local`), `pnpm --filter @bs/db test`, with real counts pasted.
9. ARCHITECTURE, ADR-029, change record (with the checklist ticked only for what you ran), `progress.md`.
10. Works at 375 px and desktop; evidence per section 6.

## 8. Hand back
Rebase on the latest `origin/main`, run the full gate, push the branch, open a PR, mark your "In flight" line `[Ready for Claude verification]`. In the change record state plainly what you ran, what failed, what you did not test, and any owner questions. Do not claim "verified" for anything you did not run.
