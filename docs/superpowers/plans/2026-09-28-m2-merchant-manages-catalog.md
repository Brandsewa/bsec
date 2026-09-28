# M2: Merchant Manages Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement M2 catalog and content capabilities allowing merchants to create and manage products, variants, options, media (R2 + Cloudflare Images), categories, collections, brands, inventory levels/movements, CSV import/export, brand settings with WCAG AA contrast check and favicon generator, theme tokens, versioned block registry v1 (`packages/blocks`), pages with rollback, navigation menus, and store admin UI screens, with 100% tenant isolation (FORCE RLS) and test coverage against PostgreSQL 18.

**Architecture:**
- **Database & RLS (`packages/db`):** 17 new `tenantTable()` definitions across catalog, media, inventory, branding, theme, pages, and menus with composite `(tenant_id, x_id)` FKs, tenant-first indexes, and explicit `FORCE ROW LEVEL SECURITY`. Search vector generated column with GIN index on `products`.
- **Block Registry (`packages/blocks`):** New workspace package providing 12 versioned block types (Hero, Banner, ProductGrid, CollectionGrid, ProductCarousel, Testimonials, Reviews, RichText, FAQ, Gallery, Newsletter, USP strip) with Zod/JSON schema validation on save and render, and migration pipelines.
- **Domain Services & Contracts (`packages/contracts`, `packages/domain`):** Type-safe oRPC contracts for admin catalog, inventory, media, branding, theme, pages, and menus; pure domain services executing via `withTenant()` with strict permission gating (`products.read/write`, `settings.write`, `theme.publish`, `content.write`).
- **Store Admin UI (`packages/ui`, `apps/admin`):** Ported Supabase design system components (FilterBar, MetricCard, DataTable); Store Admin screens for Products (list/detail), Inventory (stock levels/adjustments), Online Store (Theme tokens, Page builder, Menus), and Settings (Branding).
- **Integration & Security Testing:** Dynamic isolation test suite verification against real PostgreSQL 18 with 0-row cross-tenant guarantees, permission enforcement, and `relforcerowsecurity = true` validation.

**Tech Stack:** TypeScript 6.0.3, Drizzle ORM 0.45.3, PostgreSQL 18, oRPC 1.15.4, Zod 4.6.5, Vitest 5.0.2, TanStack Router, React 19, Tailwind CSS 4, Turborepo.

---

## Task Decomposition

### Task 1: Catalog, Inventory & Media Drizzle Schema

**Files:**
- Create: `packages/db/src/schema/catalog.ts`
- Modify: `packages/db/src/schema/index.ts`
- Test: `packages/db/test/schema.test.ts`

