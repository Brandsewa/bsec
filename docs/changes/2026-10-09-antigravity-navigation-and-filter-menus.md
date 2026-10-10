# Admin Improvements Phase 6: Navigation builder and filter menus

- **Date:** 2026-10-09
- **Agent:** antigravity
- **Branch:** `feat/admin-improvements-phase-6` (not merged yet)
- **Area:** db, domain, contracts, blocks, block-editor, admin, web, docs
- **Type:** feature
- **Supersedes:** none

## Summary
Implements Phase 6 of `docs/ADMIN-IMPROVEMENTS-PLAN.md`: completes the store navigation builder and faceted product filter menus across both store admin and storefront.
1. **Slice A (Storefront uses menus):** Additive `menuHandle` on `SiteHeader` (default `"header"`) and on each `SiteFooter.columns`; server-side hierarchical menu rendering (dropdowns on desktop, accordions in mobile drawer); seamless fallback to inline links when no menu exists; dynamic target resolution at render time (`page` to canonical path, `collection`/`product`/`category`/`brand` to current slug) skipping dead targets; tenant cache invalidation with `"nav"` cache tags.
2. **Slice B (Navigation screen redesign):** Modern menus list (`DataTable`) displaying title, handle, kind, item count, usage location, and timestamps; protected default menus `header` and `footer` (cannot be deleted, handle locked); dedicated route `menus_.$handle.tsx` featuring drag-and-drop reordering and nesting powered by `@dnd-kit` (keyboard accessible, non-pointer up/down fallback buttons, max depth 3, dirty state / unsaved changes guard, atomic save); "Add item" drawer with comprehensive link-type picker and searchable resource list; live header preview strip.
3. **Slice C (Filter menus / Shop filter):** Migration `0055_menus_kind.sql` (`kind` `'navigation' | 'filter'`); Zod-validated filter items (`availability`, `price`, `brand`, `category`, `collection`, `tag`, `option`); `CollectionListing` optional `filterMenuHandle` prop; storefront faceted sidebar on desktop and bottom sheet drawer on mobile (`FacetedFilters.tsx`) driven by URL search params; parameterized Drizzle queries only with bounded inputs (max 10 facets, max 20 values per facet, price clamped to non-negative); EXPLAIN query plan evidence included below.

## What changed

### Slice A: Storefront Dynamic Navigation & Resolution
- **Blocks & Block Editor (`@bs/blocks`, `@bs/block-editor`):**
  - Added additive optional `menuHandle` prop to `SiteHeaderSchema` (defaults to `"header"`) and `SiteFooterColumnSchema` in `packages/blocks/src/registry.ts`. No block version bumps (ADR-009).
  - Extended `SiteHeaderProps` and `SiteFooterColumn` in `packages/blocks/src/types.ts` with resolved `resolvedMenu?: MenuItem[]`.
  - Updated `SiteHeaderView` in `packages/blocks/src/views.tsx` to render nested menu trees: dropdowns with chevron indicators on desktop, nested accordion disclosures in mobile slide-over sheet. When `resolvedMenu` is absent or empty, falls back cleanly to the block's inline `links` (preserving exact backward compatibility).
  - Added navigation styling in `packages/blocks/src/blocks.css` (`.bs-header-nav-item`, `.bs-header-dropdown`, `.bs-mobile-accordion`).
  - Added `MenuSelect` field primitive (`packages/block-editor/src/MenuField.tsx`) and registered it in `packages/block-editor/src/config.tsx` for header and footer block panels.
- **Domain & Storefront Cache Tagging:**
  - In `packages/domain/src/themes/block-data.ts` (`resolvePageRenderData`): queries store `menus` for referenced handles (`header` and footer column menus) in the same tenant transaction.
  - Dynamically resolves resource targets at render time:
    - `page`: resolves by `targetId` to canonical full public URL (`/` or `/pages/...`).
    - `collection`, `product`, `category`, `brand`: resolves by `targetId` to current slug.
    - Dead targets (deleted resources) are omitted from the rendered tree, preventing broken links.
  - In `apps/web/src/server/cached-storefront.ts`: tagged with tenant-prefixed `"nav"` cache tag (`tenantTag(ctx, "nav")`).
  - In `packages/domain/src/cache-invalidation.ts`: `invalidateCache(rt, tenantId, "menu_changed")` emits tenant-prefixed tag `"nav"`.

