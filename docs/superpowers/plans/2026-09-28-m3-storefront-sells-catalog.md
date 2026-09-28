# M3: Storefront Sells the Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the public storefront (M3) enabling visitors to browse the catalog, view products with variant selection and structured data, search via PostgreSQL FTS/trigrams, manage carts, and complete the checkout UI flow, with Next.js 16 Cache Components invalidation, render-time block validation/migration, store status lifecycle enforcement, and Lighthouse mobile score ≥ 90.

**Architecture:**
- **Storefront Request Lifecycle (`@bs/domain`):** Strict 5-step evaluation: Host resolution → Tenant lifecycle check (PLAN §6.4: provisioning, suspended, archived, deleted, past_due, trial, active) → Store status mode (PLAN §8.2: live, coming_soon, maintenance, password with staff/preview bypass) → SEO headers (`X-Robots-Tag`) → Page render.
- **Data & Multi-Tenant Isolation (`packages/db`):** 6 new `tenantTable()` definitions (`store_status`, `seo_settings`, `search_queries`, `newsletter_subscribers`, `carts`, `cart_items`) with composite FKs, tenant-first indexes, and explicit `FORCE ROW LEVEL SECURITY`.
- **Block Rendering Pipeline (`packages/blocks`):** Render-time block migration (`migrateBlockDocument`) and schema validation (`validateBlockDocument`) preventing corrupt or outdated block documents from rendering on public pages.
- **Cache Components Invalidation Matrix (PLAN §11.6):** Strict `t:{tenantId}:[kind]:[id?]` tag structure enforced by ESLint, revalidated synchronously on catalog/theme/page/menu mutations.
- **Storefront UI & Pages (`apps/web`):** Next.js 16 App Router pages (`/`, `/products/[slug]`, `/collections/[slug]`, `/categories/[slug]`, `/search`, `/cart`, `/checkout`, `/pages/[slug]`, `/blog`, `/policies/[type]`, `/sitemap.xml`, `/robots.txt`) with Server Components and lightweight Client Components adhering to the <100KB gzipped JS budget.

**Tech Stack:** Next.js 16 (App Router + Turbopack + Cache Components), React 19, TypeScript 6.0.3, Drizzle ORM 0.45.3, PostgreSQL 18, oRPC 1.15.4, Zod 4.6.5, Vitest 5.0.2, Tailwind CSS 4.

---

## Task Decomposition

### Task 1: Drizzle Schema for M3 Storefront Tables

**Files:**
- Modify: `packages/db/src/schema/settings.ts`
- Create: `packages/db/src/schema/search.ts`
- Create: `packages/db/src/schema/marketing.ts`
- Create: `packages/db/src/schema/cart.ts`
- Modify: `packages/db/src/schema/index.ts`
- Test: `packages/db/test/schema.test.ts`

- [ ] **Step 1: Write test for M3 storefront schema tables**
In `packages/db/test/schema.test.ts`, add assertions verifying the 6 new tables are exported and present in `tenantTableNames`:
`store_status`, `seo_settings`, `search_queries`, `newsletter_subscribers`, `carts`, `cart_items`.

```ts
it("registers M3 storefront tables in tenantTableNames", () => {
  const m3Tables = [
    "store_status",
    "seo_settings",
    "search_queries",
    "newsletter_subscribers",
    "carts",
    "cart_items",
  ];
  for (const table of m3Tables) {
    expect(tenantTableNames).toContain(table);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @bs/db test`  
Expected: FAIL (missing exports/tables in `tenantTableNames`).

- [ ] **Step 3: Implement M3 schema definitions**
1. In `packages/db/src/schema/settings.ts`, export `storeStatus` and `seoSettings` with `tenantTable()`.
2. In `packages/db/src/schema/search.ts`, export `searchQueries` with `tenantTable()`.
3. In `packages/db/src/schema/marketing.ts`, export `newsletterSubscribers` with `tenantTable()`.
4. In `packages/db/src/schema/cart.ts`, export `carts` and `cartItems` with `tenantTable()`.
5. In `packages/db/src/schema/index.ts`, re-export everything from `search.ts`, `marketing.ts`, `cart.ts` and add all 6 table names to `tenantTableNames`.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @bs/db test`  
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add packages/db/src/schema/ packages/db/test/schema.test.ts
git commit -m "feat(db): add M3 storefront schema definitions with tenantTable"
```

