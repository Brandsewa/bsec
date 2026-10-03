# Catalog Verification Follow-ups: Internal Read-Backs, Post-Commit Cache Invalidation, and Real-Postgres Integration Tests

- **Date:** 2026-10-03
- **Agent:** antigravity
- **Branch:** `feat/catalog-a-f`
- **Area:** domain, db, tests
- **Type:** fix
- **Supersedes:** none

## Summary
Addressed all verification follow-ups identified from Claude's review on Catalog Phases A to F:
1. Write-only callers (`products.write` without `products.read`) no longer get `Forbidden` on post-mutation read-backs; internal loaders (`loadProductDetailInternal`, `loadCategoryDetailInternal`, `loadCollectionDetailInternal`, `loadBrandDetailInternal`, `loadLocationDetailInternal`) are used immediately post-commit without requiring `products.read` permission.
2. Cache invalidations (`invalidateCache`) in `updateProduct`, `updateVariant`, `adjustInventory`, and category, collection, and public review mutations now execute strictly after transaction commit.
3. Added a comprehensive real-PostgreSQL integration test suite `packages/domain/test/catalog.int.test.ts` covering 3-level category tree limits, delete guards, collection ordering, brand deletion and product unlinking, location constraints, product primary category partial unique index, and tenant RLS isolation.

## What changed
- `packages/domain/src/catalog-services.ts`:
  - Extracted internal getters (`loadProductDetailInternal`, `loadCategoryDetailInternal`, `loadCollectionDetailInternal`, `loadBrandDetailInternal`, `loadLocationDetailInternal`) for internal post-commit data hydration.
  - Public `getProduct`, `getCategory`, `getCollection`, `getBrand`, and `getLocation` retain standard `products.read` permission checks before delegating to internal loaders.
  - Moved `invalidateCache` outside `withTenant` in `updateProduct`, `updateVariant`, `adjustInventory`, `createCategory`, `updateCategory`, `deleteCategory`, `createCollection`, `updateCollection`, and `deleteCollection`.
  - In `deleteBrand`, explicitly set `brandId: null` on matching products before deleting the brand row to prevent composite foreign key `(tenant_id, brand_id)` null constraint violations in Postgres.
  - In `deleteProduct`, added `.returning()` to verify deletion and throw `Product not found` if no matching row existed in the caller's tenant.
- `packages/domain/src/review-services.ts`:
  - Moved `invalidateCache` in `submitPublicReview` outside the transaction to ensure cache invalidation happens only after commit.
- `packages/domain/test/catalog.int.test.ts`:
  - Real-PostgreSQL integration test suite testing write-only actors, category depth and delete guards, collection manual ordering, brand delete & product unlinking, location constraints, primary category partial unique index enforcement, and tenant RLS isolation under `app_rw`.

## Decisions and trade-offs
- Internal loaders (`load*DetailInternal`) are used exclusively for post-commit read-backs within the service methods after a write permission check (`products.write`) has already passed.
- All cache invalidations execute outside `withTenant` so concurrent storefront requests cannot read or re-cache uncommitted stale data.

## Verification
- `pnpm typecheck`: 15 packages passed cleanly (0 errors).
- `pnpm lint`: 15 packages passed cleanly (0 errors).
- `pnpm docs:check`: ok.
- `pnpm --filter @bs/domain test:fast`: 28 test files passed (238/238 tests).
- `pnpm --filter @bs/domain test:heavy` (`vitest run --no-file-parallelism int.test.ts`): 61 test files passed (1,179/1,179 tests), including `catalog.int.test.ts` (10/10) and `reviews.int.test.ts` (6/6).
- `pnpm --filter @bs/admin test`: 3 test files passed (25/25 tests).
- `pnpm --filter @bs/web test`: 17 test files passed (158/158 tests).
- `pnpm build`: 6 packages built successfully.

## Definition of done
- [x] Code follows rules; the verification gate passes.
- [x] Real-DB tests added and passed for tenancy, catalog domain constraints, write-only actors, and RLS isolation.
- [x] Change record created in `docs/changes/2026-10-03-antigravity-catalog-verification-fixes.md`.
- [x] No secrets, no generated files, no unrelated edits in the diff.
