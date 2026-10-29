# Order tracking: plan

Status: draft for owner review (2026-10-29). Owner: Claude Code, branch `feat/order-fulfillment-tracking`.
Related: `docs/ORDERS-SETTINGS-PLAN.md`, `docs/ORDERS-RETURNS-PLAN.md`, ADR-010 (no merchant code on servers).

## 1. What exists today (verified in code)

| Piece | Where | State |
|---|---|---|
| Per-order status page | `apps/web/src/app/o/[token]/page.tsx` | Reached only through a secret link (`action_tokens`, purpose `order_view`). Shows status badge, items, totals, returns form. **No shipment info at all**: no carrier, tracking number, tracking link, parcel list or timeline. |
| Thank-you page | `apps/web/src/app/orders/[token]/thank-you/page.tsx` | Links to `/o/{token}`. |
| Account order list and detail | `apps/web/src/app/account/(dashboard)/orders/` | Detail shows items, totals, address. "Track order or request a return" goes to `/account/orders/{id}/track`, a route that mints a fresh token and redirects to `/o/{token}`. No shipment info on the detail page either. |
| Lookup by order number | nothing | A guest who lost the email has no way in. No `/track` page. |
| Shipping email | `handleFulfillmentShippedJob` in `packages/domain/src/jobs.ts` | Template `order_shipped` receives `orderId, orderNumber, awb, carrier`. No tracking link, no status-page link. |
| Data to show | `fulfillments` (carrier, awb, trackingUrl, status, shippedAt, deliveredAt), `fulfillment_items`, `tracking_events`, `order_events.visibleToCustomer` | Already written by `transitionFulfillment`. Partial shipments (one fulfillment per parcel) now exist (`orders.ship`, this branch). |
| Admin settings | `apps/admin/.../settings/orders.tsx`, `order_settings` jsonb, `packages/domain/src/admin/order-settings.ts` | Order numbers and processing rules only. Nothing about tracking. |

So: the data model is ready, the customer-facing surfaces are not. This is mostly a storefront and settings job, plus one lookup endpoint.

## 2. Target behaviour (modern store practice)

1. **A fixed public page `/track`** (linked from header or footer menu and from every order email). The shopper enters **order number plus email or phone** and sees the same tracking view as the link in their email. The same input can also come from a deep link (`/track?order=ORD-00012`) with the number prefilled.
2. **Signed-in shoppers**: the Orders list in the account has a **Track** action on each order, and "View order" opens a detail page that shows tracking inline (no redirect through a token).
3. **One shared tracking view** (a single component) used by the `/o/{token}` page, `/track` result and the account order page, so they never drift apart.
4. **Tracking view contents**
   - Order number, placed date, payment line, current status as a stepper: Placed, Confirmed, Packed or In progress, Shipped, Out for delivery, Delivered (cancelled and RTO shown as their own end states).
   - **One card per parcel**: carrier, tracking number (copy button), "Track with carrier" button when a URL exists, status, ship and delivery dates, the items and quantities in that parcel. Orders shipped in parts show "2 of 3 items shipped" plus the unshipped items under "Not shipped yet".
   - **Event timeline** from `tracking_events` and customer-visible `order_events`, newest first, with location when the carrier gave one.
   - Estimated delivery text only if the merchant sets a delivery window (see settings). Never invented.
   - Delivery address (masked on the guest lookup: name and city, pincode only), items, totals, returns form (existing), help block with merchant contact.
5. **Notifications carry the link**: `order_shipped`, delivered and out-for-delivery emails (and later WhatsApp/SMS) include carrier, tracking number, carrier link and the status-page link. The "Notify customer" switch in the fulfil dialog (already built) controls it.
6. **Merchant settings** (Settings, Orders, new card "Order tracking"):
   - Enable public tracking page (default on).
   - Lookup method: order number + email, or order number + phone, or either (default either).
   - Show event timeline to customers (default on); show carrier name and tracking number (default on).
   - Estimated delivery window in days after shipping (optional, blank hides it).
   - Custom message shown above the tracker (plain text, length-capped, no HTML: ADR-010).
   - Carrier list used by the fulfil dialog: add, rename, set a **tracking URL template** such as `https://example.com/track/{awb}` so staff only type the number. (Today staff paste a URL per shipment.)
   - Notify customer by default when fulfilling (default off, matches today).

