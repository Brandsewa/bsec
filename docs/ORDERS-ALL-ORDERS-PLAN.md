# Orders: "All orders" parity with the Storify reference

Hand-off plan for Antigravity. Verifier: Claude (checks every item against the acceptance criteria in section 8 before it is called done).

**Styling (mandatory):** build every screen with the owner's design system: `docs/admin-ui-standards.md`, the shadcn `base-mira` (Base UI) components in `apps/admin/src/components/ui`, and the shared kit. See section 4 of [ORDERS-SECTIONS-OVERVIEW.md](ORDERS-SECTIONS-OVERVIEW.md). Do not hand-roll tables, selects, dialogs or form controls.

**Settings** (numbering, Create order defaults): see [ORDERS-SETTINGS-PLAN.md](ORDERS-SETTINGS-PLAN.md); its step 1 (order prefix actually applied) should land before Create order work.

Scope of this document: **the All orders list, the Create order screen and the order detail actions only.** Pre-orders, Returns, Quotes and Abandoned checkouts get their own plan files after this one is reviewed.

## 0. Goal

The owner runs a second site, **Storify** (a Next.js + MongoDB admin, code kept locally in `Storify/` at the repo root, never committed). Its Orders area is the model for how bsec's store admin should be grouped and behave. This plan records, button by button, what Storify does, what bsec already does, and what to build to close the gap **without copying Storify code** (different stack, different tenancy rules).

## 1. Ground rules

