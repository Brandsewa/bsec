# Bulk editor for products, categories and collections

- **Date:** 2026-11-05
- **Agent:** claude
- **Branch:** `feat/bulk-editor` (merged in #230, 4964d7e)
- **Area:** contracts, domain, web (API), admin, content-admin, docs
- **Type:** feature
- **Supersedes:** none

## Summary
Owner request: a Shopify-style bulk editor for products, categories and collections, with compact tables, and a smaller type size for the product list's bulk bar and pagination footer. Built on the reusable-grid idea from the State Pricing work, in one PR as the owner asked.

## What changed
- Products list: **Edit** in the bulk bar opens `/products/bulk-edit` (ticked rows, or all matching up to 250). Grid of products with variants as child rows (single-variant products collapse to one row). Columns in a searchable, grouped Columns menu (remembered per browser): General (title, short and long description, media, status, category, more categories, collections, tags, type, vendor, featured), Inventory (SKU, stock at the default location, track quantity, sell when out of stock, barcode), Pricing (base, compare-at, cost, tax class, price on request), SEO (title, meta description, URL handle), Shipping (weight in grams, L x W x H, HSN, requires shipping, returnable), and one column per custom field (text, number, yes/no, dropdown; Growth plan and above). Dirty cells tinted, per-cell errors, unsaved bar with Save and Discard, undo and redo, leave-page warning.
- Categories and Collections lists: **Bulk edit** button; grids with name or title, description, long description (rich editor popover), featured image, SEO title and description, URL handle, active/featured or published/indexable, parent, position, sort order, type and product count (read only).
- API: `admin.products.getMany`, `admin.products.bulkUpdate`, `admin.categories.bulkUpdate`, `admin.collections.bulkUpdate` (`packages/domain/src/catalog/bulk-edit.ts`). `admin.collections.list` now returns `seo`.
- Typography: bulk bar and pagination in `packages/content-admin` use the 12px table scale (all lists using them).
- New files: `components/data-grid/bulk-grid.tsx`, `taxonomy-bulk-editor.tsx`, `lib/bulk-edit.ts`, `lib/bulk-edit-products.ts`, `lib/bulk-edit-entry.ts`, route files `products/bulk-edit.tsx`, `categories_.bulk-edit.tsx`, `collections_.bulk-edit.tsx`.

## Decisions and trade-offs
- Each record is saved through the existing single-record services, so rules, permissions, market-price sync and cache invalidation stay in one place. Cost: not one transaction per record; a record can be partly saved if a later step fails (reported as failed, edits kept so the owner can retry).
- Stock is edited as "wanted on hand at the default location" and written as a `correction` movement, never an overwrite. Multi-location stays on the Inventory page.
- Media add and remove save at once (separate endpoints); everything else saves with Save.
- Product long description is plain text, matching the product page today.
- A changed URL handle is allowed without redirects (warning not built yet; see follow-ups).

## Verification
- Ran: `pnpm --filter @bs/contracts --filter @bs/domain typecheck` pass; `pnpm --filter @bs/admin typecheck` pass; `pnpm --filter @bs/web typecheck` pass; admin and domain lint pass; `pnpm docs:check` ok; `pnpm --filter @bs/admin build` ok; `vitest run src/lib/bulk-edit.test.ts` 9 pass.
- NOT run: `packages/domain/test/bulk-edit.int.test.ts` and the isolation suite mapping (new `products.getMany`, `products.bulkUpdate`, `categories.bulkUpdate`, `collections.bulkUpdate` cases). Docker was not running, so real-database tests could not start; CI runs them.
- NOT exercised by hand: no screen was opened in a browser (no local database), so the grids, popovers, keyboard movement and the typography change are unseen. Needs an owner or ZCode walk at 375 px and desktop.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (section 21)
- [ ] ADR: not needed (no new architectural decision)
- [ ] `DEPLOYMENT.md`: not needed
- [x] `progress.md` (in flight)

## Follow-ups and open questions
- "Set all" helpers (apply a value, price % change, add or remove tag) and Excel paste into the new grid.
- URL handle change warning and redirects.
- e2e selectors if the e2e suite touches the list bulk bar.

## Definition of done
Gate partly run (see Verification); real-database tests and a browser walk-through outstanding.
