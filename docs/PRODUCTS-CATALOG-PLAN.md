# Products: categories, collections, brands, locations, reviews, indexing

Hand-off plan for Antigravity. Verifier: Claude. **Phase F is unblocked** (the Orders work is built; Phase F names the base branch). Phases A to E touch none of the files the Orders work changed.

**Styling (mandatory):** build every screen with the owner's design system: `docs/admin-ui-standards.md`, the shadcn `base-mira` (Base UI) components in `apps/admin/src/components/ui`, and the shared kit. See section 4 of [ORDERS-SECTIONS-OVERVIEW.md](ORDERS-SECTIONS-OVERVIEW.md). Do not hand-roll tables, selects, dialogs or form controls.

Background and evidence: [PRODUCTS-SECTION-FINDINGS.md](PRODUCTS-SECTION-FINDINGS.md). Storify (`Storify/`, untracked, never copy code) is a behaviour reference only.

## 0. Owner decisions (2026-10-02)

| # | Decision |
|---|---|
| Q1 | **Collections default to not indexable.** An admin can switch indexing on per collection. |
| Q1b | **Categories are always indexable. There is no switch to turn it off.** |
| Q2 | Every product has **one primary category** (required to publish) plus optional extra categories. |
| Q3 | **Unlisted** status: reachable by direct link, hidden from every list, search and sitemap. |
| Q4 | **No brand pages on the storefront** for now. Brands are a label and a filter only. |
| Q5 | Build a **basic review system now**: the theme blocks already show stars from `rating_avg` and `rating_count`, which have no source today. |
| Q6, Q7 | Global variants and Transfers are deferred. |
| Q8 | Product form: two-column layout with Organization, SEO and Publishing cards; skip barcode standards, HS code, 3D, POS, SEO score (keep the live preview and counters). |
| Q9 | Pre-order and Price on request stay off the product form until those features start. |

**Confirmed by the owner (2026-10-02):** an **empty category** (no active listed products) is served `noindex, follow` automatically, because an empty page is a soft 404. It is not a manual switch, and it also applies to collections (section 3, rule 4).

## 1. What bsec has (verified)

- `categories` (tree: `parent_id`, `path`, `position`, `seo` jsonb, `image_media_id`), `collections` (`type` manual or automated, `rules` jsonb, `match`, `sort_order`, `seo`, `published`, `image_media_id`), `brands` (name, slug, logo), `locations` (name, address, pincode, `is_default`, `is_active`), `product_categories` (many to many, `position`), `collection_products` (`packages/db/src/schema/catalog.ts`).
- Admin API contracts exist for categories, collections and brands (`packages/contracts/src/admin.ts`) but **no admin screens** for them and **no API at all for locations**. Provisioning creates a default location.
- Storefront routes `apps/web/src/app/categories/[slug]` and `collections/[slug]` exist but **build title and description from a template and ignore the stored `seo`**, set no robots meta, and sort and filter through query parameters. `robots.txt` and the sitemap switch off only for the whole store (`access.noindex`, coming soon, password, maintenance). The sitemap lists products and collections.
- `STOREFRONT_PRODUCT_STATUSES = ["active", "published"]` (`packages/domain/src/storefront/product-status.ts`) is the single visibility rule used for both direct pages and lists.
- `products.rating_avg` and `rating_count` exist and `packages/blocks` renders stars from them; nothing writes them and there is no reviews table.
- The admin has routes only for Products and Inventory (`apps/admin/src/routes/_store/`).

## 2. Data (expand-only migrations, `docs/migrations.md`)

| Change | Notes |
|---|---|
| `collections.indexable boolean not null default false` | Existing collections become not indexable (owner decision). State this in the change record; they currently appear in the sitemap and will leave it until an admin switches them on. |
| `categories.is_active boolean not null default true` | Inactive categories are hidden from the storefront and menus but their products stay. |
| `categories.is_featured boolean not null default false` | For featured-category blocks; optional in the UI until a block uses it. |
| `product_categories.is_primary boolean not null default false` | Partial unique index `(tenant_id, product_id) where is_primary` so a product has at most one. Backfill: the earliest-position row per product becomes primary. |
| `products.status` accepts `unlisted` | The column is free text; update the contract enum and any validation list. |
| New tenant table `reviews` (Phase E) | Via `tenantTable()` plus `forceRlsSql`, composite FKs to `products`, `customers` (nullable) and `order_items` (nullable). |

