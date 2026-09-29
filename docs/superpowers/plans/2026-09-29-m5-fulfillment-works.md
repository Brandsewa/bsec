# M5 · Fulfillment Works Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the full M5 Fulfillment, Shipping, GST Tax Invoices, Returns, Discounts, Transactional Email, and Admin Management subsystem for the bsec platform with rigorous verification against real PostgreSQL 18.

**Architecture:**
- **Database & Multitenancy (`packages/db`):** Create remaining PLAN §5.7 & §5.8 tenant tables (`fulfillments`, `fulfillment_items`, `tracking_events`, `returns`, `return_items`, `invoices`, `discounts`, `discount_redemptions`, `email_log`) with `tenantTable()`, composite foreign keys to `tenant_id`, and raw SQL migration `0007_m5_fulfillment.sql` enforcing `FORCE ROW LEVEL SECURITY`.
- **Shipping Provider Adapter Layer (`packages/shipping`):** Mirror `@bs/payments` with a provider-neutral `ShippingProvider` interface (`getRates`, `checkServiceability`, `createShipment`, `generateLabel`, `trackShipment`, `cancelShipment`, `verifyWebhook`) and a production-grade `ShiprocketProvider` handling authentication caching, real request payload serialization, HMAC webhook verification, and manual fallback kill switch (PLAN §11.7).
- **Domain State Machines & Commerce Correctness (`packages/domain`):**
  - Implement `transitionFulfillment(rt, ctx, fulfillmentId, event)` and `transitionReturn(rt, ctx, returnId, event)` strictly adhering to PLAN §11.1.
  - Wire cross-entity guards: order cannot cancel once any fulfillment is past `label_created`; order cannot be marked `delivered` while any fulfillment is pending; refund cannot exceed captured amount.
  - Number sequences per financial year for invoices (`INV-YYYY-YY-XXXX`) and returns (`RET-XXXX`).
  - GST calculation engine adhering strictly to PLAN §15 V1 scope (tax-inclusive/exclusive, HSN, B2C/B2B with GSTIN, place of supply CGST+SGST vs IGST, discounts reducing taxable value, shipping tax treatment, FY numbering, and credit notes).
  - Discount engine (percent, fixed, free shipping, BXGY, usage limit guarded atomic updates, combinable flags).
  - Webhook inbox integration for Shiprocket tracking events re-using `receiveWebhook`/`processWebhookInboxItem`.
  - Transactional emails via domain events (`order.paid`, `fulfillment.created`, `fulfillment.delivered`, `return.requested`, `refund.processed`) with `email_log` tracking and integration kill-switch (queue and retry on outage).
  - Scheduled abandoned-cart recovery job via pg-boss.
- **Contracts & Administration (`packages/contracts`, `apps/web`, `apps/admin`):**
  - Extend oRPC contracts for orders management (saved views, timeline, notes, draft orders, pay links, fulfill, cancel, refund), shipments, returns, invoices, customers, and discounts.
  - Implement corresponding domain services and admin screens with Supabase-grade UX and mobile touch targets.

**Tech Stack:** TypeScript 6.0.3, Next.js 16 (App Router), React 19, TanStack Router / Query, Drizzle ORM 0.45.3, PostgreSQL 18, pg-boss 12.35.0, oRPC 1.15.4, Vitest 5.0.2.

---

## Task Decomposition

### Task 1: Drizzle Schemas & Migration 0007 (`packages/db`)
- Create schemas for:
  - `packages/db/src/schema/shipping.ts`: `fulfillments`, `fulfillment_items`, `tracking_events`, `returns`, `return_items`, `invoices`.
  - `packages/db/src/schema/marketing.ts`: Add `discounts`, `discount_redemptions`.
  - `packages/db/src/schema/system.ts`: Add `emailLog`.
  - Re-export all in `packages/db/src/schema/index.ts`.
  - Update `packages/db/src/queues.ts` with domain event queues:
    - `fulfillment.created`, `fulfillment.delivered`, `fulfillment.rto`, `return.requested`, `refund.processed`, `cart.abandoned`, `cart.recovery_sweep`.
- Generate and refine migration `packages/db/migrations/0007_m5_fulfillment.sql` with explicit `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` for every new tenant table.
- Register `0007_m5_fulfillment` in `packages/db/migrations/meta/_journal.json`.
- Verify migration passes against real PostgreSQL 18 with `pnpm --filter @bs/db test`.

### Task 2: Provider-Neutral Shipping Layer (`packages/shipping`)
- Initialize workspace package `@bs/shipping` (mirroring `packages/payments`):
  - `types.ts`: `ShippingProvider`, `ShippingRate`, `ServiceabilityResult`, `ShipmentInput`, `ShipmentResult`, `LabelResult`, `TrackingUpdate`, `VerifiedShippingWebhookEvent`.
  - `providers/shiprocket.ts`: Real API client implementation for Shiprocket REST endpoints (auth token caching, custom order creation, manifest, label download, tracking webhook verification).
  - `providers/manual.ts`: Fallback manual fulfillment provider for the kill switch (PLAN §11.7).
- Tests in `packages/shipping/test/shiprocket.test.ts`:
  - Mock HTTP layer and assert on exact outgoing request shapes, headers, authentication caching, payload serialization, and webhook signature verification.

### Task 3: State Machines & Cross-Entity Guards (`packages/domain`)
- Implement `packages/domain/src/orders/fulfillment-state-machine.ts`:
  - `transitionFulfillment(rt, ctx, fulfillmentId, event)` with exhaustive transitions:
    - `pending → label_created → picked_up → in_transit → out_for_delivery → delivered`
    - `in_transit/out_for_delivery → rto → rto_delivered`
    - `pending/label_created → cancelled`
  - Integration with `order_events` timeline.
