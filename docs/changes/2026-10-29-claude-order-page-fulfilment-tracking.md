# Order page redesign, partial shipments and shopper tracking view (Phase A)

- **Date:** 2026-10-29
- **Agent:** claude
- **Branch:** `feat/order-fulfillment-tracking` (not merged yet)
- **Area:** admin, domain, contracts, web
- **Type:** feature
- **Supersedes:** none

## Summary
The admin order page now follows the owner's layout, items are two compact lines, and "Mark as fulfilled" opens a dialog that ships all or part of an order with carrier, tracking number, tracking URL and a notify switch. Storefront order pages (emailed link and account) now show real tracking: progress, one card per parcel, items not shipped yet and a customer-safe timeline. Phase B adds the public `/track` lookup page; Phase C adds the "Order tracking" settings card; Phase D puts the carrier link, tracking number and parcel contents in the shipped email. Plan for the remaining phases: `docs/ORDER-TRACKING-PLAN.md`.

## What changed
- Admin `orders_.$orderId.tsx`: header with badges, fulfilment dropdown (Unfulfilled, In progress, Mark as fulfilled or Ship remaining items, Mark delivered), Refund dialog (existing `orders.refund`), More menu (GST invoice, archive, cancel, delete). Left column Items, Summary, Timeline; right column Customer then Shipments.
- New `orders.ship` (contract, handler in `apps/web/src/server/api.ts`, `shipAdminOrderItems` in `packages/domain/src/orders/manual-lifecycle.ts`): one fulfillment per parcel, quantity validated against what is left, order rolls up to partially fulfilled until the last unit ships. No courier call.
- `transitionFulfillment` takes `opts.notify`; `false` skips queuing the shipping email. The ship flow notifies at most once and only when the switch is on.
- `loadOrderTracking` in `packages/domain/src/customers/orders.ts`; `getOrderByActionToken` and `getCustomerOrderDetail` return `tracking`. Timeline labels come from a fixed map, never from raw event messages.
- `/track` (`apps/web/src/app/track/`, server action) and `lookupOrderForTracking` in `packages/domain/src/customers/orders.ts`: matches the order number (with or without the store's `#`) and the email or last 10 phone digits, mints a 24-hour `order_view` token; every failure returns the same message; limits 10 per IP and 6 per order number per 10 minutes via `checkRateLimit`.
- Phase C: `tracking` block in `order_settings` (contract `TrackingSettings`, `parseTrackingConfig`, `readTrackingConfig`, `carrierTrackingUrl` in `packages/domain/src/admin/`); `updateOrderSettings` keeps it when only numbering changes and audits changes; admin card in `settings/orders.tsx`; `/track` 404s when off and follows the lookup method; tracking view hides timeline or carrier details, shows an estimate and the message; fulfil dialog uses the store's carrier list and notify default, and `orders.ship` builds the tracking link from the carrier template when staff leave it empty. No migration.
- Phase D: `handleFulfillmentShippedJob` now reads the parcel itself (the queue message only had ids, so carrier and tracking number never reached the email before) and passes carrier, tracking number, carrier link, parcel contents ("1 of 2"), and the estimated delivery date; the `order_shipped` template renders them via a new `after` slot in `orderEmail`, only http(s) links; carrier details are left out when the store hides them. The status-page link was already the email button (`mintOrderViewUrl`).
- Web: `OrderTrackingView` and `CopyButton` in `apps/web/src/components/orders/`, used by `/o/[token]` and `/account/orders/[id]`; status wording for partly shipped and processing orders; account button now reads "Request a return".

## Decisions and trade-offs
- `createAdminFulfillment` (Shiprocket-flavoured, always marks the order fulfilled) is untouched; the manual flow gets its own function (AGENTS rule 14).
- "On hold" and the staff "Order status page" link were left out: they need a new order state and a staff-minted token, which is the owner's call.
- Carrier list is a fixed set plus "Other" for now; Phase C moves it to settings.

## Verification
- Ran: `pnpm typecheck` and `pnpm lint` (all 15 tasks pass, warnings only); `manual-lifecycle.int.test.ts` 12 pass (five new real-database tests: lookup and throttle, settings round trip, carrier link, shipped email body); `email-templates`, `email-branding`, `email-handlers`, `notifications` 53 pass; `order-settings-config.test.ts` 7 pass; order-phase1, settings-audit-coverage and checkout-settings 32 pass; web `order-labels.test.ts` 3 pass; `pnpm docs:check` ok; `isolation.int.test.ts` 1605 pass (includes `orders.ship`).
- Exercised by hand (local demo store, own ports 3200 and 5190): partial shipment from the admin dialog, the emailed-link page at desktop and 375px, the signed-in account order page.
- NOT verified: the rest of `pnpm test:heavy`, `pnpm build`, e2e selectors (the e2e suite may use the old Actions-card labels), the notify switch against the real worker, the refund dialog.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (`orders.ship`, tracking view on `/o/[token]` and account order page)
- [x] ADR not needed: no architectural decision
- [x] `DEPLOYMENT.md` not needed
- [x] `progress.md` in-flight line

## Follow-ups and open questions
- Phase B gaps: `/track` is not linked from any menu; no cross-tenant lookup test (tenant comes from the host and every query filters on it).
- Out-for-delivery and delivered emails with tracking links wait for the notification manager branch (`docs/NOTIFICATION-MANAGER-PLAN.md`); not touched here.

## Definition of done
Not complete until `pnpm build`, the rest of heavy tests and an e2e selector check are done.
