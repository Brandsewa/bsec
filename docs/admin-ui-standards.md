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

## 4. Typography, spacing and layout tokens

- **Fonts:** Geist (UI sans) and Geist Mono (IDs, SKUs, money, code). No other font families.
- **Type scale & visual hierarchy:**
  - Page title: 20px / 600 (`text-xl font-semibold` or `text-lg font-bold`)
  - Section title: 14px / 600 (`text-sm font-semibold`)
  - Body & form labels: 13px / 500 (`text-xs font-medium` or `13px`)
  - Subtext, hints & secondary descriptions: 11px-12px (`text-[11px]` or `text-xs font-normal text-muted-foreground`)
  - Tables & metadata: 12px / 400 (`text-xs tabular-nums`)
  - Button labels: 14px / 500 (`md`), 13px / 500 (`sm`)
- **Spacing:** 4px grid (4, 8, 12, 16, 20, 24, 32, 40, 48). Standard card padding is 16px-20px (`p-4` or `p-5`).
- **Surface & Theme Contrast (Light & Dark):**
  - **Light mode:** Canvas background is light gray (`--background: #f8f9fa` / `hsl(210 20% 98%)`), cards and containers are pure white (`--card: #ffffff` / `hsl(0 0% 100%)`) with subtle border (`border border-border`).
  - **Dark mode:** Canvas is deep dark neutral (`--background: hsl(220 18% 7%)`), while cards, modals, and dropdown surfaces use contrasting elevated dark gray (`--card: hsl(220 16% 12%)` / `--surface-200: hsl(220 14% 15%)`) with visible, clean borders (`--border: hsl(220 13% 20%)`). Never leave cards transparent or matching canvas background in dark mode.
  - **Smooth theme transitions:** Theme toggle transitions smoothly using standard CSS opacity/color cross-fade without layout flash.

## 5. Settings & Card Hierarchy Standards

1. **Individual Modular Cards (`SettingsCard`):** Never group distinct settings into a giant divided monolithic box. Every logical group of options gets its own card with clear header and description.
2. **Horizontal Row Efficiency:** Place contextual help text or secondary descriptions horizontally opposite the primary title or input label whenever possible (e.g. tax hint on the right of Legal business name; registered/dispatch note on the right of Business address) to reduce unnecessary vertical height.
3. **Card header hierarchy:**
   - Left: Card title in `text-sm font-semibold text-foreground` + optional icon.
   - Right: Inline contextual note or badge in `text-xs text-muted-foreground`.
   - Divider: Subtle separator `border-b border-border/60 pb-3 mb-4`.
4. **Form controls:** Standard form inputs (`Input`, `Select`, `Checkbox`, `Switch`) must always use semantic tokens and appropriate sizes (`h-8` or `h-9` for compact settings).

## 6. Super Admin Standards

1. **Full-width operational workspace:** All Super Admin views (`Tenants`, `Signups`, `Staff`, `Audit Log`, `Email`, `System`, `Plans`, `Quotas`, `Features`) use `PageContainer size="full"` with responsive paddings.
2. **Unified Header Search Bar:** Quick search trigger in `Layout.tsx` uses a sleek input-like button container (`w-44 sm:w-64`, `Search` icon, `bg-muted/40 hover:bg-muted/70`, `border border-border`, `<kbd>Ctrl K</kbd>` badge).
3. **Data tables:** All lists use `@bs/ui` table tokens with sticky/muted headers (`bg-muted/40 hover:bg-muted/40`), subtle row separators (`border-border`), and tabular alignments.
4. **Card borders:** Always specify explicit `border border-border bg-card shadow-xs` on all cards and containers.

## 7. Mandatory Rule for New Screens & Components

> **CRITICAL DIRECTIVE**: Anyone building or modifying any screens, dialogs, drawers, or components in `apps/admin` or `apps/superadmin` **MUST** follow this style guide and use the existing tokenized primitives from `@bs/ui`. Hand-rolled custom tables, inconsistent button shapes, arbitrary hex colors, raw borders without semantic tokens, and monolithic undivided settings layouts are strictly forbidden. All new views must support both light and dark modes with proper background/card contrast.
