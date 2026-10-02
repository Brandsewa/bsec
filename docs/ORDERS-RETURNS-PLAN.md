# Orders: Returns and exchanges (manual review model)

Hand-off plan for Antigravity. Verifier: Claude. Read [ORDERS-SECTIONS-OVERVIEW.md](ORDERS-SECTIONS-OVERVIEW.md) first.

**Styling (mandatory):** build every screen with the owner's design system: `docs/admin-ui-standards.md`, the shadcn `base-mira` (Base UI) components in `apps/admin/src/components/ui`, and the shared kit. See section 4 of [ORDERS-SECTIONS-OVERVIEW.md](ORDERS-SECTIONS-OVERVIEW.md). Do not hand-roll tables, selects, dialogs or form controls.

**Settings for this feature** live in Settings, specified in [ORDERS-SETTINGS-PLAN.md](ORDERS-SETTINGS-PLAN.md) section 5 (Returns); build them with this plan.

**Owner decision (2026-10-02):** returns are handled **manually**. The customer files a return or exchange request from their portal, with photos. The store admin reviews it, verifies, and **manually** offers an exchange or refunds the money. There is a **Returns and exchanges** section in Settings that switches the feature on and sets the rules. No automatic gateway refunds, no store credit, no restocking fees, no return labels, no courier integration.

## 0. What this plan delivers

1. **Settings > Returns**: turn returns on, turn exchanges on, window, reasons, photo rules, instructions.
2. **Customer portal**: request a return or exchange with item selection, reason, comment and **photo upload**; track its status.
3. **Admin Returns page**: a proper table, stats, a review sheet with the photos, and a short manual decision flow: approve (as refund or as exchange) or reject, mark received, record the manual refund or the arranged exchange, close.

