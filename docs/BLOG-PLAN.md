# Blog system plan (categories, posts, themed archive and single templates, recent-posts widget)

- Status: **Draft for owner review.** Nothing built. Written 2026-10-15.
- Planner and verifier: Claude Code. Builders: assigned per phase by the owner (section 11).
- Related: ADR-004 (cache tags), ADR-009/010 (blocks, no merchant code), ADR-018 (editor), ADR-029/030 (media picker, media in blocks), ADR-032 (theme page set), `docs/THEME-TEMPLATES-PLAN.md`, `docs/admin-ui-standards.md`, `docs/ARCHITECTURE.md` sections 7-10. A new **ADR-033** is written in Phase 0.
- Hard rules that apply: AGENTS.md 1 (`tenantTable` + `forceRlsSql`), 2-3 (domain only), 4 (permissions in the service), 5 (tenant cache tags), 6 (audit rows), 8 (no merchant code), 10 (append-only migrations), 11 (`loading.tsx` and `pendingComponent`).

## 1. Goal

A store owner can write blog posts in the admin (rich text, featured image, title, slug, SEO), organise them in **categories and subcategories**, schedule or publish them, and the storefront shows them with a **theme-owned Blog Archive template** and **Blog Single template** (same model as the collection archive and collection page). A **Recent Posts widget** block shows the latest posts on the home page or any other page. The result must be technically strong for SEO (indexable, fast, correct structured data, in the sitemap and an RSS feed) and must not weaken tenant isolation or the no-merchant-code rule.

Reference model: WordPress (categories with parents, post editor with a settings sidebar, SEO panel, scheduled posts, slug redirects) and Shopify (blog + article templates a theme owns, a "featured blog" section). We take the useful 80% and leave out plugins, comments, custom post types.

## 2. What exists today (read from the code, 2026-10-15)

| Item | State |
|---|---|
| `/blog` and `/blog/[slug]` | Stub pages with a hard-coded empty `SAMPLE_ARTICLES` and `ARTICLE_DETAILS = {}` (`apps/web/src/app/blog/`). No storage, no admin. Both already have `loading.tsx` |
| Sitemap | `STATIC_BLOG_POSTS` in `packages/domain/src/storefront/seo.ts` lists **three fake posts** that do not exist (they would be 404s in the sitemap). Must be removed in this work |
| JSON-LD | `generateArticleJsonLd` and `generateBreadcrumbJsonLd` already exist in `seo.ts`; extend, do not duplicate |
| Reserved slug | `"blog"` is already in `RESERVED_PAGE_SLUGS` (`content-services.ts`), so a CMS page cannot take `/blog` |
| Menus | Menu item kind `blog` links to `/blog` (admin `menus_.$handle.tsx`, contracts) |
| Theme pages | `THEME_SYSTEM_PAGES` (`packages/blocks/src/theme-pages.ts`): home, collections archive, collection, product, cart, header, footer. Activation copies a theme's pages into the store's own `pages` rows; storefront falls back to a built-in layout when the store has none (ADR-032) |
| Hierarchy pattern | `categories` (parent, position, active, seo, image) and `pages` (parent, depth max 3) both use a composite `tenantForeignKey` on the parent |
| SEO shape | `PageSeoInput { title, description, imageMediaId }` stored as `seo jsonb` on pages, categories, collections |
| Media | `media_usages.owner_type` has a CHECK list (`product, variant, collection, category, brand, page, theme, store_branding`); new owners need a migration |
| Rich text | Only the `RichText` block (sanitised HTML via `sanitize-html`, `packages/blocks/src/sanitize.ts`, edited as a raw HTML textarea in Puck). **No WYSIWYG editor exists in the admin.** `@tiptap/*` is already in the lockfile as a Puck dependency |
| Permissions | `content.write` (pages) exists; there is no `blog.*` permission |

## 3. Scope

**In (v1):** blog categories with subcategories (2 levels), posts (title, slug, excerpt, rich body, featured image with alt, category, author, status draft / scheduled / published, published date, SEO fields), admin screens, slug redirects, themed archive + single templates (blocks), category pages, Recent Posts widget, sitemap + RSS + JSON-LD + OG, menu link types, demo seed, preview samples, tests.

