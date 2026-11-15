# SEO Phase 2, second slice: merchant listing schema, hreflang and image sitemap, manifest, IndexNow, SEO health

- **Date:** 2026-11-15
- **Agent:** claude
- **Branch:** `feat/seo-phase2b` (not merged yet)
- **Area:** domain, db (one migration), web, admin, worker job, contracts, docs
- **Type:** feat
- **Supersedes:** none (finishes `docs/SEO-GEO-AEO-PLAN.md` section 4)

## Summary
Builds the rest of Phase 2 that code can do: Google merchant-listing fields on product schema (return policy, shipping, reviews), hreflang and image entries in the sitemap, a per-store web manifest, the default share image on blog pages, IndexNow notifications (off until the owner enables them) and an admin "SEO health" report.

## What changed
- `packages/domain/src/storefront/seo-offers.ts` (new): return policy, shipping details and reviews built from the store's own settings. Read-only: it does not create a shipping zone (checkout's loader does) and never calls a courier (rule 14). Wired into `generateProductJsonLd` through `extras` and loaded on the product page by `getCachedOfferExtras` (reviews refresh with the product tag; the entry also expires within the hour because return and shipping settings have no cache tag).
- `packages/domain/src/storefront/seo-markets.ts` (new), `seo.ts`: `generateSitemapXml` adds `<image:image>` and `<xhtml:link rel="alternate" hreflang>` and declares those namespaces only when used. hreflang only when every market has a distinct valid code; x-default points at the base market. Home also gets `alternates.languages`. The sitemap no longer invents a `lastmod` of "now" for the home page without a saved home page, or for `/blog` without posts.
- `apps/web`: `/manifest.webmanifest` (`lib/web-manifest.ts`), blog archive and post metadata use the default share image, `getStorefrontBrandAssets` also returns icon sizes.
- IndexNow: `packages/domain/src/storefront/indexnow.ts`, queue `seo.indexnow_sweep` (every 15 minutes), key route `/api/indexnow-key/[key]` plus a rewrite from `/<32 hex>.txt` in `next.config.ts`, migration `0107_seo_indexnow_watermark` (`seo_settings.indexnow_pinged_at`, nullable, expand-only). **Off unless `INDEXNOW_ENABLED=true`.**
- SEO health: contract `admin.seo.health` (`SeoHealthView`), `packages/domain/src/admin/seo-health.ts` (rules in a pure `buildSeoHealthChecks`), handler with `settings.read`, admin page `/settings/seo` and a Settings nav item "SEO health" (Store group).
- `scripts/seo-audit.mjs`: warns when an offer has no return policy or shipping details.
- Tests: `storefront-seo-offers.test.ts`, `storefront-seo-offers.int.test.ts` (real Postgres, two stores, no zone created by reading, state-limited zone left out), `storefront-seo-markets.test.ts`, `storefront-indexnow.test.ts`, `indexnow.int.test.ts` (enrol, send once with the store's own key, nothing for a hidden store, a 429 keeps the watermark), `admin-seo-health.test.ts`, `admin-seo-health.int.test.ts`, `apps/web/test/web-manifest.test.ts`, isolation mapping for `seo.health`.

## Decisions and trade-offs
- **IndexNow is a sweep, not a hook at publish time.** Many edit paths publish, and the worker cannot tell which URL an edit changed; the sitemap's `lastmod` already says. Cost: a delay of up to 15 minutes. It never sends the whole catalogue (enrolment sends nothing) and sends at most 500 URLs per store per sweep.
- **Off by default.** It contacts an outside service, so the owner turns it on in production (`INDEXNOW_ENABLED=true` on web and worker). Staging and local never send.
- **Key derived, not stored:** HMAC of the tenant id with `TENANT_SECRETS_KEY`. Rotating that secret changes every key; the key file and the pings change together, so nothing breaks.
- **Shipping details only when accurate:** the default zone, whole country only, rates priced by checkout's own rule engine for that variant's price; weight tiers are skipped when the variant weight is unknown; a market with no zone publishes nothing.
- **Reviews** are the newest five published ones (the first a shopper sees), and only beside a real aggregate rating.
- Not built: CollectionPage schema (little value), the Search Console and Bing Webmaster connection and a scheduled live crawl (need the owner's accounts), per-page title and description length in the health panel. Cloudflare items (http to https 301, `www`, `robots.txt` cache lifetime) still need the owner.

## Verification
- See the PR description for the exact counts of the final run. Run in `C:\dev\bsec-seo3`: root typecheck and lint, domain unit and heavy suites on a shared local Postgres, web suite, admin suite, web build and the page-script budget test.
- NOT verified: a running storefront (hreflang and image entries in a real store's sitemap, the manifest in a browser, the SEO health page in the admin UI), Google's Rich Results Test, a real IndexNow request (the sweep is tested against a fake endpoint only), production.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (routes, queue and schedule, migration 0107, env vars), `DEPLOYMENT.md` (`INDEXNOW_ENABLED` for web and worker), `docs/SEO-GEO-AEO-PLAN.md`
- [x] ADR not needed (no architectural decision beyond the plan); `progress.md` (in flight)

## Follow-ups and open questions
- **[owner]** Set `INDEXNOW_ENABLED=true` on web and worker in production when ready, then check `https://<store>/<key>.txt` and the worker log for `seo.indexnow_sweep processed`.
- **[owner]** Cloudflare: http to https 301, `www`, `robots.txt` cache lifetime.
- After deploy: `pnpm seo:audit https://ricwell.com` (offers should now carry a return policy and shipping details).

## Definition of done
Gate run before push; after merge set the `Branch` line, remove the in-flight line, delete the branch and worktree.
