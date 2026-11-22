# Storefront audit fixes plan

Status: **phase 1 and most of phase 2 built on `fix/storefront-audit-fixes` (not merged)**; phase 3 (redirect manager, www) and phase 4 not started. Section 9 lists what was built and what differed from this plan · Author: Claude · 2026-11-21 · Builder: Claude.

Goal: fix, once and for every store, the platform-caused defects found by three external quality audits of live stores, and add the guardrails that stop merchants from making the content mistakes the audits also found.

Source: three audit reports run on 2026-11-21 against three live stores (called here store A: single-market honey store, 29 URLs; store B: tea B2B and retail, 164 URLs; store C: tea store with a domestic and a `/global` market, 421 URLs). The reports are the owner's files; store names are left out because this repo is public. The audits are automated crawls plus a headless browser. They were **not** all verified by us: section 4 lists what must be re-checked before it is fixed.

## 1. How findings were sorted

| Class | Meaning | In this plan |
|---|---|---|
| **A. Platform defect** | Same failure on every store whatever the merchant did. We fix the code. | Sections 3 (phases 1 to 3) |
| **B. Platform guardrail gap** | The merchant produced the bad data, but our editor or defaults let (or pushed) them into it. We fix the guardrail. | Phases 1, 4 |
| **C. Owner decision or unverified** | Needs infra access, production data work, or a live re-check first. | Section 4 |
| **D. Merchant content** | Copy and data only the merchant can write. We give them tools to find it. | Phase 4 tools; not fixed by code |

## 2. Findings mapped to the code (read on 2026-11-21 at `origin/main` 7dabf0b2)

| ID | Finding (audits) | Class | Cause in our code | Scale |
|---|---|---|---|---|
| F1 | Product breadcrumb "Products" links to `/products`, which is a 404 | A | `apps/web/src/components/product/ProductDetailSection.tsx` (breadcrumb nav) hardcodes `/products`; `apps/web/src/app/products/` only has `[slug]` | every product page on every store (B 96, C 298) |
| F2 | Buttons, banner and menus link to `/collections/all`, a 404 | A | Defaults ship it: `packages/blocks/src/registry.ts` (Banner, Header, Footer, Hero slide), `packages/domain/src/themes/launch-template.ts`, `commerce-templates.ts`, `packages/block-editor/src/config.tsx` (Bricks row link, Hero slide), migration `0012`, `packages/domain/src/themes/block-data.ts` (brand link `/collections/all?brand=`). No route serves `collections/all` (`app/collections/[slug]` has no special case) | every store started from a template (B: all B2B CTAs and the banner) |
| F3 | Banner says "Free shipping over ₹999" but the cart bar asks for a higher amount | A | The starter Banner text is a hardcoded literal in `launch-template.ts` and `commerce-templates.ts`. The real threshold comes from shipping settings (`MiniCartDrawer.tsx` `freeShippingThresholdPaise`). The two are never linked. Violates hard rule 12 (shipping is per-store configuration) | every store that kept the template text (A: contradiction seen) |
| F4 | Product JSON-LD `brand` is null (Merchant Center warning) | A | `packages/domain/src/storefront/seo.ts` `generateProductJsonLd`: `brand` only if `product.brand?.name` | all products, all stores |
| F5 | Product pages with no `<meta name="description">` | A | `seo.ts` `buildProductSeoMetadata`: `storedDescription ?? shortDescription ?? "Buy X at Y."`; `??` keeps an empty-string short description, so the tag comes out empty or is dropped; HTML is not stripped, length is not capped | A 1, B 24, C 10 |
| F6 | Thin generic descriptions on custom pages, blog, policies | A | Fallbacks: `apps/web/src/app/pages/[...path]/page.tsx` ("Read more about {title}."), `packages/domain/src/blog/seo.ts` ("Read the latest posts from {store}."), category/collection templates in `seo.ts`; the exact strings the audits quote for policies ("Privacy Policy of X.") were not found by grep, so the policy path needs a look | all stores |
| F7 | Hundreds of images with `alt=""` | A | Product card hover image (`components/catalog/ProductCard.tsx`), gallery thumbnails (`ProductGallery.tsx`), variant swatches (`VariantSelector.tsx`), `blocks/GalleryViewer.tsx`, collection cards and others in `packages/blocks/src/views*.tsx`; media `alt` is not threaded through | A 72, B 536, C 1,034 |
| F8 | Stray `‹` over the announcement bar text | A (verify) | `packages/blocks/src/views.tsx` `BannerView` renders an absolutely positioned prev button (`blocks.css` `.bsb-ann-nav`) with no reserved gutter | stores with a rotating banner |
| F9 | Old Shopify paths 404 (`/blogs/<handle>/<slug>`, `/collections/all`, `/checkouts/...`) | A | Only blog slugs have redirects (`blog_slug_redirects`); there is no general redirect table or built-in Shopify path map | every store migrated from Shopify |
| F10 | Banner link to the platform host (`<store>.bcom.si`); link saved as `/collections/https://...` | B | Link fields accept any string; absolute URLs on the store's own or preview host are stored as typed | C: banner on 421 pages |
| F11 | "Write a Review" button disabled | A (low) | `ProductReviewsSection.tsx`: `disabled={shopper === null}` until client state loads, so server HTML (what crawlers read) has a disabled button | all product pages |
| F12 | `www.<domain>` does not resolve; links to `www` are dead | A + D | No www provisioning or www/apex redirect found in custom-domain code; guidance and verification are missing. The DNS record itself is the merchant's | A |
| F13 | Blog sitemap omits a category page that returns 200 | A (low) | `listBlogForSitemap` lists only categories that directly have posts; the page route serves parents too | B |
| F14 | Homepage H1 is only the store name; title suffix casing differs (`| Brand` vs `| brand`) | B | Starter home has no keyword H1 guidance; `formatTitle` uses the raw store name while some titles carry a hand-typed suffix | all |
| F15 | Dead links in blog bodies, expired Shopify checkout links, typos, missing descriptions | D | Merchant content or migration leftovers | B, C |

