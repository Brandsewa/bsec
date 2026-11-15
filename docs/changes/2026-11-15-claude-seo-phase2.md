# SEO Phase 2: Organization schema, default share image, favicon, H1, blog title

- **Date:** 2026-11-15
- **Agent:** claude
- **Branch:** `feat/seo-phase2` (not merged yet)
- **Area:** domain, web, scripts, docs
- **Type:** feat
- **Supersedes:** none (continues `2026-11-15-claude-seo-geo-aeo-audit.md`; plan `docs/SEO-GEO-AEO-PLAN.md` section 4)

## Summary
First slice of Phase 2, every item code-only and tenant-scoped. After deploy every store gets: an Organization schema with a logo, contact point and profile links; a default `og:image` and `twitter:image` on pages that have no picture of their own; the favicon and apple touch icon from Brand settings; one H1 on the home page and the collections page; and no more doubled store name in blog titles.

## What changed
- `packages/domain/src/storefront/seo.ts`: `getStorefrontBrandAssets` (logo, favicon, apple touch icon, share image resolved to public URLs; share image = SEO default image, else Brand social image, else logo); `generateOrganizationJsonLd` adds `@id`, `legalName` (only when different), `contactPoint` (only when the merchant set an email or phone); `cleanSameAs` keeps absolute https URLs only.
- `packages/domain/src/blog/seo.ts`: `brandedTitle` appends the store name only when the title does not already contain it (ricwell's blog category title was `... | Ricwell | ricwell`).
- `apps/web/src/server/cached-storefront.ts`: `getCachedBrandAssets`, tagged `theme`, `store-shell` and `seo` so Brand publish and SEO settings changes refresh it.
- `apps/web/src/app/layout.tsx`: store metadata now sets `icons` (favicon, apple), a default `openGraph` (`website`, site name, share image) and `twitter` card.
- `apps/web/src/lib/share-image.ts` (`withShareImage`): Next replaces a page's whole `openGraph` and `twitter`, so pages that set their own re-add the default image when they have none. Used on home, collections, collection, category, page and policy pages. A page with its own image is untouched.
- `apps/web/src/app/page.tsx`: Organization schema gets the logo (Brand settings, else the theme header or footer logo), legal name, support email and phone, and the footer's https social links (`apps/web/src/lib/theme-brand.ts`); a visually hidden H1 with the store name when no block supplies one (`apps/web/src/lib/has-h1.ts`: a Heading at `h1` or a slider with `titleTag: h1`).
- `apps/web/src/app/collections/page.tsx`: same hidden H1 ("Collections") and share image.
- `scripts/seo-audit.mjs`: warns on a missing `og:image` and favicon link; fails when the home page has no Organization schema; warns when it has no logo.
- Tests: `storefront-seo-phase2.test.ts`, `storefront-brand-assets.int.test.ts` (real Postgres, two stores), `apps/web/test/seo-phase2-helpers.test.ts`; `storefront-catchall-pages.test.ts` updated (mock for the new loader; a page with no image now gets a plain `summary` Twitter card instead of none).
- No migration, no new env var, no new queue, no new route.

## Decisions and trade-offs
- The footer, not `store_settings.social`, is the source of `sameAs`: that column has no UI and is always empty. Only https links are used (mailto and WhatsApp-style schemes are dropped).
- The hidden H1 is added only when no block already produces one, so a merchant's own H1 is never doubled. It is a store-name or "Collections" fallback, not a content decision.
- `sameAs` and contact data come from what the merchant already entered; nothing is invented.
- Not done in this slice (still in the plan): `hasMerchantReturnPolicy` and `shippingDetails` (need structured fields), image sitemap and hreflang, IndexNow, CollectionPage schema (low value for Google), a per-store web manifest, admin SEO health panel, scheduled audit, and the Cloudflare items (http to https 301, `www`, the one-year `robots.txt` `max-age`). Rule 14 (shipping) is untouched.

## Verification
- Ran in `C:\dev\bsec-seo2`: root `pnpm typecheck` (17 tasks) and `pnpm lint` (0 errors, existing warnings); `@bs/web` build (lists `/llms.txt`); `perf-budget-bundle.int.test.ts` 3 pass (50 KB page-script budget kept; all new code is server-side); domain unit tests; web suite; `storefront-brand-assets.int.test.ts` 2 pass on real Postgres.
- NOT verified: a running storefront in a browser (head tags, hidden H1, logo in the schema on a store with a theme header); Google's Rich Results Test; production. After deploy run `pnpm seo:audit https://ricwell.com` and look at the home page rows.

## Docs updated
- [x] `docs/SEO-GEO-AEO-PLAN.md` (Phase 2 items marked)
- [x] ADR not needed; `ARCHITECTURE.md` and `DEPLOYMENT.md` not needed (no route, table, job or env var)
- [x] `progress.md` (in flight)

## Follow-ups and open questions
- Merchant content, not code: product and blog images with empty alt text, and products with no description (Goomtee on ricwell).
- Phase 2 remainder as listed above.

## Definition of done
Gate run before push; after merge set the `Branch` line, remove the in-flight line, delete the branch and worktree.
