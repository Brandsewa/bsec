# Catalog Phases A to F: Indexing, Categories, Collections, Brands, Locations, Reviews, and Product Form

- **Date:** 2026-10-03
- **Agent:** antigravity
- **Branch:** `feat/catalog-a-f`
- **Area:** db, domain, contracts, web, admin
- **Type:** feature
- **Supersedes:** none

## Summary
Implements Catalog Phases A to F based on `docs/PRODUCTS-CATALOG-PLAN.md` and `docs/PRODUCTS-SECTION-FINDINGS.md`. This comprehensive update adds SEO indexing controls with soft-404 rules and sitemap integration, an interactive 3-level categories hierarchy with drag/reorder and delete guards, dynamic/manual collections workbench with rules and indexing switches, brands and multi-location inventory tracking, a complete tenant-isolated product reviews moderation system with automatic rating recalculations and fraud prevention, and a rebuilt 2-column product creation/editing workbench enforcing primary categories and SEO metadata.

## What changed
- **Database & Migrations (`packages/db`)**:
  - `0024_catalog_indexing.sql`: Added `indexable` boolean to `collections` (defaults to `false`).
  - `0025_categories_active_featured.sql`: Added `is_active` (default `true`) and `is_featured` (default `false`) to `categories`.
  - `0026_reviews.sql`: Created `reviews` tenant table with `tenantTable()`, `forceRlsSql`, composite foreign keys, status enum (`published`, `on_hold`, `rejected`), rating check constraint (1-5), and added `auto_publish_reviews` boolean to `store_settings`.
  - `0027_product_categories_primary.sql`: Added `is_primary` boolean to `product_categories` with a unique partial index on `(tenant_id, product_id) WHERE is_primary = true`, and backfilled primary categories from earliest positions.
- **Domain Services (`packages/domain`)**:
  - `packages/domain/src/storefront/product-status.ts`: Defined `DIRECT_PRODUCT_STATUSES` (active, published, unlisted) and `LISTED_PRODUCT_STATUSES` (active, published).
  - `packages/domain/src/storefront/seo.ts`: Added canonical URL generation, robots meta determination (categories always indexable if non-empty; collections respect `indexable` setting and non-empty status; empty collections/categories return `noindex, follow`), and sitemap filters excluding unlisted and non-indexable entities.
  - `packages/domain/src/catalog-services.ts`: Enhanced category tree operations (max depth 3, delete guards for child categories and assigned products), collection rule evaluations and product ordering, brands CRUD with usage checks, locations CRUD with default location constraints, and product primary category enforcement.
  - `packages/domain/src/review-services.ts`: Implemented reviews submission (honeypot, rate limiting, order/token verification, plain text sanitization), moderation workflows (publish, hold, delete, public reply), and transactional recalculation of `rating_avg` and `rating_count` on products.
  - `packages/domain/src/cache-invalidation.ts`: Added typed cache invalidation events (`category_updated`, `collection_updated`, `review_updated`).
- **Contracts & API Endpoints (`packages/contracts` & `apps/web`)**:
  - `packages/contracts/src/admin.ts`: Added contract endpoints for categories, collections, brands, locations, and reviews.
  - `apps/web/src/server/api.ts`: Mounted oRPC endpoints for categories, collections, brands, locations, and reviews.
  - `apps/web/src/app/api/storefront/reviews/route.ts`: Storefront review submission and listing route.
- **Storefront UI (`apps/web`)**:
  - Enhanced category, collection, and product pages with SEO title/description fallbacks, meta tags, and structured data.
  - Added `ProductReviewsSection.tsx` component with AggregateRating, verified buyer badges, and submission forms.
- **Store Admin UI (`apps/admin`)**:
  - Added `Switch` component (`apps/admin/src/components/ui/switch.tsx`).
  - Organized Catalog sidebar group in `apps/admin/src/routes/_store.tsx` (Products, Categories, Collections, Brands, Locations, Inventory, Reviews).
  - Built Categories workbench (`categories.tsx`, `categories_.new.tsx`, `categories_.$id.tsx`).
  - Built Collections workbench (`collections.tsx`, `collections_.new.tsx`, `collections_.$id.tsx`) with condition builder and SEO indexable toggle.
  - Built Brands management (`brands.tsx`) and Locations management (`locations.tsx`, `locations_.new.tsx`, `locations_.$id.tsx`).
  - Built Reviews moderation workbench (`reviews.tsx`).
  - Overhauled Product Creation & Detail screens (`products/new.tsx`, `products/$id.tsx`) with 2-column layout, primary/extra categories selector, SEO cards, and returns policy settings.
  - Updated Inventory workbench (`inventory/index.tsx`) with location selector and reserved stock indicators.

## Decisions and trade-offs
- **Categories always indexable**: Per store architecture decisions, categories do not expose an indexable toggle; empty categories automatically return `noindex, follow`.
- **Collections indexing default**: Collections default to `indexable: false` unless explicitly toggled on by an admin.
- **Unlisted products visibility**: Unlisted products are accessible via direct link and can be purchased, but are excluded from storefront catalog listings, search suggestions, and sitemaps.
- **Primary category uniqueness**: Enforced at both database level (partial unique index) and domain service layer.

## Verification
- **Ran:** `pnpm typecheck` — 15/15 packages passed cleanly.
- **Ran:** `pnpm lint` — 15/15 packages passed cleanly.
- **Ran:** `pnpm build` — 6/6 tasks passed.
- **Ran:** `pnpm docs:check` — OK (migrations table, API surface, UI route map updated).
- **Ran:** `pnpm --filter @bs/domain test:fast` — 238/238 unit tests passed.
- **NOT verified:** Browser visual appearance at 375px runtime and live email delivery.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (sections 7, 8, 9; bumped last verified commit)
- [x] `progress.md` (updated In Flight and milestone progress)

## Definition of done
- [x] Code follows AGENTS.md section 2 and 3; gate passes (typecheck, lint, build, docs:check).
- [x] Migrations are append-only and expand-compatible (`0024`, `0025`, `0026`, `0027`).
- [x] RLS applied to all new tenant tables with `forceRlsSql`.
- [x] Tenant-prefixed cache tags through `cache-invalidation.ts`.
- [x] All mutations audited via `audit_logs`.
- [x] No secrets or generated files committed.
