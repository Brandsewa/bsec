# Blog system, Phase 3: blocks, theme templates, storefront routes, SEO output, widget

- **Date:** 2026-10-15
- **Agent:** claude
- **Branch:** `feat/blog-system` (not merged yet)
- **Area:** blocks, block-editor, domain, web, admin, superadmin
- **Type:** feature
- **Supersedes:** none

## Summary
Shoppers can now read the blog. `/blog`, the category pages and every post are drawn by theme templates (a blog archive and a blog post page, like the collection archive and collection page), with the same blocks and default settings when a store has no template. A Recent Posts widget block can be dropped on the home page or any page. This covers Phase 3 and the widget half of Phase 4 of `docs/BLOG-PLAN.md`.

## What changed
- **Blocks** (`packages/blocks`, now 39 types): `BlogListing` (archive core), `BlogPostContent` (single post core), `BlogPosts` (widget: newest, featured or one category; grid, list or slider; 1-12 posts; image, summary, date, author, category switches; hides itself when there are no posts). Shared `BlogCard`; labelled samples in editors. Block editor fields for all three; `blockAllowed` limits the two cores to their page.
- **Theme pages:** `THEME_SYSTEM_PAGES` gains `blog` (`blog_archive_template`, `template-blog`) and `blog-post` (`blog_post_template`, `template-blog-post`). Keys must be lowercase (template page key rule), so they are not `blogArchive`/`blogPost`. Super Admin theme editor tabs, Store Admin page editor kinds, media-usage labels and cache invalidation know them. Activating a theme without them unpublishes the previous theme's copies (existing loop). "Modern Commerce" defines both pages and a "From the blog" section on its home page (hidden with no posts).
- **Storefront** (`apps/web`): `/blog`, `/blog/page/[n]`, `/blog/category/[...path]` (optional `/page/n`), `/blog/[slug]`, `/blog/feed.xml`; each page has a `loading.tsx`. Old demo stubs removed. 308 for an old slug, for `/blog/page/1` and for a category's page 1; unknown, hidden, disabled-blog and out-of-range requests use the themed not-found. `BlogListingSection`, `BlogPostSection` (breadcrumb, category, date, author, reading time, featured image, table of contents for 3+ H2s, sanitised body, share links, related posts, previous and next), `JsonLd` (escapes `<`).
- **SEO** (`packages/domain/src/blog/seo.ts`): title, description, canonical, robots, Open Graph article tags, Twitter card, feed link; `BlogPosting`, `Blog` + `ItemList` and `BreadcrumbList` JSON-LD; RSS 2.0 (excerpts only). Sitemap already lists real posts (Phase 1).
- **Render data:** `resolveBlockData` resolves `BlogPosts` blocks (one bounded query each, inside the existing transaction); new `BlockData` kind `blog-posts`. `loadRenderData` tags pages that hold the widget with `blog` and a short `cacheLife`.
- **Preview and seed:** theme previews draw sample archive and post pages; `seedThemeDemoBlog` (called by the demo catalog seed): 4 categories (2 subcategories), 8 posts covering long, short, scheduled, draft, noindex.
- CSS for cards, the widget, archive, post and prose in `blocks.css`. No migration, no new env var.

## Decisions and trade-offs
- The cores are drawn by the storefront through render hooks (like `CollectionListing`), because they depend on the request (page, category, post). The widget uses render data, so it works wherever the block tree renders.
- `postsPerPage` in the archive block (when above 0) wins over the store's blog setting; the loader reads the template first to know it.
- Blog menu links to a category or a post (plan criterion 9) were **not built**: the existing "Blog" link kind still points at `/blog`. Staff can use a custom URL link meanwhile.
- The post preview link for drafts (plan section 8) was **not built**.

## Verification
- Real Postgres: `blog.int.test.ts` 21/21; full `@bs/domain` heavy suite 110 files, 2226 tests (adds widget data by source and category, isolation, disabled blog, demo seed), `themes.int.test.ts` 27/27 (activating Modern Commerce copies both blog pages and the home widget; a theme without them removes them), `isolation.int.test.ts` green.
- Unit: `blog-seo.test.ts` 7/7 (metadata, JSON-LD, RSS), `blog-blocks.test.tsx` 8/8 (widget output and hiding, layouts, sample data, escaped text), web route and pagination tests. `pnpm typecheck` 15/15, `pnpm lint` 15/15 (0 errors), `pnpm build` 6/6 (routes listed), `docs:check` ok.
- By hand on a local database (demo store, Next dev server): `/blog` lists the 6 visible posts (not the scheduled or draft), title, canonical, feed link, robots, JSON-LD present; category and subcategory pages, a post page (table of contents, share, related, previous and next, heading ids), RSS, hidden post sends `noindex`, a changed-slug post, the widget in a grid and as a category slider on a custom page. At 375 px: one column, no sideways scroll; at 1280 px: three columns.
- NOT verified: the pages' look in a screenshot (the browser pane would not paint; I measured layout after revealing streamed content), unknown and hidden URLs answer HTTP 200 with a noindex not-found page in dev (the same as existing product and collection pages; not checked on a production build), axe, Lighthouse, keyboard use of the slider, the Super Admin and Store Admin editors for the new blocks in a browser (typechecked and linted only), feed validation in an external validator, tablet width.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (routes, blocks, theme pages, last verified)
- [x] ADR-033 covers it; plan updated in Phase 2 (cache life)
- [x] `DEPLOYMENT.md` not needed
- [x] `progress.md` in-flight line still valid

## Follow-ups
Menu link kinds for blog categories and posts; draft preview link; Phase 5 test round (axe, Lighthouse, 375 px walkthrough, e2e selectors).
