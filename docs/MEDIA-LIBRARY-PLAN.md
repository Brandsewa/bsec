# Media Library plan (Online Store > Media)

- Status: **Phase 1 ready to build.** Owner decisions recorded 2026-10-13.
- Planner and verifier: Claude Code. Phase 1 builder: **Google Antigravity** (prompt: [`docs/prompts/media-library-phase-1.md`](prompts/media-library-phase-1.md)).
- Related: ADR-002 (tenancy), ADR-006 (jobs), ADR-009/010 (blocks), ADR-025 (quota tiers), `docs/admin-ui-standards.md`.

## 0. Owner decisions (2026-10-13)

| # | Decision |
|---|---|
| D1 | Name **"Media"**, placed under **Online Store** (`/online-store/media`). |
| D2 | **Flat library first.** No folders UI. The existing `folder` column stays as an internal tag (`products`, `pages`, `branding`, `general`) and is used only as a filter. |
| D3 | **SVG uploads are off.** `image/svg+xml` is removed from the allowed list. Existing SVG rows stay readable. |
| D4 | The library has a **thumbnail (grid) view and a table view**, switchable. |
| D5 | Per-file size limits: **image 5 MB, video 10 MB, document 5 MB**. |
| D6 | **Video is allowed on every plan.** |
| D7 | **Trash keeps files 30 days**, then they are deleted permanently (only if still unused). |
| D8 | Usage is linked to **each plan's quotas** (section 6): total storage per plan, per-type file size per plan, editable by Super Admin per tier without code changes. |

## 1. Goal

One store-wide library where merchants upload, find, edit and reuse every image, video and document. Every place that takes media (products, variants, collections, categories, brands, branding, theme and page builder blocks) opens the **same picker** and stores a **reference to a `media` row** (never a copied URL). Editing alt text or replacing a file in the library updates every place it is used.

## 2. Research summary (what we take)

| Product | Take | Skip |
|---|---|---|
| Shopify Files | Flat library, search, type filter, sort, grid/table toggle, drag-drop upload anywhere, "Replace file" keeps every reference, "used in" references, bulk delete, inline alt text | Copy-URL-only embedding |
| WordPress Media Library | Attachment details side panel (title, alt, caption, dimensions, size, uploader, date), infinite grid, filter by type and date, "Unattached" filter | Generating many physical sizes per upload |
| Webflow / Framer | Upload progress chips, CDN responsive variants, AVIF/WebP delivery | Per-site asset copies |
| Cloudinary / Sanity | Focal point per image, duplicate detection by hash | Exposing transform URL syntax |

UX rules that come from this:
1. Upload from anywhere: library page drop zone, picker dialog, any media field.
2. One picker everywhere, with "Library" and "Upload" in the same dialog, so a merchant never leaves the form.
3. Never break a storefront: a used file cannot be deleted silently; it goes to Trash first and the "used in" list is shown.
4. Edit once, updated everywhere.
5. Fast at thousands of files: thumbnails only in lists, cursor paging, lazy images.

## 3. What exists today (verified in code, 2026-10-13)