This is the pattern most small D2C stores use (and what Shopify's native returns do for a store that handles refunds by hand): request with evidence, merchant decision, manual resolution, a record of what was done.

## 1. Reference: what Storify does, and what we keep

Storify (`components/admin/returns-data-table.tsx`, `lib/returns/*`) automates carts of cases: per-line approval, condition grading (new, opened, damaged, missing parts, unusable), restock location, tracking, gateway refund, store credit split, restocking and shipping fees, fault, exchange orders. We **keep**: a status ladder, stats strip (needs review, on the way back, refund due, refunded), search and a status filter, per-line quantity, a reason and decline message the customer sees, a **restock tickbox**, a close step, and the rule that the server caps a refund at what was paid. We **drop** (manual model): everything automatic or financial beyond recording what the owner did.

## 2. What bsec has (verified)

- Schema `returns` (number, status, reason, `resolution` refund | replacement | store_credit, `photos uuid[]`, `admin_note`), `return_items` (order item, quantity, restock) in `packages/db/src/schema/shipping.ts`. **`photos` exists but nothing reads or writes it.**
- State machine `orders/return-state-machine.ts`: `requested -> approved | rejected`; `approved -> picked_up -> received -> refunded | replaced -> closed`.
- Domain `orders/manual-lifecycle.ts`: shopper request by order token (`requestReturnByToken`, 7-day window hard-coded as `RETURN_WINDOW_DAYS`, delivered orders only), `actOnReturn` (`approve`, `reject`, `pick_up`, `receive`, `refund`, `close`), restock into the default location on receive.
- Storefront: `/o/[token]` with `ReturnRequestForm` (`apps/web/src/components/orders/`); no photo field, **no way for the shopper to ask for an exchange** (resolution defaults to refund and is not passed from the form).
- Admin page `apps/admin/src/routes/_store/returns.tsx`: filter buttons and cards; uses **`window.confirm`**, forbidden by `docs/admin-ui-standards.md`.
- Admin media upload exists (`packages/domain/src/media/storage.ts`, `media-services.ts`, presigned R2), **admin only**.

### 2.1 Defects and gaps to fix

| # | Finding |
|---|---|
| R1 | `window.confirm` on refund. |
| R2 | No stats, search, paging, table, or review sheet. |
| R3 | The `refund` action **requires a payment intent** (`"This order has no payment to refund"`) and `refunds.intent_id` is `NOT NULL`, so a purely manual refund cannot be recorded for a COD order or an order without an intent. Needs an expand migration (`intent_id` nullable, plus `method`, `reference`) or a return-level manual refund record. |
| R4 | Return window is hard-coded to 7 days; it must be a store setting. |
| R5 | Shopper cannot choose exchange, attach photos, or see the store's decision message. |
| R6 | No `audit_logs` row on any return action (AGENTS.md rule 6). |
| R7 | Refund amount is computed, not editable and not recorded with a method or reference. |
| R8 | A GST **credit note** is the legal record of a refund after an invoice. `generateInvoice` supports `credit_note` but returns do not call it. See decision D2. |

## 3. Design

### 3.1 Settings > Returns and exchanges (`apps/admin/src/routes/_store/settings/returns.tsx`, nav item "Returns" in the settings list)

Stored with the existing store settings pattern (follow `shipping.tsx` and the domain `store-config` service; `settings.write` permission, audited).

| Setting | Default | Notes |
|---|---|---|
| Accept return requests | off for existing stores, on for new | When off, the portal hides the request button and the server refuses. |
| Allow exchanges | on when returns are on | When off, the portal offers refund only. |
| Return window (days) | 7 | 1 to 90. Counted from delivery (the latest fulfillment `delivered_at`; fall back to the order's last update). |
| Reasons | Damaged or defective; Wrong item received; Not as described; Size or fit; Changed my mind; Other | Editable list (add, rename, reorder, hide), max 12, each max 60 characters. |
| Photos required for | Damaged, Wrong item, Not as described | Per reason: required / optional / not asked. |
| Instructions for the customer | empty | Shown after approval (return address, packing advice). Plain text, max 1000. |
| Policy text | empty | Shown on the request form, plain text, max 1000. |

Also a per-product **Returnable** switch (default on; "Final sale" when off), because every store has items it cannot take back. Expand migration on `products`: `returnable boolean not null default true`. Non-returnable lines are not offered in the request form.

### 3.2 Customer portal

Where: `/o/[token]` (guest link, existing) and `/account/orders/[id]` (signed in). Each page keeps its `loading.tsx`.

1. **Request** button appears only when: returns are on, the order is `delivered`, inside the window, and at least one returnable item remains.
2. **Form**: choose items and quantities (existing rules: cannot exceed what is returnable); **Reason** (from the settings list); **What would you like?** Refund or Exchange (Exchange only if enabled; if Exchange, a free-text "What would you like instead (size, colour, item)?" field); **Comments** (optional, max 1000); **Photos** (see 3.3); the policy text.
3. **Submit** creates the return (`requested`), stores the choice as `resolution` (`refund` or `replacement`; do not offer `store_credit`), emails the store, and shows a confirmation with the return number.
4. **Status tracker** under the order: Requested, Approved or Rejected (with the store's message), Received, Refunded or Exchange arranged, Closed. After approval show the store's instructions.
5. One open return per order line at a time (existing rule). The customer can **cancel** a request while it is still `requested` (add a `cancelled` status; a customer-side cancel needs the same token proof).

### 3.3 Photo upload (new public write surface: handle with care)

Requirements, all mandatory:

- **Scope:** only with a valid order action token or a signed-in customer who owns the order; per-order rate limit (e.g. 20 uploads per hour).
- **Method:** the server issues a **presigned PUT** to R2 for a key under `tenants/<tenantId>/returns/<orderId>/<uuid>`; the client uploads directly; a **finalize** call verifies the object (exists, size, content type) and creates the `media` record. A photo is never attached to a return until finalized.
- **Limits:** up to 5 photos per request; each at most 5 MB; content types `image/jpeg`, `image/png`, `image/webp` only (**no SVG, no HTML, no GIF**). Verify the type by magic bytes on finalize, not just the header.
- **Privacy:** objects are **private** (no public URL). The admin sees them through short-lived signed GET URLs. Strip EXIF (GPS location) on finalize or at least do not serve the original; state which in the change record.
- **Clean up:** a daily job deletes uploaded-but-unattached objects older than 24 hours and the photos of returns purged by retention.
- **Storage:** reuse `packages/domain/src/media/storage.ts`; if it only supports public objects, add a private prefix rather than loosening the existing rules.
- Store the `media` ids in `returns.photos` (the column already exists; add per-photo rows only if you need captions).
- Malware scanning is out of scope; images are only ever rendered by the admin as images.

### 3.4 Admin Returns page (`/returns`, in the Orders nav group)

Built on the shared kit like the Orders list: `DataTable`, `TableToolbar`, `ScrollTabs`, `MetricCard`, URL state, mobile cards, `pendingComponent`.

- **Stats (4):** Needs review (`requested`), Awaiting item (`approved`), To refund or exchange (`received`), Resolved (`refunded` + `replaced`, last 30 days).
- **Tabs:** All, Needs review, Approved, Received, Resolved, Rejected / closed.
- **Search:** return number, order number, customer email or name. **Filter:** Refund or Exchange, date range.
- **Columns:** Return (number, date), Order (link), Customer, Items, Reason, Requested (Refund / Exchange), Photos (count), Status, Amount.
- **Row click** opens the **review sheet** (the `Sheet` component already in `apps/admin/src/components/ui/sheet.tsx`): customer and order, items and quantities, the customer's reason and comment, **photo gallery** (thumbnails, click to enlarge, signed URLs), what they asked for, the order's payment method and amount paid, the timeline, an internal note, and the action buttons.
- **Actions (each a `ConfirmDialog` or a small form dialog, never `window.confirm`):**
  - **Approve**: choose **Refund** or **Exchange** (defaults to what the customer asked; the admin may change it), optional message and instructions to the customer.
  - **Reject**: reason message required; the customer is told.
  - **Mark received**: tick **Put back in stock** (default on; restocks to the default location only; see 3.5).
  - **Record refund** (when Refund): amount (default the paid share of the returned lines, editable, capped at what was paid and not already refunded), **method** (UPI, bank transfer, cash, original payment method, other), **reference**, note. This **only records** what the owner did; no money moves.
  - **Record exchange** (when Exchange): note ("Sent size L, order #1042"), optional link to the new order number. A convenience button opens **Create order** for that customer; building that prefill is optional.
  - **Close**: final state.
- **Bulk:** none. Export: CSV of the current filter.

### 3.5 Domain and data

- Status ladder (append-only, no removals): `requested -> approved | rejected | cancelled`; `approved -> received` (keep `picked_up` allowed but unused in the UI); `received -> refunded | replaced`; `refunded | replaced -> closed`. Allow `approved -> refunded | replaced` directly when no physical return is needed (a cheap damaged item the owner tells the customer to keep) with a mandatory note.
- New columns (expand migration): `returns.requested_resolution`, `returns.customer_comment`, `returns.exchange_request` (text), `returns.decision_message`, `returns.instructions_sent_at`, `returns.refund_method`, `returns.refund_reference`, `returns.refund_amount` (paise), `returns.refunded_at`, `returns.exchange_note`, `returns.exchange_order_id` (nullable). Prefer storing the manual refund **on the return** and writing an `order_events` row; if the owner wants it in the payment ledger as well, make `refunds.intent_id` nullable (expand) and add `method` and `reference`. **Do not drop or rename existing columns.**
- `receive` keeps today's restock behaviour but honours the tickbox per request, not per line.
- Every transition: `assertPermission` (`orders.write`; recording a refund needs `orders.refund`), a row in `order_events` visible to the customer when the message is for them, and an `audit_logs` row (R6).
- Notifications by pg-boss after commit: new request (to the store), approved, rejected, refund recorded, exchange arranged (to the customer). Email delivery is not live until the platform email service ships; until then the timeline records "email will be sent when delivery is enabled".

## 4. Decisions

| # | Decision | Taken |
|---|---|---|
| D1 | Default return window | **7 days**, editable per store (matches current behaviour). |
| D2 | **GST credit note** when a refund is recorded | **Open for the owner or the accountant.** If invoices are issued at dispatch, Indian GST expects a credit note for a post-sale refund. Recommendation: generate a credit note automatically when a refund is recorded on an invoiced order, but only after the owner confirms. Until then the plan records the refund and flags "credit note not issued". |
| D3 | Store credit | **Not built.** Remove it from the options; no ledger exists. |
| D4 | Exchange fulfilment | **Manual.** The owner ships the replacement and records it; optional link to a new order. |
| D5 | Restocking and shipping fees, return labels | **Not built.** Return shipping cost is described in the policy text. |
| D6 | Final-sale items | **Built** as the per-product Returnable switch. |
| D7 | Customer cancel of a request | **Built** (before approval). |

## 5. Build order

1. Admin page rebuild on the shared kit with stats, tabs, search, review sheet and proper dialogs (no new data yet); add audit rows. This also removes `window.confirm`.
2. Migration and domain: new return columns, manual refund recording (R3), the status ladder, the settings.
3. Settings > Returns UI and the per-product Returnable switch.
4. Customer portal form, tracker, exchange choice and cancel.
5. Photo upload (3.3) and the admin gallery.
6. Notifications and the credit note once D2 is answered.

## 6. Not built

Automatic gateway refunds; store credit; fees; return labels or pickup; per-line condition grading; partial restock in steps; fault assignment; exchange orders created automatically; vendor flows.

## 7. Acceptance criteria

- [ ] No `window.confirm` in the returns route; every confirmation uses `ConfirmDialog` or a form dialog.
- [ ] Settings control the feature: with "Accept return requests" off the portal shows nothing and the API refuses; the window and reasons come from settings, not constants.
- [ ] A customer can submit a request with reason, comment, Refund or Exchange (Exchange only if enabled), and up to 5 JPEG, PNG or WebP photos at most 5 MB each; SVG, HTML, GIF, oversize, wrong magic bytes and a 6th photo are refused (tests).
- [ ] Photos are private; the admin sees them only through short-lived signed URLs; an unfinalized upload is not attachable and is cleaned up after 24 hours (test with a faked clock).
- [ ] Photo upload is rate limited and requires the order token or the owning signed-in customer; another order's token cannot attach to this return.
- [ ] The admin can approve (as refund or exchange), reject (message required), mark received (restock tickbox), record a manual refund (amount capped at what was paid and not already refunded, method and reference required) or an exchange, and close; illegal transitions are refused by the server.
- [ ] A refund can be recorded on a COD order and on an order with no payment intent.
- [ ] Every action writes `audit_logs` and an `order_events` row; permissions enforced in the domain (`orders.refund` for recording money).
- [ ] The four stat cards and the tabs match a seeded set; search, filters and paging come from the URL; sorted stably.
- [ ] RLS test: one tenant cannot see or act on another tenant's returns or photos.
- [ ] Non-returnable products are not offered in the form and are refused by the server.
- [ ] Money is paise end to end; nothing in the plan or code moves money.
- [ ] `pendingComponent` and `loading.tsx` present; gate passes; change record and `ARCHITECTURE.md` updated; UI exercised by hand and reported honestly.
