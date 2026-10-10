# ADR-026: Page hierarchy and canonical hierarchical URLs

- **Status:** Accepted
- **Date:** 2026-10-09
- **Plan reference:** PLAN §7.3, ADMIN-IMPROVEMENTS-PLAN §7

## Context
Store content pages (e.g. About, Company, Leadership, FAQ) were previously flat resources where each page existed solely at `/pages/[slug]`. Indian D2C brands require structured informational hierarchies (e.g. `Company > About Us > Leadership`), both for clear customer navigation and for search engine indexation.

Key constraints:
1. **Multi-tenancy isolation (Rule 1):** Page references across tenants must be structurally impossible at the database level.
2. **Canonical public URLs & SEO:** A page must have a single canonical public URL based on its ancestor chain (`/pages/<ancestors>/<slug>`). Non-canonical accesses (e.g. legacy flat `/pages/<slug>` or wrong ancestor paths) must issue HTTP 308 permanent redirects to the canonical URL.
3. **Data integrity:** Hierarchies must never contain cycles and must respect a maximum depth limit (3 levels).
4. **Referential safety:** Deleting a page with children or a page linked in store navigation menus must be refused.
5. **Cache invalidation (Rule 5):** Any parent or slug modification must invalidate Next.js cache tags for the modified page and all its descendants using tenant-prefixed cache tags (`tenantTag(tenantId, "page", slug)`).

## Decision
1. **Schema & Tenancy:**
   Add `parent_id uuid NULL` to `pages` in migration `0054_pages_hierarchy.sql`. Enforce tenant isolation using a composite tenant foreign key `tenantForeignKey(table.tenantId, table.parentId, () => [table.tenantId, table.id])`, with an index on `(tenant_id, parent_id)`.
2. **Hierarchy Validation:**
   In `packages/domain/src/content-services.ts`:
   - Enforce maximum depth of 3 levels.
   - Prevent circular parent references during page creation and updates.
   - Disallow the `home` page and theme system pages from having parents or acting as parents to regular custom pages.
3. **Canonical Storefront Route & Redirects:**
   - Migrate Next.js storefront route `apps/web/src/app/pages/[slug]` to the catch-all `apps/web/src/app/pages/[...path]`.
   - Resolve pages by the terminal path segment (`slug`), verify the entire ancestor chain in `getStorefrontPageByPath`.
   - If accessed via an incorrect ancestor path or shallow path, issue a `308 permanentRedirect` to the canonical path.
   - Emit hierarchical breadcrumb JSON-LD structured data and canonical link tags.
4. **Deletion Safety:**
   Refuse deletion in `deletePage` if the page has child pages (`childCount > 0`) or is referenced by any store menu in `schema.menus`.
5. **Cache Invalidation:**
   When a page's slug or parent changes, collect all descendant slugs and emit `extraSlugs` invalidation on `page_published` through `invalidateCache`.

## Consequences
- **Positive:** Merchants can organize pages hierarchically with auto-generated canonical URLs and live preview in the admin drawer. SEO metadata and breadcrumbs automatically match the hierarchy. Search engines receive 308 permanent redirects for old/partial URLs.
- **Enforced:** Real-database tests (`packages/domain/test/pages-hierarchy.int.test.ts`) assert that cross-tenant parent assignments are rejected by the composite FK, cycles and depth > 3 are rejected, and deletion with children/menu links is refused.
- **Neutral:** Storefront catch-all route handles all nested sub-paths without breaking flat URLs.

## Alternatives considered
- **Nested paths stored as a static column in DB:** Storing `path` directly on `pages` risks data inconsistencies if an ancestor's slug or parent changes. Computing the canonical path dynamically via ancestor traversal ensures full consistency.
- **Client-side redirect or 302:** Rejected. SEO requires 308 permanent redirect to preserve page rank and link equity.
