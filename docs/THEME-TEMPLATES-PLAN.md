# Theme and Templates plan (page set, demo store, end-to-end test)

- Status: **Draft for owner review.** Nothing built. Written 2026-10-15.
- Planner and verifier: Claude Code. Builders: assigned per phase by the owner (section 9).
- Related: ADR-009/010 (blocks, no merchant code), ADR-018 (visual editor), ADR-004 (cache tags), ADR-026 (page hierarchy), `docs/ARCHITECTURE.md` section 10, `docs/admin-ui-standards.md`.
- Hard rules that apply: AGENTS.md 2 (domain only), 5 (tenant cache tags), 8 (no merchant code), 11 (`loading.tsx` per storefront page), 12 (server recomputes money), 14 (no live payment/shipping).

## 1. Goal

Every theme ships a **complete, predesigned set of storefront pages**. Each page pulls live catalog data (products, variants, collections, prices, stock) and is tested through to a placed order. Merchants customise **templates** (blocks) but cannot break the **commerce-critical pages** (cart, checkout, result pages), which stay a fixed, hardened default with token-level styling only.

## 2. What exists today (verified in code, 2026-10-15)

| Item | State |
|---|---|
| Theme system pages (`theme-pages.ts`) | `home`, `collection` (`template-collection`), `product`, `cart`, `header`, `footer` |
| Page cores (blocks) | `CollectionListing`, `ProductDetail`, `CartContents`, `SiteHeader`, `SiteFooter` |
| Storefront routes | `/` , `/collections/[slug]`, `/categories/[slug]`, `/products/[slug]`, `/cart`, `/checkout`, `/cod/[token]`, `/o/[token]`, `/orders/[token]/thank-you`, `/search`, `/pages/*`, `/blog`, `/policies` |
| Theme library | `theme_templates` draft/published/archived, preview snapshots `/preview/<code>`, launch theme "Essential Commerce", seed script `seed:templates` |
| **Gaps found** | No **Collection Archive** (list of all collections): `/collections` has only `[slug]`. No theme-owned **Checkout**, **Order success** or **Failure** page: checkout and result pages are plain storefront code with no theme tokens or template. `/preview` samples only show home/collection/product/cart. No 404 / search / account theme coverage. No per-collection or per-product template assignment. |

## 3. Final page set (your list, plus what was missing)

"Default" = fixed hardened layout, token-styled, merchant edits copy/toggles only. "Template" = block-editable, merchant can duplicate and assign.

| # | Page | Route | Type | Notes |
|---|---|---|---|---|
| 1 | Home | `/` | Template | Exists |
| 2 | Collection Archive | `/collections` | Default + Template | **New.** Grid of all collections with image, title, product count; sort and search |
| 3 | Collection Single | `/collections/[slug]` | Default + Template | Exists as one template; add per-collection template assignment |
| 4 | Product Page | `/products/[slug]` | Default + Template | Exists as one template; add per-product template assignment (e.g. apparel vs single-SKU) |
| 5 | Cart | `/cart` | Default | Add optional cart drawer (mini cart) as part of header chrome |
| 6 | Checkout | `/checkout` | Default | **New theme coverage.** Tokens + logo + trust badges only |
| 7 | Order Success (thank-you) | `/orders/[token]/thank-you` | Default | **New theme coverage** |
| 8 | Order Failure / Payment failed | `/checkout/failed` (new) | Default | Retry payment, switch to COD, contact support. Only reachable when online payment is on (test mode); built now so it is ready |
| 9 | Search results | `/search` | Default | **Added.** Predictive search in header |
| 10 | 404 / Not found | `not-found.tsx` | Default | **Added.** Search box, popular collections |
| 11 | Header, Footer, Announcement bar | chrome | Template | Exist (header, footer); add announcement bar block |
| 12 | Generic Page, Blog, Policies | `/pages/*` etc. | Template | Exist; just inherit theme tokens and chrome |
| 13 | Account, Login, Order lookup | `/account`, `/o/[token]` | Default | Already token-themed (accent); verify only |

Out of scope for this plan: wishlist, reviews submission flow, multi-currency, gift cards, subscriptions (list as future).

## 4. Industry practice we apply