## 3. Work plan (one branch, four phases, each independently shippable)

Branch `fix/storefront-audit-fixes` from `origin/main`, own worktree. One PR per phase is acceptable if the owner prefers smaller merges; the default is one PR because the fixes share files (`seo.ts`, templates).

### Phase 1: stop sending shoppers to 404s (F1, F2, F3, F10)

1. **`/products` and `/collections/all` become real.** Add an "All products" listing page at `apps/web/src/app/products/page.tsx` (with `loading.tsx`, hard rule 11) using the existing catalog listing and card components, honoring the market scope. Add a 308 from `/collections/all` to `/products` (middleware or `next.config` redirects; check the multi-market prefix handling in `middleware.ts`). Do **not** break `/collections/[slug]`; `all` is reserved so no merchant collection can take the slug (add to the reserved-slug list in the collections domain code and add a test).
2. **Breadcrumb**: link "Products" to the product's primary category if it has one (`/categories/<slug>`), else `/products`. Add the same two-level logic to the BreadcrumbList JSON-LD so the visual and structured data agree.
3. **Change the defaults** that still point at `/collections/all` to `/products` in `registry.ts`, `launch-template.ts`, `commerce-templates.ts`, `block-editor/src/config.tsx`, `block-data.ts` (brand link becomes `/products?brand=<slug>`; confirm the listing supports the `brand` filter, else add it). Existing stores keep working through the redirect. No migration that rewrites merchant JSON.
4. **Free-shipping banner text** (F3): remove the hardcoded amount from the starter Banner. Add a text token `{{free_shipping_threshold}}` that `BannerView` resolves server-side from the store's shipping settings (and hides the message if no threshold is set). Template text becomes "Free shipping on orders over {{free_shipping_threshold}}". Existing banners that contain a literal amount are untouched; the SEO/health panel in phase 4 warns when a literal amount differs from the real threshold. The market currency must format the amount.
5. **Link normalisation on save** (F10) in the shared link field and in the domain service that saves menus and blocks: (a) an absolute URL whose host is the store's own host, any of its connected domains, or the platform's `*.bcom.si` host is stored as a relative path; (b) an absolute URL pasted into a path-prefix field (the `/collections/https://...` case) is rejected with a clear message. Enforce in `packages/domain` (hard rule 3), mirror the message in the editor.