1. Read `AGENTS.md` first. Sections 2 (hard rules) and 4 (verification gate) apply in full.
2. **Do not copy code from `Storify/`.** It is Mongoose, single-tenant, multi-vendor, Stripe/PayPal oriented. Use it only as a behaviour reference. Do not import from it, do not commit it (it is untracked; `git add -A` would pick it up, so stage files by path).
3. Contracts first: `packages/contracts/src/admin.ts` -> handler -> `packages/domain/src/admin/orders.ts` -> `apps/admin`.
4. Permissions in the domain service (`assertPermission`). Reads: `orders.read`. Writes: `orders.write`. Refunds: `orders.refund`.
5. Every store mutation that changes money, access or content writes `audit_logs` (rule 6). **Today `packages/domain/src/admin/orders.ts` writes none**; every mutation you touch must gain one.
6. Money is integer paise (`bigint` mode number). Shipping and tax are recomputed on the server (rule 12). Never trust a client total.
7. Admin UI follows `docs/admin-ui-standards.md`: shared kit, no native `<select>`, no `window.confirm`, `pendingComponent` on every route.
8. Do not touch Razorpay or Shiprocket (rule 14).
9. Gate: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`, then `pnpm --filter @bs/domain test:fast` and `test:heavy`, one package at a time.

## 2. What Storify's All orders does (verified in the browser and in code)

Reference files: `Storify/components/admin/orders-data-table.tsx`, `orders-stats-strip.tsx`, `orders-list-view.tsx`, `lib/orders/order-list.ts`, `lib/orders/order-status-workflow.ts`, `lib/orders/create-admin-order.ts`, `components/common/order-create-form.tsx`, `components/admin/order-details/order-header.tsx`.

### 2.1 List page

| Element | Behaviour |
|---|---|
| Stats strip, 5 cards | Total orders, Open orders (not delivered/cancelled), Paid orders, Total revenue (sum of paid totals), Avg order value (revenue / paid count). Computed in one aggregate pass, streamed separately from the table. Counts only orders someone actually placed (not abandoned gateway checkouts). |
| Tabs | All, Unfulfilled (`pending`, `processing`), Unpaid (`pending`, `partially_paid`), Open (not delivered/cancelled), Archived (delivered/cancelled). |
| Search | By order number only. |
| Filters | Order status (pending, processing, shipped, delivered, cancelled), Payment (pending, paid, partially paid, refunded, partially refunded, expired), Channel (online, POS). |
| Sort | Date toggle in the toolbar; sortable headers: order number, date, total, payment, fulfillment. Server side, with an `_id` tiebreaker on non-unique fields so paging never duplicates or drops a row. |
| Columns | Checkbox, Order number (+ relative date), Products (first item name, "+N more", links to product), Date, Customer (name + email, "Guest" fallback), Channel, Total, Payment pill, Fulfillment pill, Items, Delivery pill. Several columns hide at narrow widths. |
| Row click | Opens the order. |
| Row menu | View details; the status moves legal from the current status (see 2.2); Delete. A move that the payment rule forbids is shown **greyed with the hint "Payment not received"** rather than hidden. |
| Bulk bar | Mark processing, Mark shipped, Mark delivered, Cancel order, Delete. Orders that cannot legally make the move are **skipped and counted**; the toast reports "N updated, M failed, K skipped, First issue: ...". |
| Mark shipped dialog | Carrier and tracking number (both optional). |
| Cancel dialog | Optional reason; warns that stock is restored and that shipped orders cannot be cancelled. If a cancelled order's refund fails, a warning toast names the order numbers that still hold the shopper's money. |
| Delete dialog | Permanent delete. Unshipped orders return reserved stock. |
| Import / Export | Export writes the current page as CSV. Import is a disabled placeholder. |
| Create order | Button goes to the create screen. |
| Pagination | Rows per page, first / previous / next / last, "Showing x to y of z". |
| State | The URL query string is the whole state (page, limit, search, view, filters, sort). |

### 2.2 Status workflow (Storify)

`pending -> processing -> shipped -> delivered`; `preordered -> processing`; cancel allowed from `preordered`, `pending`, `processing`; `shipped` can only go to `delivered`; `delivered` and `cancelled` are terminal. A fulfilment move (processing, shipped, delivered) is **refused for online-gateway orders whose payment is still pending, or fully refunded**, but allowed for cash on delivery and for money the merchant records themselves. Every refusal uses one shared message.

### 2.3 Create order screen

| Element | Behaviour |
|---|---|
| Header | "Create order" + Draft badge; subtitle flips to "Unsaved draft order" once anything changes; Save (disabled until dirty) and Back. |
| Add product | Dialog: image, name, variant label, available stock, price; multi-select with an "n/500 variants selected" counter; Cancel and Add. "Search by" and "Add filter" are disabled placeholders. |
| Add custom item | Disabled placeholder. |
| Line item | Image, name, variant badge, SKU, quantity (1 to 999), line total with "each" price, remove. |
| Payment card | Subtotal ("n items" counts lines), flat discount in currency, shipping in currency, tax as a percent. **Total = (subtotal - discount) x (1 + tax%) + shipping.** Discount is capped at the subtotal. Tax does not apply to shipping. |
| "Payment due later" | Unticked: primary button is **Mark as paid** (creates the order as paid, method `manual`). Ticked: primary button is **Save order** (creates as pending, method `manual_pending`). |
| Send invoice | **Dead button.** It has no handler. Do not reproduce it. |
| Notes | Single textarea. |
| Customer | Search box; dropdown with "+ Create a new customer" and "No customers found". Selecting a customer fills the shipping address. |
| New customer dialog | First name, last name, email, phone, shipping street, apartment, city, state, postal code, country (searchable list), shipping phone, tags, notes. On create it is attached to the order and a notification fires. |
| Shipping address card | Appears after a customer is chosen; prefilled, editable. |
| Tags | One comma separated text field. **Storify never saves them** (the form sends `tags` but the API route and the order builder ignore it). Do not reproduce that bug. |
| Server rules | Rejects with "Some selected items do not have enough stock". Rejects countries the store does not ship to. Takes the stock when the order is created and puts it back if the write fails. Allows only manual payment methods (never a card/wallet/COD label). When created as paid it records the payment, loyalty points and customer spend. Writes an audit row and notifies the participants. |

### 2.4 Order detail action bar

Print; Download invoice; Shipping label menu (download PDF, print to thermal); a More-actions menu holding: the legal status moves (greyed with the payment hint when blocked), Mark as paid (manual orders), Send payment link (unpaid non-COD), Override status (admin only, any status, with a reason), Open a return, approve / receive a pending return, Refund in full, Refund partially; Back. Also on the page: address-hold banner, items, consignments (split orders), shipments card, payment attempts, timeline with staff comments, customer card, and badges for payment, status and fulfilment location.

## 3. What bsec already has (verified by reading the code)

Do **not rebuild these**; they are ahead of Storify:

- `apps/admin/src/routes/_store/orders.tsx`: URL-state table, saved views (All, Unfulfilled, Unpaid, COD to confirm, RTO), payment / fulfillment / status filters, COD-only toggle, placed-date range, debounced search (number, email, phone, name), six sorts, column picker, filter chips, bulk runner with progress, "select all N results", row menu, mobile card layout, export of selection or all matching pages, empty and error states.
- Domain: `listAdminOrders`, `getAdminOrderDetail`, `createAdminDraftOrder`, notes, cancel, refund, fulfill, GST invoice, confirm, advance (`packages/domain/src/admin/orders.ts`, `orders/manual-lifecycle.ts`, `orders/state-machine.ts`).
- Schema: `orders` (separate `status`, `paymentStatus`, `fulfillmentStatus`; integer money; `source`; `cancel_reason`), `order_items`, `order_events` (timeline), `order_notes`, `customers` (already has `tags` and `note`).

## 4. Gaps, and what is easy vs. what needs the owner

### 4.1 Easy, no schema change (Phase 1)

| # | Gap | Build |
|---|---|---|
| G1 | Tabs **Open** and **Archived** | Add two `view` values. Open = status not in (`delivered`, `cancelled`, `returned`). Archived = status in those three. Add to `ListOrdersInput.view`, the contract enum, `VIEWS`. |
| G2 | **Channel** filter | `orders.source` already exists (`web`, ...). Add a `source` filter and a Channel select. Make admin-created orders write `source = 'admin'`. |
| G3 | **Revenue stats**: Total orders, Open, Paid, Total revenue, Average order value | New query `admin.orders.stats` (one aggregate with conditional sums, `orders.read`). Replace the four count cards with these five. Keep the saved-view counts on the tabs. Revenue = sum of `grand_total` where `payment_status = 'paid'` (also include `cod_collected`; see D4). |
| G4 | **Products** column ("Name +N more") | Add `firstItemTitle` to `OrderListItem` (one extra query per page, not per row). |
| G5 | **Skip report** in bulk actions | The bulk runner already skips ineligible orders; make the summary toast say "N updated, M skipped, first issue: ..." like Storify. Verify the current wording first. |
| G6 | Ship dialog **carrier and tracking number** | The Mark shipped dialog currently has none. Pass them to the existing fulfilment creation. |

### 4.2 Needs an owner decision before any code (Phase 2: Create order)

The bsec create screen is a bare form: customer email and address typed by hand, no discount, shipping or tax input, no notes, no tags, no stock reservation, no paid / due-later choice, no audit row. Matching Storify is **not a small change**:

| # | Decision | Why it is big |
|---|---|---|
| D1 | **Tax model.** Storify takes one flat "% VAT". bsec is India GST: per-line `hsn`, `taxRateBps`, CGST/SGST/IGST split by place of supply. | A flat percent field would bypass GST. Recommendation: **no tax input**; tax stays computed from product HSN and place of supply, shown read-only. |
| D2 | **Shipping amount.** Storify lets staff type any shipping figure. bsec rule 12: shipping is per-store configuration, recomputed on the server. | Recommendation: show the computed shipping from the store's rates, with an optional staff **override** that is audited and capped. Owner to confirm. |
| D3 | **Discount.** Storify: one flat amount. bsec has a discounts engine (`orders/discounts.ts`). | Recommendation: allow a flat or percent manual discount, audited, capped at the subtotal, stored in `discount_total`. |
| D4 | **Payment choice.** "Mark as paid" for manually collected money vs "Payment due later". bsec payment statuses are `pending`, `paid`, `cod_pending`, `cod_collected`, `failed`, `refunded`, `cancelled`. | Needs a new manual-payment path through the payment-intent state machine so ledgers and the `order.paid` job stay correct. Recommendation: two outcomes, **Paid (collected by store)** and **Payment pending**, plus **COD** if the store has it on. |
| D5 | **Tags on orders.** | Needs a migration: `orders.tags text[]` (expand step, default empty). Customer tags already exist. |
| D6 | **Customer picker and inline "create customer".** | Reuse `customers` (unique on email and phone per tenant). Needs a search endpoint and a create path that audits. Guest orders must keep working. |
| D7 | **Stock.** Storify decrements stock at create and refuses if short. | Use `reserveInventory` / `commitReservation` (`catalog/inventory-reservations.ts`) inside the same transaction, as checkout does. |

**Decided (the owner delegated these to Claude on 2026-10-02; the recommendations above are adopted, with these specifics). Phase 2 may start after Phase 1:**

| # | Decision taken |
|---|---|
| D1 | No manual tax input. GST is computed from product HSN and place of supply and shown read-only in the totals. |
| D2 | Shipping is computed from the store's rates. Staff may **override** it with a required reason; the override is audited and capped (default Rs 10,000, editable in settings). |
| D3 | Manual **discount** (flat or percent) and a per-line **unit price override**, both audited with a required reason, discount capped at the subtotal, stored in `discount_total` and on the line. The unit price override is also what Quotes Phase B uses. |
| D4 | Two payment outcomes plus one conditional: **Payment received** (store collected it: cash, UPI, bank transfer, with a reference) creates the order `paid`; **Payment pending** creates it `pending`; **Cash on delivery** appears only if the store has COD on and creates it `cod_pending`. Implemented through the payment state machine, not by writing the status directly. |
| D5 | `orders.tags text[]` migration (expand, default empty), saved and filterable. |
| D6 | Customer picker over `customers` with inline create (audited); a guest order stays possible. |
| D7 | Stock is reserved with `reserveInventory` and committed in the same transaction as the order; a shortage returns "Some items do not have enough stock" naming the items. |

### 4.3 Deliberately not built

| Storify feature | Decision |
|---|---|
| **Delete order** (single and bulk) | **Do not build.** bsec orders carry gapless numbering and GST invoices; deleting breaks both. Cancel already exists. Raise with the owner if they disagree. |
| **Send invoice** button | Dead in Storify. bsec's invoice is a GST invoice generated on demand; emailing it waits for email delivery to go live. |
| Import orders | Disabled in Storify; skip. |
| Custom line items | Disabled in Storify; skip. |
| Search-by and Add-filter in the product picker | Disabled in Storify; skip. |

### 4.4 Phase 3: order detail parity (needs its own plan)

bsec's detail page has Items, Shipments, Invoices, Timeline with notes, an Actions card, Summary and Customer. Missing against section 2.4: print view, invoice download from the header, status override with reason, mark-as-paid, send payment link, refund dialogs (full and partial) in the page, address-hold banner, payment-attempts card, edit address, and badges. Several touch refunds and payments, so this phase waits for D4 and for the payments work. **Do not start it from this plan.**

## 5. Phase 1 build order

1. Contract: add `open` and `archived` to `view`, a `source` filter, and the `stats` procedure; add `firstItemTitle` to the list item (`packages/contracts/src/admin.ts`).
2. Domain: extend `listAdminOrders`; add `getAdminOrderStats` in `packages/domain/src/admin/orders.ts` with `assertPermission(ctx, "orders.read")`; set `source = 'admin'` in `createAdminDraftOrder`.
3. Handler: wire the procedure in `apps/web/src/server/api.ts`.
4. Admin UI: tabs, channel filter, five stat cards (with a `MetricCardSkeleton` fallback so the table does not wait on stats), Products column, carrier and tracking in the ship dialog.
5. Tests (real database, `startTestDb`): view filters return exactly the right rows, including terminal states; `source` filter; stats numbers on a seeded set (paid, COD collected, cancelled, other tenant's orders excluded); another tenant's orders never appear (RLS).
6. Docs: `docs/ARCHITECTURE.md` (contract and admin route lines), a change record, bump "Last verified".

## 6. Bugs found while reading (outside the scope above, report to the owner)

- `createAdminDraftOrder` returns `payLink: https://${ctx.tenantId}.bcom.si/checkout/pay/${order.id}`. `tenantId` is a UUID, not the store's host. The link is probably wrong. Verify against the store's real domain resolution before anyone relies on it.
- `createAdminDraftOrder` writes only `order_events`, not `audit_logs`, and does not reserve stock. Both are gaps against AGENTS.md rule 6 and the checkout path.
- `Storify/` sits untracked inside the repo. A careless `git add -A` would commit a second codebase. Stage by path, or add `Storify/` to `.git/info/exclude`.

