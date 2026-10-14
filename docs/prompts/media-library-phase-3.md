# Media Library Phase 3: theme and page builder (builder prompt)

Paste this whole file as the first message of a new coding session in the `bsec` repo. You are the builder for **Phase 3 only**. Claude Code verifies against section 8 and merges; you never merge your own PR.

## 0. Read first, in order
1. `AGENTS.md` (hard rules, gate, multi-agent rules).
2. `docs/MEDIA-LIBRARY-PLAN.md` (owner decisions in section 0 still apply: flat library, SVG off, limits 5/10/5 MB, 30-day Trash, video on all plans).
3. `docs/adr/028-media-library.md`, `docs/adr/029-media-picker-and-usages.md`, `docs/adr/009-*` (block versioning), `docs/adr/010-*` (no merchant code), and the change records `docs/changes/*media-library*` (what Phases 1 and 2 shipped and what Claude found and fixed in review).
4. `docs/ARCHITECTURE.md`, `docs/admin-ui-standards.md`, `docs/migrations.md`, `progress.md` "In flight".
5. Code you will touch: `packages/blocks/src/{registry.ts,views.tsx,types.ts,document.ts,render.ts,sanitize.ts}`, `packages/block-editor/src/{MediaField.tsx,context.tsx,config.tsx,BlockEditor.tsx}`, `apps/admin/src/components/page-editor/{host.ts,PageVisualEditor.tsx}`, `apps/admin/src/components/media/*`, `packages/domain/src/content-services.ts`, `packages/domain/src/themes/{library.ts,system-pages.ts,block-data.ts}`, `packages/domain/src/media/untracked-references.ts`, `packages/domain/src/media-services.ts`, `packages/domain/src/cache-invalidation.ts`, `packages/domain/src/saas/provisioning.ts`.

## 1. Setup
- Phases 1 and 2 are merged to `main`. `git fetch`, create your **own worktree** `../bsec-media-p3` on branch `feat/media-library-phase-3` from `origin/main`.
- Add to `progress.md` "In flight": `Antigravity · feat/media-library-phase-3 · media library · <date> · Phase 3: block editor picker, video/file props, page and theme usages`.
- Check `docs/changes/` and open branches for overlap with the page editor, blocks, themes and pages.

## 2. Goal
Images, videos and documents used inside **pages, theme sections, header/footer and product/collection templates** come from the same Media library, are tracked in `media_usages` (so "Used in" is complete and deleting a used file is blocked by real data, not by a text scan), and the block editor uses the shared picker with search, paging and upload instead of a 100-image list. Phase 4 (performance helpers, focal point, duplicate detection) is **not** in scope.

## 3. Facts about the current code (verified 2026-10-14, re-verify)
- `packages/block-editor/src/MediaField.tsx` is a hand-rolled picker: it calls `host.listMedia()` (admin host returns the **first 100 images only**) and `host.uploadMedia()`, images only.
- Block props that hold library ids today (`packages/blocks/src/registry.ts`): `backgroundMediaId` (several blocks), `avatarMediaId` (testimonials), gallery items `{ mediaId, caption, link }`, Image `mediaId`, header/footer `logoMediaId`, and others. Check **every** block schema for keys containing `media` (case-insensitive) before you start and list them in your change record.
- The existing **Video block** takes only `url` (YouTube, Vimeo or `.mp4` link) and renders `<video controls preload="none">` for direct files. `bgVideoUrl` on the hero is also a URL.
- Pages are stored as `page_versions.document` (jsonb); `pages.draft_version_id` / `pages.published_version_id` point at the current draft and published versions. Themes keep `themes.tokens` (jsonb). Header, footer, product, collection and cart templates are also `page_versions` (see `themes/system-pages.ts`, `themes/library.ts`, `saas/provisioning.ts`).
- Page writes happen in `content-services.ts` (`createPage`, `updatePage`, `savePageDraft`, `publishPage`, `rollbackPage`, `unpublishPage`, `duplicatePage`, `deletePage`, `updateTheme`), `themes/library.ts` (activating or customising a theme library item) and `saas/provisioning.ts` (new store seed pages).
- Today only `findUntrackedReferences` (a text scan of `page_versions.document` and `themes.tokens`) protects media used in blocks. It stays as a safety net in this phase.

