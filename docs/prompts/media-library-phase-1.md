# Media Library: Phase 1 builder prompt (Online Store > Media)

Paste this whole file as the first message of a new coding session in the `bsec` repo. You are the builder for **Phase 1 only**. Claude Code verifies your work against the acceptance criteria and merges; you never merge your own PR.

## 0. Read first, in order
1. `AGENTS.md` (all of it: hard rules, verification gate, multi-agent rules).
2. **`docs/MEDIA-LIBRARY-PLAN.md`**: the spec. Sections 0 (owner decisions), 3 (current code and known bugs), 4 (formats and validation), 5 (schema), 6 (plan quotas), 7 (API), 8 (jobs), 9 (UI), 11 (acceptance criteria). Where this prompt and the plan disagree, the plan wins; raise the conflict in your change record.
3. `docs/ARCHITECTURE.md`, the latest files in `docs/changes/`, `progress.md` "In flight".
4. ADRs: `002` (tenancy/RLS), `006` (jobs), `013` and `025` (quotas), `015` (checkout invariant).
5. `docs/admin-ui-standards.md`, `docs/migrations.md`, `docs/FAST-LOCAL-TESTS.md`.
6. Code you will change: `packages/db/src/schema/catalog.ts`, `packages/domain/src/media-services.ts`, `packages/domain/src/media/{storage,connection}.ts`, `packages/domain/src/system/quotas.ts`, `packages/contracts/src/admin.ts` (`media` block), `apps/web/src/server/api.ts` (`admin.media` handlers and `POST /admin/media/upload`), `apps/admin/src/lib/upload-media.ts`, `apps/admin/src/routes/_store.tsx`, `apps/worker`, `packages/domain/test/isolation.int.test.ts`.
7. TanStack Router / Vite docs as installed in `node_modules` if unsure; do not rely on memory for versions.

## 1. Setup
- `git fetch`; create your **own worktree** `../bsec-media-p1` on branch `feat/media-library-phase-1` from `origin/main`.
- Add one line to `progress.md` "In flight": `Antigravity · feat/media-library-phase-1 · media library · 2026-10-13 · Phase 1: Online Store > Media (grid + table, trash, usages, per-kind plan quotas)`.
- Check `docs/changes/` and open branches for anyone touching `media`, `quotas.ts` or `api.ts` media handlers. If so, note it in your change record.

## 2. Objective
Build the store's Media library under **Online Store > Media** as specified: grid **and** table views, search/filter/sort, upload queue with progress, detail sheet with title/alt/caption and "Used in", Trash with 30-day sweep, a `media_usages` table, and **per-kind upload limits linked to plan quotas** (image 5 MB, video 10 MB, document 5 MB, all plans, editable per tier in Super Admin). SVG is **not** allowed. Folders are **not** in scope.

Also fix the bugs listed in plan section 3: Q1 (presigned uploads skip quotas), Q2 (client-declared size is trusted), Q3 (single file-size quota), L1 (wrong `total`), L2 (delete ignores usage), L3 (storage deleted inside the transaction).

## 3. Build order (contracts first, small commits)
1. **Migration + schema** (plan §5, §6.1): `media` new columns with backfill, `media_usages` (`tenantTable`, `forceRlsSql`, `tenantForeignKey`, grants), indexes, three new quota keys seeded for every existing tier (and legacy tier columns). Extend `b2-grants.int.test.ts`. Commit: `feat(db): media library columns, media_usages and per-kind upload quotas`.
2. **Types and validation** (plan §4): `packages/domain/src/media/types.ts` with `MEDIA_TYPES` and magic-byte checks + unit tests for each format, a mismatching file and an empty file. Export the client-side list from contracts.
3. **Quotas** (plan §6.2): `assertMediaUploadQuota`, new keys in `PlanQuotaKey`/`DEFAULT_TIER_TABLE`, `getTenantUsageReport`, Settings > Storage additive field. Real-DB tests: per-kind limit, tier change, tenant override, storage full (including Trash bytes).
4. **Contracts** (plan §7) for `list`, `get`, `usage`, `requestUpload`, `create`, `upload`, `update`, `trash`, `restore`, `deletePermanent`, and `delete` as a trash alias.
5. **Domain services**: one shared `finalizeUpload` used by `create` and the proxy path (HeadObject real size, magic bytes, `sharp` dimensions for images, quota, insert, audit). `syncMediaUsages` helper wired into product media attach/detach, variant image, collection, category, brand writes and their deletes. Cursor paging and search. Trash / restore / permanent delete with usage refusal.
6. **Jobs**: `media.purge` and `media.trash-sweep` (daily) in `apps/worker`, enqueued inside the business transaction (rule 13). Tenant-prefix guard.
7. **API handlers** in `apps/web/src/server/api.ts` (thin: parse, call service, map `QuotaExceededError` to 403 `QUOTA_EXCEEDED` with `quotaKey`, limit and size).
8. **Isolation test**: map every new procedure in `isolation.int.test.ts`; run that file.
9. **Admin UI** (plan §9): nav entry, route with `pendingComponent`, toolbar, grid view, table view (`DataTable`), view toggle persisted, URL search params, upload queue + tray (XHR progress, 4 concurrent, client pre-checks from `admin.media.usage`), drop overlay, detail sheet, bulk bar, Trash tab, storage meter, empty state, 375 px layout, keyboard support. Keep `uploadMedia()` working for existing screens.
10. **Docs**: ADR `docs/adr/028-media-library.md` (usages table, per-kind quotas replacing `media_file_mb` for media, trash + sweep, SVG off, `delete` becomes trash), `docs/ARCHITECTURE.md` (tables, route, jobs, quota keys; bump "Last verified"), change record, `progress.md`.

