# Orders: Quotes (lean, industry-standard model)

Hand-off plan for Antigravity. Verifier: Claude. Read [ORDERS-SECTIONS-OVERVIEW.md](ORDERS-SECTIONS-OVERVIEW.md) first.

**Styling (mandatory):** build every screen with the owner's design system: `docs/admin-ui-standards.md`, the shadcn `base-mira` (Base UI) components in `apps/admin/src/components/ui`, and the shared kit. See section 4 of [ORDERS-SECTIONS-OVERVIEW.md](ORDERS-SECTIONS-OVERVIEW.md). Do not hand-roll tables, selects, dialogs or form controls.

**Owner decision (2026-10-02):** use the industry-standard approach, or **remove Quotes for now** if it is too big. This plan takes the lean approach, schedules it **last**, and keeps Quotes **out of the sidebar until it is built**. If the owner prefers to drop it, nothing else depends on it.

## 0. How the industry does quotes (and why Storify's version is more than we need)

Across Shopify's B2B and quote apps, WooCommerce and Magento, the pattern is the same:

1. Shopper submits a **request** for a product (a lead).
2. Merchant reviews it and prepares a **quote**: the items at the agreed price, a **valid-until** date and a note. In Shopify this is a **draft order** with custom prices.
3. The shopper gets a **link** to the quote, accepts it and **pays or confirms** that same order.
4. The quote becomes an **order**; unaccepted quotes **expire**.

The merchant's price lives **on an order**, never in special cart pricing. Storify instead re-prices cart lines against stored offers (exact quantity, single use, owned by account), which touches the cart and checkout and is the riskiest code in its quote system. bsec should **not** do that. Converting a quote into an ordinary order (with an audited price override) gets the same result with far less risk, and bsec already has the pieces: the shopper order link (`/o/[token]`) and the COD confirmation link (`/cod/[token]`).

## 1. Reference: what Storify has (code only; its quotes list was not opened in the demo. Files: `components/admin/quotes/*`, `lib/quotes/*`, `models/quote-request.model.ts`)

Keep these ideas:

- A **quote request is a lead, not an order**: it never reserves stock and never counts as revenue.
- A **product snapshot** on the request (name, variant) so a renamed or deleted product still reads.
- A **derived stage** per row instead of a hand-edited status: needs reply, offer sent, expired, ordered, won, closed. Only "lost" is set by a person.
- List: stats (needs reply, offers open and value, expired, ordered and value), tabs, filters (requested in 7/30/90 days, with account or guest), search, a detail sheet with customer, request, price, history timeline and an internal note, row actions (view, send price, reopen, withdraw, open order, email, call, mark lost, delete), CSV export.

Drop: per-offer rows, offer history of 10, cart and checkout re-pricing, single-use binding, lot-fit checks against stock, inbox threads.

## 2. What bsec has (verified)

Nothing for quotes: no table, no product flag, no page (searches found only unrelated CSV and page-builder text). Relevant existing pieces: `createAdminDraftOrder` (creates a pending order and returns a pay link built from the tenant id, which is suspect; see the All orders plan), `/o/[token]` and `/cod/[token]` shopper links, `action_tokens`, customers with phone OTP, transactional emails through jobs.

## 3. Design

### 3.1 Data (expand migration)

- `products.price_on_request boolean not null default false`.
- New tenant table `quote_requests` (`tenantTable()`, `forceRlsSql`, composite FKs to `products`, `variants` and nullable `customers`, `orders`): `number` (gapless per tenant via `number_sequences`, kind `quote`, prefix `QT-`), product and variant ids plus **snapshots** (title, variant title), `quantity`, `name`, `email`, `phone`, `company`, `message` (max 2000), `status` (`new`, `quoted`, `accepted`, `lost`, `expired`), `admin_note`, `quoted_total` (paise, the price the merchant stated), `quote_note`, `valid_until`, `quoted_at`, `order_id` (nullable), `created_at`, `updated_at`. Index `(tenant_id, status, created_at)`.
- The **stage** shown in the UI is derived: `new` = needs reply; `quoted` and `valid_until` in the future = quote sent; `quoted` and past = expired (computed on read; the daily job may set `expired` for tidiness but nothing depends on it); `accepted` = ordered (and **paid** when the linked order is paid); `lost` = closed.

### 3.2 Phase A: lead inbox (build first, medium)

