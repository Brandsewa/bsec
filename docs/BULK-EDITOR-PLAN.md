# Bulk editor for products, categories and collections

- **Owner request:** 2026-11-05 (Shopify-style bulk editor, compact tables).
- **Agent / branch:** claude, `feat/bulk-editor` (worktree `bsec-bulk-editor`).
- **Status:** built in one PR (owner decision 2026-11-05: all slices at once). Deviations: saving composes the existing single-record services (not one transaction per record); product long description is plain text like the product page; the Set all helpers (section 3) are not built yet; undo and redo are built.

## 1. What the owner asked for

A spreadsheet-like editor, like Shopify's "Editing N products": select rows in the list, press **Edit**, change many
records at once in a dense grid, save once. Products first, then Categories and Collections. Also: fix the type of
the product list's bulk bar (header) and pagination (footer), which read larger than the 12px table.

## 2. What already exists (reuse, do not rebuild)

| Piece | Where | Use |
|---|---|---|
| Spreadsheet grid (nested rows, keyboard moves, Excel paste, dirty marking, Escape reverts) | `apps/admin/src/components/data-grid/editable-grid.tsx` (State Pricing, #215) | Base of the new editor. Built to be reused here. Text cells only today: needs select, checkbox and popover cell kinds. |
| Selection across pages, bulk runner | `use-table-selection.ts`, `use-bulk-runner.ts` | Entry point from the list. |
| Variant fields | `admin.variants.update` (sku, barcode, price, compareAt, cost, weightGrams, dimensions, trackInventory, allowBackorder, preorder) | Variant rows. |
| Product fields | `admin.products.update` (title, slug, status, descriptions, tags, type, brand, tax class, hsn, flags, seo, categories, collections) | Product rows. |
| Stock | `admin.inventory.adjust` (delta per variant and location, ledger) | Stock cell writes a delta, never overwrites. |
| Media | `admin.products.media.*` | Media popover. |
| Custom fields | `admin.customFields.*` (Growth plan and above) | Columns generated from the store's definitions. |
| Rich description editor | `components/rich-description-field.tsx`, `product/rich-field-editor.tsx` | Long description popover. |

## 3. Design

**Entry.** List BulkBar gets **Edit** (selected rows, or all matching up to 250). Opens a full page
`/products/bulk-edit` (ids kept in a short-lived server-side or session list, never a giant query string). Same for
`/categories/bulk-edit` and `/collections/bulk-edit`. Header: back, "Editing 15 products", undo/redo, **Columns**
menu (search, grouped, checkboxes, remembered per store), unsaved-changes bar with Save and Discard.

**Grid.** Product row, with its variants as child rows (a single-variant product collapses into one row, as in State
Pricing). Variant-only columns (SKU, price, stock, weight...) show on the variant rows; product-only columns
(title, status, category...) on the product row. Sticky first column, 12px compact rows, tabular numbers, dirty
cells tinted, invalid cells outlined with the message, Escape reverts a cell, paste a block from Excel.

**Cell kinds.** text, number/money (parsed with the store currency), select (status, tax class, brand, unit), checkbox
(track quantity, allow backorder...), multi-select popover (category, collection: bulk set, add or remove), popover
editors for rich description and media, read-only (ids, counts).

**Save.** One call per batch: `admin.products.bulkUpdate` takes up to 100 products, each with its product patch,
variant patches and stock deltas. Each product is its own transaction, so a duplicate SKU or slug fails that row
only; the response is a per-row result and the failed rows stay dirty with the error beside the cell. One
`audit_logs` row per changed product (`products.bulk_update`, before/after of changed fields). Caches invalidate
after commit through `cache-invalidation.ts`. Same shape for `categories.bulkUpdate` and `collections.bulkUpdate`.
Permission: `assertPermission` in the domain service (products.write / catalog write as the single edits use).

**"Set all" helpers** (Shopify's bulk toolbar): apply one value to the selected cells, price +/- % or amount, add or
remove a tag, add or remove a category/collection. Phase 2.

## 4. Columns

Products (grouped in the Columns menu, default visible in bold):

- **General:** **Title**, **Short description**, **Long description**, **Media**, **Status**, **Category** (primary +
  extra), **Collections**, Tags, Product type, Vendor (brand), Featured, Template (if present).
- **Inventory** (variant): **SKU**, **Stock** (default location, delta ledger), **Track quantity**, **Barcode**,
  Allow backorder, Low-stock threshold, Pre-order (enabled, ships on, message).
- **Pricing** (variant): **Base price**, **Compare-at price**, **Cost per item**, **Tax** (tax class), Price on request.
  Margin and profit as read-only computed columns.
- **SEO:** **Title**, **Meta description**, **URL handle** (slug; warns that a changed handle changes the public URL).
- **Shipping:** **Weight** (kg or g, store unit), **Dimensions L x W x H** (cm), **HSN code**, Requires shipping, Returnable.
- **Publishing:** Created, Updated, Published date (read-only).
- **Custom fields:** one column per active definition for products (Growth plan and above; hidden otherwise).

Categories: **Name**, **Description** (short), **Long description**, **Featured image**, SEO **Title**, **Meta
description**, **URL handle**; plus Parent, Active, Featured, Sort order, Position, product count (read-only), type (read-only).

Collections: **Title**, **Description**, **Long description**, **Featured image**, SEO **Title**, **Meta
description**, **URL handle**; plus Published, Indexable, Sort order, product count and type (read-only).

Rules and rich content stay out: automated rules and manual product lists are edited on the record's own page
(a column would hide too much state). Long descriptions use the same validated block JSON as today (ADR-010), never raw HTML.

## 5. Typography fix (product list header and footer)

The BulkBar and Pagination inherit body size, so "25 products selected", "Select all 96 products", "1-25 of 96",
"Rows per page" and "Page 1 of 4" render about 16px beside 12px table text. Set them to the table scale
(`text-xs`, 12px; counts `font-medium text-foreground`, helper text `text-muted-foreground`), column headers stay
`text-xs font-medium`. Applies to every list that uses these shared parts (they live in `packages/content-admin`).

## 6. Slices (each its own PR, gate green, change record each)

1. Typography fix + extend `EditableGrid` with select, checkbox and popover cells (no behaviour change for State Pricing).
2. Contract + domain `products.bulkUpdate` (+ isolation mapping, real-DB tests: partial failure, audit row, RLS, permission, tag invalidation).
3. Products bulk-edit page: General, Pricing, Inventory, SEO, Shipping columns, Columns menu, unsaved bar, undo/redo, list entry.
4. Media and long-description popovers, category and collection multi-select, custom-field columns.
5. Categories and Collections `bulkUpdate` + their pages.
6. "Set all" helpers, CSV paste polish, e2e selectors.

## 7. Questions for the owner

1. Slice order and PR size as in section 6 (recommended), or one large PR?
2. Stock: edit **on hand at the default location** only (recommended; multi-location stays on the Inventory page)?
3. Changing a **URL handle** in bulk: allow with a warning (recommended), or lock it until redirects exist?
4. Cap per session: **250 records** (recommended) or lower?
