# Orders: Pre-orders (simple "ships on" model)

Hand-off plan for Antigravity. Verifier: Claude. Read [ORDERS-SECTIONS-OVERVIEW.md](ORDERS-SECTIONS-OVERVIEW.md) first.

**Styling (mandatory):** build every screen with the owner's design system: `docs/admin-ui-standards.md`, the shadcn `base-mira` (Base UI) components in `apps/admin/src/components/ui`, and the shared kit. See section 4 of [ORDERS-SECTIONS-OVERVIEW.md](ORDERS-SECTIONS-OVERVIEW.md). Do not hand-roll tables, selects, dialogs or form controls.

**Settings for this feature** live in Settings > Orders, specified in [ORDERS-SETTINGS-PLAN.md](ORDERS-SETTINGS-PLAN.md) section 4.5.

**Owner decision (2026-10-02):** a pre-order is a **normal order** for a **normal product at a normal price**, with a **dispatch date** instead of a deposit scheme. The shopper is told the date and notified as it nears or changes. No deposits, no balance collection, no waitlist, no quota system. This replaces the larger Storify design.

## 0. Why this is the right size

Storify's pre-orders (about 6,000 lines) exist to collect deposits and balances online. bsec takes COD today and has no online payments live, so none of that machinery has a job to do. What a D2C store actually needs is: "this arrives on 20 Oct, tell the customer, and let me see and ship those orders on time." That is a date and a notification, which is what the industry does for simple pre-order setups (a pre-order flag on the product, a "ships on" message at checkout, orders held until the date).

## 1. What the owner gets

1. On a product (or variant): a **Pre-order** switch and a **Ships on** date and an optional message ("Handmade in small batches").
2. On the storefront: a "Pre-order, ships on 20 Oct 2026" badge on the product and in the cart and checkout; the add-to-cart button reads **Pre-order**. The price is the normal price.
3. At checkout it is a normal order (COD or whatever is live). The confirmation page and the confirmation email say **"Ships on or after 20 Oct 2026."**
4. In the admin: orders that contain a pre-order line carry a **Pre-order** badge and the dispatch date; the **Pre-orders** page is a ready-made filtered view of those orders sorted by dispatch date; the owner changes the date in one place and the customer is told.
5. The order is **not offered for shipping** until the dispatch date has arrived or the owner releases it early.

## 2. What bsec has (verified)

- `variants.track_inventory`, `variants.allow_backorder` (`packages/db/src/schema/catalog.ts`).
- Orders with `fulfillmentStatus`, `order_items`, `order_events` (timeline) (`packages/db/src/schema/orders.ts`); the manual lifecycle (`orders/manual-lifecycle.ts`) and the fulfillment state machine.
- Email through jobs (`order.created` and the transactional templates in `system/email-templates.ts`); email **delivery is not live** until the platform email service ships, so mail steps below degrade to "recorded in the timeline, email when delivery is on".
- Inventory reservations (`catalog/inventory-reservations.ts`).
- No pre-order concept anywhere.

## 3. Design

### 3.1 Data (expand migration, `docs/migrations.md`)

| Table | Change |
|---|---|
| `variants` | `preorder_enabled boolean not null default false`, `preorder_ships_on date`, `preorder_message text` |
| `order_items` | `ships_on date` (snapshot of the date when ordered; null for normal lines) |
| `orders` | `ships_on date` (the latest `ships_on` among its lines, null if none) |

Index `(tenant_id, ships_on)` on `orders` where `ships_on is not null`. Existing tables already use `tenantTable()`, so RLS is inherited; add no new table. Per-variant rather than per-product so one colour can pre-order while another is in stock.

### 3.2 Rules

