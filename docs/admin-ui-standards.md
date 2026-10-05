# Admin UI standards

Applies to `apps/admin` (Store Admin) and `apps/superadmin` (Super Admin).

## 1. The core rules

1. **One design system, one package: `@bs/ui`.** Same components and tokens in Vite (admin, superadmin) and Next.js (storefront, customer account and auth). No app-local `components/ui` copies or forks (enforced by ESLint `bs/design-system-guards`).
2. **All screens use the shared kit and semantic tokens.** Do not hand-roll tables, dropdowns, date pickers, filters, dialogs or page headers.
3. **No native `<select>` or `window.confirm`.** Use `SimpleSelect`, `Select` or `Combobox` from `@bs/ui`, and `ConfirmDialog` (or `AlertDialog`) for destructive operations.
4. **No pill buttons.** Rectangular buttons with a 6px border-radius (`--radius-button`). Sizing follows Mintlify: `sm` (32px, 13px) for toolbars/tables, `md` (40px, 14px) for forms and primary actions.
5. **No raw hex colors or inline styles in app code.** Use semantic CSS variables (`--background`, `--card`, `--border`, `--muted`, `--brand`, `--foreground`).
6. **Every route declares a `pendingComponent`.** Composed skeletons (`PageHeaderSkeleton`, `DataTableSkeleton`, `FormSectionSkeleton`, `DetailPageSkeleton`, `MetricCardsSkeleton`) mirror final content with identical dimensions for zero layout shift (CLS 0).

## 2. Reference screens

- **Lists:** `apps/admin/src/routes/_store/orders.tsx` is the reference implementation for Store Admin; `apps/superadmin/src/pages/TenantsList.tsx` for Super Admin.
- **Detail / create pages:** `orders_.$orderId.tsx`, `orders_.new.tsx`, `customers_.$customerId.tsx`, `discounts_.new.tsx`. Detail and create flows are full pages with `PageHeader` + `SectionCard`s.
- **Settings:** `routes/_store/settings/*`; each section is its own route inside the unified workspace settings frame.

## 3. The shared kit (`@bs/ui`)

| Need | Use | Description |
|---|---|---|
| Primitives | `@bs/ui` | Upstream shadcn (Base UI flavour), restyled to platform tokens |
| Table | `DataTable` / `SharedDataTable` | Selection, sortable headers, sticky header, row click, row actions, mobile cards |
| Table state | `use-table-state.ts` | URL state, debounced search, column visibility via `useSearchState` adapter |
| Table chrome | `TableToolbar`, `Pagination` | Search input, filter popovers, export, bulk runner, 25/50/100 paging |
| Dropdown & Selection | `SimpleSelect`, `Select`, `Combobox`, `MultiSelect` | Accessible popover select with search, items or children |
| Date & Range | `DatePicker`, `DateRangePicker`, `DateTimePicker` | Single or range calendar, presets, store timezone (IST default), react-day-picker v10 |
| Image Upload | `ImageUploader` | Storage-agnostic uploader wired to existing `/admin/media/request-upload` |
| Tabs | `ScrollTabs`, `Tabs` | Responsive horizontal scrollable tabs on mobile, underline indicator |
| Confirmation | `ConfirmDialog` | Accessible dialog for destructive actions with title, description, and loading state |
| Form layout | `Field`, `InputGroup`, `SectionCard` | Unified accessible forms with labels, descriptions, and error states |
| Command palette | `CommandPalette` | Quick navigation and action palette via Ctrl/Cmd+K |
| Skeletons | `patterns/skeletons.tsx` | Composed layout skeletons (`PageHeaderSkeleton`, `DataTableSkeleton`...) |
| Status parts | `StatusBadge`, `Money`, `RelativeTime` | Tabular numeric amounts, relative time tooltips, semantic tone badges |

## 4. Typography and spacing

- **Fonts:** Geist (UI sans) and Geist Mono (IDs, SKUs, money, code). No other font families.
- **Type scale:**
  - Page title: 20px / 600
  - Section title: 14px / 600
  - Body & forms: 13px / 400
  - Tables & metadata: 12px / 400
  - Button labels: 14px / 500 (`md`), 13px / 500 (`sm`)
  - Numeric values: `tabular-nums`
- **Spacing:** 4px grid (4, 8, 12, 16, 20, 24, 32, 40, 48). Card padding 16px. Max content width 80rem.

## 5. Building a list screen checklist

1. Define URL state: `parseXSearch(raw)` and `xListInput(state)`.
2. Server-side search, filters, sort, and pagination where the API supports it; client-side filtering where API returns static or small sets.
3. Compose: `PageHeader`, `MetricCards` (server counts), `ScrollTabs` (saved views), `TableToolbar`, `DataTable`, `Pagination`.
4. Bulk actions through `useBulkRunner`.
5. Attach `pendingComponent` with `DataTableSkeleton` or `PageHeaderSkeleton`.
6. Add unit tests verifying table rendering and filters.