Acceptance: every crawled internal link on the three stores' templates resolves 200 or a single 308; the breadcrumb "Products" link never 404s; a banner configured with the token shows the live threshold and agrees with the cart bar; saving a link to `https://<store>.bcom.si/x` stores `/x`.

### Phase 2: SEO and accessibility defaults (F4 to F8, F11, F13, F14 partly)

1. **JSON-LD brand** (F4): `generateProductJsonLd` takes the store name as fallback (`product.brand?.name ?? storeName`). Pass `storeSettings.storeName` from the callers (`products/[slug]/page.tsx`).
2. **Meta description** (F5, F6): one helper `deriveMetaDescription(...)` in `packages/domain/src/storefront/seo.ts`: stored SEO description, then short description, then the first sentence(s) of the long description with HTML stripped; whitespace collapsed; capped at 155 characters on a word boundary; never an empty string (final fallback keeps the product title plus store name). Use `||`/trim semantics, not `??`. Use it for products, categories, collections and custom pages; replace the generic "Read more about" and "Read the latest posts" fallbacks with templates that include the page's own intro text or the store's tagline when set. Find and fix the policy description path.
3. **Alt text** (F7): a shared `imageAlt()` helper: media `alt` if set, else product title (+ "view N" for thumbnails and "alternate view" for the hover image), else for block images the block's own title. Apply to the places listed in F7. Purely decorative images keep `alt=""` but must also carry `aria-hidden` or `role="presentation"`. Expose the media library's alt field into the product media payload if it is not already.
4. **Banner arrow** (F8): reserve horizontal space for the nav buttons when `rotating`, so they never overlap text. Confirm in a browser first (section 4); fix only if reproduced.
5. **Reviews button** (F11): render "Log in to review" (a link) by default on the server; swap to the form button after hydration. No `disabled` button in server HTML.
6. **Sitemap** (F13): include blog category pages that have posts in any descendant, matching what the category route serves.
7. **Title suffix** (F14): normalise the suffix in `formatTitle` so a template suffix and a stored title cannot double or mismatch (strip a trailing ` | <store name>` case-insensitively from stored titles before appending the canonical store name).

Acceptance: `scripts/seo-audit.mjs` (existing) against a seeded store shows zero missing descriptions, zero `brand: null`, zero images without `alt` unless marked decorative; unit tests for `deriveMetaDescription` (empty string, HTML, long text, unicode) and `generateProductJsonLd`; the page-speed budget test for the product page still passes (see memory note on the 50 KB gz limit; the reviews and gallery changes must not add client JS).

### Phase 3: migration and domains (F9, F12)

1. **Shopify path map** (F9), built in without a merchant setting: `/blogs/<anyhandle>/<slug>` → `/blog/<slug>`; `/collections/all` → `/products`; `/collections/<slug>` already exists; `/products/<slug>` already matches; `/pages/<slug>` already matches. Implement in `middleware.ts` (cheap string match, no DB) and test with the multi-market prefix. Unknown `/checkouts/*` paths return a branded 404 with links to the store, not a hard failure.
2. **Redirect manager** (F9, owner decision, see section 5): a tenant table `tenant_redirects` (`tenantTable()` + `forceRlsSql`, hard rule 1), domain service with `assertPermission`, an admin screen (shared table kit), a bulk CSV upload, audit log rows, and evaluation in the web middleware through a cached per-tenant lookup (tenant-prefixed cache tag, hard rule 5). Auto-create a redirect when a product, page or collection slug changes (the blog already does this). Needs a short ADR before it starts.
3. **`www` and apex** (F12): in the custom-domain flow (`docs/CUSTOM-DOMAIN-ROUTING-PLAN.md` area), when a merchant connects an apex domain, show the exact `www` CNAME to add, check it in the verification step, and when both resolve, 301 the non-canonical host to the canonical one. When only the apex is connected, warn "www does not resolve; visitors typing www will fail". Do not change Cloudflare or DNS ourselves.

