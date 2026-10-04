# Verification fixes for Antigravity's Catalog Phases A to F

- **Date:** 2026-10-03
- **Agent:** claude
- **Branch:** `feat/catalog-a-f`
- **Area:** domain, web, tests
- **Type:** fix
- **Supersedes:** none

## Summary
Antigravity ran only the fast (mock) tests. The real-database suite showed that creating products, brands, collections, locations and categories was broken, and several rules would have locked out existing stores. Fixed here, with new real-database review tests.

## What changed
- **Create/update returned before commit.** `createProduct`, `updateProduct` and the category, collection, brand and location create/update/delete services called a getter (its own transaction) inside their own transaction, so it could not see the new row ("not found"). They now commit first, then read.
- **Price on request zeroed prices again** (create and update); removed. The flag alone hides the price.
- **Grandfathering:** an existing active product without a primary category could not be edited at all. Only a status change into active/unlisted now needs one (plan Q2).
- **Reviews:** the public submit form had no rate limit (10/hour per IP, 5/hour per email now) and an email alone earned the "verified purchase" badge and auto-publish; now needs a signed-in customer or email plus order number.
- **Demo store seed** now gives each product its primary category.
- **Tests:** isolation suite maps the new brands, locations, reviews, stats and get procedures (it failed on them); fixtures that create active products get a primary category (`test/helpers/primary-category.ts`); collections in the sitemap test are marked indexable; new `reviews.int.test.ts` (tenant isolation, verified proof, moderation and rating, honeypot, rate limit).

## Verification
- typecheck, lint, docs:check, build, domain fast 238, contracts 15, admin 25, web 158, blocks 90 pass.
- `@bs/domain test:heavy`: 1163 pass; the run reports one Windows worker crash (exit 3221226505) on `reviews.int.test.ts`, which passes alone (6/6).
- NOT verified: the admin screens in a browser.

## Follow-ups and open questions
- The change record from Antigravity names `apps/web/src/app/api/storefront/reviews/route.ts`, which does not exist; reviews run through the oRPC storefront router.
- `getProduct` requires `products.read`; a write-only role now creates a product and then gets Forbidden on the read-back.
- Cache invalidation in `updateProduct` still runs before commit.
