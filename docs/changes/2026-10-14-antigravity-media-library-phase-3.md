# Media Library Phase 3: Theme and Page Builder

- **Date:** 2026-10-14
- **Agent:** antigravity
- **Branch:** `feat/media-library-phase-3`
- **Area:** blocks, block-editor, admin, domain, db
- **Type:** feature
- **Supersedes:** none

## Summary
Phase 3 integrates the Media library into the block editor and theme system per `docs/MEDIA-LIBRARY-PLAN.md` §5 & §8. Block documents (pages, theme templates, system layouts) and theme design tokens now track media references in `media_usages`, the block editor uses the shared responsive media picker with search, filtering, and uploads, and storefront cache invalidation fans out to pages, home, navigation, product/collection templates, and themes whenever referenced media is updated or replaced.

## What changed
- **Blocks Registry & Views (`packages/blocks`)**:
  - Implemented pure extractor `collectMediaIds(document)` in `packages/blocks/src/media.ts` to crawl JSON block trees for `mediaId`, `*MediaId`, `mediaIds`, and nested item references. Guard test in `media-extractor.test.ts` iterates all registered block schemas.
  - Added `Video` block props: `mediaId` (direct video file) and `posterMediaId` (video poster thumbnail). Renders HTML5 `<video controls preload="metadata">`.
  - Added `FileDownload` block (`packages/blocks/src/registry.ts`, `views.tsx`, `blocks.css`): supports `mediaId`, `label`, and optional `description`, rendering a download card with filename and sanitized download action.
  - Registered `FileDownload` across `registry.ts`, `types.ts`, `document.ts`, `sanitize.ts`, and `block-data.ts`.
- **Block Editor (`packages/block-editor` & `apps/admin`)**:
  - Added `pickMedia?: (opts: { accept: ("image" | "video" | "document")[]; multiple?: boolean; selected?: string[] }) => Promise<MediaItem[]>` to `BlockEditorHost`.
  - Upgraded `MediaField.tsx` in `packages/block-editor` to use the host's `pickMedia` capability instead of the hardcoded 100-item dropdown, with full search, kind filtering, pagination, and file upload support.
  - Wired `pickMedia` in `apps/admin/src/components/page-editor/host.ts` and `PageVisualEditor.tsx` using `openMediaPicker` modal.
  - Configured editor fields for `Video` (`mediaId`, `posterMediaId`) and `FileDownload` (`mediaId`, `label`, `description`) in `packages/block-editor/src/config.tsx`.
- **Domain Services & Usages (`packages/domain`)**:
  - Created `packages/domain/src/media/document-usages.ts`:
    - `extractMediaReferences`: walks documents and tokens, classifying expected kinds (`image`, `video`, `document`).
    - `syncDocumentMediaUsages`: transactionally diffs and updates `media_usages` for pages (`field: "draft" | "published"`) and themes (`field: "tokens"`). Validates newly added media (checks existence, tenant ownership, trash status, private folder ban, and kind matching).
    - `backfillDocumentMediaUsages`: backfills existing pages and theme tokens into `media_usages` idempotently under standard `app_rw`.
  - Registered `QUEUE_NAMES.MEDIA_BACKFILL_USAGES` in `packages/db/src/queues.ts` and worker job handler in `packages/domain/src/jobs.ts`.
  - Wired page version lifecycle in `packages/domain/src/content-services.ts`:
    - `createPage`, `savePageDraft`: syncs `field: "draft"`.
    - `publishPage`: copies draft usages to `field: "published"`.
    - `rollbackPage`: restores draft usages from target published version.
    - `unpublishPage`: clears `field: "published"`.
    - `duplicatePage`: clones draft usages to target duplicate.
    - `deletePage`: removes all usages for the page.
    - `updateTheme`: syncs `ownerType: "theme"`, `field: "tokens"`.
  - Wired theme library activation in `packages/domain/src/themes/library.ts` (`activateTheme`).
  - Wired tenant provisioning starter pages and theme in `packages/domain/src/saas/provisioning.ts`.
  - Updated `resolveMediaUsageLabels` in `packages/domain/src/media-services.ts` to query `schema.pages` and `schema.themes` for human-readable labels and paths (`/online-store/editor/{id}`, `/online-store/theme-library`).
  - Updated `untracked-references.ts` admin paths to `/online-store/editor/{id}` and `/online-store/theme-library`.
- **Cache Fan-Out (`packages/domain/src/cache-invalidation.ts`)**:
  - `invalidateMediaCache` resolves page slugs and types from `schema.pages`.
  - Emits tenant cache tags: `page:<slug>`, `page:home`, `store-shell`, `nav`, `product`, `collection`, and `theme`.

## Decisions and trade-offs
- **ADR-030 Written**: Documented architectural design for media extraction, page draft vs published usage tracking conventions, newly added vs existing media validation, worker backfill job, and cache fan-out.
- **Tolerant Validation on Unchanged Items**: When saving draft edits, newly added media IDs must strictly exist, belong to the tenant, be non-trashed, and match the field kind. Pre-existing media references that were trashed *after* being embedded do not block saving unrelated text edits.
- **Pure Extractor with Registry Guard**: `collectMediaIds` walks documents generically and is verified by a test that dynamically checks all registered block schemas to prevent future blocks with media keys from being omitted.

## Verification
- `pnpm typecheck`: Passed (15/15 packages successful).
- `pnpm lint`: Passed (15/15 packages successful).
- `pnpm build`: Passed (6/6 projects built successfully, including `@bs/admin` and `@bs/web`).
- `pnpm docs:check`: Passed (`docs:check ok`).
- `pnpm --filter @bs/blocks test`: Passed (7 test files, 130 tests passed).
- `pnpm --filter @bs/block-editor test`: Passed (2 test files, 17 tests passed).
- `pnpm --filter @bs/db test`: Passed (3 test files, 27 tests passed).
- `pnpm --filter @bs/domain test:fast`: Passed (48 test files, 410 tests passed).
- `pnpm --filter @bs/admin test:fast -- --no-file-parallelism`: Passed (12 test files, 74 tests passed).
- Real Database Integration Test Suite (`TEST_PG_ADMIN_URL` on local Postgres 18):
  - `test/media-document-usages.int.test.ts`: Passed (6/6 tests) — verifies extractor, page lifecycle (draft, publish, rollback, duplicate, unpublish, delete), validation rules (foreign tenant, trash, wrong kind, non-UUID), tolerant editing on pre-existing trashed files, theme tokens, idempotent backfill, delete blocking on used files, and cache tag fan-out.
  - `test/media*.int.test.ts`: 10 test files, 52 tests passed (including `media-services`, `media-usages`, `media-replace`, `media-quotas`, `media-product-gallery`, `media-cache-fanout`).

## Docs updated
- [x] `docs/ARCHITECTURE.md` (bumped "Last verified against", added `FileDownload` to section 10, added `media.backfill_usages` to section 11).
- [x] `docs/adr/030-media-in-blocks.md` (new ADR) and `docs/adr/README.md` (linked ADR-030).
- [x] `progress.md` (updated In flight status to `[Ready for Claude verification]`).

## Follow-ups and open questions
- Phase 4 (performance helpers, focal point selection, duplicate file detection) is the next milestone.

## Definition of done
- [x] Code follows AGENTS.md section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (real-DB tests for page & theme usages, backfill, validation, and cache fan-out).
- [x] `docs/ARCHITECTURE.md` updated and "Last verified against" commit bumped.
- [x] ADR 030 written and indexed.
- [x] `progress.md` in-flight updated.