No existing column is dropped or renamed. Every new table or column keeps RLS and the composite tenant foreign key rule.

## 3. Indexing behaviour (Phase A, storefront and domain)

Fix the storefront so stored SEO and the rules below actually take effect.

1. **Title and description**: use `seo.title` and `seo.description` when set; otherwise today's template. Same for products, categories, collections. Open Graph follows.
2. **Categories** are always `index, follow` (except rule 4). Pages with `?sort=`, `?inStockOnly=` or other filter parameters are `noindex, follow` with the clean URL as canonical. `?page=N` is indexable with its own canonical.
3. **Collections** are `index, follow` only when `indexable` is true **and** `published` is true; otherwise `noindex, follow`. Same parameter rules as categories.
4. **Empty rule (confirmed)**: a category or collection with no active, listed products is served `noindex, follow` until it has some.
5. **Sitemap**: includes products (listed statuses only), categories (active, non-empty) and collections (published, indexable, non-empty). It never lists `unlisted` products, inactive categories, draft collections, or anything on a store that is not live.
6. **Products** always live at `/products/<slug>` (never under a category or collection path). An `unlisted` product is served with `noindex` and is excluded from every list, search result, related-products block, sitemap and collection.
7. **Canonical** for each page is the clean absolute URL on the store's primary domain.
8. Structured data: keep the existing helpers in `storefront/seo.ts`; breadcrumbs use the primary category.

Tests (real database where data is involved): a page's robots value for every combination above; sitemap contents for each state; unlisted never leaks into lists or search; another tenant's pages never appear.

## 4. Phases

### Phase A: indexing foundations (no admin UI)
Migration for `collections.indexable`; implement section 3 in `apps/web` and `packages/domain/src/storefront`. Add `DIRECT_PRODUCT_STATUSES` (`active`, `published`, `unlisted`) and `LISTED_PRODUCT_STATUSES` (`active`, `published`) beside the existing constant and **audit every use** of `STOREFRONT_PRODUCT_STATUSES`: direct product page and add-to-cart use the first; lists, search, sitemap, related, collections use the second. Contract and validation accept `unlisted`. No admin screen yet.

### Phase B: Categories admin
Route `apps/admin/src/routes/_store/categories.tsx` (list) plus a full-page create and edit (`categories_.new.tsx`, `categories_.$id.tsx`), following `orders.tsx` and the create-page pattern. List: stat cards (Total, Active, Inactive, Parents, Products assigned), tabs All, Active, Featured, Inactive, search, a **tree-aware table** (children indented, drag or arrows to reorder within a parent), row actions (Edit, Activate or Deactivate, Feature, Delete). Form: name, handle, description (500), image, parent (max **3 levels**, deeper refused), display order, Active, Featured, **SEO card** (live Google-style preview, title counter 70, description counter 160, handle editable, blank means auto). **No indexing switch.** Delete is refused while the category has children or is the primary category of any product, with the reason shown. Extend the contracts (`description`, `imageMediaId`, `isActive`, `isFeatured`, `seo`, `position`), domain with `assertPermission(ctx, "products.write")` (read `products.read`) and `audit_logs`, and cache invalidation through `cache-invalidation.ts` with tenant-prefixed tags (rule 5).

### Phase C: Collections admin
Routes `collections.tsx`, `collections_.new.tsx`, `collections_.$id.tsx`. List: stats (Total, Active, Manual, Automated, Indexable), tabs All, Active, Draft, search, columns (collection, type badge, products, status, **Search engines: Indexed or Hidden**). Form: title, handle, description, image, **type Manual or Automated**, a product picker for manual (search, add, remove, drag order), a **condition builder** for automated (rules on tag, product type, brand, category, price range, in stock, title contains; match all or any; the storefront already evaluates `rules`, so reuse its schema and validate server-side), sort order (manual, best selling, A to Z, Z to A, price low to high, price high to low, newest, oldest), status Draft or Active, and the **SEO card with an "Allow search engines to index this page" switch, off by default**. Add the `indexable` field to the contract and domain; every save audited. Skip Storify's "Look" kind.

