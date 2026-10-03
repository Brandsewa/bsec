# Quotes: Lean, Industry-Standard Model

- **Date:** 2026-10-02
- **Agent:** antigravity
- **Branch:** `feat/orders-quotes` (not merged yet)
- **Area:** db, domain, contracts, web, admin
- **Type:** feature
- **Supersedes:** none

## Summary
Implements full lean, industry-standard Quotes model according to `docs/ORDERS-QUOTES-PLAN.md`. Quote requests function strictly as inbound sales leads (no inventory reservation, no revenue calculation impact, no order record generated until staff actively converts it). Products can be marked "Price on request", which hides cart purchase options across storefront product cards and detail pages and replaces them with an accessible "Request a quote" modal dialog. In the Admin, staff manage leads in a dedicated Quotes workbench (`/quotes`) with KPI cards, tabs, search, filters, internal staff notes, and one-click order generation prefilled into `/orders/new`.

## What changed
- **Database & Migration:**
  - Added `0022_quotes.sql` adding `price_on_request boolean DEFAULT false NOT NULL` to `products`.
  - Added `quote_requests` tenant table with composite tenant foreign keys (`(tenant_id, product_id)`, `(tenant_id, variant_id)`, `(tenant_id, order_id)`, `(tenant_id, customer_id)`), RLS enabled, forced via `forceRlsSql()`, and unique index on `(tenant_id, number)`.
- **Contracts:**
  - `packages/contracts/src/storefront.ts`: Added `storefront.quotes.submit` for public rate-limited quote requests.
  - `packages/contracts/src/admin.ts`: Added `admin.quotes.*` (`stats`, `list`, `get`, `updateNote`, `markLost`, `reopen`, `delete`, `linkOrder`) and updated `admin.orders.createDraft` with optional `quoteId`.
- **Domain Services:**
  - `packages/domain/src/admin/quotes.ts`: Implemented `submitQuoteRequest`, `getAdminQuoteStats`, `listAdminQuotes`, `getAdminQuoteDetail`, `updateAdminQuoteNote`, `markAdminQuoteLost`, `reopenAdminQuote`, `deleteAdminQuote`, `linkOrderToQuote`, and `runQuoteExpirySweep`.
  - Sequential gapless numbering `QT-00001` via `number_sequences`.
  - Rate limiting (10/hr per IP, 5/hr per email) on storefront lead submissions.
  - Product/variant snapshots on quote creation; audit logs on every transition.
  - Storefront protection: `addToCart` (`packages/domain/src/storefront/cart.ts`) and `placeOrder` (`packages/domain/src/orders/checkout.ts`) reject items flagged `price_on_request`.
- **Storefront UI:**
  - `apps/web/src/components/catalog/ProductCard.tsx`: Displays "Price on request" badge when active.
  - `apps/web/src/components/product/RequestQuoteDialog.tsx`: Modal form with name, email, phone, company, quantity, and notes submitting to `/api/storefront/quotes/submit`.
  - `apps/web/src/components/product/VariantSelector.tsx`: Integrated dialog and replaces "Add to Cart" with "Request a quote" button.
- **Admin UI:**
  - `apps/admin/src/routes/_store.tsx`: Added Quotes item with `MessageSquareQuote` icon to the Orders navigation group.
  - `apps/admin/src/routes/_store/quotes.tsx`: Full Quotes Workbench with 5 KPI cards (Needs reply, Quote sent, Expired, Accepted, Total quotes value), tabs, search, filter chips, DataTable, CSV export, and detail `Sheet`.
  - `apps/admin/src/routes/_store/products/$id.tsx` & `new.tsx`: Added "Price on request" toggle switch.
  - `apps/admin/src/routes/_store/orders_.new.tsx`: Prefills customer, variant, price override, and agreed price notes from `quoteId` query parameter.

## Decisions and trade-offs
- **Quote Request is a Lead:** Quote requests never create an order, reserve stock, or pollute analytics revenue. An order is only created when staff converts the quote in the Admin (`/orders/new?quoteId=...`).
- **Storefront & Checkout Guardrails:** Even if a malicious client attempts to call `addToCart` or checkout with a `price_on_request` variant, the server strictly refuses and throws an error.
- **Expiry Sweep & Reservation Release:** When a quote is converted to a draft order with a validity period (`valid_until`, default 7 days), unconfirmed pending orders are cancelled and reserved inventory is released when expired via `runQuoteExpirySweep`.
- **Audit Logging:** Every quote mutation (notes update, marked lost, reopened, deleted, order linked) writes an authoritative `audit_logs` record.

## Verification
- Ran `pnpm --filter @bs/domain exec vitest run test/quotes.int.test.ts`: 8/8 tests passed on real Postgres 18 with Testcontainers (cart/checkout rejection, gapless sequential numbering, rate limiting, internal notes, audit logging, order conversion, expiry sweep, and cross-tenant RLS isolation).
- Ran `pnpm typecheck`: 15 packages passed cleanly.
- Ran `pnpm lint`: 15 packages passed cleanly.
- Ran `pnpm build`: 6 packages built cleanly.
- Ran `pnpm docs:check`: ok.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (updated section 7 migration table with `0022_quotes.sql`)
- [x] `progress.md` (updated In flight and marked Quotes complete)
- [x] `docs/changes/2026-10-02-antigravity-orders-quotes.md` (this file)

## Definition of done
- [x] Code follows rules; verification gate passes.
- [x] Real-DB tests verify isolation, status transitions, rate limiting, and order linkage.
- [x] `docs/ARCHITECTURE.md` updated with migration `0022_quotes.sql`.
- [x] Change record created; progress updated.
- [x] No secrets, no generated files in diff.
