# Checkout re-checks every cart line against the catalog (audit A3-01, A3-02)

- **Date:** 2026-11-15
- **Agent:** claude
- **Branch:** `fix/checkout-revalidate-cart` (merged in #276, f3f6b32; main run and production deploy succeeded)
- **Area:** domain (storefront cart, checkout)
- **Type:** fix
- **Supersedes:** none

## Summary
The platform audit found that an order was charged the price saved when the item entered the cart, and that a product unpublished or deleted afterwards could still be ordered. Checkout now compares each line with the catalog before placing the order.

## What changed
- `packages/domain/src/storefront/cart.ts`: new `revalidateCartLines`. For each line it runs the same check used when adding to a cart (`resolveVariantForCart`: published, not deleted, visible and priced in the cart's market, state price). A line that fails is removed; a line whose price differs gets the current price. It runs in its own transaction so the correction is saved.
- `packages/domain/src/orders/checkout.ts`: `placeOrder` calls it first. If a line was removed or repriced, the order is refused with a Bad Request message (item no longer available, or price changed, please review the cart). The shopper's next view of the cart shows the corrected state, and placing the order again succeeds.
- `packages/domain/test/checkout-cart-revalidation.int.test.ts` (renamed from `audit-checkout-probes.int.test.ts`): the three `it.fails` probes became regular tests; the control stays.
- Audit files marked fixed.

## Decisions and trade-offs
- **Refuse once, do not charge silently.** Charging a different amount than the cart showed is worse than one extra click. The correction is saved before the refusal, so there is no loop.
- **Free-item lines added by an offer** go through the same check; if their product is withdrawn they are removed like any other line and the shopper is told.
- **Not done:** the cart page itself still shows the saved price until checkout is attempted, so a shopper can see an old price in the cart and learn of the change at the order step. Refreshing on every cart load would also fix that; left out to keep this change small. See follow-ups.

## Verification
- Ran: `checkout-cart-revalidation`, `checkout-place-order`, `discount-checkout`, `storefront-cart` (4 files, 28 tests pass); all related integration suites serially (checkout, cart, markets-checkout, discounts, abandoned, stripe, razorpay, state-pricing, preorder, held: 15 files, 131 tests pass), against the local test Postgres. Typecheck, lint and the pre-push gate results are in the PR.
- Exercised by hand: nothing in a browser. The storefront checkout page shows the Bad Request message through the existing error path; not seen on screen.
- NOT verified: the message in the checkout UI; a cart with a free-item offer line whose product was withdrawn.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed, no structure changed
- [ ] ADR: not needed
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [ ] `progress.md`: in-flight line for the audit branch already lists this stack

## Follow-ups and open questions
- Refresh prices on every cart load so the cart page never shows a stale price (small, touches the cart read path used by every storefront page; needs the product page JS budget check).
- Confirm in a browser that the error text appears on the checkout form.

## Definition of done
- [x] Code follows section 2 and 3; tests added (real database).
- [x] No docs trigger; no secrets or generated files.
- [x] After merge: record updated, branch and worktree removed.
