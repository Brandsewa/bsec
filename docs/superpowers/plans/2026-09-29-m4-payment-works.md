# M4: Payment Works Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete, highly-correct payment and order placement subsystem for multi-tenant stores (M4), including provider-neutral payment adapters (Razorpay + COD), atomic guarded inventory reservation, gapless sequence numbering, idempotent webhook inbox, comprehensive state machine transitions, idempotency key middleware, and minimal customer accounts with end-to-end concurrency proofs on real PostgreSQL 18.

**Architecture:**
- **Database & Tenant Isolation (`packages/db`):** 9 new `tenantTable()` schemas (`orders`, `order_items`, `order_events`, `order_notes`, `payment_intents`, `payment_attempts`, `refunds`, `action_tokens`, `number_sequences`, `inventory_reservations`, `tenant_secrets`, `idempotency_keys`, `customers`, `customer_addresses`, `wishlist_items`) and system table `webhook_inbox` with `unique(provider, event_id)`. All tenant tables protected with `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.
- **Payment Provider Adapter Layer (`packages/payments`):** Provider-neutral `PaymentProvider` interface conforming strictly to PLAN §11.5 and ADR-008. Implementations for `RazorpayProvider` (encrypted keys in `tenant_secrets` via AES-256-GCM) and `CODProvider` (fee calculation, ordering limits, confirmation tokens).
- **Commerce Correctness & State Machines (`packages/domain`):**
  - `transitionOrder(ctx, id, event)`: The authoritative state machine function enforcing PLAN §11.1's exact allowed transitions for Orders and Payment Intents, logging an `order_events` record on every transition.
  - Number Sequences (PLAN §11.2): Atomic `UPDATE ... SET next_value = next_value + 1 ... RETURNING` in the same transaction as order creation.
  - Guarded Inventory Reservation (PLAN §11.3): Single guarded `UPDATE inventory_levels SET reserved = reserved + $qty WHERE on_hand - reserved >= $qty RETURNING id`, active reservation ledger, and pg-boss expiry background job.
  - Idempotency & Webhook Inbox (PLAN §11.4 & §5.10): Idempotency key tracking on checkout routes and sanitized webhook intake with background async worker processing.
- **Storefront Checkout & Customer Accounts (`packages/contracts`, `packages/domain`, `apps/web`):** Full checkout placement API accepting `Idempotency-Key`, creating orders, processing COD or Razorpay intent, clearing cart, and providing customer OTP login, address management, order history, and guest order lookup.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 6.0.3, Drizzle ORM 0.45.3, PostgreSQL 18, pg-boss 12.35.0, oRPC 1.15.4, Zod 4.6.5, Vitest 5.0.2, AES-256-GCM crypto.

---

## Task Decomposition

### Task 1: Drizzle Schema & Migration for M4 Tables (`packages/db`)
- Create schemas in `packages/db/src/schema/orders.ts`, `payments.ts`, `customers.ts`, `system.ts`, `tenant-secrets.ts`.
- Re-export in `packages/db/src/schema/index.ts`.
- Update `packages/db/src/queues.ts` with domain event queues (`order.created`, `order.paid`, `order.cod_confirmed`, `order.cancelled`, `reservation.expiry`, `webhook.process`).
- Create raw SQL migration `packages/db/migrations/0006_m4_payment_orders.sql` with explicit `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` for every tenant table, plus `unique(provider, event_id)` on `webhook_inbox`.
- Register in `meta/_journal.json`.
- Test: Validate with `packages/db/test/roles.int.test.ts` and `schema.test.ts` against PostgreSQL 18.

### Task 2: Provider-Neutral Payment Layer (`packages/payments`)
- Setup workspace package `@bs/payments`.
- Define `PaymentProvider` interface verbatim per PLAN §11.5.
- Implement AES-256-GCM secret encryption / decryption for `tenant_secrets`.
- Implement `RazorpayProvider` with signature verification, order creation, capture, refund, and webhook parsing.
- Implement `CODProvider` with fee logic, max limit guard, and confirmation action tokens.
- Implement memory/mock test harness provider for reproducible testing.
- Unit and integration tests in `packages/payments/test/`.

### Task 3: State Machine & Transition Engine (`packages/domain`)
- Implement `transitionOrder(ctx, id, event)` in `packages/domain/src/orders/state-machine.ts`.
- Check PLAN §11.1 transition table exhaustively (orders and payment intents).
- Write `order_events` on every transition with actor and timestamp.
- Cross-entity guards: cancellation forbidden once fulfillment past `label_created`; cannot deliver while fulfillment pending; refund amount <= captured amount.
- Test: Unit tests in `packages/domain/test/order-state-machine.test.ts` exhaustively covering EVERY valid and invalid transition.

### Task 4: Gapless Number Sequences & Concurrency Proof (`packages/domain`)
- Implement `allocateSequenceNumber(dbOrTx, tenantId, kind, scope)` with atomic `UPDATE number_sequences SET next_value = next_value + 1 ... RETURNING`.
- Test: Concurrency test in `packages/domain/test/number-sequences.int.test.ts` with 20 parallel workers generating 1,000 orders against real Postgres, asserting exactly 1,000 unique sequential numbers with 0 gaps.

### Task 5: Guarded Inventory Reservation & Expiry Job (`packages/domain` & `apps/worker`)
- Implement `reserveInventory(dbOrTx, tenantId, variantId, locationId, qty, cartId, orderId)`.
- Use the exact guarded SQL: `UPDATE inventory_levels SET reserved = reserved + $qty WHERE tenant_id = $t AND variant_id = $v AND location_id = $l AND on_hand - reserved >= $qty RETURNING id`.
- Insert into `inventory_reservations` with status `active` and 30-minute expiry.
- Implement `commitReservation` (on payment) and `releaseReservation` (on cancel/expiry).
- Implement pg-boss expiry worker job that releases expired reservations idempotently.
- Test: Real Postgres concurrency test in `packages/domain/test/inventory-reservation.int.test.ts` running 500 concurrent reservation attempts against stock of 100, proving exactly 100 succeed and 0 oversold.

### Task 6: Idempotency Keys & Webhook Inbox (`packages/domain`, `apps/web`, `apps/worker`)
- Implement `withIdempotencyKey(ctx, key, route, payload, executeFn)`.
- Implement `receiveWebhook(provider, headers, rawBody)` with signature validation, sanitization (strip card numbers, CVVs, auth headers), and insertion into `webhook_inbox` with `ON CONFLICT (provider, event_id) DO NOTHING`.
- Enqueue `webhook.process` job and implement worker handler to idempotently apply payments.
- Real Postgres concurrency test in `packages/domain/test/webhook-inbox.int.test.ts` proving duplicate webhooks are safely ignored.

### Task 7: Checkout Place-Order End-to-End (`packages/domain`, `apps/web`)
- Replace the M3 stub at `apps/web/src/app/api/storefront/checkout/place-order/route.ts` with the complete commerce pipeline:
  1. Idempotency key check
  2. Cart validation & price calculation
  3. Guarded inventory reservation
  4. Sequence number allocation
  5. Order record creation in `pending` status
  6. Payment intent creation (Razorpay or COD)
  7. Enqueue `order.created` domain event
  8. Cart clearing
- Mount `/api/webhooks/[provider]` route.
- Test: Integration tests verifying duplicate checkout submissions return the identical order without double-booking stock.

### Task 8: Minimal Customer Accounts (`packages/domain`, `packages/contracts`, `apps/web`)
- Implement customer OTP login / verification flow.
- Implement Customer Account services:
  - `getCustomerOrders(ctx, customerId)` / `getOrderDetail(ctx, orderId, customerId | token)`
  - `listCustomerAddresses(ctx, customerId)` / `createCustomerAddress(ctx, customerId, address)` / `updateCustomerAddress` / `deleteCustomerAddress`
  - `getWishlist(ctx, customerId)` / `addToWishlist(ctx, customerId, variantId)` / `removeFromWishlist`
- Add oRPC contracts and storefront routes (`/account/login`, `/account/orders`, `/account/addresses`, `/account/wishlist`, `/o/[token]`, `/cod/[token]`).
- Isolation test suite additions verifying customer data isolation across tenants.

### Task 9: Full Monorepo Verification & Concurrency Suite
- Run all concurrency tests against real PostgreSQL 18 container.
- Run complete test suite (`pnpm test`), type checking (`pnpm -r run typecheck`), and linting (`pnpm -r run lint`).
- Verify isolation suite covers all newly added procedures.