### Slice B: Admin Navigation Workspace & DnD Reordering
- **Contracts (`@bs/contracts/src/admin.ts`):**
  - Extended `MenuItem` additively with `targetId?: string`, `openInNewTab?: boolean`, and expanded `MenuItem.type` union to include `'brand' | 'blog' | 'policy' | 'home' | 'search' | 'account' | 'filter'`.
  - Added filter configuration schemas: `FilterKindSchema`, `FilterDisplaySchema`, `FilterItemConfigSchema`, `FilterMenuItemSchema`.
  - Added `MenuKindSchema` (`z.enum(["navigation", "filter"])`).
  - Extended `CreateMenuInput` and `UpdateMenuInput` to support `kind` and filter items.
- **Domain Services (`packages/domain/src/content-services.ts`):**
  - `listMenus`: returns all tenant menus with item counts, kind, and usage resolution (`SiteHeader` / `SiteFooter` / `CollectionListing`).
  - Protected defaults: `header` and `footer` menus cannot be deleted (`deleteMenu` throws `PROTECTED_DEFAULT_MENU`), and their handles cannot be altered.
  - URL safety validation: Custom URL targets restricted to safe schemes (`/`, `#`, `https:`, `mailto:`, `tel:` per ADR-010); `openInNewTab` permitted only for `https:` URLs.
  - Hierarchy depth validation: Maximum depth capped at 3 levels.
  - Page deletion referential safety: updated `isPageReferencedInMenus` to check both target ID match (`item.type === 'page' && item.targetId === pageId`) and URL string match.
- **Admin UI Routes (`apps/admin`):**
  - `apps/admin/src/routes/_store/online-store/menus.tsx`: Rebuilt as shared kit `DataTable` displaying Title, Handle, Kind (`navigation` vs `filter` badge), Items count, Used in location badge, and Updated timestamp. Search input, kind filter dropdown, and "Add menu" drawer supporting title, handle, and kind selection.
  - `apps/admin/src/routes/_store/online-store/menus_.$handle.tsx`: Dedicated menu builder route featuring:
    - Drag-and-drop reordering and nesting powered by `@dnd-kit`.
    - Keyboard-accessible drag handles plus explicit Up / Down / Indent / Outdent non-pointer buttons for accessible keyboard-only interaction.
    - Max hierarchy depth of 3 levels with visual indentation (`pl-0`, `pl-6`, `pl-12`).
    - Unsaved changes guard (`useUnsavedGuard`) and atomic save button.
    - "Add item" / "Edit item" drawer with tabbed/select link-type picker and searchable resource list (Pages, Collections, Categories, Brands, Products, Blog, Policies, Search, Account/Login, Home, Custom URL).
    - Filter item mode for `kind === 'filter'` menus allowing merchants to configure facet attributes (`availability`, `price`, `brand`, `category`, `collection`, `tag`, `option`).
    - Live Header Preview Strip displaying the menu structure as it would render in the storefront header.
- **Dependency Justification for `@dnd-kit`:**
  - Added `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0`, and `@dnd-kit/utilities@3.2.2` to `apps/admin/package.json` (exact pinned versions).
  - Justification: `@dnd-kit` is lightweight (zero external dependencies), modular, fully accessible (built-in screen reader announcements and keyboard sensor support), and handles hierarchical tree nesting smoothly. No other drag-and-drop library exists in the monorepo.

### Slice C: Filter Menus & Faceted Catalog Filtering
- **Database Schema & Migration:**
  - Added migration `packages/db/migrations/0055_menus_kind.sql`: adds `kind text NOT NULL DEFAULT 'navigation'` and index `menus_tenant_kind_idx` on `(tenant_id, kind)`.
  - Registered in `packages/db/migrations/meta/_journal.json` at idx 49.
  - Schema updated in `packages/db/src/schema/content.ts`.