- Implement `packages/domain/src/orders/return-state-machine.ts`:
  - `transitionReturn(rt, ctx, returnId, event)` with transitions:
    - `requested → approved | rejected → picked_up → received → refunded | replaced → closed`
- Update `packages/domain/src/orders/state-machine.ts` with cross-entity guards:
  - Guard: Order cannot cancel once any fulfillment is past `label_created`.
  - Guard: Order cannot be marked `delivered` while any fulfillment is pending.
  - Guard: Refund amount cannot exceed captured amount.
- Comprehensive unit tests in `packages/domain/test/fulfillment-state-machine.test.ts` and `return-state-machine.test.ts` exhaustively covering all pairs of transitions (valid and invalid).

### Task 4: GST Invoices Engine & Financial Year Numbering (`packages/domain`)
- Implement `packages/domain/src/orders/invoices.ts`:
  - Determine Indian Financial Year (`YYYY-YY`, e.g., `2026-27`).
  - Sequence generator: `allocateSequenceNumber(tx, tenantId, 'invoice', fy)`.
  - GST Calculation Engine strictly per PLAN §15:
    - Tax-inclusive and tax-exclusive item calculations.
    - HSN and tax class resolution.
    - Place of supply rules (seller state vs shipping state): Intra-state (CGST + SGST) vs Inter-state (IGST).
    - Discounts proportionally reducing taxable value.
    - Shipping tax treatment.
    - Rounding to nearest rupee/paise.
    - Credit note generation for returns/cancellations (`CRN-YYYY-YY-XXXX`).
- Comprehensive tests in `packages/domain/test/gst-invoices.test.ts`.

### Task 5: Discounts Engine & Atomic Concurrency Proof (`packages/domain`)
- Implement `packages/domain/src/orders/discounts.ts`:
  - Validation: code lookup, active date check, min subtotal / min quantity, eligibility.
  - Discount calculation: `percent`, `fixed`, `free_shipping`, `buy_x_get_y`.
  - Combinability rules.
  - Atomic guarded redemption: `UPDATE discounts SET used_count = used_count + 1 WHERE tenant_id = $t AND id = $d AND (usage_limit IS NULL OR used_count < usage_limit) RETURNING id`.
  - Record `discount_redemptions`.
- Real PostgreSQL 18 Concurrency Test in `packages/domain/test/discounts-concurrency.int.test.ts`:
  - `Promise.all` with 50 concurrent redemptions against a discount with `usage_limit = 10`. Proves exactly 10 redemptions succeed, 40 fail cleanly, and `used_count` is exactly 10.

### Task 6: Webhook Inbox Reuse for Shiprocket & Tracking (`packages/domain`, `apps/web`)
- Update `packages/domain/src/system/webhooks.ts`:
  - Support `shiprocket` provider in `processWebhookInboxItem`.
  - On tracking update webhook (`tracking.update` / status change):
    - Ingest into `tracking_events`.
    - Auto-transition fulfillment via `transitionFulfillment`.
    - Handle RTO transitions and trigger customer notifications.
- Update `apps/web/src/app/api/webhooks/[provider]/route.ts`:
  - Support `shiprocket` webhook with HMAC-SHA256 signature verification.

### Task 7: Transactional Emails, Outage Kill-Switch, and Abandoned Carts (`packages/domain`, `apps/worker`)
- Implement `packages/domain/src/system/email.ts`:
  - Provider interface and client (supporting Resend / SMTP / Console logger fallback).
  - Integration kill-switch: if `RESEND_API_KEY` is missing or kill switch active, queue jobs for retry rather than failing commerce operations.
  - Record all sends in `email_log`.
- Implement event listeners in `packages/domain/src/jobs.ts`:
  - `fulfillment.created` -> Shipping confirmation email with tracking link.
  - `fulfillment.delivered` -> Delivery confirmation email.
  - `return.requested` -> Return request acknowledgment.
  - `refund.processed` -> Refund processed notification.
  - `cart.recovery_sweep` / cron: Query `carts` where `status = 'abandoned'` and `recovery_sent_at IS NULL` and `last_activity_at < now() - interval '2 hours'`, enqueue recovery emails, update `recovery_sent_at`.

### Task 8: Contracts, Domain Services & Admin UI (`packages/contracts`, `apps/web`, `apps/admin`)
- Update `packages/contracts/src/admin.ts`:
  - Add contracts for:
    - `admin.orders`: saved views (`unfulfilled`, `unpaid`, `cod_to_confirm`, `rto`), detail, notes, draft orders, pay link, fulfill, cancel, refund.
    - `admin.shipments`: create shipment, download label, track.
    - `admin.returns`: list, detail, approve, reject, receive, refund.
    - `admin.invoices`: list, get, download.
    - `admin.customers`: list, detail, notes, addresses, tags.
    - `admin.discounts`: list, get, create, update, delete.
- Implement domain services and wire up oRPC routes in `apps/web/src/server/api.ts`.
- Implement Admin UI pages in `apps/admin`:
  - `_store/orders.tsx`: Full orders view with filter tabs (All, Unfulfilled, Unpaid, COD to Confirm, RTO), draft order creation modal, notes drawer, and timeline.
  - `_store/customers.tsx`: Customers list and detail.
  - `_store/discounts.tsx`: Discounts list and editor.
- Update isolation test suite `packages/domain/test/isolation.int.test.ts` to cover all new procedures.

### Task 9: Full Monorepo Verification & Staging Proof
- Run all unit and fast tests: `pnpm run test:fast`.
- Run heavy PostgreSQL 18 integration and concurrency test suite: `pnpm run test:heavy`.
- Verify isolation suite covers all admin procedures.
- Run typecheck and linting: `pnpm run typecheck && pnpm run lint`.
