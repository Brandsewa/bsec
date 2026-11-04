# Apps home, sidebar pinning, and a bulk grid for State Pricing

- **Date:** 2026-11-04
- **Agent:** claude
- **Branch:** `feat/apps-home-bulk-editor` (not merged yet)
- **Area:** db, domain, contracts, admin, web, docs
- **Type:** feature
- **Supersedes:** none

## Summary
Owner request after #213 and #214: an Apps section in the main sidebar with an app home (like the Shopify app store), installed and uninstalled tabs in Settings > Apps, pinning an installed app to the sidebar, a bulk editor for state prices instead of per-variant forms, and a simpler pincode popup.

## What changed
- Migration `0097_tenant_apps_pinned` (`tenant_apps.pinned`); `admin.apps.setPinned`; `admin.apps.listGrid`, `setPricesBulk`, `lookupSkus`.
- Admin: `/apps` (app home), `/apps/state-pricing` (Prices grid and Settings tabs), Settings > Apps with Installed and Uninstalled tabs; sidebar group Apps with pinned apps. Removed `/settings/apps/state-pricing`.
- Reusable `components/data-grid/editable-grid.tsx` (nested rows, keyboard moves, paste from Excel, dirty marking); `lib/state-pricing-grid.ts` (money parsing, CSV export and import, change building) with unit tests.
- Storefront pincode popup: solid white card (the theme background token could be transparent), one pincode field, Continue, small "For delivery and availability" line; the "continue with standard prices" link is gone.

## Decisions and trade-offs
- Own grid instead of a library: AG Grid keeps row grouping and tree data in its paid edition, Handsontable is not free for commercial use, react-data-grid is a beta on React 19. The need is small and the data model stays with the caller, so the products bulk editor can reuse it.
- Pinning is store-wide (`tenant_apps.pinned`), not per user, so every staff member sees the same sidebar. Per-user pinning would need a user preference table.
- Import stages edits for review and saves with the same Save button; an empty cell in a file never removes a price (clear the cell in the grid for that).
- With the skip link removed, a shopper in manual mode has to enter a pincode to browse. The `skip` handling stays in `/api/storefront/region` but nothing links to it.

## Verification
- Ran: typecheck and lint for admin, web, domain, contracts; admin unit tests for the grid logic.
- Walked in a browser against a fresh local database (desktop width): app home (card, Installed, Open); Settings > Apps tabs and the row menu; pin to sidebar (sidebar shows "All apps" and the pinned "State Pricing"); the grid (25 of 33 products per page, page 2, search by name and by SKU, multi-variant product expands, dirty cells marked, a 2x2 paste, an invalid price keeps the unsaved bar and disables Save, a valid save persisted and wrote one `state_prices.bulk` audit row, edits survive paging and searching); CSV export (matches the Excel layout) and a CSV import with Sikkim and West Bengal columns and one unknown SKU; more than 10 states (ten inline plus "+2 more" opening a popup); the storefront popup (solid white card, one field, Continue, small footer line; a pincode set the Karnataka price).
- Found and fixed during the walk: the unsaved-changes bar vanished while a cell was invalid.
- Written, not run locally: the real-database tests (pinning, grid read, bulk save, SKU lookup, isolation mapping); CI runs them.
- NOT checked: a real phone-width layout, keyboard arrow navigation by hand, `.xlsx` files (unsupported).

## Docs updated
- [x] `docs/ARCHITECTURE.md` (migration table, section 20)
- [ ] ADR: not needed (extends ADR-043 without changing it)
- [ ] `DEPLOYMENT.md`: not needed
- [ ] `progress.md`: in-flight line

## Follow-ups and open questions
- Excel `.xlsx` import (CSV and paste work today).
- Reuse the grid for the products bulk editor.

## Definition of done
Gate and CI outstanding; browser walk-through outstanding.