- **Domain Faceted Catalog Queries (`packages/domain/src/storefront/catalog.ts`):**
  - Added `StorefrontFacet`, `StorefrontFacetValue`, and `StorefrontFacetedResult` interfaces.
  - Extended `getStorefrontCollectionBySlug` with `filterMenuHandle?: string` and `filters?: Record<string, string[]>`.
  - Single tenant transaction: evaluates catalog products and aggregates facet counts for all configured facets in the filter menu:
    - Availability: count of in-stock products with active inventory `(on_hand - reserved) > 0`.
    - Price: computes catalog `minPrice` and `maxPrice`.
    - Brands: counts products grouped by brand slug.
    - Categories: counts products grouped by category slug.
    - Tags: counts products grouped by tag (using `unnest(tags)`).
    - Variant Options: counts products grouped by variant option value (using JSONB extraction `option_values->>'Color'`).
  - Parameterized Drizzle queries only with bounded inputs:
    - Maximum 10 facets evaluated per request.
    - Maximum 20 filter values per facet.
    - Price range values parsed and clamped to non-negative integers.
    - Variant option names strictly validated against the filter menu definition.
- **Storefront Faceted Filters UI (`apps/web`):**
  - Added `apps/web/src/components/catalog/FacetedFilters.tsx`:
    - Desktop: Sticky sidebar with accordion groups, checkboxes with counts, price range inputs, active filter badges, and "Clear all" button.
    - Mobile: Bottom-sheet slide-over drawer with filter count badge trigger button.
    - URL state: Updates search params (`?brand=a,b&price=100-500&in_stock=1`) via standard Next.js navigation. Canonical URL retains base path; filter links include `rel="nofollow"`.
  - Updated `apps/web/src/components/catalog/CollectionListingSection.tsx` and `apps/web/src/app/collections/[slug]/page.tsx` to pass resolved filter menu and render faceted filters alongside product grid.

## Database Query Plan Evidence (EXPLAIN ANALYZE)
Faceted product query performance was verified via `EXPLAIN ANALYZE` on Postgres 18:
```sql
EXPLAIN ANALYZE
SELECT p.id, p.title, p.handle
FROM products p
JOIN collection_products cp ON cp.tenant_id = p.tenant_id AND cp.product_id = p.id
WHERE p.tenant_id = '...'
  AND cp.collection_id = '...'
  AND p.status = 'active'
  AND EXISTS (
    SELECT 1 FROM variants v
    JOIN inventory_levels il ON il.tenant_id = v.tenant_id AND il.variant_id = v.id
    WHERE v.tenant_id = p.tenant_id AND v.product_id = p.id AND (il.on_hand - il.reserved) > 0
  )
  AND EXISTS (
    SELECT 1 FROM brands b
    WHERE b.tenant_id = p.tenant_id AND b.id = p.brand_id AND b.slug = 'brand-alpha'
  );
```
**Execution output:**
- Planning Time: **0.304 ms**
- Execution Time: **0.148 ms**
- Uses `Index Scan` on `products_tenant_id_uniq`, `variants_tenant_product_idx`, `inventory_levels_tenant_var_loc_uniq`, `collection_products_tenant_col_prod_uniq`, and `brands_tenant_slug_uniq`.

## Verification Feedback Fixes (2026-10-09)
Following Claude's verification review (`docs/changes/2026-10-09-claude-navigation-phase-6-verification.md`), all 4 items were resolved:
1. **Cached Storefront Nav Tag & Test Counts:**
   - Updated `apps/web/test/cached-storefront.test.ts` to expect `tenantTag(TENANT_ID, "nav")` in `getCachedStorefrontCollection`, aligning with the write-side invalidation matrix.
   - Real test count: `apps/web` has **184 passing tests across 21 test files** (0 failures).
2. **Comprehensive Nav Tag Cache Invalidation:**
   - Extended `packages/domain/src/cache-invalidation.ts` with `brand_updated` event and added `tenantTag(tenantId, "nav")` to `product_updated`, `page_published`, `collection_updated`, and `brand_updated`.
   - Wired cache invalidation into `packages/domain/src/catalog-services.ts` (`createProduct`, `deleteProduct`, `createBrand`, `updateBrand`, `deleteBrand`).
   - Added unit tests in `packages/domain/test/cache-invalidation.test.ts` (12/12 passed) and real-DB integration test in `packages/domain/test/storefront-menus.int.test.ts` proving that page slug renaming triggers `nav` invalidation and resolves the menu item to the new canonical path.
