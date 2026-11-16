# Audit fixes: payment on a cancelled order and seven smaller findings

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
- Tests: two in `razorpay-checkout.int.test.ts` (late payment recorded and alert queued once; the job alerts the owners and sends no confirmation), `team-access.int.test.ts` (audit row; two-owner race smoke check). Audit files updated.

## Decisions and trade-offs
- **Late payment keeps the order cancelled.** Reinstating it would need stock that may be gone; the merchant decides (refund, or restore the order). The order carries the original `PEND-` number because it never got a real one.
- **No new queue.** The alert rides on the existing order job with a flag, so the worker and the jobs table in the docs do not change.
- **A2-04 is not proven by a test.** The race is rare; the two-owner test passed three times with the lock removed. The fix rests on how Postgres re-checks a locked row, and the test is labelled a smoke check.
- **A3-07 limit** 9,999 per line is far above any real order and below the integer limit. Tell me if a store sells in larger units.

## Verification
- Ran against the local test Postgres (Docker): `razorpay-checkout` 8 pass, `team-access` 2 pass; the full domain heavy suite, `@bs/domain` fast tests and `@bs/web` fast tests: see the PR for the final counts. Typecheck and lint of all 17 packages pass (0 errors).
- Exercised by hand: nothing in a browser. The new notification was not viewed in the admin inbox or the Super Admin events matrix.
- NOT verified: a real provider webhook for a cancelled order; the email text; that the Super Admin notification matrix lists the new event correctly.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed (no route, table, queue, env var or migration changed)
- [ ] ADR: not needed
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [ ] `progress.md`: not needed

## Follow-ups and open questions
Not fixed, with the reason:
- A1-01 RLS on shared tables (needs a migration and a grants review), A1-03 pending custom domains block a hostname (product decision), A1-04 and A2-01 (signature changes across many callers), A2-06 (phone sign-in is not live), A3-04 rate limits and bot check (hardening item 1.7), A3-06 job enqueue inside the transaction (needs design), A4-02 invalid-signature webhooks are kept so a misconfigured secret can be diagnosed (decision).
- A3-05 (customer-only discounts) is an owner decision. A1-02 and A2-05 need a live check.

## Definition of done
- [x] Code follows section 2 and 3; tests added (real database).
- [x] No docs trigger; no secrets or generated files.
- [ ] After merge: record updated, branch and worktree removed.
