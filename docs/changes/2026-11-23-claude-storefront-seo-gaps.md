# Storefront SEO gaps from a second audit

- **Date:** 2026-11-23
- **Agent:** claude
- **Branch:** `feat/storefront-seo-gaps` (merged in #316, e72a0ee8)
- **Area:** domain, contracts, web, admin, docs
- **Type:** fix
- **Supersedes:** none (continues `docs/changes/2026-11-22-claude-storefront-redirects-health.md`)

## Summary
An external SEO tool audit of a live store gave a second list. The items that were gaps in the platform are fixed here; the ones we already had are listed in `docs/STOREFRONT-AUDIT-FIXES-PLAN.md` section 11. Bulk find-and-replace for blog posts was skipped on request, and rich product descriptions are a separate PR.

## What changed
- **`&amp;` in titles:** `decodeEntities` (`packages/domain/src/html-entities.ts`) is applied to titles, stored SEO titles and descriptions and the store name for products, categories, collections, blog posts and archives, custom pages (`apps/web/.../pages/[...path]/page.tsx`) and `formatTitle`. Stored data is not changed.
- **Index pages:** `/collections` and `/categories` get a canonical, a hidden H1 when the template has none, `CollectionPage` + `ItemList` JSON-LD, and title and description from the theme archive template (`apps/web/src/lib/archive-meta.ts`). They are in the sitemap with `lastmod`. The categories page ignores page-level SEO and collection wording because the two pages share one template.
- **SEO health:** a "Pages kept out of search" card with the reason for each, and a check counting blog and page pictures with no alt text (`admin/content-scan.ts`). `seo.health` gains an optional `noindexed` field (contract change is additive).
- **Link check:** now reads blog post HTML; the contract's `where.type` gains `blog`.
- **Default descriptions:** blog archive and blog category defaults, and policy pages (first sentence of the policy, else a phrase per policy type).
- No migration, env var or queue.

## Decisions and trade-offs
- Archive wording is edited in the theme editor (the shared archive template), not in a new settings screen.
- The decoder runs twice at most, so text escaped twice (`&amp;amp;`) is also repaired. Titles are plain text, so a literal `&amp;` typed on purpose cannot be kept.
- The noindex list reflects the storefront's rules, base market only.

## Verification
- See the PR description for the commands and counts.
- NOT verified: the new SEO health cards and the archive pages in a browser.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (storefront paragraph)
- [x] ADR: not needed
- [x] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md` (in-flight)

## Follow-ups and open questions
- Rich product descriptions (own PR). Bulk find-and-replace for blog posts (skipped). A required alt field in the blog editor and on card images. Cloudflare email obfuscation (owner action, steps given in chat).

## Definition of done
Gate partly run (see PR); no secrets or generated files in the diff.