3. **Price Facet Filter Single EXISTS Bound:**
   - In `packages/domain/src/storefront/catalog.ts`, merged `priceMin` and `priceMax` filters into a single `EXISTS (SELECT 1 FROM variants v WHERE v.tenant_id = p.tenant_id AND v.product_id = p.id AND v.price >= ${min} AND v.price <= ${max})`.
   - Added test in `packages/domain/test/storefront-menus.int.test.ts` with product `pStraddle` possessing variants at ₹5.00 and ₹90.00; confirmed filtering for ₹20.00–₹40.00 correctly excludes it.
4. **Browser Walkthrough Script & Heavy Test Run:**
   - Committed `e2e/walkthrough-phase6.mjs`. **Note on Walkthrough Script:** The RPC and API layer is statefully mocked in this script to verify client-side rendering, TanStack router routes, `@dnd-kit` drag handles, keyboard indent/reorder buttons, responsive header dropdowns (desktop hover), mobile slide-over drawers with accordion disclosures, and collection filter sidebars / bottom sheets at 375 px and desktop. It is **not** a live backend run; backend and database queries are verified against real PostgreSQL via `storefront-menus.int.test.ts` and `test:heavy:local`.
   - Executed `pnpm test:heavy:local`: Initial run encountered the known Windows worker crash (exit code 3221226505 / 0xC0000005) on 3 worker forks (`migration-0008-flags`, `cancel-restores-stock`, `finance-roles`), each of which passed individually; the subsequent full re-run passed completely (**95 test files, 2,001 tests passed**).

## Verification Evidence
- **Docs Check:** `pnpm docs:check` passed (`docs:check ok`).
- **Typecheck:** `pnpm typecheck` passed (clean across all 15 workspaces, 15/15 successful).
- **Lint:** `pnpm lint` passed (0 errors across all 15 workspaces).
- **Monorepo Build:** `pnpm build` passed (6/6 successful: Next.js storefront, Vite admin SPA, Vite superadmin SPA, worker, packages).
- **Domain Fast Tests:** `pnpm --filter @bs/domain test:fast` passed (46/46 files passed, 390/390 tests).
- **Real Database Integration Tests (`postgres://postgres:postgres@localhost:55432/postgres`):**
  - `packages/domain/test/storefront-menus.int.test.ts`: 8/8 passed (real Postgres):
    1. `resolvePageRenderData resolves SiteHeader menu dynamically and drops dead targets`
    2. `resolvePageRenderData falls back to inline links when menu does not exist`
    3. `createMenu, updateMenu, and deleteMenu respect protected defaults (header, footer)`
    4. `rejects unsafe URL schemes in custom link items`
    5. `enforces max depth 3 in menu items`
    6. `isPageReferencedInMenus detects page references by targetId`
    7. `filter menu CRUD and faceted catalog filtering with bounded inputs`
    8. `executes faceted collection query with sub-millisecond EXPLAIN ANALYZE plan`
  - `packages/db test`: 41/41 passed across 5 test files (including `b2-grants.int.test.ts` for migration 0055).
  - `pnpm test:heavy:local`: 95/95 test files passed, **2,001/2,001 tests passed** (duration: 245.17s).
- **Storefront Web Tests:** `pnpm --filter @bs/web test` passed (21/21 files passed, **184/184 tests**).
- **Blocks & UI Tests:** `packages/blocks`: 114/114 passed (`packages/blocks/test/theme-pages.test.tsx`).
- **Browser Walkthrough:** `node e2e/walkthrough-phase6.mjs`: **45/45 checks passed** across desktop (1280x800) and mobile (375x812).

## Definition of Done Checklist
- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (real-DB test for anything touching tenancy, money, auth or permissions).
- [x] `docs/ARCHITECTURE.md` updated if you changed structure, routes, tables, jobs, auth, blocks, env vars or gates; "Last verified" commit bumped.
- [x] ADR written or updated if you made or changed an architectural decision (ADR-027).
- [x] `DEPLOYMENT.md` / `infra/coolify/RUNBOOK.md` updated if env vars, services, ports or the deploy pipeline changed (N/A, no infra changes).
- [x] A change record in `docs/changes/` (required) and `progress.md` status/known-gaps/in-flight updated.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: what you verified live, what you only read, what you did not do.

