# Audit A4: payments and webhooks (test mode only)

- **Date:** 2026-11-15
- **Auditor:** claude
- **Plan:** `docs/PLATFORM-AUDIT-PLAN.md` section A4
- **Code audited:** `main` e152e4b plus the dependency bumps of PR #274
- **How:** code read and existing tests read. No provider was called, no live or test key was used, nothing was run against production. No new probe test was written for this section.

## Result

No way to mark an order paid without a real, correctly signed payment for that order and amount was found. The settle path is well built. One behaviour needs a decision (a payment that arrives for a cancelled order), and three are low.

| ID | Severity | Title | Status |
|---|---|---|---|
| A4-01 | Medium | A payment that arrives for a cancelled order is recorded as paid with no alert | fixed in `fix/payment-on-cancelled-order`, tests in `razorpay-checkout.int.test.ts` |
| A4-02 | Low | Unsigned requests are stored in `webhook_inbox` | fixed in `fix/payment-on-cancelled-order` by a 24-hour purge; the route still stores them (existing security tests assert it) |
| A4-03 | Low | The webhook route returns internal error text | fixed in `fix/payment-on-cancelled-order` |
| A4-04 | Info | The store is picked from the request before the signature is checked | safe as built |

## Findings

### A4-01 A late payment on a cancelled order is recorded silently (Medium, not reproduced)

- **Where:** `packages/domain/src/payments/razorpay-checkout.ts:185-268` `settleProviderPayment`. `startRazorpayPayment` refuses a cancelled order, but settle does not look at `order.status`: for any status other than `pending` it sets `payment_status = 'paid'` and writes the normal "Payment received" event.
- **Steps (theory):** a shopper opens the payment page; the order is cancelled (by the shopper through the abandon route, by staff, or by the stock-hold expiry); the shopper completes the payment on the provider's page; the webhook arrives.
- **Expected:** the merchant is told clearly that money arrived for a cancelled order and needs a refund or a reinstated order.
- **Actual:** the order stays cancelled with payment "paid", stock already released, `commitReservation` runs on a reservation that may be gone, and `ORDER_CREATED` is queued as for a normal order. Nothing flags it.
- **Suggested fix (S to M):** in settle, when the order is cancelled, record the payment, write a distinct `payment.received_after_cancel` event, notify the merchant, and skip the order-created job. Add a real-database test.

### A4-02 Unsigned requests are stored (Low)

- **Where:** `apps/web/src/app/api/webhooks/[provider]/route.ts:206` calls `receiveWebhook` with `signatureValid: false`; `packages/domain/src/system/webhooks.ts` inserts the row and the worker later marks it failed.
- **Impact:** anyone can add rows (limit: 300 per minute per IP and provider, and the IP caveat of A2-05 applies). A search of `packages/domain/src` and `apps/worker/src` found no job that deletes old rows. A later valid event with the same id correctly replaces an invalid row, so this cannot block a real event.
- **Suggested fix (S):** do not store or queue invalid-signature requests (log a counter instead), or delete failed-signature rows after a day.

### A4-03 The webhook route returns internal error text (Low)

- **Where:** same route, the final `catch`: `{ error: err.message }` with status 500, and the 400 from `resolveWebhookTenant` likewise.
- **Impact:** database or decryption error text can reach an unauthenticated caller.
- **Suggested fix (S):** log the error, return a fixed message.

### A4-04 The store is picked from the request before the signature is checked (Info)

- **Where:** same route: `tenantId` query parameter, `x-tenant-id` header or payload notes select whose secret is used.
- **Why it is safe:** the signature is then verified with that store's own secret, and settle runs inside that store's row-level security, so a merchant can only ever sign events for their own store. The existing test "another store cannot settle this store's order" covers it.

## Checks that passed

| Check | How | Result |
|---|---|---|
| Razorpay, Stripe, cash-on-delivery webhooks: HMAC over the raw body with the store's own secret, timing-safe compare, an empty secret never verifies | read `packages/payments/src/providers/*.ts` | pass |
| Stripe: 5 minute timestamp tolerance | read | pass |
| Processing refuses rows whose signature was not valid | read `processWebhookInboxItem` | pass |
| Duplicate events: unique (provider, event id), claim by status, settle is idempotent under a row lock | read; existing `razorpay-checkout.int.test.ts:191` | pass (existing test, not re-run) |
| Amount and currency reported by the provider must equal the stored intent; a mismatch is recorded and not accepted | read `settleProviderPayment`; existing test | pass |
| Browser confirmation: the provider order must belong to the order behind the shopper's token, then the signature is checked | read `confirmRazorpayPayment`; existing `razorpay-checkout.int.test.ts:157` | pass |
| The amount sent to the provider is the server-side intent amount | read `startRazorpayPayment` | pass |
| An online order gets its real number only when paid | read | pass |
| No live keys in the repository | `git grep` for `rzp_live_`, `sk_live_`, `pk_live_`, `whsec_` | only made-up values in tests |

## Not checked

- PayPal verification call and Cashfree signature function (read only at the call site).
- Stripe Payment Element: intent creation and reuse (`online-checkout.ts`), covered by its own new tests, not re-read.
- Refund paths and refund limits.
- Platform billing webhooks (`packages/domain/src/saas/billing.ts`) and invoice access.
- That credential read APIs return only "set" or "not set".
- Log redaction of payment payloads.
