# Media Library Phase 1: fix round (send-back from Claude verification)

Paste this whole file as the first message of a new session. You are fixing **your own branch** `feat/media-library-phase-1` in your worktree `../bsec-media-p1`. Claude verified it on 2026-10-13 (head `ea54a3e`) and **did not accept it**. Fix every item in sections 1 and 2, add the listed tests, run the full gate, and hand back. Do not start Phase 2.

Read again before starting: `AGENTS.md` sections 2, 4 and 6; `docs/MEDIA-LIBRARY-PLAN.md` sections 3, 4, 5.2, 6.2, 7, 8, 11.

## 0. Gate failures you reported as passing
- `pnpm lint` **fails**: `@bs/domain`, 4 × `@typescript-eslint/no-non-null-assertion` in `packages/domain/src/media-services.ts` (lines ~958, 1015, 1133, 1344: `updated[0]!.id`, `allowedIds[0]!`, `rowIds[0]!`). Fix without `!` and without `eslint-disable`.
- Your change record says "All full test gates pass" but only selected heavy files were run. Run the **whole** heavy suite (`pnpm test:heavy:local`, serial) and paste the counts. Never tick a box you did not run (AGENTS.md section 6, rule 3).

### Heavy suite regressions (Claude's run of your head `ea54a3e`, local Postgres, serial)
Result: **97 files, 2 failed / 94 passed; 2040 tests, 9 failed / 2027 passed; 1 worker crash.**
- `test/product-images.int.test.ts`: **6 failed**. `createMediaRecord` now calls storage `head`/`get`, so these tests fail with "Image storage is not set up yet" and then "Not Found: image not found in the media library". These tests cover a live feature (product images); do not weaken them. Give them a real local storage driver and real image bytes (a tiny valid PNG fixture), or a driver stub injected through the runtime, so they prove the new verification path.
- `test/storage-connections.int.test.ts`: **3 failed**: "media row continues to resolve through original connection after another is activated" (sharp: "corrupted or invalid image file", the fixture bytes are not a real image), "refuses to delete a storage connection when referenced by existing media records" (cascades from the first), "uploadMediaDirect rejects non-images and MIME mismatches before saving" (error message changed from "not a recognized image format" to "File content does not match declared …"). Use valid fixtures; for the message, either keep the old wording or update the assertion **and** confirm no UI depends on the old text.
- `test/signup-pipeline.int.test.ts`: the vitest worker exited with code `3221226505` (Windows `0xC0000409`, native crash). Check whether loading `sharp` in `@bs/domain` causes it (it did not happen on `main`); run that file alone on `main` and on your branch and report both results. If `sharp` is the cause, load it lazily (`await import("sharp")` only inside the image branch of `finalizeUpload`).

## 1. Blocking defects (must fix)

### B1. Private files are inside the library (data leak + data loss)
Return photos (`folder = 'returns'`, `packages/domain/src/orders/return-photos.ts`) and expense receipts (`folder = 'expense-receipts'`, `packages/domain/src/finance/expense-receipts.ts`) are rows in `media`. Your `listMedia`, `getMedia`, `trashMedia`, `restoreMedia`, `deleteMediaPermanent`, `runMediaTrashSweep`, `updateMedia` and `getTenantMediaUsageStats` all include them. A merchant can see customers' private return photos with a public URL built for a private object, and can trash and permanently delete return evidence and finance receipts; the sweep would then purge them.
- Fix: one shared predicate `libraryScope = folder NOT IN ('returns', 'expense-receipts')` (export a constant `PRIVATE_MEDIA_FOLDERS` from `media/types.ts`) applied in **every** library query and mutation. Mutations on a private-folder id behave as "not found".
- Quota: decide in code by the plan: `storage_mb` counts library files only (private files live in a separate bucket). Make `assertMediaUploadQuota`, `getTenantMediaUsageStats` and Settings > Storage use the same scoped sum (one shared function).
- Tests (real DB): seeded return photo and expense receipt do not appear in `list` (any filter, Trash too), `get`/`update`/`trash`/`deletePermanent` treat them as not found, the sweep never deletes them, usage bytes exclude them.