---

### Task 2: Migration `0005_m3_storefront.sql` with FORCE RLS

**Files:**
- Create: `packages/db/migrations/0005_m3_storefront.sql`
- Test: `packages/db/test/migration.test.ts`

- [ ] **Step 1: Write test for M3 migration and FORCE RLS**
In `packages/db/test/migration.test.ts`, add test verifying `0005_m3_storefront.sql` applies successfully, enables RLS, and forces RLS on all 6 tables.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @bs/db test migration.test.ts`  
Expected: FAIL (missing migration file).

- [ ] **Step 3: Create migration `0005_m3_storefront.sql`**
Write SQL with:
- DDL for `store_status`, `seo_settings`, `search_queries`, `newsletter_subscribers`, `carts`, `cart_items`.
- `ALTER TABLE "store_status" ENABLE ROW LEVEL SECURITY; ALTER TABLE "store_status" FORCE ROW LEVEL SECURITY;` (repeated for all 6 tables).
- Multi-tenant isolation RLS policies using `current_setting('app.current_tenant_id')`.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @bs/db test migration.test.ts`  
Expected: PASS against PostgreSQL 18 Testcontainers.

- [ ] **Step 5: Commit**
```bash
git add packages/db/migrations/0005_m3_storefront.sql packages/db/test/migration.test.ts
git commit -m "feat(db): add migration 0005 with FORCE RLS for storefront tables"
```

---

### Task 3: Block Rendering Pipeline with Migration & Validation in `@bs/blocks`

**Files:**
- Create: `packages/blocks/src/render.ts`
- Modify: `packages/blocks/src/index.ts`
- Test: `packages/blocks/test/render.test.ts`

- [ ] **Step 1: Write test for renderBlockDocument**
In `packages/blocks/test/render.test.ts`, write unit tests verifying:
1. Valid block document passes through and strips hidden blocks.
2. Older-version blocks are migrated to current registry version before validation.
3. Invalid blocks after migration are safely handled without throwing uncaught exceptions.
4. Rich text blocks in render path are sanitized.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @bs/blocks test render.test.ts`  
Expected: FAIL (module not found).

- [ ] **Step 3: Implement renderBlockDocument**
In `packages/blocks/src/render.ts`:
- Define `renderBlockDocument(doc: unknown): { blocks: BlockInstance[]; errors?: ValidationError[] }`.
- Run `migrateBlockDocument(doc as BlockDocument)` -> `validateBlockDocument(migrated)` -> filter `hidden !== true`.
- Re-export in `packages/blocks/src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @bs/blocks test render.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add packages/blocks/src/render.ts packages/blocks/src/index.ts packages/blocks/test/render.test.ts
git commit -m "feat(blocks): implement render-time block migration and validation pipeline"
```

---

### Task 4: Storefront Request Lifecycle & Host Resolution in `@bs/domain`

**Files:**
- Modify: `packages/domain/src/host-resolver.ts`
- Create: `packages/domain/src/storefront/lifecycle.ts`
- Modify: `packages/domain/src/context.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/test/storefront-lifecycle.test.ts`

- [ ] **Step 1: Write test for storefront lifecycle state machine**
In `packages/domain/test/storefront-lifecycle.test.ts`, write unit tests verifying:
1. `resolveHostToTenant` returns complete lifecycle info (`tenantStatus`, `tenantId`, `storeStatusMode`).
2. `provisioning` status yields `status: "provisioning"` (503).
3. `suspended` status yields `status: "suspended"` (503 temporarily unavailable).
4. `archived`, `deletion_requested`, `deleted` status yields `status: "not_found"` (404).
5. `trial`, `active`, `past_due` evaluate `store_status.mode`:
   - `live` -> 200 normal.
   - `coming_soon` -> 200 coming soon with noindex.
   - `maintenance` -> 503 with retry-after.
   - `password` -> 200 password prompt (or bypass if correct hash/cookie).
6. Staff session or preview token bypasses `coming_soon`, `maintenance`, and `password` with `isBypass: true`.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @bs/domain test storefront-lifecycle.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement storefront lifecycle services**
1. In `packages/domain/src/host-resolver.ts`:
   - Update `resolveHostToTenant` to select `schema.tenants.status` and query `store_status.mode`.
2. In `packages/domain/src/storefront/lifecycle.ts`:
   - Implement `evaluateStorefrontAccess(db, host, opts)` enforcing the full state machine from PLAN §6.4 and §8.2.
   - Implement `verifyStorePassword(plainPassword, passwordHash)` and `verifyBypassToken(token, tokenHash)`.
3. In `packages/domain/src/context.ts`:
   - Wire `buildTenantContext` to utilize `evaluateStorefrontAccess`.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @bs/domain test storefront-lifecycle.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add packages/domain/src/host-resolver.ts packages/domain/src/storefront/lifecycle.ts packages/domain/src/context.ts packages/domain/test/storefront-lifecycle.test.ts
git commit -m "feat(domain): implement 5-stage storefront request lifecycle state machine"
```

