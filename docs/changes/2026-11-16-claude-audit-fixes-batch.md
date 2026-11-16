# Audit fixes: payment on a cancelled order and the smaller findings

- **Date:** 2026-11-16
- **Agent:** claude
- **Branch:** `fix/payment-on-cancelled-order` (not merged yet)
- **Area:** domain (payments, jobs, notifications, cart, team), web (webhook and place-order routes)
- **Type:** fix
- **Supersedes:** none

## Summary
One change set for the findings of the platform audit (`docs/audit/`) that could be fixed safely in code: A4-01 (Medium), A2-02, A2-03, A2-04, A3-07, A3-08 and A4-03 (Low). The owner asked for all fixes in one commit and one PR. Findings that need a decision, a migration or a live check are listed under follow-ups, not fixed.

## What changed
- **A4-01** `packages/domain/src/payments/razorpay-checkout.ts`: a verified, amount-matching payment for an order that is already cancelled is recorded (payment attempt, order shows paid so the merchant can refund it with the normal flow) but the order is NOT confirmed: no order number is taken, stock stays released, no confirmation goes to the shopper. It writes a `payment.received_after_cancel` order event and queues the existing order job with `paymentAfterCancel: true`. The job (`packages/domain/src/jobs.ts`) sends a new locked notification `store_payment_after_cancel` (in app and email, to owners and admins; `notifications/catalog.ts`) and skips the confirmation email and the Purchase conversion event. A retried event finds the order already paid and does nothing.
- **A2-02** `saas/onboarding.ts`: dismissing the setup card needs `settings.write`. The rest of A2-02 was a script blind spot (see the correction in the A2 file); `scripts/audit-api-guards.mjs` now knows `assertStoreOwner`.
- **A2-03** `admin/team.ts`: accepting a staff invitation writes an `audit_logs` row (role, never the token).
- **A2-04** `admin/team.ts`: the owner count takes a row lock (`FOR UPDATE OF memberships`) so two owners demoting each other at once cannot both pass "keep one owner".
- **A3-07** `storefront/cart.ts` and the cart items route: at most 9,999 of one item per cart line (rejects above, caps when an add would exceed).
- **A3-08** place-order route: the context it builds has no staff role and no permission.
- **A4-03** webhook route: unauthenticated callers get fixed messages; the detail goes to the log.
- **A3-04** `system/rate-limit.ts` `checkPlaceOrderRateLimit`: per-IP (60 per 10 min) and per-phone (10 per 10 min) limits on place-order, per-IP on the pay route. Fails open on its own faults like the store-wide limiter. No bot check yet.
- **A4-02** `system/retention.ts` `pruneInvalidWebhookInbox`, called by the 15-minute maintenance pass: invalid-signature webhook rows older than 24 hours are deleted. The route is unchanged: three existing security tests assert that a forged webhook is stored and then rejected by the processor.
- **A2-01 (partly)** feature flag update, retire and restore, and audit-log archive and unarchive check the platform role inside the service.
- **A2-05** `TRUST_CLOUDFLARE` documented in `DEPLOYMENT.md` and `.env.example`.
- **A2-06** `customers/otp.ts`: the sign-in code hash is an HMAC keyed with the server secret; `customers/placeholder-email.ts`: new phone-only customers get a `@phone.invalid` address; every place that recognises "no email" accepts both that and the legacy `@customer.store`.
- Tests: two in `razorpay-checkout.int.test.ts` (late payment recorded and alert queued once; the job alerts the owners and sends no confirmation), `team-access.int.test.ts` (audit row; two-owner race smoke check), `rate-limit-place-order.int.test.ts` (per-phone and per-IP limits, per store), `webhook-inbox-retention.int.test.ts`, `placeholder-email.test.ts`. Audit files updated.

## Decisions and trade-offs
- **Late payment keeps the order cancelled.** Reinstating it would need stock that may be gone; the merchant decides (refund, or restore the order). The order carries the original `PEND-` number because it never got a real one.
- **No new queue.** The alert rides on the existing order job with a flag, so the worker and the jobs table in the docs do not change.
- **A2-04 is not proven by a test.** The race is rare; the two-owner test passed three times with the lock removed. The fix rests on how Postgres re-checks a locked row, and the test is labelled a smoke check.
- **A3-07 limit** 9,999 per line is far above any real order and below the integer limit. Tell me if a store sells in larger units.

## Verification
- Ran against the local test Postgres (Docker): the full `@bs/domain` heavy suite 3,091 passed in 161 of 162 files; the one file that did not report, `rate-limiting.int.test.ts`, lost its worker to a Windows native crash (exit code 3221226505, seen once before in an unrelated file) and passes alone, together with the three new files (15 tests). `@bs/domain` fast tests 762 pass, `@bs/web` fast tests 266 pass, typecheck of all packages passes, lint has no errors (one unused variable of mine fixed). The isolation suite (1,832 tests) was re-run after its assertion was changed.
- Exercised by hand: nothing in a browser. The new notification was not viewed in the admin inbox or the Super Admin events matrix.
- NOT verified: a real provider webhook for a cancelled order; the email text; that the Super Admin notification matrix lists the new event correctly.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed (no route, table, queue, env var or migration changed)
- [ ] ADR: not needed
- [x] `DEPLOYMENT.md`: `TRUST_CLOUDFLARE` documented (also `.env.example`); RUNBOOK not needed
- [ ] `progress.md`: not needed

## Follow-ups and open questions
Not fixed, with the reason:
- **A1-01** row-level security on the shared platform tables: needs a migration, and several store-side queries read these tables outside a tenant transaction, so a policy would make them return nothing. It needs a call-site review and a staged change (expand, check, enforce), not a blind policy.
- **A1-03** a pending custom domain blocks the hostname for other stores: needs a product rule (how long, who may claim), and the provider-side hostname must be removed too.
- **A1-04** the `TenantContext | string` overloads: about a hundred test calls and two platform call sites use the string form; the fix is to point them at the `...Internal` functions, whose return shapes differ in places.
- **A2-01** the other ten platform services (see the A2 file); **A2-06** data migration of legacy `@customer.store` rows, and a mailer guard.
- **A3-04** bot check (Turnstile) on checkout; **A3-06** enqueue the order job inside the transaction (needs a design for the job library's transaction option).
- **A3-05** customer-only discounts (owner decision); **A1-02** and **A2-05** production value need a live check.