| Piece | Where | State / problem |
|---|---|---|
| `media` tenant table | `packages/db/src/schema/catalog.ts` | id, storage_key, storage_connection_id, cf_image_id, mime, bytes, width, height, alt, folder, uploaded_by, timestamps. Missing kind, status, filename, title, duration, soft delete, hash |
| FK references to `media.id` | `product_media`, `variants.image_media_id`, `categories.image_media_id`, `collections.image_media_id`, `brands.logo_media_id` | Good: already reference-based |
| Presigned PUT + server proxy fallback | `packages/domain/src/media/storage.ts`, `media/connection.ts` (`uploadMediaDirect`), `apps/admin/src/lib/upload-media.ts`, `apps/web/src/server/api.ts` `POST /admin/media/upload` | Works, images only |
| Quotas | `packages/domain/src/system/quotas.ts` (`storage_mb`, `media_file_mb`, `assertStorageQuota`) | **Bug Q1:** `assertStorageQuota` runs only on the proxy path (`uploadMediaDirect`). The normal presigned path (`requestMediaUpload` + `createMediaRecord`) never checks quota. **Bug Q2:** `createMediaRecord` trusts the client's `bytes`; a client can declare 1 byte and upload 10 MB. **Gap Q3:** one `media_file_mb` for all types cannot express D5 |
| `listMedia` | `packages/domain/src/media-services.ts` | **Bug L1:** `total` is the page length. Offset paging. No search or filters |
| `deleteMediaRecord` | same | **Bug L2:** no usage check (FK error or broken image). **Bug L3:** deletes the storage object inside the DB transaction (rule 13) and deletes the object before the row is known to be deletable |
| Block editor host | `apps/admin/src/components/page-editor/host.ts` | Lists first 100 images only. Fixed in Phase 3 |
| Permissions | `packages/auth/src/permissions.ts` | Media uses `content.write`. Phase 1 keeps `content.write` for reads and writes (no new permission yet, to avoid a role migration) |
| Libraries in repo | `sharp` (image metadata), `@tanstack/react-table` (via `components/data-table`) | Reuse. No new dependency needed for Phase 1 |

## 4. Supported formats (Phase 1)

| Kind | Allowed MIME | Extensions | Max per file (default, all plans) |
|---|---|---|---|
| `image` | `image/jpeg`, `image/png`, `image/webp`, `image/avif`, `image/gif` | jpg, jpeg, png, webp, avif, gif | 5 MB |
| `video` | `video/mp4`, `video/webm`, `video/quicktime` | mp4, webm, mov | 10 MB |
| `document` | `application/pdf`, `text/csv`, `text/plain`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `...spreadsheetml.sheet`, `...presentationml.presentation` | pdf, csv, txt, docx, xlsx, pptx | 5 MB |

Not allowed: SVG (D3), HEIC (later, needs conversion), ZIP and executables, anything else.

Single source of truth: a `MEDIA_TYPES` table in `packages/domain/src/media/types.ts` (mime → kind, extensions, magic-byte signature). The contract (`packages/contracts`) exports the same list for the admin client's `accept` attribute and pre-checks. Do not hardcode MIME lists anywhere else; remove `ALLOWED_IMAGE_MIMES` usage from the media library path (keep the export for return photos, which are separate).

Validation runs three times:
1. **Client**: extension + MIME + size against the store's effective limits (fetched with the usage endpoint), so the merchant gets an instant, specific error.
2. **Server, before presign** (`requestUpload`): MIME allowed, kind derived from MIME, size ≤ per-kind quota, storage quota not exceeded.
3. **Server, after upload** (`create`, and the proxy path): `HeadObject` gives the **real** size (fixes Q2), the first 4 KB are read and checked against the magic-byte signature for the declared MIME. Mismatch or oversize → delete the object (job), insert nothing, return a clear error. For images, `sharp` reads width/height and these values replace any the client sent. For videos, width/height/duration come from the client (read from a `<video>` element before upload) and are stored as advisory; they are not trusted for any security decision.

Magic bytes (no new dependency, small table): JPEG `FF D8 FF`; PNG `89 50 4E 47`; GIF `47 49 46 38`; WebP `RIFF....WEBP`; AVIF `....ftypavif`/`ftypavis`; MP4/MOV `....ftyp` (brands isom, mp4*, avc1, qt, M4V); WebM `1A 45 DF A3`; PDF `25 50 44 46`; DOCX/XLSX/PPTX `50 4B 03 04` (zip; accept only with the matching office extension); CSV/TXT: no signature, reject if the first 4 KB contain a NUL byte.

Serving rules: documents other than PDF are served with `Content-Disposition: attachment`. All objects get `X-Content-Type-Options: nosniff` (set as object metadata on PUT where the driver supports it).