## 4. Slices (small commits, contracts first, in this order)

### S1. One extractor for media ids in block documents (pure, tested)
In `packages/blocks`, add `collectMediaIds(document): { images: string[]; videos: string[]; files: string[]; all: string[] }` (name as you like, one exported function). Rules:
- Walk the whole document generically. A value is a media reference when its key is `mediaId`, ends with `MediaId`, is `mediaIds` (array), or it is an object inside an array whose key `mediaId` is set (gallery items). Ignore everything else (`url`, `href`, `bgVideoUrl`).
- Deduplicate, ignore empty strings, ignore anything that is not a UUID string.
- **Guard test (important):** a unit test iterates **every block schema in the registry**, builds a document with a UUID in every field whose key contains "media" (case-insensitive), and asserts the extractor finds them all. A future block with a new media key that the extractor misses must fail this test.
- Unit tests for nesting, arrays, header/footer blocks, and junk input.

### S2. Block editor picker (replace the 100-image list)
- `BlockEditorHost` (`packages/block-editor/src/context.tsx`): add `pickMedia?: (opts: { accept: ("image"|"video"|"document")[]; multiple?: boolean; selected?: string[] }) => Promise<MediaAsset[]>`. Extend `MediaAsset` with `kind`, `filename`, `mime`, `thumbnailUrl?`. The `block-editor` package must stay app-agnostic: it imports nothing from `apps/admin`.
- `MediaField.tsx`: when `host.pickMedia` exists, "Choose" calls it (single or multiple, with `accept` by field kind); keep the thumbnail, change and remove actions and the per-field "alt" behaviour. When the host has no `pickMedia` (Super Admin theme templates: no store), keep today's placeholder message. Remove `listMedia` and `uploadMedia` from the admin host once nothing uses them (keep the optional members in the interface only if Super Admin still needs them).
- Admin: implement `pickMedia` in `apps/admin/src/components/page-editor/host.ts` by opening the shared `MediaPickerDialog` from Phase 2 through a small promise-based mount inside `PageVisualEditor` (one dialog instance, resolved with the selection, rejected/empty on close). The dialog must work inside the Puck editor (focus, z-index above the editor panels, Escape closes only the dialog) and at 375 px.
- Field kinds in the block editor config: `mediaField` (image), `videoMediaField`, `fileMediaField`, `galleryMediaField` (multiple). Reuse one implementation with an `accept` parameter.

### S3. Video and file in blocks (block changes, ADR-009)
Follow AGENTS.md "new block = schema + view + registration + editor config + tests". Optional fields with defaults do not need a version bump; check `registry.ts` rules at the top of the file and bump the version only when the shape changes incompatibly.
- **Video block**: keep `url` (YouTube/Vimeo/direct link) and add optional `mediaId` (a library video) and `posterMediaId` (library image). Rule: if `mediaId` is set it wins over `url`. Library video renders `<video controls playsInline preload="none" poster=...>`; never autoplay with sound. Optional `autoplayLoop` boolean (default false) that renders `muted loop autoplay playsInline` only when true, for silent decorative clips. The editor shows a "Video source" choice (Library or Link) so one block cannot be both. Missing/deleted media renders the existing placeholder, never a broken player. Update `sanitize.ts`/schema checks so only same-tenant UUIDs are accepted here.
- **File download block** (new, e.g. `FileDownload`): label, optional description, `mediaId` (document kind), shows file name, type and size from render data, links with `download`. Add to the block registry, editor config (category "content"), views, sample data, and tests. Documents other than PDF must be served as attachments (verify what object metadata the storage driver sets; if `Content-Disposition` is not set, add it in the presign/put paths for document kinds and note it in the change record).
- **Gallery** and **Image** blocks: use the multiple/single picker; gallery stays images only in this phase.
- Render data: the code that resolves `media: Record<string,string>` for blocks (`themes/block-data.ts`, `loadRenderData` in the admin host, storefront page loaders) must resolve **all** ids returned by `collectMediaIds` in **one query**, including video, poster and file ids, and return `kind`, `filename`, `bytes`, `mime` for file blocks. Unknown or trashed-then-deleted ids resolve to nothing (placeholder), not an error.