Acceptance: legacy-path fixtures redirect with a single 308/301 and keep the query string; the redirect table passes the tenant isolation suite (`packages/domain/test/isolation.int.test.ts` mapping); domain page shows both records and their state.

### Phase 4: guardrails and tools for merchants (F14, F15, and what else)

1. **Link health check** in admin: scans blocks, menus, blog posts, product and page descriptions of the store for internal links that 404 (resolve against our own routes and catalog, no network crawling), own-host or preview-host absolute links, `www.<domain>` links, `/checkouts/` links and links with a pasted URL in a path. Runs as a pg-boss job (ADR-006) and stores the result for the admin screen; "Fix automatically" for the safe class (absolute own-host → relative), manual list for the rest.
2. **SEO health panel** per store: missing or short descriptions (with the derived fallback shown), homepage H1 equals store name, missing alt text, banner literal threshold different from the real one, title suffix mismatch, product without brand, policy page missing. Read-only summary plus links to the item; no auto-writing of merchant copy.
3. **Starter home template** gets a keyword H1 placeholder and a short prompt explaining why (information icon pop-up, per the editor-hints rule).
4. **Richer product schema** (optional, last): `sku`/`gtin`, `priceValidUntil`, shipping and return details taken from store settings, to clear the remaining Merchant Center warnings.
5. **Bulk import** (optional): add an `alt` column, normalise imported text to Unicode NFC, and reject or warn on byte sequences that look like mis-decoded UTF-8 (`â€`) before they are saved. Prevents the mojibake class for future imports.

## 4. Check first, fix only if confirmed (class C)