1. **A pre-order variant is sellable** even at zero stock (it behaves like `allow_backorder` while `preorder_enabled`). When stock arrives the owner switches the flag off. A date in the past with the flag still on shows as **"Ships soon"** on the storefront rather than a stale date, and the admin product list flags it ("pre-order date passed").
2. **Price is the normal price.** Nothing else changes in pricing. The server snapshots `ships_on` on the line at checkout; the client's claim is never trusted (AGENTS.md rule 12).
3. **Mixed carts:** an order with any pre-order line ships **as one parcel on the latest date** by default (simplest and cheapest for the shopper). Splitting is a later option, not built now. State this at checkout ("Your order ships on or after 20 Oct because it includes a pre-order item").
4. **Order lifecycle is unchanged**: confirm, shipped, delivered. The only addition is a **hold**: while `ships_on` is in the future, the "Mark shipped" and "Create fulfillment" actions are disabled with the reason "Pre-order ships on 20 Oct" and can be overridden by the owner with **Release now** (audited), because stock sometimes arrives early.
5. **Changing the date** (a delay or an early arrival) updates every order that has not shipped, writes an `order_events` row per order, and queues a "Your ship date changed" notification to each customer. A delay also asks for a reason (shown to the customer). Done in one transaction; the emails go through pg-boss after commit (rule 13).
6. **Reminder:** a daily job notifies customers 2 days before `ships_on` ("Your pre-order ships soon") and, when the date arrives, surfaces the orders in an admin "Ready to ship" count. The job is idempotent per order (record the reminder as an event and skip if present).
7. **Cancellation** works as for any order (COD means no money to return). The customer may cancel before it ships through the normal self-service path if one exists; do not build a new one here.
8. **Stock:** a pre-order line decrements stock when the goods are received, not at order time. Until then it is a backorder line. When the owner adds stock the normal inventory tools apply; do not invent a quota. (Optional later: a per-variant **limit** so a store cannot sell more than it can make; build only if the owner asks.)

### 3.3 Admin UI

- **Product editor** (`apps/admin/src/routes/_store/products/`): per variant, a Pre-order switch, a date field, a message field. Validation: date must be in the future when enabling; message max 200 characters.
- **Pre-orders page** (`apps/admin/src/routes/_store/preorders.tsx`), in the Orders nav group: a filtered orders table (reuse the orders list component and URL state, filter `ships_on is not null`), default sort **ships on ascending then placed ascending** (oldest promise first). Tabs: **All**, **Waiting** (date in future), **Ready to ship** (date reached, not shipped), **Shipped**, **Cancelled**. Columns: Order, Customer, Items (pre-order lines marked), Ships on, Payment, Fulfillment, Total. Stat cards: **Pre-orders open**, **Ready to ship**, **Due in next 14 days**, **Overdue** (date passed, not shipped).
- **Row and bulk actions:** View order, **Change ship date** (dialog with new date and reason), **Release now**, and for the bulk bar **Change ship date** and **Export CSV**. Ineligible rows are skipped and reported.
- **All orders** shows a small "Pre-order · ships 20 Oct" tag in the Products cell; the order detail shows the same banner above Items.

### 3.4 Storefront

Product page badge and message; cart and checkout line note; checkout summary line "Ships on or after <date>"; confirmation page and email. Each storefront page keeps its `loading.tsx` (rule 11).

## 4. Build order

1. Migration and domain (`catalog` variant fields, `orders/checkout.ts` snapshot, `admin/preorders.ts` list, stats, change-date, release).
2. Product editor fields and storefront labels.
3. Admin Pre-orders page and the order-detail banner.
4. Notifications (date changed, 2-day reminder) with the email degradation noted above.

## 5. Not built (and why)

Deposits, pay-later and balance collection (no online payments yet); waitlist and "notify me when available"; per-variant sale limits; partial shipments; vendor features. Revisit deposits only after online payment is live, and write an ADR then.

## 6. Acceptance criteria

- [ ] A variant with Pre-order on and zero stock can be bought at its normal price; with it off, a zero-stock variant still cannot.
- [ ] The order and its lines store `ships_on` as set at checkout; changing the product's date afterwards does not alter existing orders.
- [ ] The storefront shows the date on the product, cart, checkout and confirmation; a past date shows "Ships soon".
- [ ] "Mark shipped" and "Create fulfillment" are disabled with the reason until the date, and **Release now** enables them and writes an audit row.
- [ ] Changing the ship date updates all unshipped orders in one transaction, adds one timeline event per order, and enqueues one notification per order after commit; shipped and cancelled orders are untouched.
- [ ] The 2-day reminder fires once per order (run the job twice in a test and assert one event).
- [ ] The Pre-orders page tabs and the four stat cards match a seeded set; sorted by ship date then oldest first; another tenant's orders never appear (RLS test).
- [ ] Every mutation calls `assertPermission` (`orders.write`; list and stats `orders.read`) and writes `audit_logs`.
- [ ] No deposit, balance or waitlist UI exists.
- [ ] Gate passes; change record and `ARCHITECTURE.md` updated; UI exercised by hand and reported honestly.