---

### Task 5: Storefront Catalog & Search Services in `@bs/domain`

**Files:**
- Create: `packages/domain/src/storefront/catalog.ts`
- Create: `packages/domain/src/storefront/search.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/test/storefront-catalog.test.ts`

- [ ] **Step 1: Write test for storefront catalog and search**
In `packages/domain/test/storefront-catalog.test.ts`, write tests for:
1. `getStorefrontProduct(ctx, slug)`: returns product with active variants, options, media, brand, and stock summary.
2. `getStorefrontCollection(ctx, slug, filters)`: returns collection with filtered/paginated products.
3. `getStorefrontCategory(ctx, slug, filters)`: returns category with filtered/paginated products.
4. `searchStorefrontProducts(ctx, query, options)`: performs FTS + trigram matching on `searchVector` and `title`, upserts query into `search_queries`.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @bs/domain test storefront-catalog.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement catalog & search services**
In `packages/domain/src/storefront/catalog.ts` and `search.ts`:
- Execute queries inside `withTenant(db, ctx.tenantId, ...)`.
- Filter only `status = 'published'` and `deletedAt IS NULL`.
- In `search.ts`, use SQL `websearch_to_tsquery('english', ...)` and trigram similarity `title % ...`, then log to `search_queries` with `ON CONFLICT (tenant_id, normalized_query, day) DO UPDATE SET count = search_queries.count + 1`.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @bs/domain test storefront-catalog.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add packages/domain/src/storefront/catalog.ts packages/domain/src/storefront/search.ts packages/domain/src/index.ts packages/domain/test/storefront-catalog.test.ts
git commit -m "feat(domain): implement storefront catalog queries and postgres search with query logging"
```

---

### Task 6: Storefront Cart & Newsletter Services in `@bs/domain`

**Files:**
- Create: `packages/domain/src/storefront/cart.ts`
- Create: `packages/domain/src/storefront/newsletter.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/test/storefront-cart.test.ts`

- [ ] **Step 1: Write test for cart and newsletter services**
In `packages/domain/test/storefront-cart.test.ts`, write tests for:
1. `getOrCreateCart(ctx, token)`: creates or retrieves cart with line items, quantities, and calculated subtotal.
2. `addToCart(ctx, token, variantId, quantity)`: snapshots unit price, calculates subtotal.
3. `updateCartItemQuantity(ctx, token, itemId, quantity)`: updates quantity or removes if quantity is 0.
4. `removeCartItem(ctx, token, itemId)`.
5. `subscribeNewsletter(ctx, email, source)`: inserts subscriber, ignores duplicate with upsert.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @bs/domain test storefront-cart.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement cart and newsletter domain services**
In `packages/domain/src/storefront/cart.ts` and `newsletter.ts`:
- Use `withTenant()` for all operations.
- Ensure all cart mutations touch `lastActivityAt`.
- Prevent cross-tenant cart tampering by enforcing `carts.tenantId = ctx.tenantId`.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @bs/domain test storefront-cart.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add packages/domain/src/storefront/cart.ts packages/domain/src/storefront/newsletter.ts packages/domain/src/index.ts packages/domain/test/storefront-cart.test.ts
git commit -m "feat(domain): implement cart lifecycle and newsletter subscription services"
```

