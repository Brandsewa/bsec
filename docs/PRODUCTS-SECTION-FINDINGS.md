# Products section: findings from the Storify reference

Findings only, no build instructions yet. Source: Storify's live admin (browsed read-only) and its code, compared with bsec's code. Build plans and Antigravity prompts follow once the owner answers the questions in section 6.

## 1. The feel of Storify's layout

**Every list page uses one frame**: a strip of 4 to 5 stat cards (icon chip, big number, one-line caption), then the title with one primary button on the right ("Add Product", "Add Collection"), then status tabs with a sort toggle at the right, then search plus **Import / Export** plus **Filter** on one row, then the table with row-end action icons, then a footer with "Showing x of y" and rows per page. Empty states are an icon and one sentence. This is the same frame bsec already adopted (`docs/admin-ui-standards.md`, reference `orders.tsx`), so lists need little new design.

**Create and edit pages are full pages in two columns.** A sticky header holds the title, a status badge (Draft, Active), and Save and Back. The left column is a stack of cards in the order a merchant thinks: Details, Product format, Media, Pricing, Inventory, Shipping, Variants, Search Engine Listing. The right rail holds **Status** (with Featured), **Publishing** (channels) and **Organization** (Category, Brand, Type, Collections, Tags). Category forms put Status, Featured and Parent category in the rail; Collection forms put Status, Publishing, Sort order and Display position there.

Small touches worth copying: a live **Google-style preview** in the SEO card ("Auto-filled from title and excerpt. Customize to override.") with character counters (title 70, description 160); an image **Icon** upload for categories; a "how this nests in the mega menu" explainer (levels 1 to 3, level 4 refused); a visual, drag-ordered editor for option values with colour swatches.

bsec today: lists follow the frame, but **product edit is a single plain column** (Product Information, Variants, Stock, Media only) with no category, brand, collection, SEO or publishing controls, and **categories, collections and brands have an API but no admin screens** (the admin routes are only Products and Inventory).

## 2. Section by section

| Section | Storify | bsec today | Verdict |
|---|---|---|---|
| **All products** | Stats (total, active, draft, out of stock, units); tabs All, Active, Draft, Archived; search; Import/Export CSV; Filter; columns product (image, title), category, status, inventory ("0 in stock"), price, channels; two-column form (above); price on request; pre-order switch; barcode standards; HS code; Unlisted status; Featured; POS channel | List screen on the shared kit with bulk actions, CSV export and import; simple edit page; domain CSV import/export exists | **Upgrade the form** to the two-column layout and add the missing Organization and SEO cards. Skip POS, barcode-source rules, HS code for now. |
| **Global variants** | Reusable option sets (for example Size: S, M, L; Colour with swatches), created once and applied to any product; drag to reorder values | Options are per product (`product_options`) | **Defer.** Valuable for apparel with many products; low value for a store with a handful of sizes. |
| **Collections** | Stats; tabs All, Active, Draft; Manual or **Automated (condition builder)**; image; sort order (manual, best selling, A-Z, price, date); display position; "Look" kind (fashion outfits); Draft or Active; SEO card | Schema already supports manual or automated (`type`, `rules`, `match`), `sort_order`, `seo`, `published`; storefront route exists; **no admin UI** | **Build the admin UI** and add the indexing control (section 3). Skip "Look". |
| **Categories** | Stats (total, active, inactive, parents, assigned products); tabs All, Active, Featured, Inactive; tree up to 3 levels feeding the mega menu; image and small icon; featured flag; display order; SEO card | Tree schema exists (`parent_id`, `path`, `position`, `seo`); storefront route exists; **no admin UI**; no featured flag or icon | **Build the admin UI**, add featured and the indexing control. |
| **Brands** | Stats including "pending approval" and "vendor source"; approval states for vendor-submitted brands | `brands` has name, slug, logo only; no storefront page | **Build a simple admin list and form**; drop vendor approval. Add description and SEO only if brand pages are wanted (question Q4). |
| **Inventory** | Stats (tracked, low, out, units, locations); tabs All, In stock, Low, Out; columns Unavailable, Committed, Available, On hand, Incoming; inline quantity edit with a save bar; "unavailable" reasons dialog; location and barcode filters; barcode label printing | Per-location levels, reserved stock, a movement ledger, adjust with reasons (received, sold, damaged, returned, correction, transfer), tabs and low-stock; no breakdown columns | **bsec is close.** Add the Committed and Available columns (the data exists: `reserved`, `available`) and a location filter once there are several locations. Skip barcode labels for now. |
| **Locations** | Name, address, default, active; pickup, opening hours, fulfilment priority, "fulfils online orders", "sells at counter", "accepts returns" | `locations` table (name, address, pincode, default, active, Shiprocket pickup name); provisioning **creates a default location** (better than Storify, which starts with none and blocks stock until one is made); **no admin UI** | **Build a minimal screen** (name, address, pincode, active, default). Skip pickup and hours until in-store pickup is wanted. |
| **Transfers** | Move stock between locations: Draft, Ready to ship (locks stock), In transit, Completed (accepted and rejected quantities per line), Cancelled; event timeline | Not present; the ledger already has a "transfer" reason | **Defer** until a store has two or more locations. When built, follow the same lifecycle with ledger entries on completion. |
| **Reviews** | Rating summary card; tabs All, Published, On hold, Replied, Awaiting reply; publish or hold, bulk, delete, public reply | **No review table.** Products carry `rating_avg` and `rating_count` with no source | **New feature.** Decide scope first (Q5). |