### Phase D: Brands and Locations admin
**Brands**: list and a small dialog or page (name, handle, logo), stats (Total, Used, Unused), delete allowed (products fall back to no brand through the existing `set null` FK) with a count shown. No brand pages, no SEO fields. **Locations**: new contract and domain (none exist). List with name, address, PIN code, status, default badge. Form: name, address, PIN code, Active, Default. Rules: exactly one default (setting a new default clears the old one in the same transaction), the default cannot be deactivated or deleted, the last active location cannot be deactivated, a location with stock on hand cannot be deleted (offer deactivate). Audited. No pickup or opening hours for now.

### Phase E: Reviews (basic)
Data: `reviews` (id, product, optional variant, optional customer, **order item** for verified purchase, reviewer display name, rating 1 to 5, title up to 100, body up to 1000, `status` `published` or `on_hold`, optional public reply text and `replied_at`, timestamps). Unique per (customer, product). Rating aggregates: recompute `products.rating_avg` and `rating_count` **in the same transaction** whenever a review changes status, is edited or deleted, counting published reviews only (a one-time backfill job for existing products with no reviews sets zeros).

Storefront: the product page shows the rating summary, the published reviews (newest first, 10 per page) and a **Write a review** form. Who may review: a signed-in customer, or a guest holding a valid order link, whose **delivered order contains that product**; one review per product; reviews are **plain text only** (escape on output, never render HTML or links), rate limited per customer and per IP, and a honeypot field. New reviews are `on_hold` by default; a store setting **Publish reviews automatically** (Settings, off by default, next to the order settings) publishes verified-purchase reviews immediately. JSON-LD `AggregateRating` and `Review` only for published reviews. Every page keeps `loading.tsx`.

Admin: route `reviews.tsx` per Storify: a rating summary card (average, count, 5 to 1 star bars), tabs All, Published, On hold, Replied, Awaiting reply, search (product, reviewer, text), table (product, reviewer, rating and text, date, status), row and bulk actions **Publish**, **Put on hold**, **Delete** (confirm), and a **Reply** dialog (one public reply per review, up to 1000 characters, editable). Permissions: read `products.read`, write `products.write`; all mutations audited; the product list shows the rating. No review photos in this phase (they can reuse the returns photo upload later).

### Phase F: product form, sidebar, inventory (UNBLOCKED: the Orders work is built)

**Base:** the Orders work is a linear stack of branches ending at `feat/orders-returns` (commit `7a7f49f`). Branch from that tip, or from `main` once the stack is merged. Never start from older `main`: the product editor, the sidebar, `catalog.ts` and the contracts have all changed. **Migrations: the last one is `0023_returns.sql`, so new ones start at `0024`** (renumber Phases A to E accordingly).

**What the Orders work left in the product area (verified in the code on 2026-10-02):**
- `apps/admin/src/routes/_store/products/$id.tsx` and `new.tsx` are still the **single-column** forms. They now also carry: a **Price on request** checkbox in Product Information (`products.price_on_request`), and a per-variant **pre-order block** (checkbox, expected ship date, message up to 200) inside each variant row (`variants.preorder_enabled`, `preorder_ships_on`, `preorder_message`).
- The products **list** shows "Pre-order" and "Pre-order date passed" badges (`preorderStatus` from the list contract).
- `products.returnable` exists and the server enforces it (`orders/manual-lifecycle.ts`), but **nothing in the admin or the contract can set it**: the "Returnable" switch the Returns plan required was not built, so today every product is returnable and cannot be changed. Fix it here.
- The plan asked for a `switch.tsx` component; **it was not added**. The new controls use `Checkbox`. Add `switch.tsx` through the shadcn CLI (overview section 4 has the gotchas) and use it for on and off settings; convert the three new checkboxes above to switches.
- Sidebar (`apps/admin/src/routes/_store.tsx`): an **Orders** group (All orders, Pre-orders, Quotes, Abandoned checkouts, Returns) and a **Sell** group (Products, Inventory, Customers, Discounts). Settings has Orders and Returns items.
- Quotes (a full lean version) and `price_on_request` already exist, so Q9 changes: **Price on request stays on the form**, in the Pricing card.