**Out (listed so nobody builds them by accident):** comments, tags, multiple authors with public profiles, post revisions/history, WordPress import, scheduled social posting, AI writing, newsletter-on-publish, per-post alternate templates, multi-language, video/embed blocks inside posts. Each is a candidate for v2 (section 13).

## 4. Data model (migration `0061_blog`, expand only)

All tables use `tenantTable()`; the migration runs `forceRlsSql(name)` for each; references use `tenantForeignKey` (AGENTS.md rule 1).

**`blog_categories`**
- `id`, `parent_id` (composite FK to itself, `on delete restrict`), `name`, `slug citext`, `description`, `image_media_id` (composite FK to `media`, set null), `position`, `is_active`, `seo jsonb`, timestamps.
- Unique `(tenant_id, slug)`, unique `(tenant_id, id)`. **Depth limited to 2** (category -> subcategory), enforced in the domain service, so no `path` column is needed. A category with children or posts cannot be deleted without a move target (same rule family as pages: restrict).

**`blog_posts`**
- `id`, `title`, `slug citext`, `excerpt` (plain text, max 300, like `collections.description`), `content_html` (sanitised on write, never trusted on read), `content_text` (plain text derived on write, for search and reading time), `reading_minutes int`, `featured_image_media_id` (composite FK, set null), `featured_image_alt` (overrides the media alt for this post), `category_id` (composite FK, set null: posts survive their category), `author_membership_id` (nullable) + `author_name` (display, copied at write so a removed staff member does not blank old posts), `status` (`draft | scheduled | published`, CHECK), `published_at timestamptz`, `is_featured boolean`, `seo jsonb` (`title`, `description`, `imageMediaId`, `noindex`), timestamps.
- Unique `(tenant_id, slug)`, unique `(tenant_id, id)`. Indexes: `(tenant_id, status, published_at desc)` for listings, `(tenant_id, category_id, published_at desc)` for category pages.
- **Visibility rule (one function, used by every storefront read and the sitemap):** `status in ('published','scheduled') AND published_at <= now()`. Scheduled posts therefore go live at the right minute even if no job ran; the job in section 8 only refreshes caches.

**`blog_slug_redirects`** (`from_slug`, `post_id` composite FK, cascade): written when a published post's slug changes; `/blog/<old>` answers **308** to the new URL. Same pattern as the hierarchical page redirects.

**`store_settings.blog_settings jsonb`** (nullable column, expand): `{ enabled, title, description, postsPerPage }`. `enabled=false` makes `/blog*` 404 and hides blog entries from sitemap and menus. `title` and `description` feed the archive's `<title>`/meta.

**`media_usages`**: widen the CHECK to add owners `blog_post` and `blog_category`; the post's featured image and every `<img data-media-id>` in the body are recorded so the media library shows "used in" and blocks deletion (ADR-029). Backfill not needed (no existing posts).

URL decisions (fixed in ADR-033):

