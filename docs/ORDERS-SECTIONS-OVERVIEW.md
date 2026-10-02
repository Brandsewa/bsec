# Orders sections: overview and build order

Hand-off index for Antigravity. Verifier: Claude. Read this first, then the section plan you are assigned.

| Section | Plan | What it is in Storify | State in bsec today | Size |
|---|---|---|---|---|
| All orders | [ORDERS-ALL-ORDERS-PLAN.md](ORDERS-ALL-ORDERS-PLAN.md) | Order list, create order, order detail | Ahead of Storify on the list; create screen is bare | Phase 1 small; create order needs owner decisions |
| Returns | [ORDERS-RETURNS-PLAN.md](ORDERS-RETURNS-PLAN.md) | Return requests, refunds, restock, exchange | **Manual model (owner decision):** customer portal request with photos, Settings > Returns, admin reviews and records refund or exchange by hand. Backend lifecycle exists; admin page is basic and breaks the UI standard | Medium; photo upload is the sensitive part |
| Abandoned checkouts | [ORDERS-ABANDONED-CHECKOUTS-PLAN.md](ORDERS-ABANDONED-CHECKOUTS-PLAN.md) | Left-behind checkouts, recovery email ladder | Sweep job and one email exist; **no admin page at all** | Phase 1 small; ladder medium |
| Quotes | [ORDERS-QUOTES-PLAN.md](ORDERS-QUOTES-PLAN.md) | "Price on request" leads, merchant price offers | Nothing. **Lean industry model:** request, then merchant converts it to an ordinary order with an audited price; **optional, last, hidden from the sidebar until built** | Phase A medium; Phase B medium (needs Create order Phase 2) |
| Pre-orders | [ORDERS-PREORDERS-PLAN.md](ORDERS-PREORDERS-PLAN.md) | Orders for goods not yet in stock; deposit and balance | Only `allow_backorder`. **Simple model (owner decision):** a normal order with a "ships on" date and customer notification; no deposits | Medium |
| Settings (Orders, Returns) | [ORDERS-SETTINGS-PLAN.md](ORDERS-SETTINGS-PLAN.md) | One "Order Settings" page: prefix, tax, shipping, commission, returns rules | Order prefix setting exists but **checkout ignores it**; returns window hard-coded; shipping, tax and COD already have pages | Small to medium; the prefix fix is first |

## 1. Recommended order of work

0. **Settings step 1: make the order prefix, digits and next number actually apply** (ORDERS-SETTINGS-PLAN section 7, step 1). It is a defect fix and every other plan creates orders or returns that use numbering.
1. All orders Phase 1 (no schema change, unblocks the stats pattern reused below).
2. Sidebar grouping (section 2 of this file).
3. Abandoned checkouts Phase 1 (read-only page over data that already exists).
4. Returns steps 1 to 3 (page rebuild, manual refund recording, Settings > Returns), then the customer portal and photo upload.
5. Pre-orders (simple "ships on" model; needs only a small migration and the checkout snapshot).
6. All orders Phase 2 (Create order parity; decisions are taken in that plan).
7. Quotes Phase A, then Phase B after step 6. Optional; drop it if priorities change.

Owner decisions (2026-10-02): Pre-orders are simple dated orders; Returns are manual with portal requests and photos; Quotes are lean and optional; everything else follows the recommendations in each plan (the owner delegated them to Claude).

## 2. Sidebar grouping (small, do with step 2)

Storify groups these under one **Orders** menu: All orders, Pre-orders, Returns, Quotes, Abandoned checkouts. bsec's sidebar (`apps/admin/src/routes/_store.tsx`, `nav`) has flat groups: **Orders** and **Returns** are separate items under "Sell".

Build: replace the single "Orders" item and the "Returns" item with a group labelled **Orders** holding **All orders** (`/orders`), **Returns** (`/returns`), and, as each ships, **Abandoned checkouts** (`/abandoned-checkouts`), **Quotes** (`/quotes`), **Pre-orders** (`/preorders`). Each item keeps its own permission (`orders.read`). Show an item only when its page exists and (for Pre-orders and Quotes) the store has the feature enabled; do not link to pages that 404. No collapsible component needed. Each new route needs `pendingComponent` (rule 11).

## 3. Shared rules for every section