## 3. Security rules (non-negotiable)

- The lookup endpoint returns **the same generic "We couldn't find that order" for every failure** (wrong number, wrong email, other store). No account or order enumeration.
- **Rate limit** by IP and by order number (pattern: `packages/domain/src/customers/auth.ts`). Lock out for a short window after repeated misses.
- Tenant comes from the host, never from input. Lookup runs through a domain service under RLS (`app_rw` or `app_saas` path used by `getOrderByActionToken`); no new BYPASSRLS use.
- Guest view exposes **no full address, no phone, no email**; the token and account views may show the address the shopper already knows. Internal notes and staff-only events never appear (`visibleToCustomer` only).
- Match email and phone case-insensitively and by normalised digits; compare in constant time.
- Pages send `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `noindex`. The tracking URL from the merchant must be `http(s)` only (already validated in `orders.ship`).
- A successful lookup may mint a short-lived `order_view` token so returns and refreshes work; it expires like today's tokens.

## 4. Build phases (each shippable alone, each with its own tests)

**Phase A: shared tracking view and shipment data (storefront, domain)**
- Domain: extend the order-detail query used by token and account views to return `shipments[]` (with their items) and `timeline[]` (customer-visible only), `unshippedItems[]`.
- Web: `OrderTrackingView` component in `apps/web/src/components/orders/`, used by `/o/[token]` and the account detail page. Replace the redirect-through-token "Track" link with inline tracking in the account.
- Acceptance: partial shipment shows two parcel cards and the leftover items; delivered order shows delivered state; cancelled order has no parcel cards; internal notes never rendered. Real-DB test for the domain query; 375px and desktop walkthrough.

**Phase B: `/track` lookup page**
- Contract: `public.orders.lookup` (order number plus email or phone). Domain service with rate limit and generic failure.
- Web: `/track` page with form, `loading.tsx`, `noindex`; result renders `OrderTrackingView` in guest (masked) mode. Add a "Track order" link to the default header or footer blocks and to the 404 for unknown order links.
- Acceptance: wrong email, wrong number and other-tenant number return the identical response and timing class; 6th miss in the window is throttled; isolation test proves a store A order cannot be found from store B host.

**Phase C: merchant settings**
- Extend `order_settings` jsonb (no migration needed unless a column is preferred) with a `tracking` block, validated with Zod in `packages/contracts`, read and written through `order-settings.ts`. New "Order tracking" card in `settings/orders.tsx`. Storefront reads the settings through the existing tenant cache with a tenant-prefixed tag.
- Carrier list with URL templates stored in the same block; the fulfil dialog reads it for its carrier select and auto-builds the tracking URL when a template exists.
- Acceptance: turning the page off makes `/track` return 404 and hides links; changing the lookup method changes what the form asks; audit log row written on save.

**Phase D: notifications**
- Add `trackingUrl`, `statusUrl` to the `order_shipped` job data and template (`email-templates.ts`, notification catalog). Add out-for-delivery and delivered content only if the notification manager (`docs/NOTIFICATION-MANAGER-PLAN.md`, other branch) has landed; otherwise leave a note. Coordinate, do not edit that branch's files.
- Acceptance: email preview shows the carrier link and status link; "Notify customer" off sends nothing.

**Out of scope (needs owner decision first):** live carrier webhooks or polling (rule 14), SMS or WhatsApp delivery (providers deferred), customer-editable delivery address, map view.

## 5. Docs and gate for every phase
Change record in `docs/changes/`, `progress.md` In flight line, `docs/ARCHITECTURE.md` (routes, settings, contract), `pnpm gate:quick`, `pnpm --filter @bs/domain test:heavy`, new `public.*` procedure mapped in the isolation test. Storefront pages need `loading.tsx` (rule 11) and the product-page JS budget must not be touched (`/track` is its own route).

## 6. Open questions for the owner
1. Lookup default: order number plus email **or** phone, or email only? (Phone is friendlier for Indian shoppers; slightly easier to guess, so the rate limit matters more.)
2. Should the `/track` page be added automatically to every store's menu, or left for merchants to add?
3. Show carrier events from `tracking_events` to customers by default, or only the milestones (shipped, out for delivery, delivered)?
4. Are the estimated-delivery window and the custom message wanted in the first release?
5. Order of work: A first (value inside the account and email links at once), then B, C, D. Agree?