---

### Task 7: Storefront SEO & JSON-LD Structured Data in `@bs/domain`

**Files:**
- Create: `packages/domain/src/storefront/seo.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/test/storefront-seo.test.ts`

- [ ] **Step 1: Write test for SEO and structured data generator**
In `packages/domain/test/storefront-seo.test.ts`, write tests for:
1. `generateTitle(template, title, storeName)`.
2. `generateProductJsonLd(product, storeUrl)`.
3. `generateBreadcrumbJsonLd(items)`.
4. `generateOrganizationJsonLd(settings, storeUrl)`.
5. `generateFaqJsonLd(faqs)`.
6. `generateRobotsTxt(seoSettings, storeStatusMode)`.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @bs/domain test storefront-seo.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement SEO generators**
In `packages/domain/src/storefront/seo.ts`:
- Build schema.org compliant JSON-LD objects for Product, Organization, BreadcrumbList, FAQPage, ItemList, Article.
- Format `robots.txt` respecting `aiCrawlers` (GPTBot, ClaudeBot, etc.) and `indexingEnabled` switch.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @bs/domain test storefront-seo.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add packages/domain/src/storefront/seo.ts packages/domain/src/index.ts packages/domain/test/storefront-seo.test.ts
git commit -m "feat(domain): implement V0 SEO title, structured data, and robots.txt generators"
```

---

### Task 8: Storefront oRPC Contracts & Procedures

**Files:**
- Create: `packages/contracts/src/storefront.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/web/src/server/api.ts`
- Test: `packages/contracts/test/storefront.test.ts`

- [ ] **Step 1: Write test for storefront oRPC contracts**
In `packages/contracts/test/storefront.test.ts`, verify contract schema definitions for `storefront.search`, `storefront.cart.*`, `storefront.newsletter.subscribe`, `storefront.storeStatus.*`.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @bs/contracts test storefront.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement storefront contract and route handlers**
1. In `packages/contracts/src/storefront.ts`, define `storefrontContract`.
2. Re-export in `packages/contracts/src/index.ts` under `storeContract.storefront`.
3. In `apps/web/src/server/api.ts`, mount `storeRouter.storefront` procedures resolving tenant context via `entryPath: "storefront"`.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @bs/contracts test storefront.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add packages/contracts/src/storefront.ts packages/contracts/src/index.ts apps/web/src/server/api.ts packages/contracts/test/storefront.test.ts
git commit -m "feat(api): define and mount storefront oRPC contract and procedures"
```

---

### Task 9: Storefront Shell, Theme Tokens & Navigation in `apps/web`

**Files:**
- Create: `apps/web/src/components/storefront/StoreHeader.tsx`
- Create: `apps/web/src/components/storefront/StoreFooter.tsx`
- Create: `apps/web/src/components/storefront/CartBadge.tsx`
- Create: `apps/web/src/components/storefront/StoreStatusBanner.tsx`
- Modify: `apps/web/src/app/layout.tsx`

- [ ] **Step 1: Write component tests for StoreHeader and CartBadge**
In `apps/web/test/storefront-shell.test.tsx`, test navigation links, logo rendering, and cart count badge.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @bs/web test storefront-shell.test.tsx`  
Expected: FAIL.

- [ ] **Step 3: Implement StoreHeader, StoreFooter, CartBadge, and layout**
- Read published `theme` tokens and `brand_settings` from domain service.
- Inject CSS variables (`--color-primary`, `--font-heading`, etc.) in `layout.tsx`.
- Include `StoreStatusBanner` when preview bypass is active.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @bs/web test storefront-shell.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/components/storefront/ apps/web/src/app/layout.tsx apps/web/test/storefront-shell.test.tsx
git commit -m "feat(web): implement storefront shell with dynamic theme tokens and navigation"
```

---