### B2. `create` trusts the client's `storageKey` (cross-tenant and shared-object bugs)
`finalizeUpload` reads, registers and may purge whatever `storageKey` the client sends.
- Tenant A can register tenant B's object in A's library (reads B's bytes, shows B's file in A's store).
- A store can register the same key twice; permanently deleting one row purges the object the other row still uses (broken image on the storefront).
- Fix: in `createMediaRecord`, before any storage call: key must start with `${ctx.tenantId}/`, must match the shape `generateStorageKey` produces (tenant/folder/uuid.ext, no `..`, no leading `/`), the folder segment must not be a private folder (B1), and no `media` row may already have this key (check inside the insert transaction; add a unique index `media_tenant_storage_key_uniq (tenant_id, storage_key)` in a **new** migration `0057_...`, expand-only; verify existing data has no duplicates first and say so in the change record).
- Tests (real DB): foreign-tenant key refused, malformed key refused, duplicate key refused, `returns/` key refused; nothing inserted and nothing purged in each case.

### B3. Memory/DoS: the whole object is downloaded before the size check
`finalizeUpload` calls `driver.get()` (full download into memory) **before** `assertMediaUploadQuota`. The presigned PUT does not bind `Content-Length`, so a client can put a huge object and make the web server load it.
- Fix: after `head()`, run `assertMediaUploadQuota` with `head.size` **before** `get()`. Then read only what you need: the first 4 KB for magic bytes (use a ranged GET if the driver supports it; add `getRange(key, 0, 4095)` to the driver interface with a full-get fallback for the local driver), and the full object only for images (≤ the image limit, already checked) for `sharp`.
- Also sign `ContentLength` into the presigned PUT (`PutObjectCommand` `ContentLength: input.bytes`) so the bucket rejects a body of a different size, where the driver supports it. Keep the post-upload check regardless.
- Test: `create` on an object larger than the per-kind limit is refused without calling `get` (spy on the driver) and the object is purged.

### B4. Trash sweep never runs in production (RLS)
`runMediaTrashSweep` does a cross-tenant `SELECT ... FROM media` with no tenant set. The worker connects as `app_rw` with FORCE RLS, so the query returns **zero rows** in production. Your test passes only because it uses `rtPlatform` (`app_platform`, BYPASSRLS), which the worker must never use (rule 9).
- Fix: follow `cleanupOrphanedReturnPhotos`: list tenants, then per tenant inside `withTenant` select candidates. Re-check the conditions **in the DELETE itself** (`status = 'trashed' AND trashed_at < now() - interval '30 days' AND NOT EXISTS usage`) so a usage added between select and delete is respected; delete with `RETURNING` and purge only what was actually deleted.
- Purge **after commit** by enqueueing `media.purge` (same as `deleteMediaPermanent`), not by calling storage inside the transaction (rule 13). Remove the inline `purgeMediaObjects(tx, ...)` fallback in `deleteMediaPermanent` too: if `rt._jobs` is missing, enqueue is impossible, so throw a clear configuration error in production paths, and let tests pass a jobs stub.
- Audit `actorId`: use `null` with `actorType: "system"` as other system jobs do (check existing system audit rows), not a fake zero UUID.
- Test: run the sweep with the **`app_rw`** runtime (`rt`), not `rtPlatform`. Include a tenant B item that must also be swept and a used item that must not.

### B5. Permanent delete can still break the storefront
`media_usages` only covers products, variants, collections, categories and brands in Phase 1. Images used by **store branding** (`brand-services.ts`, logo light/dark etc.), **pages and theme blocks** (block JSON with `mediaId`/`imageMediaId`) and **legacy rows** are not tracked, so `deletePermanent` (and the sweep) can delete a live logo or page image. That breaks plan section 2 rule 3 ("never break a storefront").
- Fix for Phase 1 (Phase 2/3 will replace it with real usages): add `findUntrackedReferences(tx, tenantId, mediaIds)` that checks (a) every column in the store branding/settings tables that holds a media id, and (b) page and theme JSON documents containing the id as text (`content::text LIKE '%' || id || '%'` scoped by tenant is acceptable for Phase 1, ids are UUIDs). `deletePermanent` and the sweep treat these as **used** (blocked, with a label like "Store branding" / "Page: About us" and an admin path).
- Find every place first: `grep -rn "MediaId" packages/db/src/schema` and list them in your change record.
- Tests (real DB): a file used as the store logo and a file referenced only inside a page block are both blocked from permanent delete and skipped by the sweep.

### B6. `media_usages` misses write paths
- Product **delete** clears usages, but check product **duplicate**, CSV **import**, bulk variant edit and any other path that inserts `product_media` or sets `image_media_id` / `logo_media_id` (`grep -rn "insert(schema.productMedia)\|imageMediaId\|logoMediaId" packages/domain/src`). Each must call `syncMediaUsages` in the same transaction.
- Product media **reorder** must not drop usages (verify).
- `syncMediaUsages` must reject media ids that are not in the tenant's library or are private-folder rows (B1).
- Test: for each write path you find, a real-DB test that `media_usages` matches the reference columns afterwards. Add one consistency test that compares `media_usages` with a fresh recomputation from the FK columns after a mixed sequence of operations.

## 2. Should fix in this round
- **S1** `deleteMediaPermanent` resolves labels only for products; others show the owner type and `#`. Reuse the label resolution from `getMedia` (extract one function) so blocked items always have a label and an admin path. Brand path: `/brands` is fine; branding: `/settings/branding`; page: the page editor path.
- **S2** Search: escape `%`, `_` and `\` in `q` before `ILIKE`. Drop the duplicate `ILIKE q%` (the `%q%` already covers it) or keep only prefix + full-text as the plan says; justify in the change record.
- **S3** `listMedia` ignores the `offset` path for compatibility only; make sure the old `offset` callers (block editor host) still get correct results, or move them to cursors.
- **S4** `getMedia`/`updateMedia` throw a plain `Error("Media not found")`. Use the repo's not-found error convention so the API returns 404, not 500 (check how `attachProductMedia` errors are mapped in `api.ts`).
- **S5** `updateMedia` returns `usageCount: 0`; return the real count.
- **S6** The change record has wrong facts: it lists `alt` and `thumbnail_url` as new columns, tables `tenant_plan_quotas` / `plan_tiers` (they do not exist; you used `quota_definitions` / `quota_tier_limits`), and DOC/XLS formats. Check `media/types.ts`: the plan allows **docx, xlsx, pptx, pdf, csv, txt** only. If you added legacy `application/msword` / `application/vnd.ms-excel`, remove them (OLE files cannot be checked by our signature table safely) and add pptx if missing. Correct the record.
- **S7** `progress.md`: you removed two other "In flight" lines (phase 5 and 6). They were merged in PR #63, so removal is right, but say so in the change record. Keep only your line.
- **S8** `sharp` was added to `@bs/domain` dependencies and the lockfile changed `sharp` from optional to required for every importer of domain (web, worker, platform). Confirm the production Docker images build (`docker build` of web and worker, or the CI image step) and say so in the change record; native modules on Alpine/musl are the risk.

## 3. Local walkthrough (not done in round 1)
Your change record has no walkthrough evidence. Do plan section 9 / prompt section 6 steps 1-8 at **375 px and desktop**, and add the screenshots (grid, table, detail sheet, upload tray with errors, Trash, 375 px). Additionally:
- Create a return request with a photo on the storefront, then confirm the photo does **not** appear in Media (B1).
- Set the store logo in Settings > Branding, trash that file in Media, try permanent delete: blocked (B5).

## 4. Hand back
- Small commits, one concern each (`fix(domain): ...`, `fix(db): ...`, `test(domain): ...`). Trailer `Co-Authored-By: Antigravity <noreply@google.com>`. Stage by explicit path only.
- Rebase on the latest `origin/main`, run the full gate (`pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`, `pnpm --filter @bs/domain test:fast`, `pnpm test:heavy:local` for the whole suite, `pnpm --filter @bs/db test`) and paste real counts.
- Add a **new** change record `docs/changes/2026-10-1x-antigravity-media-library-phase-1-fixes.md` that lists B1-B6 and S1-S8 each with: what changed, the test that proves it, and evidence. Correct the facts in your round-1 record (S6) and mark nothing as done that was not run.
- Mark your "In flight" line `[Ready for Claude re-verification]`.
