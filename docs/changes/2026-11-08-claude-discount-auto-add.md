# Free items added to the cart automatically

- **Date:** 2026-11-08
- **Agent:** claude
- **Branch:** `feat/discount-auto-add`
- **Area:** `packages/domain` (cart, discounts, admin), `packages/db` (migration 0104), `packages/contracts`, `apps/web` (cart row), `apps/admin` (offer form)
- **Type:** feat
- **Supersedes:** none (follow-up to `2026-11-07-claude-discounts-engine.md`, which listed this as not built)

## Summary
The owner tried buy-x-get-y on the live store: the coupon could be created, but adding two products did not bring the free third item into the cart or checkout, and a "spend over 2,000, get a product free" offer needed the same. The first release only made a free item free once the shopper had added it. Now the store adds it: with two of the product in the cart a third appears and shows free, and a cart over the spend gets the gift, on the cart page and at checkout.

## What changed
- `syncAutoFreeLines` (`storefront/cart.ts`) keeps the free items in the cart after every cart change, when a cart is opened and when an order is placed; `planAutoAdds` / `hasAutoAddWork` (`orders/discounts.ts`) decide what to add; `autoFreeSets` (`discounts/bxgy.ts`) counts how often the shopper's own items earn the offer.
- Migration 0104: `cart_items.auto_free_qty` (expand-only). The shopper's own quantity of a line is `quantity - auto_free_qty`.
- Rules: `bxgy.autoAdd` (contract `discount-rules.ts`); on by default for a free offer, so offers already created on the store start adding items without editing. Only a free offer can add items (validated on save). Admin offer form has the checkbox "Add the free items to the cart automatically".
- Cart row shows "Free item added for you" / "Includes N free item".
- A typed code for such an offer is accepted when the items it needs are one free item away, and adds the item.
- Also fixed: collection scopes inside buy-x-get-y and bundle parts were not given their membership data by the loader.

## Decisions and trade-offs
- For "buy 2 get 1 free" on the same items, the free item is another of the cheapest line the shopper chose; with 3 of their own they get 1 free (4 in the cart), with 4 they get 2 free.
- For a gift of a chosen product: the first sellable, in-stock variant. Not added when out of stock. If the shopper already has the gift product it becomes one more of it, free.
- A quantity the shopper sets that is at or below the free count is read as their own quantity; pressing minus on 3 (2 own + 1 free) leaves 1.
- Removing the line removes its free items; they return on the next change only while the buy part is still met.
- Gift by collection (not chosen products) is not added automatically; the offer still works when the shopper adds the item.

## Verification
- New real-database tests `discounts-autoadd.int.test.ts` (12): third item, quantity changes, checkout charges one unit free and reserves three, removal, offer turned on or off while a cart is open, `autoAdd: false`, a code that adds the item, spend gift appears and disappears, gift free at checkout, shopper already has the gift product, gift out of stock, validation.
- Existing discount, cart, checkout and isolation suites rerun: 1876 passed.
- See the PR for CI. The live check on the production store is recorded below once done.

## NOT verified
- The admin form checkbox and the cart row text were checked by typecheck and lint only until the live check below.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (section 22, migration 0104), `docs/DISCOUNTS-PLAN.md` section 9
- [x] No env var, service or pipeline change