### Task 10: Storefront Home Page, Content Pages & Policies in `apps/web`

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/pages/[slug]/page.tsx`
- Create: `apps/web/src/app/blog/page.tsx`
- Create: `apps/web/src/app/blog/[slug]/page.tsx`
- Create: `apps/web/src/app/policies/[type]/page.tsx`

- [ ] **Step 1: Write tests for page rendering with block validation**
In `apps/web/test/storefront-pages.test.tsx`, test rendering of home page and policy page with mocked tenant context.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @bs/web test storefront-pages.test.tsx`  
Expected: FAIL.

- [ ] **Step 3: Implement home page, custom pages, blog, and policies**
- In `apps/web/src/app/page.tsx`: fetch published home page version, call `renderBlockDocument()`, and render block components.
- In `apps/web/src/app/pages/[slug]/page.tsx`: fetch page by slug, validate blocks, render.
- In `apps/web/src/app/policies/[type]/page.tsx`: render store terms, privacy policy, refund policy, and shipping policy.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @bs/web test storefront-pages.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/app/page.tsx apps/web/src/app/pages/ apps/web/src/app/blog/ apps/web/src/app/policies/ apps/web/test/storefront-pages.test.tsx
git commit -m "feat(web): implement home, custom content, blog, and policy routes with block renderer"
```

---

### Task 11: Storefront Product Page (`/products/[slug]`) in `apps/web`

**Files:**
- Create: `apps/web/src/app/products/[slug]/page.tsx`
- Create: `apps/web/src/components/product/ProductGallery.tsx`
- Create: `apps/web/src/components/product/VariantSelector.tsx`
- Create: `apps/web/src/components/product/StockEtaHole.tsx`
- Create: `apps/web/src/components/product/AddToCartButton.tsx`

- [ ] **Step 1: Write test for Product page rendering and variant selection**
In `apps/web/test/product-page.test.tsx`, test gallery, variant switching, JSON-LD script tag generation, and Suspense stock hole.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @bs/web test product-page.test.tsx`  
Expected: FAIL.

- [ ] **Step 3: Implement product page components**
- Server Component fetches product details and injects JSON-LD `Product`.
- `StockEtaHole` wrapped in React `<Suspense>` for dynamic stock and pincode delivery check.
- `VariantSelector` handles option changes and updates price/image display.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @bs/web test product-page.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/app/products/ apps/web/src/components/product/ apps/web/test/product-page.test.tsx
git commit -m "feat(web): implement product detail page with variant selection and JSON-LD"
```

---

### Task 12: Storefront Catalog Listing & Search (`/collections/[slug]`, `/categories/[slug]`, `/search`)

**Files:**
- Create: `apps/web/src/app/collections/[slug]/page.tsx`
- Create: `apps/web/src/app/categories/[slug]/page.tsx`
- Create: `apps/web/src/app/search/page.tsx`
- Create: `apps/web/src/components/catalog/ProductCard.tsx`
- Create: `apps/web/src/components/catalog/CatalogFilters.tsx`

- [ ] **Step 1: Write test for collections, categories, and search page**
In `apps/web/test/catalog-listing.test.tsx`, test listing display, sorting, price filter, and empty search state.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @bs/web test catalog-listing.test.tsx`  
Expected: FAIL.

- [ ] **Step 3: Implement catalog listing and search pages**
- In `collections/[slug]` and `categories/[slug]`: Cache Components for initial page, search params for filters.
- In `search/page.tsx`: dynamic page with search bar, instant results, and zero-results suggestions.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @bs/web test catalog-listing.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/app/collections/ apps/web/src/app/categories/ apps/web/src/app/search/ apps/web/src/components/catalog/ apps/web/test/catalog-listing.test.tsx
git commit -m "feat(web): implement collections, categories, and search pages with product cards"
```

---

### Task 13: Storefront Cart & Checkout UI Flow in `apps/web`

**Files:**
- Create: `apps/web/src/app/cart/page.tsx`
- Create: `apps/web/src/app/checkout/page.tsx`
- Create: `apps/web/src/app/orders/[token]/thank-you/page.tsx`
- Create: `apps/web/src/components/checkout/CheckoutForm.tsx`

- [ ] **Step 1: Write test for cart and checkout UI flow**
In `apps/web/test/cart-checkout.test.tsx`, test cart line items, quantity adjustment, checkout steps (contact -> address -> shipping -> payment UI), and thank-you screen preview.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @bs/web test cart-checkout.test.tsx`  
Expected: FAIL.