| Item | What to check | Why not fixed blindly |
|---|---|---|
| Mojibake (`â€“` in titles on store C) | `curl -s <product url> | head` with an explicit UTF-8 decode; look at the stored `seo.title` and `products.title` in the database (read only, local copy or with the owner's yes) | I found no decoding bug in the import code; either the data was already corrupt when migrated, or the audit tool decoded it wrongly. If real, the repair is a data change on production: owner's yes required |
| `/cdn-cgi/l/email-protection` 404 | Whether Cloudflare Email Address Obfuscation is on for the zone and the custom domains | Changing Cloudflare config needs the owner's explicit yes (AGENTS.md section 5) |
| `/policies/shipping` missing from sitemap (store B) | Fetch the live sitemap; check the 24 h `s-maxage` cache and the policy's published state | `STATIC_POLICY_PAGES` already lists it, so this may be a stale cache or a disabled policy |
| hreflang missing between markets (store C) | View source of a `/global/products/...` page | `layout.tsx` already writes hreflang and `x-default` for multi-market stores (ADR-040); the audit may have missed it or it may be absent on some routes |
| Banner `‹` overlap | Reproduce on a rotating banner at desktop width | Shown only in rotating mode in code; the audited store may have had one message |
| Starter typos ("Frequently Asked Question") | Grep the starter templates for the singular strings | May be merchant text, not ours |

## 5. Decisions needed from the owner

1. **What `/products` is**: recommended a real "All products" listing page, with `/collections/all` redirecting to it. Alternative: redirect `/products` to `/categories`.
2. **Redirect manager now or later** (phase 3, item 2): recommended now, because migrated stores will otherwise need developer help for every old URL.
3. **Banner token vs. warning only** (F3): recommended the token plus the health-panel warning.
4. **Section 4 items that touch production** (Cloudflare setting, data repair): yes or no, per item, after the checks.

## 6. Tests and verification plan

- Unit: `deriveMetaDescription`, `generateProductJsonLd` (brand fallback), `imageAlt`, link normaliser, Shopify path map, banner token resolver.
- Real-database (`*.int.test.ts`): redirect table isolation and permission checks, link-check job writes only that tenant's results, reserved `all` slug, sitemap category rule.
- Web: render tests for the breadcrumb target, `/products` page (loading.tsx present, `bs/route-pending` lint), reviews button server HTML, banner nav spacing.
- Browser walk (local, 375 px and desktop, seeded store only; never the live stores): product → breadcrumb → listing, banner with token vs. cart bar, reviews as guest, rotating banner.
- Existing `scripts/seo-audit.mjs` run against the seeded store before and after, numbers pasted in the change record.
- Gate before push: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`, `pnpm test:affected`, `pnpm --filter @bs/domain test:fast`, `pnpm test:heavy:local`. If any `admin.*` procedure is added (redirects, link check), map it in `isolation.int.test.ts`.
- After merge and deploy, owner re-runs the three audits; the score card is: zero 404s from template links, zero missing descriptions, zero `brand: null`, alt-less images only where decorative.

## 7. Out of scope

Writing merchants' copy (descriptions, H1s, blog fixes), DNS changes for merchants, Cloudflare configuration, editing production data, Shiprocket or any shipping integration (hard rule 14).

## 8. Definition of done (for the builder)

Copy the list in `AGENTS.md` section 7 into the change record; update `docs/ARCHITECTURE.md` (routes, link normalisation, redirect table if built), write the ADR for the redirect manager before phase 3 item 2, and remove the "In flight" line after merge.

## 9. Build log and corrections (2026-11-21)

The first reading of the code (section 2) was done in a checkout that was behind `origin/main`; the build re-read everything at `origin/main` 7dabf0b2. Differences from the plan above:

| Plan item | What was done |
|---|---|
| F1, F2 `/products` and `/collections/all` | **Owner decision 2026-11-21:** `/products/all` shows all products with filters (a built-in listing, `getStorefrontAllProducts`, drawn by the collection listing template); `/collections/all` shows the list of collections and `/categories/all` the list of categories. All three, and `/products`, are 308s in `middleware.ts` (`lib/legacy-paths.ts`: `/products` to `/products/all`, `/collections/all` to `/collections`, `/categories/all` to `/categories`), not pages: with Cache Components a redirect from inside a page streams as a meta refresh, which is not a real redirect for crawlers. Templates, block defaults, the brand-menu link and the demo store now point at `/products/all`; the breadcrumb links to `/products/all` (no primary category exists on the product payload). Stored content that still says `/collections/all` lands on the collections list. A product with the slug `all` is shadowed by `/products/all`. |
| F3 free shipping | `{{free_shipping_threshold}}` token in the announcement bar, resolved in `resolveBlockData`; starter templates and the block default use it; the "On orders above 999 rupees" feature rows now say "On qualifying orders". Existing banners with a typed amount are unchanged (the health panel warning is not built yet). |
| F4 brand | Falls back to the store name. |
| F5 description | `deriveMetaDescription` (empty string is not text, HTML stripped, 155 cap) for product, category and collection pages; the JSON-LD description uses the same cleaning. The merchant's own SEO description is never altered. |
| F6 thin descriptions on pages, blog, policies | **Not done.** They are merchant-editable SEO fields; the fallback strings are unchanged. |
| F7 alt | Card hover image, gallery thumbnails and the viewer thumbnails now carry text; the main card image and the product payload already fell back to the title. Remaining `alt=""` on a local store were placeholder pictures of products with no photo (correct). |
| F8 banner chevron | **Not reproduced, not changed.** |
| F10 link tidy | `storeHrefSchema` for every store block link. **Menus are not covered yet.** |
| F11 reviews | Button is no longer `disabled` in the server HTML. |
| F13 blog sitemap | **Not a defect:** blog categories nest one level and parents are already listed; the audited page is probably an empty category. Dropped. |
| F9 Shopify blog paths | Built in `middleware.ts` (phase 3 item 1 done early). The redirect manager and `/checkouts/*` handling are not built. |
| Phase 4 SEO health panel | **Already exists** (`admin/seo-health.ts`, `admin.seo.health`, Settings, SEO health). Add the new checks to it rather than building a second panel. |

