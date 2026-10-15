# Blog system, Phase 1: data, domain, scheduling job, real sitemap

- **Date:** 2026-10-15
- **Agent:** claude
- **Branch:** `feat/blog-system` (not merged yet)
- **Area:** db, domain, blocks, docs
- **Type:** feature
- **Supersedes:** none

## Summary
First phase of `docs/BLOG-PLAN.md` (ADR-033): storage, domain services, the scheduled-publish job and the sitemap fix. No admin screens, contracts, blocks or storefront routes yet (Phases 2-4), so nothing a shopper or merchant sees has changed, except that the sitemap no longer lists three posts that never existed.

## What changed
- Migration `0061_blog`: `blog_categories` (parent and child), `blog_posts` (draft / scheduled / published), `blog_slug_redirects`, `store_settings.blog_settings`, and `media_usages` owner types `blog_post` and `blog_category`. All three tables have forced RLS and composite foreign keys.
- `packages/domain/src/blog/`: categories (depth 2, move-on-delete), posts (create, update, publish, schedule, unpublish, duplicate, delete, list, get), storefront queries (single visibility rule, categories tree, recent-posts widget query, sitemap), settings, the due job. All admin writes need `content.write`, audit and invalidate after commit.
- Blog body sanitiser `sanitizeBlogHtml` in `@bs/blocks`: no scripts, iframes, classes, styles or handlers; h1 becomes h2; images only from the store's own media (`data-media-id`, `src` rebuilt server side); external links `rel="noopener nofollow"`. Heading ids, plain text, reading time are derived on write.
- Cache: tag kind `blog`; events `blog_post_changed`, `blog_category_changed`, `blog_settings_changed` (also refresh home, nav, seo).
- Queue `blog.publish_due` (every minute): flips scheduled posts whose time has come and audits them.
- Sitemap: `STATIC_BLOG_POSTS` removed; real visible, indexable posts and categories with a post are listed.

## Decisions and trade-offs
- The worker cannot call `revalidateTag`, so the job refreshes no caches. The blog's cached storefront loaders (Phase 3) must use a short `cacheLife` (about 60 s) so a scheduled post appears within a minute. This was not in ADR-033 or the plan; recorded here and to be added to the Phase 3 criteria.
- `sanitizeMediaUuid` (existing, `packages/blocks/src/sanitize.ts`) only accepts UUID versions 1-5, so it rejects the store's UUIDv7 ids. The blog code uses `isUuid` instead. Other callers of `sanitizeMediaUuid` were not touched: worth a separate check.

## Verification
- `packages/domain/test/blog.int.test.ts` 15/15 on real Postgres 18 (local test DB): status rules, depth limit, cross-store category (service and composite FK), reserved and duplicate slugs, visibility (draft, future, unpublished, other store, disabled blog, inactive category chain), read-time scheduling, due job and audit, redirect chains, sanitiser corpus, foreign media refused, usages recorded and released, widget query bounds, audit per mutation, `content.write` required.
- `packages/blocks/test/blog-sanitize.test.ts` 3/3. `@bs/blocks` 153/153, `@bs/domain test:fast` 425/425, `@bs/web` 213/213.
- Also green with the new tables: `isolation`, `queue-consumers`, `storefront-isolation`, `media-usages`, `theme-demo-catalog` (1374 tests in those six files).
- Full `@bs/domain` real-DB suite (local Postgres 18): 108 of 110 files passed in one run (2123 tests); the other two (`monitoring`, `abandoned-checkouts`) crashed their worker with a Windows native exit code before running a test, and passed on re-run (14/14). Not related to this change.
- `pnpm docs:check` ok; typecheck clean for db, domain, blocks, web; eslint clean for domain and blocks.
- NOT verified: full `pnpm build`, the whole workspace lint, Super Admin / admin typecheck, the migration against a populated production-size database (all adds are new tables and one nullable column; the `media_usages` CHECK is dropped and recreated with a wider list), e2e (no labels changed).

## Docs updated
- [x] `docs/ARCHITECTURE.md` (sections 7 tables and migrations, 11 queue and schedule, 6 tag kinds)
- [x] ADR-033 written, README index updated
- [x] `DEPLOYMENT.md` not needed (no env var or service change)
- [x] `progress.md` (in flight)

## Follow-ups
Phase 2 (contracts, handlers, admin screens, Tiptap editor) and Phase 3 (blocks, templates, routes, JSON-LD, RSS) per `docs/BLOG-PLAN.md`. The `admin.blog.*` procedures must be mapped in `isolation.int.test.ts` when added.
