# Marketing section: blog, categories, navigation and media in Super Admin, blog live on bcom.si

- **Date:** 2026-11-02
- **Agent:** claude
- **Branch:** `feat/marketing-site-cms` (not merged yet)
- **Area:** contracts, domain, platform, superadmin, admin, web, new package `content-admin`
- **Type:** feature
- **Supersedes:** none

## Summary
Phase 3 of `docs/MARKETING-SITE-CMS-PLAN.md`. Owners and admins can write blog posts, manage categories, media and the site's header menu under Marketing in Super Admin. Posts appear at bcom.si/blog in the marketing design, in the RSS feed and the sitemap, and the saved `header` menu replaces the built-in header links.

## What changed
- New `packages/content-admin`: the blog, menu and media screens and the upload queue moved out of `apps/admin`. Each app plugs in its API with `configureContentHost`, and the moved screens are otherwise unchanged. Store admin routes are now thin wrappers.
- `marketing.blog`, `marketing.menus`, `marketing.media`, `marketing.pages.list` reuse the admin contracts. Handlers run on the `app_rw` runtime with a server-built context. `POST /api/marketing/media/upload` is the upload fallback.
- Web: `blogAccess` (`server/site-access.ts`), `app/blog/layout.tsx`, middleware allows `/blog*` on the marketing host, sitemap adds blog URLs, `SiteNavProvider` feeds `HomeNav`, and `home.css` restyles the blog blocks with no gradients.
- Blog preview links use the marketing host for the website record.

## Decisions and trade-offs
- Screens read a module-level host instead of props. Each app has one API, and this kept the moved code nearly identical, which limits the risk to working store screens.
- `platform_audit_logs` is written after commit for Marketing, because the change runs on `app_rw`. `audit_logs` stays in the transaction. See ADR-042.
- The footer links are still in code; only the header reads the menu. A menu link to a page (`/pages/...`) will not work on bcom.si until Phase 4.
- The root layout reads the header menu on each marketing request, uncached. A failed read keeps the built-in links.

## Verification
Gate: `gate:quick` passed (admin 109, web 232, domain 582), admin, Super Admin and web builds passed, `docs:check` passed. Platform heavy suite 153 of 153 and domain `platform-site`, `blog` and `finance-reconcile` 47 of 47 on real Postgres. The first platform run after a Docker restart had 6 failures in `audit-coverage.int.test.ts` (no audit row found); the file then passed alone and the full suite passed, with no code change. Unproven guess: a host and container clock gap, since the test compares a Node timestamp with Postgres `created_at`. `finance-reconcile.int.test.ts` failed twice in an earlier full serial domain run and passed alone, cause unknown. The full domain heavy suite was not rerun locally. Driven in headless Chromium against local web, platform and Super Admin with the dev staff login: set up the record, wrote and published a post, created the `header` menu, image picker enabled, post on `/blog`, the post page, feed and sitemap, `/cart` and `/products/x` still 404 on the marketing host, no 5xx responses. `platform_audit_logs` showed `marketing.blog.posts.create` and `marketing.menus.create` from the real route. Menu items for the header test were set directly in the local database, not through the editor.

NOT verified: uploading an image end to end (no storage configured locally), the store admin's blog and menu screens in a browser (their render tests pass), Safari, Firefox and real phones.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (package list)
- [x] ADR-042
- [ ] `DEPLOYMENT.md`: no new variable since the foundation change
- [x] `progress.md` (in-flight line from the foundation change)

## Follow-ups and open questions
- Phase 4 and 5: Pages and Puck blocks.
- Footer links from a menu.
- A "Blog" link: add it under Navigation, once a post is published.

## Definition of done
Not done until merged: see `AGENTS.md` section 7.