## 7. Out of scope here

Pre-orders, Returns, Quotes, Abandoned checkouts (own plans); POS; couriers; online payments; email delivery.

## 8. Acceptance criteria (verifier checks each)

Phase 1 is done only when all hold:

- [ ] Tabs All, Unfulfilled, Unpaid, COD to confirm, RTO / Returns, **Open**, **Archived** exist; Open and Archived partition all orders (every order is in exactly one).
- [ ] A Channel select filters by `source`; orders created from admin carry `source = 'admin'`.
- [ ] The strip shows Total orders, Open orders, Paid orders, Total revenue, Average order value; values match a hand-calculated seed; empty store shows zeros, not errors; the table renders without waiting on the stats.
- [ ] Revenue counts only collected money and never another tenant's rows.
- [ ] Products column shows the first item and "+N more"; no per-row queries (assert query count on a 25-row page).
- [ ] The ship dialog accepts carrier and tracking number and they appear on the order.
- [ ] Bulk summary reports updated / skipped / failed counts.
- [ ] Domain functions call `assertPermission`; a user without `orders.read` gets a refusal (test).
- [ ] No `eslint-disable`, no native `<select>`, `pendingComponent` present, no change to Razorpay or Shiprocket.
- [ ] Delete order is **not** implemented.
- [ ] `Storify/` is not in the diff.
- [ ] Gate passes (`typecheck`, `lint`, `build`, `docs:check`, domain `test:fast` and `test:heavy`); failures are reported with output, not hidden.
- [ ] Change record written (`docs/changes/`), `docs/ARCHITECTURE.md` updated, UI exercised by hand (`pnpm --filter @bs/admin dev`) and the result stated honestly.
