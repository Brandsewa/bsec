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
- Written, not run locally (Docker engine not running): real-database tests for pinning, the grid read, bulk save, SKU lookup and the isolation mapping; CI runs them.
- NOT done: no browser walk-through of the app home, pinning, Settings tabs, the grid, import and export, or the new popup.

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
