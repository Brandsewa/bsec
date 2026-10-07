# Store Admin archives consistency & settings card hierarchy polish

- **Date:** 2026-10-06
- **Agent:** antigravity
- **Branch:** `design/sprint-ui` (not merged yet)
- **Area:** admin, ui
- **Type:** refactor
- **Supersedes:** none

## Summary
Completed comprehensive design system polish across Store Admin (`apps/admin`) focusing on archives table layout parity, Return & Exchange workflows, and complete restructuring of all settings routes into compact `SettingsCard` hierarchies. Every settings route now utilizes modular cards, right-aligned compact descriptions/action rows, and standardized typographic scales.

## What changed
- **Archive Tables & Width Parity**:
  - Aligned archive tables across Orders (`quotes`, `abandoned-checkouts`, `returns`), Catalog (`categories`, `collections`, `brands`, `locations`, `reviews`), and Finance (`expenses`, `reports`) to match the refined full-width table layout from All Orders.
  - Removed outdated black borders and enforced consistent border token styling (`border-border`).
- **Return & Exchange Improvements**:
  - Removed top breadcrumbs (`Home > Orders > Exchange`).
  - Consolidated search and filter controls into a single row using the shared `DateRangePicker` component.
  - Added multi-select checkboxes for bulk selection and two-step action workflow (Archive first, Delete only available in Archive view).
  - Fixed Drawer opacity/readability (solid background tokens, no transparent backdrop bleed) and set width to cover >=30% of screen.
- **Settings Re-architecture & Card Standardization**:
  - Docked settings navigation on the sidebar with sub-navigation font sizing matching primary navigation weight and hierarchy.
  - Replaced legacy divided single-cards and `SettingsSection` elements across all 20 settings routes with dedicated `SettingsCard` components:
    - **Store Details**: Renamed first card to *Business details*; placed tax hints opposite legal business name and dispatch note opposite business address.
    - **Storefront**: Reduced mode description font text size to `text-[11px] text-muted-foreground` under titles.
    - **Branding**: Replaced divided section layout with clean single-column cards (*Store identity & images*, *Brand colours*, *Typography*); removed auxiliary *Accessibility Check* and *Storefront preview* columns per user instruction.
    - **Checkout, Customer Accounts, Customer Privacy, Payments, Shipping, Taxes, Orders, Returns, Users, Plan & Billing, Policies, Activity, Support, Storage, Notifications**: Standardized on `SettingsCard` with inline right-aligned descriptions and compact form controls.

## Decisions and trade-offs
- **Single-column settings layout**: Converted Branding & Visual Identity from a 2-column layout to the standard single-column stack matching all other settings pages after removing the auxiliary preview and WCAG contrast check cards.
- **Typography hierarchy**: Standardized card headers to `text-sm font-semibold text-foreground`, right-aligned header notes to `text-xs text-muted-foreground`, and option descriptions in radio/switch groups to `text-xs` / `text-[11px]`.
- **Online Store exclusion**: Preserved all `apps/admin/src/routes/_store/online-store/` routes untouched per explicit scope constraints.

## Verification
- `pnpm --filter @bs/admin typecheck`: Passed (0 errors).
- `pnpm --filter @bs/admin lint`: Passed (0 errors/warnings).
- `pnpm --filter @bs/admin test`: Passed (11 test files, 72/72 tests passed).
- Dev server verified running on `http://localhost:5173` (HTTP 200).
- Hand inspection: Reviewed front-end layouts directly in browser.

## Docs updated
- [ ] `docs/ARCHITECTURE.md` (no architectural boundaries or routes changed)
- [ ] ADR / not needed (pure UI layout & presentation refinement)
- [ ] `DEPLOYMENT.md` / not needed
- [x] `progress.md` (updated In-flight entry)

## Follow-ups and open questions
- None. All settings and archive table views are optimized, typechecked, and verified.

## Definition of done
- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (verified 72/72 tests in `@bs/admin`).
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status reported.
