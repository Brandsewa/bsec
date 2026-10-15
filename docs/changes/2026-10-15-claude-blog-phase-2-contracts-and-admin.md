# Blog system, Phase 2: contracts, API handlers and admin screens

- **Date:** 2026-10-15
- **Agent:** claude
- **Branch:** `feat/blog-system` (not merged yet)
- **Area:** contracts, web (API), admin, domain
- **Type:** feature
- **Supersedes:** none

## Summary
Merchants can now manage the blog in Store Admin: a Blog entry under Online Store, a posts list, a post editor with a rich text editor, SEO panel and publishing controls, a category tree with subcategories, and blog settings. Nothing is shown on the storefront yet (Phase 3).

## What changed
- `packages/contracts/src/blog.ts`: `admin.blog.{categories,posts,settings}` (19 procedures), wired into `adminContract`; handlers in `apps/web/src/server/api.ts`, all behind `content.write`. Domain adds `previewBlogHtml`; list and get now return ISO date strings.
- `apps/admin`: routes `online-store/blog`, `blog_/new`, `blog_/$id`, `blog_/categories`; `components/blog/PostForm.tsx` and `BlogEditor.tsx` (Tiptap, lazy-loaded on the post screen only); sidebar entry "Blog".
- Editor: headings 2-4, bold, italic, underline, link (inline address bar, no browser prompt), lists, quote, divider, image from the media library (keeps the media id), undo and redo. Visibility (draft, published, scheduled with a date-time picker), category, author, featured post, featured image with alt text, search title and description, social image, hide-from-search switch, live search preview and an advisory SEO checklist. Unsaved-changes guard.
- Dependencies: `@tiptap/react`, `starter-kit`, `extension-image`, `extension-placeholder`, `pm`, all pinned to 3.31.4, the version already locked for Puck. `pnpm-lock.yaml` changed by about 200 lines.
- The server now drops empty paragraphs the editor leaves behind.

## Decisions and trade-offs
- Draft autosave from the plan was not built (the unsaved-changes guard is); Phase 5 can add it.
- Reordering categories uses up/down buttons (keyboard friendly) instead of drag and drop.
- The post list has no thumbnails yet (the list API returns the media id only).

## Verification
- `isolation.int.test.ts` 1412/1412 with all 19 `blog.*` procedures mapped (each is checked for tenant access, customer session, no session, missing permission and success); `blog.int.test.ts` 15/15.
- `@bs/contracts`, `@bs/domain`, `@bs/web`, `@bs/admin` typecheck clean; eslint clean on the new admin files.
- Run by hand on a local database (`bsec_blogdev`, demo seed, Next dev on 3000, admin on 5173), signed in as a generated local test owner: opened the list, added a category, wrote a post (heading plus paragraph), published it, saw it in the list and in the database (sanitised HTML with a heading id, audit rows), edited the title and saved. Found and fixed: the Save button stayed enabled on an untouched post (the editor re-serialises stored HTML), and an empty paragraph at the end of every post.
- NOT verified: the blog settings drawer, scheduling with the date-time picker, inserting an image, the category drawer edit and delete flows, the unsaved-changes dialog, delete confirmations, 375 px layout, keyboard use of the toolbar, dark mode, e2e (no existing labels changed, but the sidebar gained "Blog").

## Docs updated
- [x] `docs/ARCHITECTURE.md` (API surface, UI routes)
- [x] ADR not needed (ADR-033 covers it); plan criteria updated (cache life)
- [x] `DEPLOYMENT.md` not needed
- [x] `progress.md` in-flight line still valid

## Follow-ups
Phase 3: blocks, theme templates, storefront routes, JSON-LD, RSS (cached loaders must use a short `cacheLife`).