- **Product editor:** a **Price on request** switch; saving it stores price 0 and excludes the variant from add-to-cart. The **cart and checkout servers must refuse** such a line even if called directly (test it).
- **Storefront:** the product page shows **Request a quote** instead of the price and cart button. Form: name, email, phone, company (optional), quantity, variant, message. Public write surface, so: Zod validation, per-IP and per-email rate limit, the same bot guard other public forms use, no price ever accepted from the client. On submit: create the request, enqueue "new quote request" email to the store and an acknowledgement to the shopper (pg-boss after commit; email delivery is not live yet, so the timeline records the intent). Keep `loading.tsx`.
- **Admin Quotes page** (`apps/admin/src/routes/_store/quotes.tsx`): stats (Needs reply, Quote sent, Expired, Accepted), tabs (All, Needs reply, Quote sent, Expired, Accepted, Closed), filters (requested: any / 7 / 30 / 90 days; customer: with account / guest), search (number, name, email, product), columns (Requested, Customer, Product with variant and quantity, Quoted total, Stage), a detail **sheet** (`Sheet` in the UI kit) with customer, request, message, history, **internal note** and Save, row menu (View, Email, Call, Mark lost, Reopen), CSV export. Delete is allowed only for `lost` or never-answered leads and is audited.
- **Permissions:** read `orders.read`, write `orders.write`. All mutations audited.
- Nav item appears only when at least one `price_on_request` product exists.

### 3.3 Phase B: send a quote by converting it to an order (medium, depends on Create order Phase 2)

- Button **Create quote order** in the sheet opens the admin **Create order** screen **prefilled** (customer from the request, the item and quantity, **unit price editable**). The price override is an audited, capped action defined in the All orders plan (decision D3 there), so it is not reinvented here.
- Saving creates a normal **pending order** linked to the request (`quote_requests.order_id`, status `quoted`, `valid_until` set from a field in the dialog, default 7 days; `quoted_total` = the order total).
- The shopper gets an email with the **order link** and the **confirm link** (reuse `/o/[token]` and `/cod/[token]`): accepting is confirming the order. Until delivery is live, the admin sheet shows a **Copy link** button so the owner can send it by WhatsApp or email manually.
- If the quote's `valid_until` passes before confirmation, a daily job **cancels the pending order** (releasing reserved stock via the existing path) and marks the request `expired`. If the owner re-quotes, a new order is created and the old one stays cancelled.
- Stock follows the normal order rules at the time the order is created (no special quote stock logic).

### 3.4 Not built

Cart or checkout re-pricing, offer single-use binding, multiple offers per request with history, lot checks, inbox conversations, shopper `/account/quotes` list (the shopper uses the order link), vendor quotes.

## 4. Decisions

| # | Decision | Taken |
|---|---|---|
| D1 | Keep Quotes at all | **Optional.** Safe to drop; schedule last. |
| D2 | Offer mechanism | **Order-based**, not cart-pricing. |
| D3 | GST on the quoted price | Quoted price follows the store's existing price mode (inclusive or exclusive) and goes through normal order tax calculation; do not add a quote-specific tax rule. |
| D4 | Expiry | Default 7 days, editable per quote. |
| D5 | Guests | A guest request is fine; the order link plus confirm link act as proof, as for any guest order. |

## 5. Acceptance criteria

Phase A:

- [ ] A `price_on_request` variant cannot be added to a cart, nor ordered, even by calling the API directly.
- [ ] A request never changes stock and never appears in order stats or revenue.
- [ ] The form is validated and rate limited; a client-supplied price is ignored; the store email is enqueued after commit.
- [ ] Stats, tabs, filters, search and paging match a seeded set; URL state survives reload; stable ordering.
- [ ] Mark lost, Reopen, note save and Delete write `audit_logs`; permission refusals tested; Delete refused on a quoted or accepted request.
- [ ] RLS test: tenant A cannot see tenant B's requests.
- [ ] No offer or pricing UI exists in Phase A (absent, not disabled).

Phase B:

- [ ] The prefilled Create order applies the audited price override; the resulting order total equals `quoted_total`.
- [ ] The order is linked to the request; accepting (the confirm link) moves the request to `accepted`; paid state follows the order.
- [ ] Expiry cancels the pending order and releases stock exactly once (run the job twice in a test).
- [ ] No change to cart or checkout pricing code.

Both phases: `pendingComponent` and `loading.tsx` present; gate passes; change record and `ARCHITECTURE.md` updated; UI exercised by hand and reported honestly.
