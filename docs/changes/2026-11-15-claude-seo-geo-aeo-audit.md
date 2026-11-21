# SEO, GEO and AEO audit of merchant storefronts, and first fixes

- **Date:** 2026-11-15
- **Agent:** claude
- **Branch:** `feat/seo-geo-aeo` (merged in #264, d0fa25a)
- **Area:** domain, web, scripts, docs
- **Type:** fix
- **Supersedes:** none

## Summary
Audited the live store `ricwell.com` (read-only GETs) and the storefront SEO code against Google, AI-crawler and llms.txt practice. The most serious defect: product schema published the stored minor-unit price (`63700` for a ₹637 product). Also fixed the generic home title and description, blocked AI search agents, private paths missing from `robots.txt`, no `llms.txt`, policy pages that served identical stock text on every store, and a breadcrumb pointing at a 404. The full findings table and the remaining work are in `docs/SEO-GEO-AEO-PLAN.md`.

## What changed
- `packages/domain/src/storefront/seo.ts`: product JSON-LD converts price with `toMajorUnits` and adds `@id`, `url`, `sku`, `category`, seller, valid `gtin`, `PreOrder`/`BackOrder`, market prefix; `buildHomeSeoMetadata`; robots uses `PRIVATE_PATHS`, `Allow: /`, and emits a group only for blocked bots; `DEFAULT_AI_CRAWLERS` now allows search and user agents and training bots and blocks only `CCBot` and `Bytespider`; sitemap lists only published policies and XML-escapes `<loc>`; `generateLlmsTxt` and `getStorefrontLlmsTxt`; `og:url` and `og:site_name` on product, category and collection metadata.
- `apps/web/src/app/llms.txt/route.ts` (new), home, product, policy, collections and search pages, `ProductCard` alt fallback.
- `scripts/seo-audit.mjs` and `pnpm seo:audit <url>`: a read-only checker for any public store (robots, llms.txt, sitemap, then a sample of pages: status, title, description, canonical, noindex, H1, alt text, Open Graph, schema price against the visible price, breadcrumb URLs).
- `packages/db/migrations/0105_seo_reset_old_ai_crawler_defaults.sql` (data only, no schema change): sets `seo_settings.ai_crawlers` to NULL for every store whose row still equals the old default (five blocked AI bots), so existing stores such as ricwell follow the new default after deploy. Runs per tenant because the table is FORCE RLS. Rows a merchant edited are untouched. Listed in `docs/ARCHITECTURE.md` section 7.
- `packages/domain/test/migration-0105-seo-crawlers.int.test.ts` (new, real Postgres): old-default row reset, edited row and NULL row untouched, safe to run twice, run as `app_owner` under FORCE RLS.
- No new env var, no new queue.

## Decisions and trade-offs
- **AI crawler defaults flipped to allow** (owner goal: stores must be citable by AI agents). Blocking training bots does not hide a store from Google Search, so the choice stays per store in Settings. Existing stores: owner asked (2026-11-15) that the update reach current stores too, so migration 0105 resets rows that still equal the old default; a merchant who deliberately saved exactly those five blocks is indistinguishable and is reset as well (they can block again in Settings). Rows with any other content keep the merchant's choice. `robots.txt` is cached up to a day at the CDN, so the change shows within about 24 hours.
- Allowed bots get no `robots.txt` group of their own. A bot with its own group ignores the `*` group, so an explicit `Allow: /` group would let it into cart and checkout.
- Unpublished policies are `noindex` and left out of the sitemap: the fallback text is the same on every store (duplicate content) and says it is hosted on the platform.
- The `Offer` list stays an array of per-variant offers (the existing shape); an `AggregateOffer` was not introduced.
- Not changed: Shiprocket or any shipping integration (AGENTS rule 14). No merchant-controlled code (rule 8).

## Verification
- Ran in `C:\dev\bsec-seo`: `pnpm --filter @bs/domain test:fast` 705 pass (73 files); `pnpm --filter @bs/web exec vitest run` 256 pass (35 files; one test, `seo-endpoints.test.ts`, was updated for the new robots groups); `storefront-isolation.int.test.ts` 18 pass against a real Postgres on port 55432 (borrowed from another worktree's test container); `tsc --noEmit` for `@bs/domain` and `@bs/web` clean; `pnpm --filter @bs/domain --filter @bs/web lint` 0 errors (6 existing warnings); `pnpm --filter @bs/web build` succeeds and lists `/llms.txt`; `pnpm docs:check` ok.
- Ran `node scripts/seo-audit.mjs https://ricwell.com --sample 12` against production **before** the fix: 15 failures, which match the findings in the plan (price 100x, `Home` title, default description, missing canonical, breadcrumb to a 404).
- Root `pnpm typecheck` (17 tasks) and `pnpm lint` (0 errors, 6 existing warnings) pass; `pnpm docs:check` ok; `packages/db` tests 50 pass; full domain heavy suite (`vitest run int.test.ts`, shared local Postgres) 143 files and 2976 tests pass on the second run (the first run lost two Windows worker processes, exit code 3221226505, in unrelated files; the re-run was clean); `migration-0105-seo-crawlers.int.test.ts` 2 pass.
- NOT verified: the new `/llms.txt` route, home metadata and policy metadata on a running store (no local stack was started: it needs the gitignored `.env.dev`, a seeded database and a build); migration 0105 has not run against production data (it ran on an empty migrated test database plus the three fixture rows); `pnpm gate:quick` is run by the pre-push hook, not before this commit; nothing was checked in Google's Rich Results Test; no live store was changed.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (storefront routes: `robots.txt`, `sitemap.xml`, `llms.txt`)
- [x] ADR not needed (no architectural decision; the crawler default is a product choice recorded here and in the plan)
- [ ] `DEPLOYMENT.md` not needed
- [x] `progress.md` (in flight)
- [x] `docs/SEO-GEO-AEO-PLAN.md` (new)

## Follow-ups and open questions
- Deployed 2026-11-15 (migration 0105 applied). `pnpm seo:audit https://ricwell.com` after deploy: price, home title, canonical, breadcrumb and `/llms.txt` failures gone; one failure left, a product with an empty description (merchant content). The origin `robots.txt` now blocks only CCBot and Bytespider, but Cloudflare still served the old cached copy (`s-maxage=86400`, about 3.5 h old at check time), so it should clear within a day: re-check `https://ricwell.com/robots.txt`. Purging the cache is a Cloudflare change and needs the owner's yes.
- Phase 2 list in the plan (H1 on home and collections, Organization logo, return policy and shipping schema, default `og:image`, favicon, image sitemap and hreflang, IndexNow, http to https 301 and `www`, the one-year `max-age` on `robots.txt`).
- After deploy, re-run `pnpm seo:audit https://ricwell.com` and expect the price and breadcrumb failures to be gone.

## Definition of done
Gate run (see Verification): typecheck, lint, build, `docs:check`, domain fast and heavy, db and web suites pass; `pnpm gate:quick` runs in the pre-push hook and a browser check on a running store is still to do. After merge: set the `Branch` line, remove the `progress.md` in-flight line, delete the branch and worktree. No secrets or generated files in the diff.