## 4. Rules that matter most here
- Rule 1: `tenantTable` + `forceRlsSql` + composite `tenantForeignKey`. Rule 2: no `drizzle-orm`/`@bs/db` imports in apps. Rule 3/4: logic and `assertPermission(ctx, "content.write")` in `packages/domain`. Rule 6: `audit_logs` on every mutation. Rule 10: append-only, expand-only migration. Rule 11: `pendingComponent`. Rule 13: storage deletion via pg-boss after commit. Rule 7: never log or return bucket credentials, endpoints or presigned URLs in logs.
- Admin UI kit only: no native `<select>`, no `window.confirm`, no hand-rolled tables. Hints go behind (i) info tips.
- **No new dependencies.** `sharp` and `@tanstack/react-table` are already in the monorepo. If you think you need one, stop and ask in the change record.
- Do not touch return-photo storage, payment, or shipping code.
- Test **only locally** (local Postgres, local storage driver or a test bucket). Never use the production store.
- Stage files by explicit path. Never `git add -A`, `git add .` or a directory. Read `git status` before each commit. Do not commit `routeTree.gen.ts`, `.env*`, `.turbo`, `dist`.
- Commit trailer: `Co-Authored-By: Antigravity <noreply@google.com>`.

## 5. Tests you must add (real database where marked)
- Unit: `MEDIA_TYPES` mapping and magic bytes for every allowed type; SVG refused; cursor encode/decode; client pre-check helper.
- Real DB (`*.int.test.ts`, `startTestDb`):
  - Quotas: 6 MB image and 11 MB video refused at `requestUpload`; tier change to `media_video_mb=20` allows 11 MB; tenant override wins; storage full refuses (Trash counted).
  - `create` with a declared size smaller than the real object is refused and nothing is inserted; a PDF renamed `.png` is refused.
  - `list`: total, cursor stability with inserts between pages, search, filters, sorts.
  - Usages: attach/detach product media, set/clear variant/collection/category/brand image update `media_usages`; migration backfill produces rows for seeded links.
  - Trash/restore; permanent delete refuses used items; purge job enqueued in the same transaction; sweep deletes only >30 days and unused.
  - Isolation: all new procedures cross-tenant denied.
  - Audit rows for every mutation.
- Admin: component tests if the admin package has a pattern for them; otherwise a local manual walkthrough (below).

## 6. Local walkthrough (attach evidence to the change record)
Run `pnpm --filter @bs/web dev`, `pnpm --filter @bs/admin dev`, the worker, local Postgres. At **375 px and desktop**:
1. Open Online Store > Media on an empty store: empty state, info tip with limits.
2. Upload 12 mixed files (jpg, png, webp, gif, mp4, mov, pdf, docx, one 6 MB jpg, one svg, …): progress, 4 at a time, specific errors for the oversize and the SVG, retry/remove.
3. Switch Grid ↔ Table, reload: view persists. Search by a file name, filter Videos, sort Largest, filter Unused.
4. Attach an image to a product (existing product screen), return to Media: it shows "Used in 1" and the detail sheet links to the product.
5. Edit alt text, reload: saved.
6. Trash the used image: warning shown; storefront still shows it. Try permanent delete: blocked with the product listed. Remove it from the product, then delete permanently: gone, and the object is removed by the worker.
7. Storage meter changes after uploads and deletes and matches Settings > Storage.
8. In Super Admin `/quotas`, set `media_video_mb` to 20 for the store's tier: an 11 MB video now uploads.
Screenshots (grid, table, detail sheet, upload tray with errors, 375 px) go in the change record.

## 7. Done means "ready to verify"
- Plan §11 acceptance criteria 1-20 each checked off in your change record with the evidence (test name, command output counts, or screenshot).
- Gate run and pasted: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`, `pnpm --filter @bs/domain test:fast`, `pnpm --filter @bs/domain test:heavy` (or `pnpm test:heavy:local`), `pnpm --filter @bs/db test`.
- Rebase on the latest `origin/main`, re-run the gate, push the branch, open a PR, mark your "In flight" line `[Ready for Claude verification]`.
- In the change record, list honestly: what you ran, what failed, what you did not test, and open questions (put anything the owner must decide there; do not guess).
