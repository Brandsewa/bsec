# Blog system, Phase 5: remaining features and test round

- **Date:** 2026-10-15
- **Agent:** claude
- **Branch:** `feat/blog-system` (not merged yet)
- **Area:** domain, contracts, web, admin, blocks, docs
- **Type:** test (with the features that were still open)
- **Supersedes:** none

## Summary
Builds what Phases 2 and 3 left open (menu links to blog categories and posts, draft preview links, draft autosave, list thumbnails), then walks the whole blog through the admin and the storefront, fixing what the walk found. All items of `docs/BLOG-PLAN.md` are now built.

## What changed
- **Menu links:** new link kinds `blog_category` and `blog_post` (contract enum, picker in the menu editor, resolved in `block-data.ts` through `blogMenuTargetsTx`). Only live targets resolve: a hidden category (or hidden parent), a draft, a scheduled post, a deleted target, another store's id or a switched-off blog is skipped like any dead link.
- **Preview links:** `admin.blog.posts.previewLink` returns an absolute address on the store's primary domain with a signed token (HMAC over store, post and expiry, 24 hours, key `TENANT_SECRETS_KEY`; nothing stored). `/blog/<slug>?preview=<token>` shows the post whatever its state with a banner, `noindex, follow`, no structured data, read fresh (not from the shared cache). A wrong, expired or other-store token gives the normal not-found.
- **Draft autosave:** a saved draft saves itself 30 s after the last change; published and scheduled posts are never saved this way. Quiet on failure. Save button and discard guard unchanged.
- **List thumbnails:** the posts list returns `featuredImageUrl`.
- **Found by the walk and fixed:** subcategory address shown without its parent in the category list; the post editor, posts list and category screens overflowed sideways at 375 px (action rows now wrap, grid children can shrink); archive post titles were `h3` straight under the page `h1` (axe heading-order), now `h2` on the archive and `h3` under a section heading; category links are 44 px tall; a hidden post's `robots` is `noindex, follow`.
- Bundle budget test also covers `/blog` and `/blog/[slug]` (50 KB gzipped).

## Verification
- Real Postgres: `blog.int.test.ts` 21/21 (menu targets, preview tokens and links, plus earlier cases), `isolation.int.test.ts` with `blog.posts.previewLink` mapped, `themes.int.test.ts` 27/27. Full `@bs/domain` real-database run: 109 of 110 files in one pass (2227 tests); `finance-roles` crashed its worker with the Windows native exit code before running and passed on re-run (7/7). Also: typecheck 15/15, lint 15/15, build 6/6, `docs:check` ok, unit suites green (blocks 161, block-editor 18, contracts 22, web 216, admin 82, domain fast 432), bundle budgets for `/blog` and `/blog/[slug]` pass.
- **Admin, by hand** on a local database as a generated local test owner (Vite on 5173, Next on 3000): Blog settings drawer saved (title and posts per page, audit row); category rename, add subcategory, delete with the "move posts" dialog; image insert from the media library (stored with a server-built address, size and a `body` usage); scheduling with the date-time picker (stored as the right instant for the browser's zone); Preview button (the address opens the post for the draft, the public address and a tampered token give not-found); autosave of a draft (title saved, status stayed draft, audit row `blog.post.updated`, no toast) and none for a published post; the discard-changes dialog (Keep editing, Discard); post editor, list and categories fit 375 px without sideways scroll.
- **Storefront, by hand and with axe-core 4.10 (WCAG 2.0/2.1/2.2 A and AA plus best practice):** `/blog`, a post and a page holding two widgets (grid, and a category slider): no violations from the blog code at 1280 and 375 px; 768 px shows two columns; the slider can take focus and scrolls; share, chip and previous/next targets are 42 px or more. Remaining axe findings are not from the blog: the footer copyright line fails colour contrast on every page (existing), and "region" findings are an artefact of the measuring (streamed content moved into view by script, outside `<main>`).
- **Feed and sitemap:** the RSS parsed with a strict XML parser (version 2.0, required channel fields, absolute links, `guid` equals link, RFC 822 dates, newest first, no draft or scheduled post); the sitemap lists `/blog`, the 4 categories that have posts and the 5 indexable posts, and omits the noindex post, the scheduled post and the draft.
- NOT verified: Lighthouse (not installed here); the Super Admin theme editor and the Store Admin page editor with the new blocks in a browser (typechecked, linted and unit-tested only); an external RSS validator and Google's Rich Results Test (need the public internet; the JSON-LD is unit-tested for required fields); unknown-URL status codes on a production server (dev answers 200 with a noindex not-found page, as for products); keyboard use of the Tiptap toolbar beyond Tab order; the e2e suite (not changed; no new e2e spec was added because it only runs in CI on `main` and could not be run here); real-image rendering (the local media files were placeholders).

## Docs updated
- [x] `docs/ARCHITECTURE.md` (API surface, routes)
- [x] ADR-033 unchanged (decisions held); plan criteria updated earlier
- [x] `DEPLOYMENT.md` not needed (preview links reuse `TENANT_SECRETS_KEY`, already required)
- [x] `progress.md`

## Follow-ups
- The date-time picker uses the browser's time zone, not the store's; they match for a merchant working in the store's own zone.
- Footer copyright contrast (existing, every page) should be fixed in the store theme tokens.
- A pre-existing `sanitizeMediaUuid` rejects UUIDv7 ids (only UUID versions 1 to 5); other callers may be affected.