## 5. Schema design (Phase 1 migration)

Guidelines (apply to every change here):
- **Append-only migration**, next free number (currently `0056_media_library.sql`; check `packages/db/migrations` at build time, another branch may have taken it). Generated with the repo's drizzle workflow, then reviewed by hand.
- **Expand only.** All new columns are nullable or have defaults. No drop or rename (rule 10). `media.folder` stays.
- New tenant tables use **`tenantTable()`**, the migration runs **`forceRlsSql(name)`**, and references between tenant tables use **`tenantForeignKey`** (composite `tenant_id, id`) (rule 1).
- Grants follow existing migrations: `app_rw` gets SELECT/INSERT/UPDATE/DELETE on new tenant tables; `app_platform` as for `media`. Check `packages/db/test/b2-grants.int.test.ts` and extend it.
- Check constraints in SQL for enums (text + CHECK), as other tables do. No Postgres enums.
- Timestamps `timestamptz`, ids `uuidv7()`.

### 5.1 `media` (extend)

| Column | Type | Default | Notes |
|---|---|---|---|
| `kind` | text not null | `'image'` | CHECK in (`image`,`video`,`document`). Backfill from `mime` in the same migration (`video/%` → video, `image/%` → image, else document) |
| `status` | text not null | `'ready'` | CHECK in (`ready`,`trashed`). Phase 1 validates synchronously, so no `processing` state yet |
| `filename` | text | null | Original file name, max 255, shown and searchable. Backfill: last path segment of `storage_key` |
| `title` | text | null | Max 255 |
| `caption` | text | null | Max 1000 |
| `duration_ms` | integer | null | Video only, CHECK ≥ 0 |
| `sha256` | text | null | Hex. Phase 1 stores it when the proxy path has the bytes; used for duplicate hints later |
| `trashed_at` | timestamptz | null | Set when moved to Trash. `status='trashed'` ⇔ `trashed_at is not null` (CHECK) |
| `trashed_by` | uuid | null | Staff user id |
| `search` | tsvector GENERATED ALWAYS AS (`to_tsvector('simple', coalesce(filename,'') || ' ' || coalesce(title,'') || ' ' || coalesce(alt,''))`) STORED | | `simple` config: file names are not English prose |

Indexes:
- `media_tenant_status_created_idx (tenant_id, status, created_at desc, id desc)`: default listing and cursor paging.
- `media_tenant_kind_idx (tenant_id, kind, status)`.
- `media_search_idx` GIN on `search`.
- `media_tenant_trashed_idx (tenant_id, trashed_at) where trashed_at is not null`: trash sweep.

### 5.2 `media_usages` (new tenant table)

