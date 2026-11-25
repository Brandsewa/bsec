# State Pricing grid: editable default price, expander in the SKU column

- **Date:** 2026-11-25
- **Agent:** claude
- **Branch:** `feat/state-pricing-default-edit`  (not merged yet)
- **Area:** admin
- **Type:** feature
- **Supersedes:** none

## Summary
Follow-up to the layout change (`2026-11-25-claude-state-pricing-grid-layout.md`). The Default price column is now editable. For a product with several variants the group row shows only the expander in the SKU column and the product name and variant count in the Product column.

## What changed
- `apps/admin/src/routes/_store/apps/state-pricing.tsx`: Default price is an editable column (paste, keyboard and revert work like the state columns). Edits are saved with `admin.products.bulkUpdate` (the product editor's service, so market prices, cache invalidation, audit and `products.write` stay in one place), then state prices as before, from one Save button.
- `apps/admin/src/lib/state-pricing-grid.ts`: `BASE_KEY`, `basePriceProblem`, `buildBaseChanges`; `buildChanges` ignores default-price edits.
- `apps/admin/src/components/data-grid/editable-grid.tsx`: group row cells per column again, expander in the first column, label in `groupLabelColumn`.
- `apps/admin/src/lib/state-pricing-grid.test.ts`: tests for the default-price helpers.

## Decisions and trade-offs
- No new API: default prices reuse `products.bulkUpdate`. A staff member with `apps.manage` but not `products.write` can edit state prices but gets an error toast when saving a default price.
- Default price cannot be emptied or zero (an empty cell is invalid).
- Default prices are saved before state prices; if the second step fails the first is already saved (the edits stay in the grid and a retry is harmless).
- The CSV import still ignores the "Default Price" column.

## Verification
- Ran: `pnpm --filter @bs/admin typecheck`, `lint`, and the unit tests of `state-pricing-grid` (10 pass).
- Not verified: the screen in a browser, an actual save against a database, the permission-denied toast.

## Docs updated
None needed.
