# Store Admin & Super Admin design system and dashboard optimization sprint

- **Date:** 2026-10-07
- **Agent:** antigravity
- **Branch:** `design/sprint-ui`
- **Area:** admin, superadmin, ui
- **Type:** refactor
- **Supersedes:** `2026-10-06-antigravity-admin-settings-and-archives-polish.md`

## Summary
Completed full design system alignment and optimization sprint across both `apps/admin` (Store Admin) and `apps/superadmin` (Super Admin). Modernized settings architectures with modular `SettingsCard` hierarchies, aligned all archive and operational tables with full-width tokenized layouts, fixed dark mode contrast across both dashboards (canvas vs. elevated card backgrounds), added smooth theme transitions, refined header search bars, and codified mandatory style standards in `docs/admin-ui-standards.md` and `progress.md`.

## What changed

### 1. Store Admin Polish (`apps/admin`)
- **Full-Width Table Parity**: Aligned archive and operational tables across Orders (`quotes`, `abandoned-checkouts`, `returns`), Catalog (`categories`, `collections`, `brands`, `locations`, `reviews`), and Finance (`expenses`, `reports`) to match the refined full-width table layout from Orders.
- **Returns & Exchanges Workflow**:
  - Removed redundant top breadcrumbs.
  - Consolidated search and filter controls into a single row using the shared `DateRangePicker`.
  - Added multi-select checkboxes for bulk selection and two-step action workflow (Archive first, Delete only available in Archive view).
  - Modernized slide-over drawer with solid background tokens (`bg-card`/`bg-background`) and responsive width (>=30% of screen).
- **Settings Re-architecture & Card Hierarchy**:
  - Docked settings navigation on the sidebar with sub-navigation font sizing matching primary navigation weight and hierarchy.
  - Re-architected all 20 settings routes (`store-details`, `storefront`, `branding`, `checkout`, `customer-accounts`, `customer-privacy`, `payments`, `shipping`, `taxes`, `orders`, `returns`, `users`, `plan-and-billing`, `policies`, `activity`, `support`, `storage`, `notifications`, `domains`):
    - Replaced monolithic single-card containers with modular `SettingsCard` components.
    - Maximized horizontal row efficiency: placed contextual help text opposite input labels and card headers (e.g., tax notes opposite Legal business name, registered/dispatch address notes opposite Business address).
    - Reduced excessive description font sizes to `text-[11px] text-muted-foreground`.
    - Streamlined Branding & Visual Identity into clean single-column cards, removing auxiliary accessibility/preview cards per instruction.

### 2. Super Admin Optimization (`apps/superadmin`)
- **Layout Standardisation**: Converted all operational pages (`TenantsList`, `Signups`, `Staff`, `AuditLog`, `EmailSettings`, `System`, `Plans`, `Quotas`, `Features`, `Support`, `Templates`) to `PageContainer size="full"` with responsive paddings.
- **Data Tables & Controls**: Replaced ad-hoc table markup with `@bs/ui` table tokens with sticky muted headers (`bg-muted/40`) and clean borders (`border-border`). Replaced native HTML checkboxes with accessible `@bs/ui` `Checkbox`.
- **Quick Search Bar**: Replaced button styling collision in `Layout.tsx` with a sleek, input-like search trigger (`w-44 sm:w-64`, `Search` icon, `bg-muted/40 hover:bg-muted/70`, `border-border`, and `<kbd>Ctrl K</kbd>` badge).
- **Email Settings Polish**: Fixed missing `border-border` styling on Test Email Delivery and DNS Verification Checklist cards.

### 3. Theme & Token System (`@bs/ui` + Admin + Superadmin)
- **Dark Theme Contrast**:
  - Set canvas background to deep dark neutral (`hsl(220 18% 7%)`) and cards/surfaces to contrasting elevated dark gray (`hsl(220 16% 12%)` / `hsl(220 14% 15%)`).
  - Cards, table headers, modals, drawers, and popovers now maintain distinct contrast from background in both light and dark modes globally.
  - Added smooth CSS transitions for theme toggles to eliminate jarring theme flashes.

### 4. Standards & Documentation
- Updated `docs/admin-ui-standards.md` with:
  - Typography, spacing, and layout token guidelines.
  - Light & dark mode surface contrast rules.
  - Settings modular card hierarchy rules and row efficiency standards.
  - Super Admin workspace and table guidelines.
  - **Mandatory directive**: Anyone creating or updating components/screens must use the tokenized `@bs/ui` kit and adhere to these standards.
- Updated `progress.md` with full sprint checklist and completion status.

## Verification
- `pnpm --filter @bs/admin typecheck`: Passed (0 errors).
- `pnpm --filter @bs/admin lint`: Passed (0 errors).
- `pnpm --filter @bs/superadmin typecheck`: Passed (0 errors).
- `pnpm --filter @bs/superadmin lint`: Passed (0 errors).
- `pnpm --filter @bs/ui typecheck`: Passed (0 errors).
- `pnpm --filter @bs/admin test`: Passed (11 test files, 72/72 tests passed).
- Dev servers verified live on `http://localhost:5173` (Admin) and `http://localhost:5174` (Super Admin).

## Definition of done
- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (verified 72/72 tests in `@bs/admin`).
- [x] `docs/admin-ui-standards.md` and `progress.md` updated.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status reported.
