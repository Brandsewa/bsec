# Owner polish batch 1: admin forms, navigation editor, theme-builder product block, Modern Commerce mobile

- **Date:** 2026-10-20
- **Agent:** claude
- **Branch:** `feat/admin-storefront-polish-batch1`  (committed, not merged)
- **Area:** admin, ui, block-editor, blocks, web, domain, docs
- **Type:** feature
- **Supersedes:** none

## Summary
The owner sent a 41-item list of fixes and refinements while walking the local admin and the storefront. Most are small screen changes; the product, category, collection and navigation forms were made consistent between "add" and "edit", the theme builder's Product details settings were regrouped, and the Modern Commerce theme got a working phone menu, a bottom bar, a search popup and a share button. Item 13 (categories built like collections) was built after the owner chose "exactly like collections": migration `0074_category_types` adds `type`, `match`, `rules` and `sort_order` to `categories`.

## What changed
**Store admin**
- Breadcrumbs removed from every store-admin page (`PageBreadcrumbs` stays in `@bs/ui` for Super Admin). Pages that kept their buttons in the breadcrumb row now use `PageActions`; pages that had no other way back got a `back` link on `PageHeader` (orders, returns, discounts).
- Product: add and edit share `StatusVisibilityCard` (a dropdown everywhere), `PricingQuotesCard` (price on request plus a product-wide **pre-order** switch with ship date and message, applied to every variant) and `OrganizationCard` (extra categories and manual collections chosen in popups with search) in `components/product/product-cards.tsx`. The add page's old option and variant cards are replaced by `DraftVariantBuilderCard`: variant rows appear as soon as option values are entered, with SKU and price inline. On the edit page, Enter after a value applies the options at once (no separate Apply click). The variant drawer has a side rail of all variants; edits are kept per variant while you switch and one Save writes every changed variant. Preview button on product, category and collection pages (opens the storefront; disabled for draft, inactive or unpublished items).
- Categories: one `CategoryForm` for add and edit in the product page's two-column layout, with the collection model: Manual or Automated type, the same Conditions builder (`RulesBuilderCard`, now shared with collections), an "Add products" assignment popup for manual categories, Product Sorting and Active/Featured visibility. Domain (`catalog-services.ts`): `createCategory`/`updateCategory` take `type`, `match`, `rules`, `sortOrder`, `productIds`; `syncCategoryProducts` writes `product_categories` in order, makes the category primary for a product that has none, and refuses to remove a product whose primary category it is. Storefront (`getStorefrontCategory`, `listStorefrontCategories`): automated categories list listed products matching the rules, the category's sort is the default (a shopper's choice still wins), and the categories archive counts automated categories by their rules.
- Collections: Manual and Automated cards side by side; manual product assignment is an "Add products" popup (`ProductPickerDialog`, searches the whole catalog, shows status, price range, variants and stock).
- Navigation editor: URL line hidden in rows; drag and drop now nests (drop on a row to move there, drag sideways to nest or lift, three levels max); drawer padding fixed; link pickers show names only with the resolved link as a small hint (Collection and Category link types already existed); header preview is a white card and its dropdown is no longer clipped; Menu Settings is one compact row.
- Sidebar: small "View your store" icon on the Online Store row (`NavGroup.external`). Add page drawer footer is one aligned row.

**Theme builder (`packages/block-editor`, `packages/blocks`)**
- Product details settings are accordion sections (Order of the elements, Layout, Product info, Add to cart and Buy now, Payment and reassurance, Delivery estimate, Highlight cards, Accordion rows); Yes/No settings are compact switches (`toggle`). Stored props are unchanged.
- The editor's sample product page is interactive: choosing a size changes price, compare-at price and saving (`views-product-sample-client.tsx`).

**Storefront (`apps/web`, `packages/blocks`)**
- Phone menu rewritten as a client side drawer (it opened off-screen and blank before). Bottom bar `MobileBottomNav` for theme stores. `SearchModal` with live results and Add to cart, backed by `GET /api/storefront/search/products` (new `log: false` option on `searchStorefrontProducts` so typing is not counted as searches). Carousel cart button opens the quick-buy popup for multi-variant products (`GET /api/storefront/products/[slug]/quick-buy`). Mini cart is 90% wide on phones. Share button beside the price. Reviews now come right after the product blocks and "You may also like" last. Breadcrumb hidden and padding reduced on phones. Rich-text custom fields keep lists, bold and headings. `SiteHeader.showAccount` defaults to on.

## Decisions and trade-offs
- Pre-order is still stored per variant. The product-level switch writes the same values to all variants when the product is saved; the variant drawer can still set it per variant, and the card says when only some variants are on pre-order.
- Item 26 (compare-at price missing on the live page) could **not be reproduced**: with a real click the live page shows the compare-at price, saving percentage and follows the chosen variant. The theme-builder sample was static, which is what the owner most likely saw. One real flaw was fixed: a variant without a compare-at price used to borrow the first variant's.
- `SiteHeader.showAccount` default changed from false to true (no schema shape change, so no block version bump); stored headers that say `false` keep it off.
- The static markup of the header no longer contains the phone drawer's links (they appear when it is opened); desktop navigation is unchanged.
- Bottom bar is shown only when the store uses a theme header (the theme system), not for stores on the built-in header.

## Verification
- Ran: `pnpm --filter @bs/admin typecheck`, `lint`, `test` (90 + 5 new pass); `@bs/ui` typecheck and test (45 pass); `@bs/blocks` typecheck, lint, test (210 pass; three tests updated for the new header behaviour); `@bs/block-editor` typecheck, lint, test (18 pass); `@bs/web` typecheck, lint (warnings only, none new of note), test (224 pass); `storefront-isolation.int.test.ts` and `catalog.int.test.ts` against the local test Postgres (17 and 13 pass, including the new "log: false is not recorded" test and the category tests: manual assignment and ordering, the primary-category guard, automated storefront listing, default sort, archive counts).
- Exercised by hand in the Browser pane against the local stack: add-product page (options plus Enter creates variant rows), product edit variant drawer (rail, unsaved markers, "Save 2 variants"), live product page price switching and compare-at, phone menu drawer, bottom bar, search popup (live results), quick-buy popup.
- NOT verified: saving the add-product form end to end with the new payload; the variant drawer's multi-variant save; the category and collection pages and the navigation drag-and-drop nesting in the browser; the theme builder's new accordion panel and interactive sample (typechecked and tested only); the carousel quick-buy trigger itself (the demo store's home has no carousel; the popup was exercised through search); the share button on a real phone; the bottom bar on a store with a built-in header; `pnpm build` and `docs:check` (see the final gate line in the PR). Nothing was run against production.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (sections 8 and 10; "Last verified" bumped)
- [ ] ADR: not needed (no architectural decision; defaults changed inside an existing block)
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed (no env, service or deploy change)
- [x] `progress.md` (in flight)

## Follow-ups and open questions
- Item 13 caveat: an automated category does not edit any product, so a product listed by rules is not "in" the category for other purposes (breadcrumbs, the product form's category fields). Manual categories keep using `product_categories`, so assigning in the category form and picking it on the product form are the same data.
- Item 26: the owner should name a product where the live page still shows no compare-at price.
- Super Admin still shows breadcrumbs (only the store admin was asked about).

## Definition of done
- [x] Gate items run for the touched packages (above); full `pnpm build`, `pnpm lint` and `docs:check` still to be run before merge.
- [x] Tests added or updated (draft variants, header chrome, real-database search logging).
- [x] No secrets, generated files or unrelated edits (`apps/web/AGENTS.md` is rewritten by `next dev`; do not commit that change).