Records every place a media file is used, so the library can show "Used in", filter Used/Unused, block unsafe deletes, and later invalidate storefront caches.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk default uuidv7() | |
| `tenant_id` | uuid not null | from `tenantTable` |
| `media_id` | uuid not null | `tenantForeignKey` → `media`, **ON DELETE CASCADE** (usage rows die with the file; the owner's own FK decides whether the delete is allowed) |
| `owner_type` | text not null | CHECK in (`product`,`variant`,`collection`,`category`,`brand`,`page`,`theme`,`store_branding`) |
| `owner_id` | uuid not null | Id of the owning row (no FK: polymorphic) |
| `field` | text not null | e.g. `gallery`, `image`, `logo`, or a block path for pages |
| `created_at` | timestamptz not null default now() | |

Constraints and indexes: `unique (tenant_id, media_id, owner_type, owner_id, field)`; `index (tenant_id, owner_type, owner_id)`; `index (tenant_id, media_id)`.

Writing rules:
- A domain helper `syncMediaUsages(tx, ctx, { ownerType, ownerId, field, mediaIds })` replaces the rows for one (owner, field) with the given set. It is called **inside the same transaction** as the write that changes the reference.
- Phase 1 wires it into: `attachProductMedia` / `detachProductMedia` (`product`/`gallery`), variant image update (`variant`/`image`), collection, category and brand create/update (`image` / `logo`). Deleting an owner deletes its usage rows (in the owner's delete service).
- Pages, themes and store branding are wired in Phase 2/3.
- **Backfill** in the migration (SQL `INSERT ... SELECT` from `product_media`, `variants`, `collections`, `categories`, `brands`), so existing stores show correct usage on day one.

### 5.3 Quota rows (section 6) are seeded in the same migration.

## 6. Plan quota linkage (D5, D6, D8)

Quotas stay in the ADR-025 system: `quota_definitions` + `quota_tier_limits` per tier, `tenant_quota_overrides` per store, resolved by `resolveEffectiveQuota`. Super Admin already edits these in `/quotas`. The media library only **reads** them.

### 6.1 New quota keys (seeded in the migration, added to `PlanQuotaKey` and `DEFAULT_TIER_TABLE`)

| Key | Unit | Enforcement | XS | S | M | L | Meaning |
|---|---|---|---|---|---|---|---|
| `media_image_mb` | MB | hard | 5 | 5 | 5 | 5 | Max size of one image |
| `media_video_mb` | MB | hard | 10 | 10 | 10 | 10 | Max size of one video. `0` would disable video for a tier; all tiers get 10 (D6) |
| `media_document_mb` | MB | hard | 5 | 5 | 5 | 5 | Max size of one document |
| `storage_mb` | (exists) | hard | 1024 | 5120 | 25600 | 102400 | Total bytes of all non-purged media, **including Trash** (the files still occupy storage until purged) |

Insert into `quota_definitions` (and the legacy `tier_xs/s/m/l` columns, per ADR-025 write-through) and into `quota_tier_limits` for every **existing** tier row (`INSERT ... SELECT code FROM quota_tiers`), so custom tiers also get values. Use `ON CONFLICT DO NOTHING` so re-runs and Super Admin edits are safe.

`media_file_mb` is **no longer consulted** by the media library (it stays in the table; contract phase later, noted in the ADR). Return photos keep their own limit.

Effective limit for one upload = `resolveEffectiveQuota(tenant, "media_<kind>_mb")`. A per-store override in `tenant_quota_overrides` wins, as for every other quota.

### 6.2 Enforcement (fixes Q1, Q2, Q3)

New function in `quotas.ts`, replacing `assertStorageQuota` for the media library (keep the old one exported until the proxy path is migrated, then make it a thin wrapper):

```ts
assertMediaUploadQuota(db, tenantId, { kind, bytes }): Promise<void>
// 1. bytes <= media_<kind>_mb limit         else QuotaExceededError("media_<kind>_mb")
// 2. used_bytes + bytes <= storage_mb limit else QuotaExceededError("storage_mb")
//    used_bytes = SUM(bytes) FROM media WHERE tenant_id = $1   (trashed included)
```

Called at:
1. `requestMediaUpload` (before presigning), with the declared size.
2. `createMediaRecord` (after `HeadObject`), with the **real** size. If it fails here, enqueue `media.purge` for the uploaded object and throw.
3. `uploadMediaDirect` (proxy), with the real buffer length.

Race: two parallel uploads can each pass check 1 and together exceed storage by at most one file. Accepted for Phase 1 (check 2 runs again at `create`; the overshoot is bounded by concurrency × max file). Note it in the change record.

Errors: `QuotaExceededError` maps to HTTP 403 with code `QUOTA_EXCEEDED` and `quotaKey`, so the admin shows: "Videos can be up to 10 MB on your plan. This file is 14.2 MB." or "Your store has used 1.0 GB of 1 GB. Delete unused files or empty the Trash."

Checkout invariant (ADR-015) unchanged: media quotas never affect storefront reads or checkout.

### 6.3 Usage reporting

- `getTenantUsageReport` includes the three new keys (current value 0, they are per-file limits) and `storage_mb` as today.
- Settings > Storage (`admin.storageUsage.get`, `/settings/storage`) today reports `maxUploadBytes` from `media_file_mb`. Change it to report the three per-kind limits (additive contract field `maxUploadBytesByKind`; keep `maxUploadBytes` = image limit for compatibility) and link to Online Store > Media. Its "used" figure must match `admin.media.usage.usedBytes` (same query; share the function).
- New `admin.media.usage` procedure returns `{ usedBytes, limitBytes, trashedBytes, fileCount, limits: { image, video, document } (bytes) }` for the storage meter and client-side pre-checks. Reads only; `content.write`.

## 7. API (contracts first: `packages/contracts/src/admin.ts`)

All in `admin.media.*`, all through `requireAdmin` + `requirePermission("content.write")` in `apps/web/src/server/api.ts`, all logic in `packages/domain/src/media-services.ts` with `assertPermission(ctx, "content.write")` (rule 4).

| Procedure | Change | Input → output |
|---|---|---|
| `list` | **change** (keep old fields optional for compatibility) | `{ cursor?, limit (1-100, default 40), q?, kinds?: Kind[], usage?: 'any'\|'used'\|'unused', trash?: boolean (default false), sort?: 'newest'\|'oldest'\|'name'\|'largest' }` → `{ items: MediaItem[], nextCursor: string\|null, total: number }`. Cursor = opaque base64 of the sort key + id. `total` from a `count(*)` with the same filters (fixes L1). Search: `search @@ websearch_to_tsquery('simple', q)` **or** `filename ILIKE q%` (prefix match on names users type). Each item includes `usageCount` (subquery count from `media_usages`) |
| `get` | **new** | `{ id }` → `MediaItem & { usages: { ownerType, ownerId, field, label, adminPath }[] }`. Labels: product title, collection title, etc., resolved in one query per owner type |
| `usage` | **new** | see 6.3 |
| `requestUpload` | **change** | add kind validation and `assertMediaUploadQuota`. Output unchanged |
| `create` | **change** | input adds `filename`, `title?`, `durationMs?`; server derives `kind`, verifies real size + magic bytes (section 4) and quota, reads image dimensions with `sharp` (bytes fetched with ranged/whole GET; max 5 MB so whole GET is fine), writes `uploaded_by = ctx.userId`, audit log |
| `upload` (proxy) | **change** | same validation path as `create` (share one internal `finalizeUpload` function; do not duplicate) |
| `update` | **new** | `{ id, title?, alt?, caption? }` → `MediaItem`. Alt max 512. Audit log. Invalidate cache |
| `trash` | **new** | `{ ids: uuid[1..100] }` → `{ trashed: number, used: { id, usageCount }[] }`. Sets status/trashed_at. Allowed even when used (the file still exists and still renders), but the UI warns first. Audit log |
| `restore` | **new** | `{ ids }` → `{ restored: number }`. Audit log |
| `deletePermanent` | **new** (replaces `delete` behaviour; keep `delete` as an alias that calls `trash` for one id so old clients cannot hard-delete) | `{ ids }` → `{ deleted: number, blocked: { id, usages }[] }`. Only trashed items. **Refuses items with usages** (returns them in `blocked`); no force option in Phase 1. Deletes rows in a transaction, then enqueues `media.purge` with the storage keys **in the same transaction** (pg-boss, rule 13). Audit log |

`MediaItem` contract shape: `{ id, kind, mime, filename, title, alt, caption, bytes, width, height, durationMs, url, thumbnailUrl, status, trashedAt, usageCount, uploadedBy, createdAt, updatedAt }`. `thumbnailUrl` = CDN transform (`buildCloudflareImageTransformUrl`, width 320, `format=auto`, `fit=cover`) when a CDN base is configured, else `url`. Videos and documents: `thumbnailUrl` null (UI shows a type icon; video grid tiles use `<video preload="metadata" muted>` with `#t=0.1` only when hovered/visible, not by default).

Audit: every mutation writes `audit_logs` (`media.upload`, `media.update`, `media.trash`, `media.restore`, `media.delete`) with ids and, for update, a before/after of changed text fields (rule 6).

Cache: every mutation calls `invalidateCache(rt, ctx, { type: "media_updated" })` **after commit**. Phase 1 does not yet fan out to owners (Phase 2).

Isolation: every new procedure (`media.get`, `media.usage`, `media.update`, `media.trash`, `media.restore`, `media.deletePermanent`) is mapped in `packages/domain/test/isolation.int.test.ts` (otherwise CI heavy fails).

## 8. Jobs (`apps/worker`, ADR-006)

| Job | Trigger | Does |
|---|---|---|
| `media.purge` | enqueued by `deletePermanent`, by a failed `create` validation, and by the sweep | `{ tenantId, objects: { storageKey, storageConnectionId }[] }` → resolve driver per object (`resolveDriverForMediaRow`), delete, retry with backoff (pg-boss retryLimit 5). Missing object = success. Never touches keys outside `${tenantId}/` (assert prefix) |
| `media.trash-sweep` | pg-boss schedule, daily 03:30 IST | Per tenant: rows with `trashed_at < now() - 30 days` **and no usages** → delete rows, enqueue `media.purge`. Trashed-but-used rows are kept and logged (they need the merchant to remove the usage first). Writes one `audit_logs` row per tenant per run with the count (actor = system) |

## 9. Admin UI (Phase 1)

Follow `docs/admin-ui-standards.md`: shared kit only (`@bs/ui`, `components/data-table`, `simple-select`, `confirm-dialog`, `responsive-dialog`, `sheet`, `empty-state`, `info-tip`), no native `<select>`, no `window.confirm`, no hand-rolled table. Hints go behind an (i) info tip, not inline paragraphs.

### 9.1 Navigation
`apps/admin/src/routes/_store.tsx`, Online Store group: add `{ label: "Media", href: "/online-store/media", icon: Images, perm: "content.write" }` after Pages. Route file `apps/admin/src/routes/_store/online-store/media.tsx` with `pendingComponent` (rule 11). URL search params hold `view`, `q`, `kinds`, `usage`, `sort`, `trash` (shareable, back button works).

### 9.2 Page layout
- **Header**: "Media", storage meter (`1.2 GB of 5 GB used`, bar turns warning at 80%, danger at 95%; info tip lists per-type limits for this plan), primary "Upload files" button (opens file chooser, `multiple`, `accept` from the contract type list).
- **Tabs**: "All files" | "Trash (n)".
- **Toolbar** (data-table toolbar parts): search input (debounce 250 ms), type filter (Images / Videos / Documents, multi), usage filter (All / Used / Unused), sort (`simple-select`), view toggle **Grid | Table** (icon toggle; choice saved in `localStorage` key `bs.media.view`, wrapped in try/catch).
- **Grid view (D4)**: responsive columns (2 at 375 px, 4 at 768, 6 at 1280, 8 at 1600). Square tiles, `object-fit: cover` on `thumbnailUrl`, `loading="lazy"`, `decoding="async"`, explicit width/height. Video tiles: play badge + duration. Document tiles: file-type icon + extension label. Under the tile: filename (one line, ellipsis) and size. Checkbox visible on hover/focus and always when any item is selected; shift-click selects a range. Click opens the detail sheet. "Load more" via `IntersectionObserver` on a sentinel (cursor paging); skeleton tiles while loading.
- **Table view (D4)**: `DataTable` with columns: select, thumbnail (40 px), name, type, dimensions / duration, size, used in (count, links to the detail sheet), uploaded (relative date, full date in tooltip). Server-side sort and paging (cursor, "Load more" row or the data-table pager in cursor mode).
- **Bulk bar** (sticky at the bottom when items are selected): "n selected", Download (opens URLs; documents via attachment), Move to Trash (confirm-dialog; if any selected item is used, the dialog lists how many are used and says the storefront keeps showing them until removed). In Trash: Restore, Delete permanently (confirm-dialog; items still used are reported back as blocked with their "used in" list).
- **Drop zone**: dragging files anywhere over the page shows a full-page overlay "Drop files to upload". Non-file drags are ignored.
- **Upload tray** (bottom-right panel, stays open while the page is open): one row per file with name, progress bar (XHR upload progress events; `fetch` has no upload progress), cancel, retry, and the specific error ("Too large: videos can be up to 10 MB on your plan", "Not a supported file type", "Storage full"). Max 4 concurrent uploads, the rest queue. Files are pre-checked on the client against `admin.media.usage` limits before any request. New items are inserted at the top of the list as they finish (no full reload).
- **Empty state**: illustration-free `empty-state` with "Upload files" button and "or drop files here"; the supported types and limits are in an info tip.
- **Detail sheet** (`sheet` on desktop, full-screen `responsive-dialog` at < 768 px): preview (image fits; video `<video controls preload="metadata">`; PDF shows icon + "Open" link, no inline iframe in Phase 1; other documents icon + Download). Editable: Title, Alt text (with an info tip on why alt text matters; warning badge when an image has no alt), Caption. Save button (disabled until dirty). Read-only facts: file name, type, dimensions or duration, size, uploaded by, uploaded at. Actions: Copy link, Download, Move to Trash / Restore. **Used in** list: each entry links to the admin page of the owner (product, collection, …); "Not used anywhere" when empty.
- **Accessibility**: grid is a `role="grid"` or a list of buttons with visible focus; arrow keys move focus in the grid; space toggles selection; enter opens details; all icons have labels; the drop overlay announces via `aria-live`.
- **375 px**: toolbar wraps into search row + filter row; bulk bar is full width; sheet becomes full-screen.

### 9.3 Upload client
Rework `apps/admin/src/lib/upload-media.ts` into a small upload queue module (`apps/admin/src/lib/media-upload-queue.ts`) used by the library page now and the picker in Phase 2. Keep the existing `uploadMedia(file, options)` export working (it is used by product, collection, branding and page editor screens) by implementing it on top of the queue's single-file path. The client reads image/video dimensions and video duration before upload (via `createImageBitmap` / a detached `<video>` `loadedmetadata`) and passes them; the server overrides image dimensions with `sharp`.

## 10. Storefront and performance (Phase 1 scope)

- No storefront change in Phase 1, except that `listMedia`/`get` return `thumbnailUrl` built from the CDN transform helper.
- Admin targets (checked with seeded data in a heavy test or local run): `list` first page under 150 ms p95 with 10,000 media rows for one tenant on the local Postgres; no OFFSET queries; grid renders only loaded pages; images in grid ≤ 320 px wide.
- Uploads go browser → bucket (presigned PUT) when the bucket allows CORS, else the proxy (existing behaviour).

## 11. Phase 1 acceptance criteria (Claude verifies each)

Schema and quota
1. Migration is append-only, expand-only, numbered after the latest on `main`; `media_usages` uses `tenantTable`, `forceRlsSql`, `tenantForeignKey`; grants test updated and passing.
2. Existing media rows backfilled: `kind`, `filename`; existing product/variant/collection/category/brand image links appear in `media_usages`.
3. Quota keys `media_image_mb`, `media_video_mb`, `media_document_mb` exist for every tier with 5 / 10 / 5, visible and editable in Super Admin `/quotas` without code changes. A tenant override for `media_video_mb` takes effect on the next upload.
4. Presigned path enforces quota: a 6 MB JPEG and an 11 MB MP4 are refused at `requestUpload` with a `QUOTA_EXCEEDED` error naming the limit; a store at its `storage_mb` limit cannot upload. Declaring a small `bytes` and uploading a larger object is caught at `create` (real size via HeadObject), nothing is inserted, and the object is queued for purge. Real-DB test.
5. A file with a `.png` name/MIME whose bytes are a PDF is refused at `create`; SVG is refused at `requestUpload`.

API and domain
6. `list` returns correct `total`, stable cursor paging (no duplicates or gaps when 3 items are inserted between page fetches), search by filename prefix and title/alt words, kind/usage/trash filters, all four sorts. Real-DB test.
7. `get` returns "used in" with labels and admin paths for product, variant, collection, category, brand.
8. `trash` → `restore` round trip; `deletePermanent` refuses used items and reports them; deleting unused trashed items enqueues `media.purge` in the same transaction and the storage object is removed by the worker (test with the local storage driver).
9. Trash sweep deletes only items trashed > 30 days ago **and** unused. Real-DB test with backdated `trashed_at`.
10. Tenant isolation: tenant A cannot list, get, update, trash, restore, delete or see usage of tenant B's media; all new procedures mapped in `isolation.int.test.ts`; the purge job refuses keys outside the tenant prefix.
11. Every mutation writes `audit_logs`; cache invalidated after commit.

UI
12. "Media" appears under Online Store for users with `content.write`, not for others. `pendingComponent` present.
13. Grid and Table views both work, toggle persists across reloads; filters, search and sort are in the URL.
14. Uploading 12 mixed files (images, a video, a PDF, one oversize, one unsupported) shows per-file progress, 10 succeed and appear without reload, 2 show specific errors with retry/remove; at most 4 upload at once.
15. Detail sheet edits title/alt/caption and the change persists; "Used in" links open the right admin pages.
16. Bulk trash, restore and permanent delete work with `confirm-dialog`; the used-file warning appears.
17. Storage meter matches `admin.media.usage` and updates after uploads and permanent deletes.
18. Works at 375 px and desktop (Antigravity walks both and attaches screenshots to the change record).
19. Existing image uploaders (product gallery, collection, category, brand, branding, page editor) still work unchanged.

Gate
20. `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`, `pnpm --filter @bs/domain test:fast`, `pnpm --filter @bs/domain test:heavy` (or `test:heavy:local`), `pnpm --filter @bs/db` tests, admin tests: all green, counts pasted in the change record. `docs/ARCHITECTURE.md` (tables, routes, jobs), a new ADR `028-media-library.md` (usages table, per-kind quotas, trash, SVG off), change record, `progress.md` updated.

## 12. Later phases (not for Phase 1)

- **Phase 2: Shared picker and wiring** (spec and builder prompt: `docs/prompts/media-library-phase-2.md`). `MediaField`, `MediaGalleryField`, `openMediaPicker({ accept, multiple, max })` with Library + Upload tabs; replace uploaders on products (images + video in gallery, drag reorder), variants, collections, categories, brands, Settings > Branding (logo, favicon move to media ids, expand/contract); `syncMediaUsages` for branding; `replace` file (same id, new key, old object purged); cache fan-out from `media_usages` to owner tags; new `media.read`/`media.write`/`media.delete` permissions if the owner wants finer roles.
- **Phase 3: Theme and page builder.** Block editor host uses `openMediaPicker`; `video` and `file` block prop kinds (block version bumps, ADR-009); Video block (muted loop option, poster, `playsinline`, `preload="none"`); usage extraction from block JSON on page/theme save; reject media ids not in the tenant.
- **Phase 4: Performance and polish.** `mediaSrc`/`mediaSrcSet` helper with responsive widths and focal point; blur/dominant-colour placeholders; video poster frames (worker, ffmpeg); duplicate detection by sha256 ("Use existing"); focal point editor.
- **Phase 5 (owner decisions needed).** Folders, HEIC conversion, video transcoding/HLS provider, AI alt text, crop/rotate editor, larger video limits.