Sources of the pattern: Shopify Online Store 2.0 (JSON templates, sections, default vs alternate templates), Baymard Institute checkout and product-page research, Google Core Web Vitals, WCAG 2.2 AA.

**Structure**
1. Template = ordered sections of blocks; the **core block** (`ProductDetail`, `CollectionListing`) is mandatory and cannot be deleted, other blocks around it are free. Prevents a merchant publishing a product page with no buy button.
2. **Default + alternate templates**: a theme ships one default; merchants duplicate to make alternates and assign per product/collection. Fall back to default if an assigned template is deleted.
3. **Checkout and result pages are not block-editable.** Industry norm (Shopify locks checkout for the same reasons): security, PCI scope, conversion safety. Branding via tokens only.

**Commerce UX (Baymard-style checklist, used as acceptance criteria)**
- Product page: gallery with zoom and swipe, variant selector that updates price, image, stock and URL (`?variant=`), clear "Out of stock" and disabled add-to-cart, sticky add-to-cart on mobile, price with compare-at and tax note, delivery/returns snippet, reviews summary, related products, breadcrumbs.
- Collection: filters (price, availability, option values), sort, active-filter chips, product count, pagination or load-more with URL state, quick-view optional, consistent card aspect ratio (no layout shift).
- Cart: line items with variant, qty stepper, remove, subtotal, shipping estimate message, free-shipping progress (configurable), upsell slot, empty-cart state with collection links.
- Checkout: guest checkout first, single page, address autofill attributes, inline validation, order summary always visible, COD clearly labelled, no distractions (minimal header, no nav), trust and return-policy links.
- Success: order number, items, address, payment status, next steps, link to order tracking, continue shopping. Failure: plain-language reason, one-click retry, alternative method, cart preserved.

**Performance and quality budgets (enforced by existing `perf-budget` test and Lighthouse run)**
- LCP under 2.5 s, CLS under 0.1, INP under 200 ms on 375 px mobile; hero/product image `priority`, rest lazy, responsive `sizes`, explicit width/height.
- No client JS for static sections; editor code never shipped to shoppers (ADR-018).
- Accessibility: WCAG 2.2 AA, keyboard-operable variant picker and gallery, visible focus, 44 px touch targets, labels on every input.
- SEO: server-rendered, canonical URLs, Product + BreadcrumbList + CollectionPage JSON-LD, `noindex` on cart/checkout/result pages, OG tags.

## 5. Data and architecture changes

All business logic in `packages/domain/src/themes/` (rule 3); contracts first (AGENTS.md section 3).

1. `THEME_SYSTEM_PAGES` gains: `collections_archive` (`collections_archive_template`), `checkout`, `order_success`, `order_failure`, `search`, `not_found` as **default-type** pages (token/copy settings only, no block tree), plus `collections_archive` as a block template.
2. `theme_templates` snapshot schema bumps version (ADR-009 style): adds the new page keys; migration expand-only, old snapshots load with defaults (rule 10).
3. Template assignment: nullable `template_key` on `products` and `collections` (expand migration, both are `tenantTable`, RLS unchanged). Resolver falls back to default.
4. Storefront routes read the active theme through one `getActiveTheme(ctx)` cached with `tenantTag(ctx, "theme")`; new routes each ship `loading.tsx` (rule 11).
5. Preview: extend `server/preview-samples.ts` so `/preview/<code>?page=` covers every page above with sample variants.
6. Editor: Super Admin theme editor lists all pages grouped "Templates" and "Default pages"; default pages show a settings form (copy, toggles) rather than Puck.
7. New ADR: *Theme page set, default vs template pages, template assignment* (needed because it extends ADR-009/018).

## 6. Demo store (the test fixture)

A seed script `pnpm --filter @bs/platform seed:demo-store` (idempotent, local/ephemeral DB only; never run against production, AGENTS.md 6 rule 2). Creates tenant `demo` with:

- **Collections (6):** Men, Women, Accessories, New Arrivals, Sale (with compare-at prices), Empty collection (tests empty state). Include nested/overlapping membership.
- **Products (~24)** covering every case:
  - simple single-SKU (no variants)
  - 1 option (Size), 2 options (Size x Color), 3 options (stress)
  - variant-specific images and prices
  - compare-at / sale price
  - one sold-out variant, one fully sold-out product, one low-stock
  - long title and long description, missing image, 10-image gallery
  - draft and archived products (must not appear)
