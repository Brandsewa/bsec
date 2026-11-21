# Signed-in customers can order when guest checkout is off (audit A3-03)

- **Date:** 2026-11-16
- **Agent:** claude
- **Branch:** `fix/checkout-signed-in-customer` (merged in #278, 5b673b0; main run and production deploy succeeded)
- **Area:** web (storefront checkout route), tests
- **Type:** fix
- **Supersedes:** none

## Summary
The store setting "Guest checkout" (Admin, Settings, Checkout) makes `placeOrder` require a customer id. The place-order route never read the customer's session cookie, so it never passed one, and every order on such a store failed with "Guest checkout is not permitted", signed in or not. The route now passes the customer behind the session cookie.

## What changed
- `apps/web/src/app/api/storefront/checkout/place-order/route.ts`: reads `bs_customer_token` with `getCustomerBySession` (the same lookup the account pages use: active customer, unexpired session) and passes `customerId` to `placeOrder`. The id comes only from the verified session, never from the request body.
- A signed-in customer's order is now linked to that account, where before it was linked by the email typed into the form.
- `packages/domain/test/checkout-guest-off.int.test.ts` (real database): with guest checkout off, an order with no customer is refused and one with a signed-in customer is placed and linked to the account.
- `apps/web/test/cart-checkout.test.ts`: the route passes the session customer to `placeOrder`; a forged cookie gives no customer, and a `customerId` in the body is ignored. Confirmed to fail without the route change.
- Audit files marked fixed.

## Decisions and trade-offs
- No change to `placeOrder` itself: its check was correct, its caller was incomplete.
- Guests on a store with guest checkout on behave exactly as before (no cookie, no customer id).
- The storefront checkout page does not yet tell a signed-out shopper on such a store to sign in before they fill in the form; they find out when they submit (the existing message). That is a UI change and was left out.

## Verification
- Ran (local test Postgres, Docker): `checkout-guest-off.int.test.ts` 2 pass; `apps/web` `cart-checkout.test.ts` 23 pass; with the route change reverted the new route test fails (expected undefined to be 'cust-signed-in'). Typecheck, lint and gate results are in the PR.
- Exercised by hand: nothing in a browser; not driven end to end with a real cookie.
- NOT verified: the full sign-in then checkout flow on a running store.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed
- [ ] ADR: not needed
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [ ] `progress.md`: not needed (small, merged quickly)

## Follow-ups and open questions
- Show a "sign in to continue" prompt on the checkout page when guest checkout is off and nobody is signed in.

## Definition of done
- [x] Code follows section 2 and 3; tests added (real database and route level).
- [x] No docs trigger; no secrets or generated files.
- [x] After merge: record updated, branch and worktree removed.