- [ ] **Step 3: Implement cart and single-page checkout UI**
- `/cart`: dynamic line items, item removal, pincode delivery estimate.
- `/checkout`: multi-step single page UI with Indian phone format, pincode auto-fill, shipping selection, Razorpay / COD radio options, and idempotency key generation. Place order triggers order submission stub and redirects to thank you page.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @bs/web test cart-checkout.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/app/cart/ apps/web/src/app/checkout/ apps/web/src/app/orders/ apps/web/src/components/checkout/ apps/web/test/cart-checkout.test.tsx
git commit -m "feat(web): implement dynamic cart and single-page checkout UI flow"
```

---

### Task 14: Dynamic SEO Endpoints (`/sitemap.xml`, `/robots.txt`) in `apps/web`

**Files:**
- Create: `apps/web/src/app/sitemap.xml/route.ts`
- Create: `apps/web/src/app/robots.txt/route.ts`
- Test: `apps/web/test/seo-routes.test.ts`

- [ ] **Step 1: Write test for sitemap.xml and robots.txt route handlers**
In `apps/web/test/seo-routes.test.ts`, test XML sitemap structure (products, collections, pages) and robots.txt crawler rules based on tenant SEO settings.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @bs/web test seo-routes.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement sitemap.xml and robots.txt route handlers**
- Route handlers call domain SEO services with `tenantTag(tenantId, "seo")`.
- Format XML sitemap with correct XML declaration and `<url>` tags.
- Format robots.txt with disallow when indexing is off, plus AI bot rules.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @bs/web test seo-routes.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/app/sitemap.xml/ apps/web/src/app/robots.txt/ apps/web/test/seo-routes.test.ts
git commit -m "feat(web): implement dynamic tenant sitemap.xml and robots.txt routes"
```

---

### Task 15: Storefront Integration & Tenant Isolation Suite against PostgreSQL 18

**Files:**
- Create: `packages/domain/test/storefront.int.test.ts`
- Test: `packages/domain/test/storefront.int.test.ts`

- [ ] **Step 1: Write comprehensive integration tests**
In `packages/domain/test/storefront.int.test.ts`:
- Setup two distinct tenants in PostgreSQL 18 Testcontainers (`tenantA` and `tenantB`).
- Seed products, collections, categories, pages, and store_status for each tenant.
- Test cross-tenant isolation: Tenant A cannot query Tenant B's cart, search queries, or unlisted items.
- Test store status lifecycle: Verify `coming_soon`, `maintenance` (503 with retry-after), `password`, and `suspended`.
- Test search logging: Verify `search_queries` logs count and results accurately under real concurrency.

- [ ] **Step 2: Run integration tests to verify**
Run: `pnpm --filter @bs/domain test storefront.int.test.ts`  
Expected: PASS with 100% real database execution (zero mockDb).

- [ ] **Step 3: Commit**
```bash
git add packages/domain/test/storefront.int.test.ts
git commit -m "test(domain): add storefront integration and tenant isolation suite against postgres 18"
```

---

### Task 16: Mobile Performance Baseline Audit (Lighthouse Mobile ≥ 90)

**Files:**
- Create: `scripts/audit-storefront-performance.ts`
- Test: Product page bundle size and Lighthouse mobile score

- [ ] **Step 1: Write bundle size & performance budget verification script**
In `scripts/audit-storefront-performance.ts`, measure production product page client JS bundle size (asserting < 100KB gzipped) and execute Lighthouse mobile audit (asserting mobile score ≥ 90, LCP < 2.0s, CLS < 0.05).

- [ ] **Step 2: Run production build and audit**
Run: `pnpm --filter @bs/web build && pnpm exec tsx scripts/audit-storefront-performance.ts`  
Expected: PASS (Lighthouse mobile score ≥ 90, JS budget < 100KB).

- [ ] **Step 3: Commit**
```bash
git add scripts/audit-storefront-performance.ts
git commit -m "chore(perf): record storefront mobile lighthouse baseline score and bundle budget"
```
