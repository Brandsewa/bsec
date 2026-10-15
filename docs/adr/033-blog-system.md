# ADR-033: Blog system (categories, posts, theme templates, recent-posts widget)

- **Status:** Accepted
- **Date:** 2026-10-15
- **Plan reference:** docs/BLOG-PLAN.md

## Context
`/blog` and `/blog/[slug]` were stubs with no storage or admin, and the sitemap listed three posts that do not exist. Stores need a simple, SEO-strong blog that follows the theme the same way the collection archive and collection page do, plus a widget that shows recent posts on any page.

## Decision
- **Tables** (tenant tables, forced RLS, composite foreign keys): `blog_categories` (parent and child only, depth 2, enforced in the domain service), `blog_posts`, `blog_slug_redirects`. Store switches live in `store_settings.blog_settings` (jsonb).
- **Visibility is one rule**, applied by every storefront read, the sitemap and the feed: `status in ('published','scheduled') AND published_at <= now()` and the post's category chain is active. A scheduled post therefore appears at its minute even when no job ran; the `blog.publish_due` job only flips the status, writes the audit row and refreshes caches.
- **URLs:** `/blog`, `/blog/page/[n]`, `/blog/category/[parent]/[child]`, flat `/blog/[slug]` (the category is not in the post URL, so moving a post never breaks a link), `/blog/feed.xml`. A changed slug of a published post writes a row in `blog_slug_redirects` (308).
- **Body** is stored as HTML, **sanitised on the server on every write** with a blog profile of the existing `sanitize-html` setup (no scripts, iframes, inline style or event handlers; images only from our media host and carrying `data-media-id`). Browser-side editor output is never trusted (ADR-010).
- **Editor:** Tiptap (MIT) in the admin, lazy-loaded on the post editor route, versions pinned to those already locked for Puck.
- **Permission:** reuse `content.write`; no new permission, so no per-tenant role data fix.
- **Theme:** two template pages (`blogArchive`, `blogPost`) in `THEME_SYSTEM_PAGES`, drawn by the core blocks `BlogListing` and `BlogPostContent`; the widget is the `BlogPosts` block. Stores without the template rows get the same blocks with default props.
- **Cache:** new tag kind `blog`; invalidation events go through `cache-invalidation.ts`; a cached page whose document contains a blog block also carries the `blog` tag.
- **Media usages:** owner types `blog_post` and `blog_category` are added to the CHECK constraint.

## Consequences
Old stores are unaffected until they publish a post; the blog is on by default for stores (`enabled` true) but empty. Adding a blog block or a blog URL means updating the sitemap, the tests and `docs/ARCHITECTURE.md`. Tags, comments, revisions, multiple public authors and WordPress import are explicitly not part of this decision.

## Alternatives considered
- Post body as a Puck block tree: heavier to author, layout freedom a blog does not need.
- Raw HTML textarea or Markdown: poor authoring for shop owners and a larger review surface for XSS.
- `/blog/<category>/<slug>` URLs: breaks links when a post moves category.
- A new `blog.write` permission: finer control, but needs a data migration of every store's system roles (see migration 0046).