## 3. Categories are primary, collections are secondary: indexing

Neither Storify's category nor collection form has any indexing control, and no Storify page has a per-page "noindex" (it exists only for utility pages like compare and sign-in). So this is **new work for both apps**, and bsec has less to build on than it seems:

- bsec stores a `seo` JSON on products, categories and collections, but **the storefront ignores it**: category and collection pages build their title and description from a template (`collections/[slug]/page.tsx`, `categories/[slug]/page.tsx`), no page sets a robots meta tag, and `robots.txt` and the sitemap switch off only for the whole store (coming soon, password, maintenance).
- The sitemap already lists products and collections; its handling of categories and of the `published` flag should be checked when this is built.

Design that matches your rule:

| | Categories | Collections |
|---|---|---|
| Role | Primary navigation and structure | Secondary grouping (campaigns, seasons, gifting) |
| Indexable default | **Yes** | Admin chooses per collection (default proposed in Q1) |
| Control | An "Allow search engines to index this page" switch, on by default, so an admin can still hide a thin or temporary category | The same switch |
| Effect when off | `robots: noindex, follow`; removed from the sitemap; kept out of structured data breadcrumbs | Same |
| Safety rules | An **empty** category or collection (no active products) is treated as noindex automatically, to avoid thin pages | Same |

Supporting rules to include when it is built: each page has one **canonical** URL (the clean path, without sort, filter or page parameters); filtered and sorted views (`?sort=`, `?inStockOnly=`) are `noindex, follow` with the clean URL as canonical; page 2 and beyond are indexable with their own canonical; a product always lives at `/products/<slug>` (not under a category path), so a product in three categories and four collections still has **one** URL and no duplicate content. Title, description and URL handle are editable per page with the live preview; blank means auto-generated.

## 4. How categories and collections relate to products

Storify's product form requires **one Category** and allows many **Collections**, which fits your model. bsec's `product_categories` is many-to-many. For breadcrumbs, structured data and the mega menu a product needs one **primary category** (required before a product can go Active) with optional extra categories; collections are many-to-many and optional. Needs the owner's confirmation (Q2).

## 5. Things bsec does better, and should keep

- Default location created at store setup; an inventory ledger with reasons; reserved stock tracked per location; a generated `available` column.
- The shared table kit with URL state, column picker, filter chips, bulk runner, select-all-results, mobile cards.
- Money in integer paise, per-store GST, tenant isolation on every table.
- Collections and categories schemas already model what Storify's UI needs (automated rules, sort order, SEO JSON, parent tree).

## 6. Questions and conflicts for the owner

| # | Question | Recommendation |
|---|---|---|
| Q1 | **Collections default:** indexable or not when first created? | Not indexable by default (they overlap with categories and are often thin); the admin switches on the ones that earn it. Categories stay indexable by default as you said. |
| Q2 | **One primary category per product** (required to publish) plus optional extra categories? | Yes. It gives clean breadcrumbs and one canonical home. |
| Q3 | **Unlisted status** (reachable by link, hidden from lists and sitemap) in addition to Draft, Active, Archived? | Add it; it is cheap and useful for launches. |
| Q4 | **Brand pages** on the storefront (`/brands/<slug>`)? There is none today. | Only if brand shopping matters; otherwise brands stay a filter and a label, with no SEO fields. |
| Q5 | **Reviews:** build now? It is a new feature: customer submission tied to a real order, moderation, public replies, rating averages, review structured data (helps search results), and photos that reuse the returns photo upload. | Build after the Orders work, in two steps: moderation and display first, photos after. |
| Q6 | **Global variants:** needed? | Defer. |
| Q7 | **Transfers and multi-location UI:** needed? | Defer until a store has two locations. |
| Q8 | **Product form scope:** adopt Storify's two-column layout with Organization, SEO and Publishing cards, and skip barcode standards, HS code, 3D models, POS channel and the SEO "score" (keep the preview and counters)? | Yes. |
| Q9 | **Pre-order and "price on request"** appear on Storify's product form. Pre-order is already planned (variant-level, simple). Price on request belongs to Quotes, which is optional and last. | Leave both out of the form until those features start. |

**One real conflict with work already in flight:** the Orders plans (pre-orders) and the Returns plan (per-product "Returnable" switch) both add fields to the **product editor**. Redesigning that editor now would collide with Antigravity's current branches. Recommendation: let those two land first, then do the product form upgrade on top, and build the new admin screens that do not touch the product editor (Categories, Collections, Brands, Locations) in parallel.

## 7. Suggested order

1. Categories, Collections, Brands and Locations admin screens (new routes, no clash with the Orders branches), including the indexing switch and the storefront robots, canonical and sitemap behaviour.
2. Product form upgrade (after the Orders work merges): Organization (primary category, brand, collections, tags), SEO card with preview, Publishing, Unlisted.
3. Inventory polish (Committed and Available columns, location filter).
4. Reviews.
5. Later: global variants, transfers.

## 8. Owner answers (2026-10-02)

Collections default to not indexable (admin can switch on); categories always indexable with no switch; one primary category per product plus extras; Unlisted means reachable by link and hidden from lists; no brand pages for now; build a basic review system; global variants, transfers and the product form wait. The product-editor conflict is resolved by waiting for the Orders work to merge, then updating Phase F of the plan. See [PRODUCTS-CATALOG-PLAN.md](PRODUCTS-CATALOG-PLAN.md).