**Build:**
1. **Sidebar:** add a **Catalog** group (Products, Categories, Collections, Brands, Inventory, Locations, Reviews), moving Products and Inventory out of **Sell**, which keeps Customers and Discounts. Add items only for pages that exist; keep each item's permission (`products.read`).
2. **Product form, two columns** (sticky header with title, status badge, Save and Back). Left: **Details** (title, handle, short description, description), **Media**, **Pricing** (price, compare-at, **Price on request** switch), **Variants** (existing per-variant fields and the **pre-order block**, kept as is and moved into the Variants card), **Inventory**, **Shipping**, **Search Engine Listing** (live preview, title counter 70, description counter 160, editable handle, blank means auto). Right rail: **Status** (Draft, Active, **Unlisted**, Archived, plus Featured), **Organization** (**Primary category, required to publish**, extra categories, brand, collections, tags) and **Returns** (the **Returnable** switch, on by default, labelled "Final sale" when off). Do not remove or rename anything the Orders work added.
3. **Domain rules:** a product cannot move to Active or Unlisted without a primary category (grandfather existing active products until their next status change, with a clear error otherwise). Extra categories and collections save through the existing `product_categories` and `collection_products`. Add `returnable` to the product contract, create and update.
4. **Status `unlisted`** (contract enum, validation, the product list status filter and badges) and the visibility split from Phase A.
5. **Inventory polish:** Committed (`reserved`) and Available columns; a location filter when the store has two or more locations.
6. Tests: the primary-category rule (publish refused without one, allowed with one, grandfathering), `returnable` round trip and its effect on the return form, status transitions including `unlisted`, RLS isolation for new queries, and component tests rendered in a router.

## 5. Acceptance criteria

Phases A to E:

- [ ] A newly created collection is `noindex, follow` and absent from the sitemap; switching its indexing on (and publishing it) makes it `index, follow` and lists it; categories have no indexing control anywhere in the UI or API.
- [ ] Category and collection pages use stored SEO title and description; filtered and sorted URLs are `noindex` with a clean canonical; page 2 is indexable with its own canonical.
- [ ] An empty category or collection is `noindex`; the sitemap excludes it.
- [ ] `unlisted` products open by direct link and can be bought, carry `noindex`, and never appear in lists, search, related blocks, collections or the sitemap (tests for each).
- [ ] The categories tree enforces 3 levels, refuses deleting a category that has children or is a primary category, and reorders without breaking the tree.
- [ ] Automated collections evaluate their rules server-side; manual collections keep their order; collection save is audited.
- [ ] Exactly one default location at all times; the default and the last active location cannot be deactivated; a location with stock cannot be deleted.
- [ ] Reviews: only a customer or order-link holder with a delivered order for that product can post; one per product; plain text only; rate limited; new reviews held unless auto-publish is on; `rating_avg` and `rating_count` always equal the published reviews (test through publish, hold, edit and delete); JSON-LD only for published reviews.
- [ ] Phase F: sidebar has the Catalog group; the product form is two-column with Organization (primary category required), SEO preview, Unlisted, Returnable and the existing pre-order and price-on-request controls; `switch.tsx` exists and replaces the three checkboxes; `returnable` is settable and changes the return form.
- [ ] Every admin screen uses the shared kit and `base-mira` components, has `pendingComponent`, mobile cards, empty and error states; every storefront page has `loading.tsx`.
- [ ] Domain functions call `assertPermission`; every mutation writes `audit_logs`; cache tags are tenant-prefixed; RLS test for each new table; contracts first.
- [ ] Gate passes; change records and `ARCHITECTURE.md` updated; each screen opened in a real browser at desktop and 375 px and reported honestly.