- [ ] **Step 1: Write test for catalog, inventory, and media schema definitions**
Add assertions in `packages/db/test/schema.test.ts` verifying all new catalog tables exist and are registered in `tenantTableNames`:
`products`, `product_options`, `variants`, `product_media`, `categories`, `product_categories`, `collections`, `collection_products`, `brands`, `locations`, `inventory_levels`, `inventory_movements`, `media`.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @bs/db test schema.test.ts`
Expected: FAIL (missing exports from schema).

- [ ] **Step 3: Implement catalog, inventory, and media schema**
In `packages/db/src/schema/catalog.ts`:
- Declare tables with `tenantTable()`:
  - `brands`: `id`, `name`, `slug`, `logoMediaId` (composite FK to media).
  - `media`: `id`, `storageKey`, `cfImageId`, `mime`, `bytes` (bigint), `width`, `height`, `alt`, `folder`, `uploadedBy`.
  - `locations`: `id`, `name`, `address` (jsonb), `pincode`, `isDefault`, `shiprocketPickupName`, `isActive`.
  - `products`: `id`, `title`, `slug`, `status`, `descriptionJson`, `shortDescription`, `brandId` (composite FK to brands), `productType`, `tags` (text[]), `seo` (jsonb), `taxClassId`, `hsn`, `requiresShipping`, `isFeatured`, `publishedAt`, `searchVector` (generated tsvector), `ratingAvg`, `ratingCount`, `deletedAt`. Unique constraint `(tenant_id, slug)`.
  - `product_options`: `id`, `productId` (composite FK to products onDelete cascade), `name`, `position`, `values` (text[]).
  - `variants`: `id`, `productId` (composite FK to products onDelete cascade), `sku`, `barcode`, `title`, `optionValues` (jsonb), `price` (bigint paise), `compareAtPrice`, `costPrice`, `weightGrams`, `dimensions`, `trackInventory`, `allowBackorder`, `position`, `imageMediaId` (composite FK to media). Unique constraint `(tenant_id, sku)`.
  - `product_media`: `id`, `productId` (composite FK to products), `mediaId` (composite FK to media), `variantId` (composite FK to variants), `position`, `alt`.
  - `categories`: `id`, `parentId` (composite FK to categories), `name`, `slug`, `description`, `imageMediaId` (composite FK to media), `position`, `path`, `seo` (jsonb). Unique constraint `(tenant_id, slug)`.
  - `product_categories`: `id`, `productId` (composite FK to products), `categoryId` (composite FK to categories), `position`. Unique `(tenant_id, product_id, category_id)`.
  - `collections`: `id`, `title`, `slug`, `type`, `rules`, `match`, `sortOrder`, `imageMediaId` (composite FK to media), `seo`, `published`. Unique `(tenant_id, slug)`.
  - `collection_products`: `id`, `collectionId` (composite FK to collections), `productId` (composite FK to products), `position`. Unique `(tenant_id, collection_id, product_id)`.
  - `inventory_levels`: `id`, `variantId` (composite FK to variants), `locationId` (composite FK to locations), `onHand`, `reserved`, `available` (generated stored: on_hand - reserved), `lowStockThreshold`. Unique `(tenant_id, variant_id, location_id)`, Check `reserved <= on_hand`.
  - `inventory_movements`: `id`, `variantId` (composite FK to variants), `locationId` (composite FK to locations), `delta`, `reason`, `referenceType`, `referenceId`, `note`, `actorId`.
- Re-export in `packages/db/src/schema/index.ts`.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @bs/db test schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
`git add packages/db/src/schema/ packages/db/test/ && git commit -m "feat(db): add catalog, inventory, and media schema definitions"`

---

### Task 2: Branding, Theme, Pages & Menus Drizzle Schema

**Files:**
- Create: `packages/db/src/schema/branding.ts`
- Create: `packages/db/src/schema/content.ts`
- Modify: `packages/db/src/schema/index.ts`
- Test: `packages/db/test/schema.test.ts`

- [ ] **Step 1: Write test for branding, theme, pages, and menus schema**
Add assertions in `packages/db/test/schema.test.ts` verifying:
`brand_settings`, `themes`, `pages`, `page_versions`, `menus` are declared via `tenantTable()` and registered.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @bs/db test schema.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement branding and content schema**
- In `packages/db/src/schema/branding.ts`:
  - `brand_settings`: `id`, `logoMediaId`, `logoDarkMediaId`, `logoWidthPx`, `faviconMediaId`, `appleTouchIconMediaId`, `socialImageMediaId`, `colors` (jsonb), `colorScheme`, `fontHeading`, `fontBody`, `fontScale`, `radius`, `buttonStyle`, `presetCode`, `version` (integer default 1). Unique `(tenant_id)`.
- In `packages/db/src/schema/content.ts`:
  - `themes`: `id`, `templateCode`, `name`, `tokens` (jsonb), `status`, `publishedAt`, `version`.
  - `pages`: `id`, `type`, `title`, `slug`, `seo` (jsonb), `status`, `publishedVersionId`, `draftVersionId`. Unique `(tenant_id, slug)`.
  - `page_versions`: `id`, `pageId` (composite FK to pages), `document` (jsonb: `{blocks: [...]}`), `createdBy`, `note`.
  - `menus`: `id`, `handle`, `title`, `items` (jsonb).
- Re-export in `packages/db/src/schema/index.ts`.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @bs/db test schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
`git add packages/db/src/schema/ packages/db/test/ && git commit -m "feat(db): add branding, themes, pages, and menus schema"`

---

### Task 3: Migration `0004_m2_tables.sql` with FORCE RLS

**Files:**
- Create: `packages/db/migrations/0004_m2_tables.sql`
- Modify: `packages/db/migrations/meta/_journal.json`
- Test: `packages/db/test/roles.int.test.ts`

- [ ] **Step 1: Write migration SQL with FORCE RLS**
Generate SQL creating all 17 tables with indexes, foreign keys, constraints, and call `forceRlsSql(table)` for every single tenant table:
`brands`, `media`, `locations`, `products`, `product_options`, `variants`, `product_media`, `categories`, `product_categories`, `collections`, `collection_products`, `inventory_levels`, `inventory_movements`, `brand_settings`, `themes`, `pages`, `page_versions`, `menus`.
Add entry to `_journal.json`.

- [ ] **Step 2: Run Postgres 18 integration test to verify migration runs cleanly**
Run: `pnpm --filter @bs/db test roles.int.test.ts`
Expected: PASS with all tables created and `FORCE ROW LEVEL SECURITY` verified.

- [ ] **Step 3: Commit**
`git add packages/db/migrations/ && git commit -m "feat(db): add migration 0004_m2_tables with FORCE RLS for all tenant tables"`

---

### Task 4: Setup `packages/blocks` Package with 12 Versioned Block Types

**Files:**
- Create: `packages/blocks/package.json`
- Create: `packages/blocks/tsconfig.json`
- Create: `packages/blocks/src/index.ts`
- Create: `packages/blocks/src/types.ts`
- Create: `packages/blocks/src/registry.ts`
- Create: `packages/blocks/src/blocks/*.ts` (12 block definitions)
- Test: `packages/blocks/test/registry.test.ts`

- [ ] **Step 1: Write tests for block registry and 12 blocks**
Test that each of the 12 blocks:
`Hero`, `Banner`, `ProductGrid`, `CollectionGrid`, `ProductCarousel`, `Testimonials`, `Reviews`, `RichText`, `FAQ`, `Gallery`, `Newsletter`, `UspStrip`
has `type`, `version: 1`, a valid Zod schema, default props, and validation passes on valid props and rejects invalid props.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @bs/blocks test`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/blocks` and 12 block definitions**
Define schemas and defaults for each block type:
- `Hero`: title, subtitle, ctaText, ctaLink, secondaryCtaText, secondaryCtaLink, backgroundMediaId, alignment, overlayOpacity.
- `Banner`: text, link, dismissible, variant (info, promo, warning).
- `ProductGrid`: title, collectionSlug, limit, columns, showPrice, showRating.
- `CollectionGrid`: title, collectionSlugs, columns.
- `ProductCarousel`: title, collectionSlug, limit, autoPlay.
- `Testimonials`: items: Array<{ quote, author, role, avatarMediaId }>.
- `Reviews`: title, showAggregate, limit.
- `RichText`: content (sanitized HTML/markdown-like rich text blocks: heading, paragraph, list).
- `FAQ`: items: Array<{ question, answer }>.
- `Gallery`: images: Array<{ mediaId, caption, link }>, layout (grid, masonry).
- `Newsletter`: title, subtitle, buttonText, placeholder.
- `UspStrip`: items: Array<{ icon, title, description }>.
Implement React renderers (semantic, token-styled).

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @bs/blocks test`
Expected: PASS.

- [ ] **Step 5: Commit**
`git add packages/blocks/ && git commit -m "feat(blocks): create packages/blocks with 12 versioned block definitions"`

---

### Task 5: Block Document Validation, Migration Pipeline & Sanitization

**Files:**
- Create: `packages/blocks/src/document.ts`
- Create: `packages/blocks/src/sanitize.ts`
- Modify: `packages/blocks/src/index.ts`
- Test: `packages/blocks/test/document.test.ts`

- [ ] **Step 1: Write unit tests for block document validation and migrations**
Verify:
- `validateBlockDocument()` validates `{ blocks: [...] }` against registry schemas.
- Reject unknown block types or invalid props.
- Unsanitized HTML in `RichText` is stripped/sanitized.
- Migration runner upgrades older block versions to current version.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @bs/blocks test document.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement validation, sanitization, and migration functions**
Implement `validateBlockDocument`, `validateBlock`, `sanitizeRichText`, and `migrateBlockDocument`.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @bs/blocks test document.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
`git add packages/blocks/ && git commit -m "feat(blocks): add block document validation, migration, and sanitization"`

---

### Task 6: Branding Utilities (WCAG AA Contrast, Favicon Generator, Curated Fonts)

**Files:**
- Create: `packages/domain/src/branding/contrast.ts`
- Create: `packages/domain/src/branding/favicon.ts`
- Create: `packages/domain/src/branding/fonts.ts`
- Test: `packages/domain/test/branding.test.ts`

- [ ] **Step 1: Write unit tests for branding utilities**
Verify:
- WCAG AA contrast ratio calculation:
  - Correct contrast ratio calculation between hex colors.
  - Passes for high contrast (e.g. black on white = 21:1 >= 4.5:1).
  - Flags failure for low contrast (e.g. #999 on #fff = ~2.8:1 < 4.5:1).
  - Suggests adjusted color to meet 4.5:1 threshold.
- Favicon generator:
  - Produces spec for 16x16, 32x32, 180x180, 192x192, 512x512 icons and web manifest JSON.
- Font list:
  - Returns curated Google Fonts list with self-hosted R2 path mappings, including Devanagari faces.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @bs/domain test branding.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement branding utilities**
Implement relative luminance calculation, contrast ratio formula, contrast fix suggester, favicon set generator, and curated font registry.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @bs/domain test branding.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
`git add packages/domain/src/branding/ packages/domain/test/branding.test.ts && git commit -m "feat(domain): add WCAG AA contrast check, favicon generator, and font registry"`

---

### Task 7: CSV Product Import & Export Utilities

**Files:**
- Create: `packages/domain/src/catalog/csv.ts`
- Test: `packages/domain/test/csv.test.ts`

- [ ] **Step 1: Write unit tests for CSV import and export**
Verify:
- Parse CSV with columns `title,slug,price,sku,stock,category`.
- Handles quoted strings, commas inside quotes, numeric conversions.
- Validates required fields and reports line-by-line errors.
- Serializes product list to CSV format matching import specification.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @bs/domain test csv.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement CSV parser and serializer**
Implement `parseProductCsv(csvContent)` and `serializeProductCsv(rows)`.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @bs/domain test csv.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
`git add packages/domain/src/catalog/csv.ts packages/domain/test/csv.test.ts && git commit -m "feat(domain): implement product CSV import and export utilities"`

---

### Task 8: Media Storage & Cloudflare Images Helpers

**Files:**
- Create: `packages/domain/src/media/storage.ts`
- Test: `packages/domain/test/storage.test.ts`

- [ ] **Step 1: Write unit tests for media storage helpers**
Verify:
- MIME type verification (accepts jpeg, png, webp, avif, gif, svg; rejects exe, html, etc.).
- Size check (max 10MB).
- Presigned PUT URL format generation.
- Cloudflare Images delivery URL formatting and dimensions extraction.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @bs/domain test storage.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement storage helpers**
Implement `generatePresignedUploadUrl()`, `validateMediaUpload()`, and `formatDeliveryUrl()`.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @bs/domain test storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
`git add packages/domain/src/media/ packages/domain/test/storage.test.ts && git commit -m "feat(domain): implement R2 and Cloudflare Images media storage helpers"`

---

### Task 9: oRPC Contracts for M2 in `packages/contracts/src/admin.ts`

**Files:**
- Modify: `packages/contracts/src/admin.ts`
- Test: `packages/contracts/test/contracts.test.ts`

- [ ] **Step 1: Write test for new admin contract routes**
Verify `adminContract` contains namespaces:
`products`, `categories`, `collections`, `brands`, `inventory`, `media`, `branding`, `themes`, `pages`, `menus`.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @bs/contracts test`
Expected: FAIL.

- [ ] **Step 3: Define oRPC schemas and routes in `admin.ts`**
Add:
- `products`: `list`, `get`, `create`, `update`, `delete`, `importCsv`, `exportCsv`.
- `categories`: `list`, `create`, `update`, `delete`.
- `collections`: `list`, `create`, `update`, `delete`.
- `brands`: `list`, `create`, `update`, `delete`.
- `inventory`: `list`, `adjust`.
- `media`: `createUploadUrl`, `confirmUpload`, `list`.
- `branding`: `get`, `update`, `publish`, `rollback`, `checkContrast`, `generateFaviconSet`.
- `themes`: `get`, `update`, `publish`.
- `pages`: `list`, `get`, `create`, `update`, `publish`, `rollback`.
- `menus`: `list`, `get`, `update`.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @bs/contracts test`
Expected: PASS.

- [ ] **Step 5: Commit**
`git add packages/contracts/src/admin.ts packages/contracts/test/ && git commit -m "feat(contracts): add M2 catalog, inventory, media, branding, theme, pages, and menus contracts"`

---

### Task 10: Domain Services in `packages/domain`

**Files:**
- Create: `packages/domain/src/catalog-services.ts`
- Create: `packages/domain/src/content-services.ts`
- Create: `packages/domain/src/brand-services.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/test/services.test.ts`

- [ ] **Step 1: Write tests for catalog and content domain services**
Test creating products with variants, stock ledger entries in `inventory_movements`, brand publishing with rollback, theme tokens update, page versioning with rollback.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @bs/domain test services.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement domain services**
All services wrap DB calls in `withTenant(rt._db.db, ctx.tenantId, async (tx) => { ... })`:
- `createProduct`, `updateProduct`, `listProducts`, `getProduct`, `deleteProduct`.
- `importProductsCsv`, `exportProductsCsv`.
- `listCategories`, `createCategory`, `updateCategory`, `deleteCategory`.
- `listCollections`, `createCollection`, `updateCollection`, `deleteCollection`.
- `listBrands`, `createBrand`, `updateBrand`, `deleteBrand`.
- `listInventory`, `adjustStock` (writes `inventory_levels` and `inventory_movements`).
- `createMediaUploadUrl`, `confirmMediaUpload`, `listMedia`.
- `getBrandSettings`, `updateBrandSettings`, `publishBrandSettings`, `rollbackBrandSettings`.
- `getTheme`, `updateTheme`, `publishTheme`.
- `listPages`, `getPage`, `createPage`, `updatePage`, `publishPage`, `rollbackPage`.
- `listMenus`, `getMenu`, `updateMenu`.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @bs/domain test services.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
`git add packages/domain/src/ packages/domain/test/services.test.ts && git commit -m "feat(domain): implement M2 domain services for catalog, inventory, media, and content"`

---

### Task 11: Mount Store Admin Procedures & Middleware in `apps/web/src/server/api.ts`

**Files:**
- Modify: `apps/web/src/server/api.ts`
- Test: `apps/web/test/router.test.ts`

- [ ] **Step 1: Write test for storeRouter M2 routes**
Verify `storeRouter.admin` contains all new namespaces with proper handlers and authorization middleware.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @bs/web test router.test.ts`
Expected: FAIL.

- [ ] **Step 3: Wire admin procedures in `apps/web/src/server/api.ts`**
Attach `requireAdmin` and `requirePermission(...)`:
- `products.*`, `categories.*`, `collections.*`, `brands.*`, `inventory.*`, `media.*` -> `products.read` / `products.write`.
- `branding.*`, `themes.*` -> `settings.write` / `theme.publish`.
- `pages.*`, `menus.*` -> `content.write`.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @bs/web test router.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
`git add apps/web/src/server/api.ts apps/web/test/router.test.ts && git commit -m "feat(web): mount M2 admin procedures with permission middleware"`

---

### Task 12: Extend PostgreSQL 18 Isolation Test Suite

**Files:**
- Modify: `packages/domain/test/isolation.int.test.ts`

- [ ] **Step 1: Update `executeAdminProcedure` in `isolation.int.test.ts` for all M2 procedures**
Map every newly discovered `storeContract.admin.*` procedure in `executeAdminProcedure()`:
- `products.list`, `products.get`, `products.create`, `products.update`, `products.delete`, `products.importCsv`, `products.exportCsv`.
- `categories.list`, `categories.create`, `categories.update`, `categories.delete`.
- `collections.list`, `collections.create`, `collections.update`, `collections.delete`.
- `brands.list`, `brands.create`, `brands.update`, `brands.delete`.
- `inventory.list`, `inventory.adjust`.
- `media.createUploadUrl`, `media.confirmUpload`, `media.list`.
- `branding.get`, `branding.update`, `branding.publish`, `branding.rollback`, `branding.checkContrast`, `branding.generateFaviconSet`.
- `themes.get`, `themes.update`, `themes.publish`.
- `pages.list`, `pages.get`, `pages.create`, `pages.update`, `pages.publish`, `pages.rollback`.
- `menus.list`, `menus.get`, `menus.update`.
Seed necessary fixtures (e.g. a product, variant, category, page in Tenant A and Tenant B).
Ensure `roleAdminA` is seeded with all permissions needed for full admin access.
Add assertion verifying `relforcerowsecurity = true` for all tenant tables in `tenantTableNames`.

- [ ] **Step 2: Run isolation test against real PostgreSQL 18**
Run: `pnpm --filter @bs/domain test isolation.int.test.ts`
Expected: PASS with 100% of admin procedures passing isolation checks.

- [ ] **Step 3: Commit**
`git add packages/domain/test/isolation.int.test.ts && git commit -m "test(domain): extend PostgreSQL 18 isolation test suite for all M2 procedures"`

---

### Task 13: Port FilterBar, MetricCard, and DataTable to `packages/ui`

**Files:**
- Create: `packages/ui/src/patterns/filter-bar.tsx`
- Create: `packages/ui/src/patterns/metric-card.tsx`
- Create: `packages/ui/src/patterns/data-table.tsx`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/test/patterns.test.tsx`

- [ ] **Step 1: Write test for ported UI patterns**
Verify `FilterBar`, `MetricCard`, `DataTable` render semantic markup using tokens.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @bs/ui test`
Expected: FAIL.

- [ ] **Step 3: Implement FilterBar, MetricCard, and DataTable**
Port Supabase design system patterns adapted for shop owners (touch targets >= 40px, light-default, Lucide icons).

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @bs/ui test`
Expected: PASS.

- [ ] **Step 5: Commit**
`git add packages/ui/src/ packages/ui/test/ && git commit -m "feat(ui): port FilterBar, MetricCard, and DataTable patterns"`

---

### Task 14: Products & Inventory Store Admin Screens

**Files:**
- Create: `apps/admin/src/routes/_store/products.tsx`
- Create: `apps/admin/src/routes/_store/products.$id.tsx`
- Create: `apps/admin/src/routes/_store/inventory.tsx`
- Modify: `apps/admin/src/routeTree.gen.ts`

- [ ] **Step 1: Implement Products List & Detail and Inventory Routes**
- `products.tsx`: List products with search, status filters, stock display, CSV import/export triggers, empty state, `pendingComponent: () => <PageSkeleton />`.
- `products.$id.tsx`: Create/edit form for title, slug, status, brand, category, variants, pricing in paise, media gallery, `pendingComponent: () => <PageSkeleton />`.
- `inventory.tsx`: Stock overview with metric cards (Total SKUs, Low Stock, Out of Stock), variant inventory table, stock adjustment modal, `pendingComponent: () => <PageSkeleton />`.

- [ ] **Step 2: Test building admin app**
Run: `pnpm --filter @bs/admin build`
Expected: PASS.

- [ ] **Step 3: Commit**
`git add apps/admin/src/ && git commit -m "feat(admin): implement Products and Inventory admin screens"`

---

### Task 15: Online Store (Theme, Pages, Menus) & Branding Settings Screens

**Files:**
- Create: `apps/admin/src/routes/_store/online-store.theme.tsx`
- Create: `apps/admin/src/routes/_store/online-store.pages.tsx`
- Create: `apps/admin/src/routes/_store/online-store.menus.tsx`
- Create: `apps/admin/src/routes/_store/settings.branding.tsx`
- Modify: `apps/admin/src/routes/_store.tsx` (add navigation items)
- Modify: `apps/admin/src/routeTree.gen.ts`

- [ ] **Step 1: Implement Online Store and Branding Settings Screens**
- `online-store.theme.tsx`: Theme token editor (color palette, font choice, radius, button style), live preview canvas, publish button.
- `online-store.pages.tsx`: Page list, page block editor (add/remove/reorder 12 blocks, edit block props), version publish and rollback.
- `online-store.menus.tsx`: Header and footer menu tree builder (links to pages, collections, custom URLs).
- `settings.branding.tsx`: Logo (light/dark) uploader, favicon generator preview, curated font selector, color scheme with real-time WCAG AA contrast check badge and fix suggestion, radius/button style selector, publish with rollback.
- Update nav in `_store.tsx` with "Online Store" (Theme, Pages, Menus) and "Settings → Branding".
- Ensure every route has `pendingComponent: () => <PageSkeleton />`.

- [ ] **Step 2: Test building admin app**
Run: `pnpm --filter @bs/admin build`
Expected: PASS.

- [ ] **Step 3: Commit**
`git add apps/admin/src/ && git commit -m "feat(admin): implement Online Store and Branding Settings admin screens"`

---

### Task 16: Verification, Typecheck, Lint, Build & Test

**Files:**
- All touched files across monorepo

- [ ] **Step 1: Run typecheck across entire monorepo**
Run: `pnpm typecheck`
Expected: PASS (10 packages + blocks).

- [ ] **Step 2: Run lint across entire monorepo**
Run: `pnpm lint`
Expected: PASS with 0 errors.

- [ ] **Step 3: Run all unit and integration tests**
Run: `pnpm test`
Expected: PASS for all packages including PostgreSQL 18 Testcontainers suites.

- [ ] **Step 4: Run full production build**
Run: `pnpm build`
Expected: PASS for all apps (web, admin, platform, worker) and packages.

- [ ] **Step 5: Final review and report**
Verify against M2 exit criteria and prepare detailed report.
