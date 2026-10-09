# ADR-027: Navigation builder and faceted filter menus

- **Status:** Accepted
- **Date:** 2026-10-09
- **Plan reference:** PLAN §7.3, ADMIN-IMPROVEMENTS-PLAN §8

## Context
Navigation menus and storefront catalog filters were previously decoupled or hardcoded:
1. `SiteHeader` and `SiteFooter` blocks held hardcoded inline links (max 8) and did not query the database `menus` table at storefront render time.
2. The admin menu editor (`apps/admin/src/routes/_store/online-store/menus.tsx`) only supported flat/arrow-button manipulation with limited link types and no visual drag-and-drop.
3. Collection catalog filtering was limited to a simple sort dropdown and an in-stock toggle, with no multi-attribute faceted filtering (brands, price range, availability, categories, tags, variant options).

Key constraints:
- **Additive per ADR-009:** Block schema changes (`menuHandle` on `SiteHeader` and `SiteFooter.columns`, `filterMenuHandle` on `CollectionListing`) must be additive with zero block version bumps, gracefully falling back to inline links or default sorting when menus are omitted or absent.
- **Tenant Isolation (Rule 1):** Menu items and facet queries must strictly isolate tenant data and prevent cross-tenant leakage.
- **Server-side faceted queries:** Filtering and facet counts must execute server-side in a single tenant transaction using parameterized Drizzle queries only (no string-built SQL), with bounded inputs (max 10 facets, max 20 values per facet, price range clamped, option names validated against the filter menu definition).
- **Protected default menus:** The store's default `header` and `footer` menus cannot be deleted or have their handles changed.
- **Cacheability & SEO:** Faceted catalog filters use URL search params (`?brand=a,b&price=100-500&in_stock=1`) so listing pages remain crawlable and shareable, while canonical tags point to the base collection URL. Navigation menus participate in the Next.js `"use cache"` scope tagged with tenant-prefixed `"nav"`.

## Decision
1. **Schema & Migration:**
   - Migration `0055_menus_kind.sql` adds column `kind` (`text NOT NULL DEFAULT 'navigation'`) and index `menus_tenant_kind_idx` on `(tenant_id, kind)` to `menus`.
   - `kind` discriminator distinguishes `'navigation'` menus from `'filter'` menus.
2. **Storefront Menu Resolution (Slice A):**
   - Added optional `menuHandle` to `SiteHeader` (defaults to `"header"`) and `SiteFooter.columns`.
   - Dynamic link targets are resolved server-side at render time in `resolvePageRenderData`:
     - `page` resolves by `targetId` to its hierarchical canonical path (`/pages/...`).
     - `collection`, `product`, `category`, and `brand` resolve by `targetId` to current slugs.
     - Dead targets (deleted resources) are cleanly omitted, never rendered broken.
   - When no menu exists, falls back cleanly to the block's inline links.
   - Tagged with tenant-prefixed `"nav"` cache tag in `cached-storefront.ts`.
3. **Admin Navigation Builder (Slice B):**
   - Menus table (`DataTable`) displaying title, handle, kind, item count, usage location, and update timestamps.
   - Dedicated route `menus_.$handle.tsx` featuring drag-and-drop reordering and nesting powered by `@dnd-kit` (`@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0`, `@dnd-kit/utilities@3.2.2`), with keyboard accessibility and up/down non-pointer fallbacks.
   - Max hierarchy depth capped at 3 levels.
   - Resource drawer picker supporting Pages, Collections, Categories, Brands, Products, Blog, Policies, Search, Account/Login, Home, and Custom URLs (restricted to safe schemes `/`, `#`, `https:`, `mailto:`, `tel:`, with external opening only for `https:`).
   - Atomic save with dirty state / unsaved changes guard.
   - Header live preview strip rendering the menu structure in real-time.
4. **Filter Menus & Faceted Filtering (Slice C):**
   - Filter menu items validate strictly against Zod schema `{ id, type: "filter", filter: { kind, label, display, optionName?, collapsed? } }`.
   - Supported facet kinds: `availability`, `price`, `brand`, `category`, `collection`, `tag`, `option`.
   - Parameterized faceted filtering and facet count aggregation in `packages/domain/src/storefront/catalog.ts` in a single tenant transaction.
   - Bounded inputs enforced: max 10 facets evaluated, max 20 selected values per facet, price range clamped to non-negative integers.
   - Responsive storefront UI: desktop sidebar and mobile bottom-sheet drawer (`FacetedFilters.tsx`).

## Consequences
- **Positive:** Merchants gain full visual control over store navigation hierarchies and faceted product search/filtering without code edits. Storefront performance remains high via indexed DB queries and Next.js `"nav"` cache tags.
- **Enforced:** Real-database tests verify menu resolution, fallback behavior, protected defaults, facet count correctness, and bounded input clamping.
- **Dependencies:** `@dnd-kit/core`, `@dnd-kit/sortable`, and `@dnd-kit/utilities` added to `apps/admin` (pinned exact versions).

## Alternatives considered
- **External Search Engine (Typesense/Algolia):** Rejected for simplicity and cost. Postgres indexed queries provide sub-millisecond execution times for store catalogs within platform quotas.
- **Storing full URLs in menu items:** Storing static URLs causes broken links when page slugs or parents change. Storing `targetId` and resolving dynamically at render time guarantees unbreakable links.