1. `AGENTS.md` sections 2 and 4 apply. No code is copied from `Storify/`; it is a behaviour reference only. Stage files by path; never `git add -A` (Storify is untracked in the repo).
2. Use the shared admin kit (`docs/admin-ui-standards.md`): `DataTable`, `TableToolbar`, `ScrollTabs`, `ConfirmDialog`, `SimpleSelect`, `MetricCard`. No `window.confirm`, no native `<select>`, no hand-rolled tables.
3. URL query string is the page state (the existing orders page already does this with `useUrlTableState`); reuse it.
4. Stats cards are their own query and render in their own boundary so the table never waits on them.
5. Contracts first, then domain service with `assertPermission`, then handler, then UI. Every mutation writes `audit_logs`. Money is integer paise.
6. Bulk actions skip ineligible rows and report "N done, M skipped, first issue: ...", never fail the whole batch.
7. Real-database tests for tenancy, permissions and money; one tenant must never see another's rows.
8. Each section ships with a change record in `docs/changes/` and an `docs/ARCHITECTURE.md` update.
9. Email: delivery is not live until the platform email service (see `docs/AUTH-OVERHAUL-PLAN.md`) is done. Any button that sends mail must be **disabled with a stated reason** until then, never silently do nothing (Storify's dead "Send invoice" is the anti-example).
10. Do not touch Razorpay or Shiprocket (rule 14). Anything that needs a courier or a gateway is deferred.

## 4. Look and feel (mandatory for every screen in these plans)

The owner already defined the design system. **Do not invent styling and do not hand-roll components.** Read these before building any screen, in this order:

1. [`docs/admin-ui-standards.md`](admin-ui-standards.md): the contract. It names the shared kit, the layout and type conventions, and a checklist for list screens.
2. `apps/admin/components.json`: **shadcn, style `base-mira`, built on Base UI**, Lucide icons, `src/index.css` for tokens. The preset is `b1D2d9ge` (see the header comment in `apps/admin/src/index.css` and `progress.md`, section "Admin UI refresh").
3. `apps/admin/src/index.css` and `packages/ui/src/styles/tokens.css`: our tokens are the source of truth; shadcn variable names alias them. **Never redeclare `--primary`, `--background`, `--foreground`, `--destructive`, `--radius` or `--border` in `index.css`**, and do not edit the shared `tokens.css`.
4. Reference screens to copy patterns from (not code): lists, `routes/_store/orders.tsx`; detail and create, `orders_.$orderId.tsx`, `orders_.new.tsx`, `customers_.$customerId.tsx`, `discounts_.new.tsx`; settings, `routes/_store/settings/*` with `components/settings/settings-page.tsx`.

Rules that follow from it, in short:

- **Components:** `apps/admin/src/components/ui/*` for base controls (button, input, select, checkbox, radio-group, dialog, sheet, tabs, table, badge, card, tooltip, popover, dropdown-menu, field, calendar, skeleton, sonner); `DataTable`, `TableToolbar`, `FilterChips`, `BulkBar`, `Pagination`, `use-table-state` for lists; `SimpleSelect` for dropdowns (never a native `<select>`); `ConfirmDialog` (never `window.confirm`); `DateRangePicker`; `ScrollTabs`; `SectionCard`; status pills and `money` from `order-parts.tsx`; `SettingsPageFrame`, `SettingsSection`, `HeaderActions`, `useUnsavedGuard` for settings; `lib/csv.ts` for CSV.
- **Base UI, not Radix:** triggers use the `render` prop (`<DropdownMenuTrigger render={<Button />}>`, `<Button nativeButton={false} render={<Link to="..." />}>`), not `asChild`. Copy the pattern from `orders.tsx`.
- **Layout:** `PageHeader` from `@bs/ui` with `aside` for buttons; grey canvas, white cards; type scale page title 20px, description 14px, tables, forms and body 12px, section titles 14px semibold; mobile turns tables into cards, tab rows scroll sideways.
- **Missing component?** Add it to the kit and use it everywhere. Notably **there is no `switch.tsx` yet**; the settings plans need on and off controls, so add one with the shadcn CLI. Run it from `apps/admin`: `yes n | pnpm dlx shadcn@latest add switch --yes`. Known CLI gotchas (from the superadmin migration prompt): it writes `import { cn } from "cn"` and adds an unrelated npm package `cn`, so rewrite the import to `@/lib/utils` and remove that dependency; answer no to overwrite prompts; generated files may fail `exactOptionalPropertyTypes` (add `| undefined`) or lint.
- **Forms:** `components/field.tsx` or `ui/field`, labels above inputs, hint text under, errors per field; a Save and Discard bar through `useUnsavedGuard`.
- **Do not** use `@bs/ui` form controls in new code (it is still used for `PageContainer`, `PageHeader`, `PageSection`, `MetricCard`, skeletons, `toast`).
- **Tests** render inside an in-memory router (`renderRouted` in `apps/admin/test/catalog-pages.test.tsx`).
- **Open the screen in a real browser** at desktop width and 375 px before saying it is done, and state honestly what you did not check.

## 5. Findings in Storify that must not be copied

- "Send invoice" on Create order has no handler.
- Order tags are collected but never saved.
- The abandoned list loads two collections fully into memory and pages in memory; fine for a demo, not for a tenant with 100k carts. Page in SQL.
- Storify's list of "Total orders" originally counted abandoned gateway checkouts; bsec keeps abandoned carts out of orders by design. Keep it that way.
- Delete order (single and bulk) is not built in bsec (gapless numbering and GST invoices).
