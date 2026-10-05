# Admin UI standards

Applies to `apps/admin` (store admin). The same direction is intended for `apps/superadmin` when it is next touched.

## The rule

1. **All new screens use the current styling and shared components described below.** Do not hand-roll tables, dropdowns, date pickers, filters or page headers.
2. **When you touch an old screen for any reason, bring it up to this standard if it is reasonably doable** (swap controls, adopt the table kit, fix the header). Do not leave a screen half old and half new.
3. If a needed component does not exist, add it to the shared kit (and use it everywhere) instead of building a one-off.

## Reference screens

- **Lists:** `routes/_store/orders.tsx` is the reference implementation. Products, Inventory, Customers and Discounts follow it.
- **Detail / create pages:** `orders_.$orderId.tsx`, `orders_.new.tsx`, `customers_.$customerId.tsx`, `discounts_.new.tsx`. Detail and create flows are full pages, not side panels or pop-ups.
- **Settings:** `routes/_store/settings.tsx` and `components/settings/*`; each section is its own route inside one workspace.

## The shared kit

| Need | Use |
|---|---|
| Base components | `@bs/ui` (shadcn on Base UI), styled by the unified design system in `packages/ui` and tokens |
| Table | `components/data-table/data-table.tsx` (selection, sortable headers, sticky header, row click, row actions, mobile cards) |
| Table state | `use-table-state.ts` (URL state, debounced search, column visibility, parse helpers), `use-table-selection.ts`, `use-bulk-runner.ts`, `fetch-all.ts` |
| Table chrome | `table-toolbar.tsx` (search, filters, mobile Filters/Sort sidebars), `toolbar-parts.tsx` (filter chips, Columns menu, bulk bar), `pagination.tsx` (25/50/100) |
| Dropdown | `SimpleSelect` or `Select` from `@bs/ui`. Never a native `<select>`: its popup cannot be themed |
| Date range | `DateRangePicker` from `@bs/ui` (one calendar, from and to, presets) |
| Saved-view tabs | `ScrollTabs` from `@bs/ui` (single line, scrolls sideways on phones) |
| Confirmations | `ConfirmDialog` from `@bs/ui`. Never `window.confirm` |
| Status pills, money | `components/order-parts.tsx` |
| Form fields | `Field` from `@bs/ui` |
| Titled form groups | `SectionCard` from `@bs/ui` |
| Settings pages | `components/settings/settings-page.tsx` (`SettingsPageFrame`, `SettingsSection`, `HeaderActions`, `useUnsavedGuard`) |
| CSV export | `lib/csv.ts` |

## Layout and style conventions

- **Page header:** `PageHeader` from `@bs/ui` with `aside` for buttons. Title and description on the left, buttons on the right. No breadcrumb on list pages.
- **Type scale:** page title 20px, description 14px, tables, forms and body text 12px/13px, section titles 14px semibold. Settings follows the same scale.
- **Buttons:** 6px radius (`--radius-button`), no pill buttons, 40px height standard (`md`), 32px height small (`sm`). Mintlify mint accent `#00d4a4` for brand variant.
- **Canvas:** semantic tokens (`--background`, `--sidebar`, `--card`, `--border`).
- **Popups:** menus, selects and popovers share the frosted, rounded, soft-shadow style in `@bs/ui`.
- **Instructions and hints:** never leave an instruction paragraph or helper note in a panel. Put it behind an `InfoTip` from `@bs/ui`.
- **Main sidebar:** 12rem wide, collapses to icons (Ctrl/Cmd+B), remembered in a cookie.
- **Mobile:** tables become cards; a list toolbar is search on row 1, then Filters and Sort buttons that open sidebars; tab rows scroll horizontally.
- `@bs/ui` is the **single unified component package** across Store Admin, Super Admin, and Customer storefront/account apps.

## Building a new list screen (checklist)

1. Define the URL state: a `parseXSearch(raw)` and an `xListInput(state)` (the request, also the query key). Use `compactSearch` in `validateSearch`.
2. Server side: search, filters, sort and paging belong in the API (`packages/contracts`, `packages/domain`). Always add an `id` tie-break to the sort.
3. Compose `PageHeader`, metric cards (server counts, not page sums), `ScrollTabs` if there are saved views, `TableToolbar`, `FilterChips`, `BulkBar`, `DataTable`, `Pagination`.
4. Bulk actions go through `useBulkRunner` (sequential, progress, one summary toast, ineligible rows skipped). "Select all results" supports Export only unless the API has a real bulk endpoint.
5. Tests: render inside an in-memory router (see `renderRouted` in `test/catalog-pages.test.tsx`) and build the query key with the page's `xListInput(parseXSearch({}))`.

## Known old screens still to bring up to standard

- Online Store: Themes, Pages, Navigation, and the page and theme editors.
- `apps/superadmin` (platform staff app) and `apps/platform` UIs.
- Customer and discount edit flows (create and detail exist; edit does not yet).
- Orders: "Process return" and refund actions are not on the order page yet.
