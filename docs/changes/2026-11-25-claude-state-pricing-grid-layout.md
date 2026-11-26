# State Pricing grid: full width, SKU first and truncated, viewport-height scroll

- **Date:** 2026-11-25
- **Agent:** claude
- **Branch:** `feat/state-pricing-grid`  (not merged yet)
- **Area:** admin
- **Type:** feature
- **Supersedes:** none

## Summary
The State Pricing price editor was a fixed-width page with a 65vh grid, and long SKUs wrapped so rows had uneven heights. It now uses the full-width page container, puts SKU before Product (both pinned left), keeps every row to one line (SKU truncated, click opens the full value; names truncated with a tooltip) and fills the viewport height, scrolling inside.

## What changed
- `apps/admin/src/routes/_store/apps/state-pricing.tsx`: `PageContainer size="full"`, SKU/Product column order and widths, `SkuCell` popover, `Clip`, grid height `calc(100dvh-16rem)`.
- `apps/admin/src/components/data-grid/editable-grid.tsx`: optional `sticky` per column and `groupLabelColumn`; group rows span the full row. Defaults keep the old behaviour (first column pinned).

## Decisions and trade-offs
- Group row label spans all columns so the expander is not squeezed into the narrow SKU column.

## Verification
- Ran: `pnpm --filter @bs/admin typecheck` and `lint`.
- Not verified: the screen in a browser, narrow viewports, keyboard navigation after the column reorder.

## Docs updated
None needed (no structure, routes, tables or env changed).