### S4. Usage tracking for pages and themes
- Domain helper `syncDocumentMediaUsages(tx, ctx, { ownerType: "page" | "theme", ownerId, field: "draft" | "published" | "tokens", document })`: computes `collectMediaIds`, **diffs** against the current `media_usages` rows for that (owner, field) and writes only the changes (insert missing, delete stale). Same transaction as the page/theme write.
- Wire it into every write path listed in section 3: draft save (`field = draft`), publish (copy: `published` = the draft's ids), rollback (restores that version into draft and published as the code does), unpublish (clear `published`), duplicate (new page gets its own rows), create, delete (clear all rows for the page), `updateTheme` (`tokens`), theme library activation/customisation, store provisioning. Header/footer/product/collection templates use `ownerType = "theme"` with the template's page id as `ownerId` and `field = draft|published`, or `page` if they are rows in `pages`: pick one convention, write it in ADR-030, and be consistent.
- **Validation on save:** every media id that is **newly added** by this save must exist in the caller's tenant library, be outside `PRIVATE_MEDIA_FOLDERS`, not be trashed, and match the kind the field expects (image field → image, video → video, file → document). Reject the save with a `Bad Request` that names the field. Ids that were already in the previous version are tolerated (so an old page is never locked because a file was later trashed).
- **Backfill:** an idempotent domain function `backfillDocumentMediaUsages(db, tenantId?)` and a worker job `media.backfill_usages` that runs it per tenant under `withTenant` as `app_rw` (the worker must never use the platform role). Enqueue it once at worker start with a pg-boss `singletonKey` so it does not pile up. No SQL jsonb walking in a migration. If the schema needs nothing new, add **no** migration; if it does, next free number, expand-only.
- Labels and paths in "Used in": `page` → page title, `/online-store/editor/{pageId}`; `theme`/templates → template name, `/online-store/theme-library`; update `resolveUsageLabel` and the `deleteMediaPermanent` blocked list. `findUntrackedReferences` stays as a safety net; add a test that for a sample of pages the usages and the text scan agree.

### S5. Cache fan-out for pages and themes
- Phase 2's `invalidateMediaCache` already maps `page` and `theme` owners to tags. Verify each owner type reaches the **actual** tags the storefront uses for: a page by path, the home page, header, footer, product/collection/cart templates. Where a tag does not exist, add it in `cache-invalidation.ts` (rule 5, tenant-prefixed) and make the page/theme loaders use it.
- Replacing or editing a file used in a hero/gallery/video block must refresh the storefront page and the shared header/footer without a redeploy. Test the computed tags for each owner type.

### S6. Cleanup
- Remove dead code you replaced (the old `MediaField` list/upload code, `host.listMedia` if unused, the `uploadMedia` import in the page-editor host).
- Docs: `docs/ARCHITECTURE.md` (blocks, media, jobs, usages for pages and themes), ADR `docs/adr/030-media-in-blocks.md` (extractor convention, owner/field conventions, validation of new ids only, backfill job, Video/File block rules), `docs/changes/` record, `progress.md`. `DEPLOYMENT.md` only if env/config changes (none expected).

## 5. Rules that matter most
- `AGENTS.md` rules 1-6, 8, 10, 11, 13. Rule 8: **no merchant-controlled code**: media ids are UUIDs, never URLs, HTML or CSS; the new blocks take enumerated props only.
- Contract first, handler, domain service, UI. Any new `admin.*` procedure is mapped in `packages/domain/test/isolation.int.test.ts`; if you add none, say so.
- **No `!` non-null assertions, no `eslint-disable`, no `@ts-ignore`.** Phase 1 failed lint on exactly this.
- No new dependencies without a stated reason. Do not touch payments, shipping or return photos.
- Test only locally. Stage files by explicit path; never `git add -A`.
- Commit trailer: `Co-Authored-By: Antigravity <noreply@google.com>`.

## 6. Tests you must add
- Unit (`packages/blocks`): `collectMediaIds` cases and the registry guard test (S1); Video and File block schema, view and sanitize tests; Video renders library file, link, and placeholder correctly.
- Real DB (`*.int.test.ts`):
  - Usages for page draft, publish, rollback, unpublish, duplicate, delete, create, and theme/template saves; the diff writes only changes (assert row counts and that unrelated usages survive).
  - Validation: newly added foreign-tenant, private-folder, trashed, wrong-kind and non-UUID ids are rejected with the field named; an id that was already present and later trashed does not block a save.
  - Backfill: seeded pages and theme tokens produce the expected usages; running it twice changes nothing; it runs as `app_rw` (use the app_rw runtime in the test, not the platform one).
  - `deleteMediaPermanent` and the trash sweep block files used only inside a page block, with the page title in the blocked list.
  - Cache: tags for page, home, header, footer and template owners after `updateMedia` / `replaceMedia`.
  - Render data: one query resolves image, video, poster and file ids; a missing id yields a placeholder, not an error.
- Admin component tests where the repo has a pattern; the rest through the walkthrough.

## 7. Local walkthrough (required evidence)
Run web, admin and worker against local Postgres with a **real local storage driver and real seeded files** (PNG, MP4, PDF). **375 px and desktop, a different screenshot per step** (earlier rounds had duplicate and blank screenshots):
1. Page editor: add an Image block, open the picker (library search, filter by type, upload tab), choose, save; the storefront page shows it.
2. Gallery block with 3 images; Hero background image; Testimonial avatar.
3. Video block: Library source with a poster; Link source; both render on the storefront; no autoplay with sound.
4. File download block with a PDF; the storefront link downloads it.
5. Media > that image shows "Used in: <page title>"; trash it, try permanent delete: the blocked result with the page named is **visible** in the screenshot.
6. Replace the file in Media; the storefront page shows the new file after refresh (cache fan-out), including a header/footer logo case.
7. Page with more than 100 library images: the picker still finds an old image by search.
8. Super Admin theme template editor still opens and shows the "stores add their own images" message (no picker).

## 8. Acceptance criteria (Claude checks each)
1. The block editor picks media through the shared picker (search, paging, upload, type filter); the 100-image list is gone; Super Admin template editing still works.
2. `collectMediaIds` finds every media reference in every registry block (guard test), and nothing else.
3. Pages, header/footer, templates and theme tokens write correct `media_usages` on every write path in section 3, with diffed writes, validated new ids, and an idempotent `app_rw` backfill job.
4. "Used in" lists pages and templates with working links; permanent delete and the sweep are blocked by usages for block-only files.
5. Video block supports library video and poster (and keeps links); File download block works; both are schema + view + registration + editor config + tests; no merchant code can enter.
6. Editing or replacing a file refreshes the storefront for pages, home, header, footer and templates (tags verified in tests and the walkthrough).
7. Real-DB tests for everything in section 6; all new procedures (if any) in the isolation suite.
8. Gate with real counts pasted: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`, `pnpm --filter @bs/domain test:fast`, whole heavy suite serial (`pnpm test:heavy:local`), `pnpm --filter @bs/db test` (set `TEST_PG_ADMIN_URL` for the local Postgres), `pnpm --filter @bs/admin test:fast -- --no-file-parallelism`, and the blocks and block-editor package tests.
9. ARCHITECTURE, ADR-030, change record with a checklist ticked **only** for what you ran, `progress.md`.
10. Works at 375 px and desktop; walkthrough evidence per section 7.

## 9. Hand back
Rebase on the latest `origin/main`, run the full gate, push the branch, open a PR, mark your "In flight" line `[Ready for Claude verification]`. State plainly in the change record what you ran, what failed, what you did not test, and any owner questions. Do not claim "verified" for anything you did not run.