- Shipping rates and COD enabled (per store config, rule 12), a test coupon, sample policies and menus, brand tokens, Essential Commerce theme activated.
- Images from a local fixtures folder (no external hosts).

## 7. Phases

| Phase | Scope | Builder | Exit criteria |
|---|---|---|---|
| **0** Plan sign-off | Owner answers section 10; ADR drafted | Claude | Owner approves |
| **1** Demo store | Seed script, fixtures, doc on running it | Antigravity | Seed runs twice with identical result; admin lists all products/variants; isolation suite still green |
| **2** Foundations | Page-set registry, schema version, migrations, template assignment resolver, preview samples | Claude | Contract/domain tests incl. real-DB template fallback; archive and old snapshots still render |
| **3** Catalog pages | Collection Archive, Collection Single, Product page redesigned per section 4, filters/sort/variants | Antigravity | Section 8 criteria 1-6; Lighthouse budgets met on demo store |
| **4** Purchase pages | Cart (+ mini cart), Checkout, Success, Failure themed as defaults; search, 404 | Antigravity | Criteria 7-10 |
| **5** Editor and library | Super Admin editor groups, default-page settings forms, per-product/collection assignment UI in Store Admin, Essential Commerce updated, 1-2 more themes optional | ZCode | Criteria 11-12; admin UI standards respected |
| **6** Full test round | Playwright e2e on demo store, mobile + desktop walkthrough, a11y and perf audit | ZCode, verified by Claude | Section 8 all green; change record with counts |

Claim each phase in `progress.md` "In flight"; one change record per phase; Claude verifies before the next phase starts.

## 8. Acceptance criteria and test matrix

1. Archive lists exactly the published collections of the active store, with images and counts; empty state when none; tenant B never sees tenant A (real-DB isolation test).
2. Collection single shows only its published products, correct prices (sale/compare-at), filters and sort update the URL and survive reload; empty collection shows empty state.
3. Product page: every demo product renders; selecting variants updates price, image, availability and `?variant=`; sold-out variant disables add to cart; unknown variant URL falls back safely.
4. Product, collection and archive pages emit valid JSON-LD (validated in test) and canonical tags.
5. Alternate template assigned to a product renders; deleting it falls back to default.
6. Draft/archived products and collections never appear on any page, search or sitemap.
7. Cart: add, change quantity, remove, persists across reload; totals computed on the server; stock cap enforced; empty-cart state.
8. Checkout (COD, test mode only): guest order with validation errors shown inline, server recomputes price (tamper test: client-sent price ignored), stock decremented once (double-submit test), order row, audit rows and queued email job created.
9. Success page shows the correct order; wrong or expired token shows not-found. Failure page: retry returns to checkout with cart intact (simulated failed test-mode payment).
10. Search and 404 render; cart/checkout/result pages are `noindex`.
11. Theme preview and activation: activating a theme on the demo store changes tokens and page layouts; rollback restores prior version; caches invalidated via `cache-invalidation.ts`.
12. Quality gates at 375 px and 1280 px: no horizontal scroll, axe finds no serious/critical issues, LCP/CLS budgets met, keyboard-only purchase possible.

Gate before every merge: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`, affected tests, `@bs/domain test:heavy`. Isolation suite updated if any `admin.*` procedure is added. e2e selectors updated in the same change if labels move.

## 9. Roles

Claude: plan, ADR, Phases 0 and 2, verification of every phase. Antigravity: Phases 1, 3, 4. ZCode: Phases 5 and 6 (tests). Never merge your own PR; own worktree each (AGENTS.md section 6).

## 10. Open questions for the owner

1. **Failure page**: online payment is deferred. OK to build the page and test it with a simulated failed test-mode payment now?
2. **Alternate templates**: required in v1 for product and collection (assignment per item), or ship defaults first and add alternates later?
3. **Checkout customisation**: confirm checkout and result pages stay token-only (no blocks) for security.
4. **Themes**: finish Essential Commerce only, or also build a second and third theme in this effort?
5. **Demo store location**: local seed only, or also a permanent staging tenant? (Production is off limits without your yes.)
6. **Extras** I added that you may want to drop: announcement bar, mini cart drawer, predictive search, free-shipping progress bar.