| URL | Page |
|---|---|
| `/blog` | archive, page 1 |
| `/blog/page/[n]` | archive pagination (path based, crawlable; `n=1` 308s to `/blog`) |
| `/blog/category/[parent]` and `/blog/category/[parent]/[child]` | category and subcategory archives (a parent lists its children's posts too) |
| `/blog/[slug]` | single post, **flat**: the category is not in the URL, so moving a post between categories never breaks a link |
| `/blog/feed.xml` | RSS 2.0 (latest 20 posts) |

Reserved post slugs: `page`, `category`, `feed.xml`, `tag`, `search`, `rss`. Post slugs are unique per store; the service refuses reserved ones and makes unique slugs from titles (`-2`, `-3`).

## 5. Domain services (`packages/domain/src/blog/`)

Files: `categories.ts`, `posts.ts`, `queries.ts` (storefront reads), `slug.ts`, `content.ts` (sanitise, derive text, reading time, heading ids), `seo.ts` (SEO resolve), `index.ts`. Exported from `@bs/domain`.

- Admin writes call `assertPermission(ctx, "content.write")` in the service (rule 4; **no new permission**, so no per-tenant role data-fix like migration 0046). Reads for admin lists need `content.write` too (the existing pages service sets that precedent; confirm when building).
- Every create/update/publish/unpublish/delete/reorder writes an `audit_logs` row (`blog.post.created`, `blog.post.published`, ...) and runs `invalidate` after commit (rules 5, 6; "commit before read-back").
- `content.ts`: the body is sanitised with a **blog profile** of the existing sanitiser (adds `h2-h4` ids, `figure`, `figcaption`, `img` with only `src` on our media host plus `data-media-id`, `width`, `height`, `alt`, `loading`; `a` gets `rel="noopener"` plus `nofollow` for external links; no iframes, scripts, styles, inline `style`, event handlers). The sanitiser stays the single source of truth; the editor's output is never trusted. Heading ids and a table of contents list are derived here, not in the browser.
- `queries.ts`: `listPosts({ categoryId?, page, perPage })`, `getPostBySlug` (with prev/next and related: same category first, then latest), `listCategoriesTree` (active only, with post counts), `getRecentPosts({ limit, categorySlug?, featuredOnly? })` (used by the widget), `listForSitemap`, `listForFeed`. All apply the visibility rule and `is_active` of the category chain.
- Slug rules mirror pages: lowercase, ascii, max 80, change of a published post's slug writes a redirect row.
- Quota: none in v1. Open question 8 asks whether to add a `blog_posts` quota key (ADR-013).

## 6. Contracts and API (`packages/contracts/src/admin.ts`)

Contracts first (AGENTS.md section 3). New `admin.blog` namespace:

- `blog.categories`: `list` (tree), `get`, `create`, `update`, `reorder`, `delete` (with `moveTo`).
- `blog.posts`: `list` (filters: status, category, search, sort; pagination), `get`, `create`, `update`, `publish`, `schedule`, `unpublish`, `duplicate`, `delete`, `previewHtml` (returns sanitised HTML for an unsaved body so the admin preview equals what shoppers get).
- `blog.settings`: `get`, `update`.

Handlers in `apps/web/src/server/api.ts` stay thin. **Every new `admin.*` procedure must be mapped in `packages/domain/test/isolation.int.test.ts`** or the heavy CI job fails (AGENTS.md section 4). Storefront reads do not need oRPC: server components call the cached loaders directly, as the collection archive does.

## 7. Admin UI (`apps/admin`)

Follows `docs/admin-ui-standards.md`: shared kit, `DataTable`, `SimpleSelect`, `ConfirmDialog`, no native `<select>`, no `window.confirm`, `pendingComponent` on every route, drawers about 40% wide, **no bare borders** (`border-border` tokens), editor hints behind an (i) icon pop-up rather than inline text (owner preferences).

Navigation: a **Blog** group under *Online store* (Posts, Categories), next to Pages. Sidebar labels change, so **update the e2e selectors in the same change** (`e2e/`).

Routes (TanStack file routes):
- `_store/online-store/blog` Posts list: DataTable (title with thumbnail, category, author, status badge, published date), filters, search, bulk delete/unpublish, "Add post".
- `_store/online-store/blog_.new` and `blog_.$id` Post editor (full page, like collections):
  - **Main column:** title, slug (auto from title until edited, with permalink preview `store.com/blog/<slug>`), **rich text editor**, excerpt (counter, 300).
  - **Right column:** Status and publish (Draft / Schedule with date-time picker in the store's time zone / Publish now), Category (SimpleSelect with parent > child labels, "Create category" inline), Author (defaults to the signed-in staff member's name), Featured image (media picker, ADR-029; alt text field with a warning when empty), "Featured post" switch.
  - **SEO panel:** SEO title (counter, ideal 50-60), meta description (counter, ideal 120-160), social image (falls back to featured image, then store social image), "Hide from search engines" switch, a live **Google result preview** and **social card preview**, and a short **checklist** (title length, description length, slug length, featured image set with alt, one H1 only, at least one internal link, body length). Advisory only, never blocks saving.
  - Unsaved-changes guard; autosave of the draft every 30 s while the post is a draft (draft only, never silently edits a published post).
- `_store/online-store/blog_.categories` Category tree: indented list with drag reorder (dnd-kit is already a dependency), "Add subcategory" action, drawer for name, slug, description, image, SEO, active switch; delete with "move posts to" choice.
- Blog settings (enable blog, blog title and description for `/blog`, posts per page): a card on the Posts page, not a new settings screen.
- Menus: add link kinds **Blog category** and **Blog post** next to the existing "Blog" (`menus_.$handle.tsx`, contracts menu link enum, `block-data.ts` link resolver at the `case "blog"` site).

**Rich text editor decision (ADR-033):** use **Tiptap** (MIT) via `@tiptap/react`, `starter-kit`, `extension-link`, `extension-image`, `extension-placeholder`, `extension-underline`, pinned to the exact version already locked for Puck so no second copy is installed. Toolbar: H2/H3/H4, bold, italic, underline, link (with `rel` handling), bullet and numbered lists, quote, horizontal rule, image (opens the media picker; inserts `<img data-media-id>`), undo/redo. The editor emits HTML; the **server sanitises on save and on preview**. It is lazy-loaded on the post editor route only (admin bundle budget). Alternatives rejected: Puck blocks for body (heavier, a writer wants a document, and blog bodies do not need layout), a raw HTML textarea (bad authoring, higher XSS review burden), Markdown (shop owners do not write it).

## 8. Storefront and theme integration

### Templates (the "archive" and "single" pair, same as collections)

Add two entries to `THEME_SYSTEM_PAGES` (+ labels, editor kinds, cache-invalidation case, media-usage labels, Super Admin editor tabs; the recipe in ADR-032 "Consequences"):

| Key | Page type | Slug | Core block (mandatory in the editor) |
|---|---|---|---|
| `blogArchive` | `blog_archive_template` | `template-blog` | `BlogListing` |
| `blogPost` | `blog_post_template` | `template-blog-post` | `BlogPostContent` |

The same template draws `/blog`, `/blog/page/[n]` and the category archives (the block receives the active category, like `CollectionListing`). A store with no template rows renders the **built-in defaults**, which are the same blocks with default props (so old stores and brand-new stores work, exactly as the collections archive does). Activating a theme copies these pages in; a theme without them unpublishes the previous theme's copies (existing loop over `THEME_SYSTEM_PAGE_KEYS`).

### New blocks (`packages/blocks`, bump count 36 -> 39)

1. **`BlogListing`** (archive core). Props: heading and intro, show category chips (parents with children dropdown/row), layout (`grid` 3/2/1 columns by breakpoint, `list`), featured first post as large card, show image / excerpt / date / author / reading time / category label, image ratio, posts per page (also set in blog settings; the block wins), pagination style (numbered links, crawlable). Empty state with copy. Borderless cards like the collection archive.
2. **`BlogPostContent`** (single core). Props: show breadcrumb, category label, date, author, reading time, featured image position (above / wide), content width (narrow / normal), table of contents (off / on for 3+ headings), share links (copy link, WhatsApp, X, Facebook as plain `a` links, no third-party scripts), author line, **related posts** (count, same category first), previous/next links. Renders the sanitised HTML inside a `.bs-prose` typography class driven by `--bs-*` tokens.
3. **`BlogPosts`** (**the recent posts widget**). Props: title and subtitle, **count** (1-12), **source** (latest / featured / one category), layout (`grid`, `list`, `slider` that scrolls sideways on phones with no JS carousel library), columns desktop/tablet/mobile (same responsive model as `CollectionGrid`: 4-2, 2-1, 1-2), show image / excerpt / date / category / author, excerpt lines, "View all posts" button (label + show/hide, links to `/blog` or the category page), section background and spacing like other content blocks. It can be dropped on home, any custom page, the footer area or a product page template from the same Puck block picker. No client JS beyond the optional slider scroll snapping (CSS only).

Block schema pattern: Zod schema + view + registration + editor config in `packages/block-editor/src/config.tsx` + tests (`packages/blocks/test`), as `docs/ARCHITECTURE.md` section 10 prescribes. Data is resolved on the server: `packages/domain/src/themes/block-data.ts` `loadRenderData` fetches posts for `BlogPosts` and `BlogListing` (one query per block, bounded by `count`/`perPage`, no N+1), so the blocks stay pure views. Blocks reference posts by slug in `renderData`, never by raw HTML from the client.

### Routes (`apps/web/src/app/blog/...`)

`blog/page.tsx`, `blog/page/[n]/page.tsx`, `blog/category/[...path]/page.tsx`, `blog/[slug]/page.tsx`, `blog/feed.xml/route.ts`. **Each `page.tsx` has a sibling `loading.tsx`** (rule 11, `bs/route-pending`). All wrapped in `.bs-skin`. Unknown slug, hidden or disabled blog, inactive category: themed `notFound()`. Old slug: 308 via `blog_slug_redirects`. Draft or future-dated posts are never reachable by URL for shoppers; staff preview uses a signed preview link (`/blog/<slug>?preview=<token>` backed by the existing preview-token pattern, `noindex`, `no-store`).

### Caching and invalidation (ADR-004)

- Add `"blog"` to `TagKind` in `cache-tags.ts`. Tags: `tenantTag(t, "blog")` (all lists, widget, feed, sitemap), `tenantTag(t, "blog", postId)`, `tenantTag(t, "blog", "cat:<id>")`.
- New `CacheChange` events in `cache-invalidation.ts`: `blog_post_changed { postId, categoryIds }`, `blog_category_changed`, `blog_settings_changed`. They revalidate blog tags, `page:template-blog*`, `nav` (menu links), `seo` (sitemap) and **the home page tag**, because the widget can sit there. Never call `revalidateTag` ad hoc.
- Cached loaders in `cached-storefront.ts` (`getCachedBlogArchive`, `getCachedBlogPost`, `getCachedBlogCategories`). **Any cached page whose block document contains a `BlogPosts` or `BlogListing` block must also tag `blog`** (add this to the shared block-data loader so it works for every page, not just home). Test it: publish a post, home page shows it after revalidation.
- **Scheduled posts:** queue `blog.publish_due` (pg-boss schedule every minute, added to `QUEUES`, handler in `jobs.ts`, test in `queue-consumers.int.test.ts`). It finds posts whose `published_at` passed since the last run, flips `scheduled -> published`, writes an audit row (`blog.post.auto_published`) and calls the invalidation. Visibility itself does not depend on the job (section 4).

## 9. SEO specification (acceptance material, not nice-to-haves)

1. **Metadata** (`generateMetadata`): title = `seo.title || post.title`, template `"%s | <Store>"`; description = `seo.description || excerpt || first 155 chars of content_text`; canonical = absolute `/blog/<slug>`; `robots` index,follow unless `seo.noindex`, preview or blog disabled; paginated archive pages self-canonical and carry the page number in the title; Open Graph `type=article`, `article:published_time`, `modified_time`, `section` (category), `author`; image = `seo.imageMediaId` -> featured image -> store social image, using the media derivative at 1200 px wide; Twitter `summary_large_image`.
2. **Structured data:** `BlogPosting` (headline, description, image array, datePublished, dateModified, author `Person`, publisher `Organization` with logo, `mainEntityOfPage`, `articleSection`, `wordCount`) by extending `generateArticleJsonLd`; `BreadcrumbList` Home > Blog > Category > Subcategory > Post; `Blog` + `ItemList` on the archive. A unit test validates required fields and that no value is `undefined`/empty.
3. **Sitemap:** replace `STATIC_BLOG_POSTS` with real queries: `/blog` (weekly, 0.6), category pages (weekly, 0.5), posts (monthly, 0.6, accurate `lastmod` = `updated_at`), only visible and indexable ones; omit all when the blog is disabled. Existing `seo-endpoints.test.ts` and `storefront-seo.test.ts` are updated, and a test proves a draft, a future-dated post and another tenant's post never appear.
4. **RSS** `/blog/feed.xml` with `<link rel="alternate" type="application/rss+xml">` in the head of blog pages, absolute URLs, `content:encoded` with the sanitised excerpt only, correct `lastBuildDate`, caching by the `blog` tag.
5. **Content quality:** one `<h1>` (the title), body headings start at `h2`, heading ids for anchors and the table of contents, responsive featured and inline images from media derivatives with `width`/`height` (no layout shift), first image `priority`/eager, the rest lazy, required alt text warned in the editor and the featured image falls back to the post title, external links `rel="noopener nofollow"`, internal links plain.
6. **Performance:** posts are server-rendered with no client JS beyond the existing storefront shell; `/blog/[slug]` joins the `perf-budget` test (bundle budget like `/products/[slug]`); LCP image preloaded; target Lighthouse mobile SEO 100, accessibility 95+ on the demo store.
7. **Crawl hygiene:** 308 redirects for changed slugs and `/blog/page/1`; canonical on every page; no duplicate content between a parent category page and `/blog` (parent lists its children's posts but has its own canonical and intro text); empty category pages return 200 with an empty state and `noindex`.
8. **Accessibility:** WCAG 2.2 AA, visible focus, semantic `article`/`time`/`nav aria-label="Breadcrumb"`, category chips are real links, slider is scrollable by keyboard.

## 10. Demo data, preview, seeds, docs

- `seedThemeDemoCatalog` (demo store, local only) gains 3 blog categories (one with two subcategories), 8 posts (long, short, with and without featured image, one scheduled, one draft, one noindex), so every page state is testable. No external image hosts; no real brand content in the repo.
- `apps/web/src/server/preview-samples.ts` and the Super Admin theme editor: sample posts for the `blogArchive` and `blogPost` template previews (`/preview/<code>?page=blogPost`).
- The "Modern Commerce" theme (`commerce-templates.ts`) defines the two pages and puts a `BlogPosts` section on its home page (behind a count of 3, hidden when the store has no posts so a new store shows no empty heading). `seed:templates` re-run is a manual, owner-approved step per environment; **production is not touched without the owner's yes**.
- Docs updated with the build: `ARCHITECTURE.md` sections 7 (tables), 8 (procedures), 9 (routes), 10 (blocks, pages), 11 (queue), 13 (tags), "Last verified"; ADR-033; `docs/changes/` record per phase; `progress.md`. No new env var; no `DEPLOYMENT.md` change expected.

## 11. Phases

| Phase | Scope | Builder | Exit criteria |
|---|---|---|---|
| **0** Sign-off | Owner answers section 14; ADR-033 (data model, URLs, editor choice, templates); claim in `progress.md` "In flight" | Claude | Owner approves |
| **1** Data and domain | Migration 0061 + schema, services, sanitiser profile, cache tags and invalidation, `blog.publish_due` job, sitemap fix, domain + isolation tests | Claude | Section 12 criteria 1-6 and 10 green on real Postgres |
| **2** Contracts and admin | `admin.blog.*` contracts and handlers, Posts list, Post editor (Tiptap, SEO panel), Categories tree, blog settings, menu link kinds, e2e selectors | Antigravity | Criteria 7-9; admin standards respected |
| **3** Storefront and templates | Three blocks, `THEME_SYSTEM_PAGES` entries, routes with `loading.tsx`, JSON-LD/OG/RSS, default layouts, Modern Commerce pages, preview samples, Super Admin editor tabs | Antigravity | Criteria 11-17 |
| **4** Widget and polish | `BlogPosts` widget everywhere, slider, home integration, demo seed, empty states | Antigravity | Criteria 18-19 |
| **5** Test round | Gate, real-DB tests, Playwright walk at 375 px and 1280 px, axe, Lighthouse, SEO validation (Rich Results Test on local HTML), change record with counts | ZCode, verified by Claude | All of section 12 |

Claude verifies every other agent's phase against these criteria and the gate before the next starts. One worktree per agent; stage files by explicit path (AGENTS.md section 6).

## 12. Acceptance criteria

1. Categories: create, rename, reslug, reorder, nest one level; a third level is refused; delete with children or posts requires a move target; the cross-tenant parent reference is impossible (composite FK, real-DB test).
2. Posts: create, edit, publish, unpublish, schedule, duplicate, delete; duplicate slug gets a suffix; reserved slugs refused; permission and audit row verified per mutation (real DB).
3. Visibility: draft, future-scheduled, inactive-category-hidden-from-lists, other-tenant and disabled-blog posts never appear on any page, widget, feed, sitemap or search. Scheduled post appears at its minute **without** the job (read-time rule) and caches refresh via the job.
4. Content security: `<script>`, `onerror`, `javascript:` links, `iframe`, inline `style`, external-host images and oversized input are stripped or rejected in the saved HTML; the admin preview shows the same sanitised result.
5. Slug change on a published post 308s the old URL; a chain (A to B to C) resolves to C in one hop.
6. Media: featured and inline images record `media_usages`; deleting a used image is blocked with the usage shown; trashing a post releases the usages.
7. Admin: editor toolbar works by mouse and keyboard; media picker inserts an image; SEO preview and checklist react live; unsaved-changes guard; draft autosave never changes a published post.
8. Admin lists use the shared DataTable, filters and search work, empty states present, every route has `pendingComponent`.
9. Menus can link to the blog, a category and a post; deleting the target does not break the menu (renders hidden or falls back to `/blog`).
10. `pnpm --filter @bs/domain test:heavy` green including new blog suites and the updated isolation suite; `audit-coverage` unaffected.
11. `/blog`, `/blog/page/2`, category and subcategory pages render with the theme's template and with the built-in default (no template rows); page 1 redirect and out-of-range page 404 correct.
12. The blog's cached storefront loaders use a short `cacheLife` (about 60 s) because the worker cannot call `revalidateTag`; a scheduled post must be visible within a minute of its time.
13. Single post renders breadcrumb, meta line, featured image, content, TOC (3+ headings), share links, related posts, previous/next; unknown or hidden slug gives the themed 404.
14. Head output validated by test: title, description, canonical, robots, OG article tags, Twitter card; `noindex` posts and preview links carry `noindex`.
15. JSON-LD: `BlogPosting`, `BreadcrumbList`, `Blog`/`ItemList` present and complete; unit tests for each.
16. Sitemap lists only visible, indexable posts and categories with real `lastmod`; the old fake entries are gone; RSS validates (well-formed XML, absolute URLs, newest first).
17. Activating a theme with blog pages copies them; a theme without them falls back to defaults; rollback restores the previous version; tags invalidate through `cache-invalidation.ts` only.
18. 375 px and 1280 px: no horizontal scroll, axe finds no serious or critical issues, Lighthouse mobile SEO 100 / accessibility 95+, LCP and CLS within the budgets in `THEME-TEMPLATES-PLAN.md` section 4, `/blog/[slug]` within its bundle budget.
19. Widget: count, source, category, layout, columns, show/hide toggles all change the output; works on home, a custom page and a product template; hides itself (no empty heading) when there are no posts; picks up a newly published post after revalidation; no N+1 queries (test counts queries).
20. Widget slider scrolls by touch and keyboard with no JS carousel library.

Gate before every merge: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`, affected tests, `@bs/domain test:heavy` (counts pasted in the change record). e2e selectors updated in the same change as the sidebar.

## 13. Risks and later (v2)

| Risk | Mitigation |
|---|---|
| Stored XSS through post HTML | Server-side sanitiser is the only trust boundary, tested with an attack corpus; no inline style, iframes or scripts |
| Sitemap/URL regressions | Flat post URLs, redirect table, canonical tests |
| Stale widget on cached pages | The shared block-data loader adds the `blog` tag for pages that contain blog blocks (criterion 18 tests it) |
| Admin bundle growth from the editor | Lazy route, Tiptap shared with Puck's lockfile entry, bundle check in the gate |
| Editor content that Puck's `RichText` cannot reuse | Separate sanitiser profile, same library |
| Scope creep | Section 3 "Out" list; additions need a new line in this plan |

v2 candidates: tags, comments with moderation, multiple authors with profile pages, revisions, per-post template, WordPress import, newsletter on publish, table/embed support in the editor, per-category RSS, `Article` image sitemap, quota key.

## 14. Open questions for the owner (recommended default first)

1. **Editor:** Tiptap WYSIWYG (recommended) or a simpler editor? It adds a direct dependency (already in the lockfile through Puck).
2. **Post URL:** flat `/blog/<slug>` (recommended; category changes never break links) or `/blog/<category>/<slug>` (WordPress-style, riskier)?
3. **Category depth:** 2 levels (category + subcategory) as asked, or allow 3?
4. **Permission:** reuse `content.write` (recommended, no role data-fix) or add `blog.write` (finer control, needs a per-tenant role migration)?
5. **Author:** display name taken from the signed-in staff member and editable per post (recommended), or one fixed store author?
6. **Scheduling and RSS** in v1: yes (recommended) or later?
7. **Homepage widget:** should the Modern Commerce theme's default home page include a "Latest from the blog" section, or only be available in the block picker?
8. **Quota:** add a `blog_posts` limit to the plan tiers (ADR-013), or unlimited for now?
9. **Builders:** Phase 1 by Claude, Phases 2-4 by Antigravity, Phase 5 by ZCode as proposed?
