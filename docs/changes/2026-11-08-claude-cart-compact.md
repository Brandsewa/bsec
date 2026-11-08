# Three-column cart lines, Offer tag, unlocked card on top

- **Date:** 2026-11-08
- **Agent:** claude
- **Branch:** `feat/cart-compact` (merged in #249, a2a9c1c; deployed, all jobs of the main run passed)
- **Area:** `apps/web` (cart page, mini cart, checkout summary, product page)
- **Type:** feat
- **Supersedes:** none (refines `2026-11-08-claude-cart-redesign.md`)

## Summary
The owner reviewed the live cart redesign and asked for: the "Offer unlocked" card at the very top of the product page (above the title) once the offer is earned; cart lines restructured into three columns (picture with a small x to remove; name over "variant x price x quantity"; quantity buttons over the price); and on the checkout, the free item to say just "Offer" in a green pill after the product name instead of "Offer unlocked, save X".

## What changed
- `CartItemRow` and the mini cart rows: column 1 the picture with an x button on its corner (the text "Remove" is gone); column 2 name, then "200g × ₹180 × 2"; column 3 the stepper, then the line price.
- `FreeItemRow` and the mini cart free row: same columns, a green "Offer" tag after the name, FREE in the price slot.
- Checkout summary: the free row has the "Offer" tag on the name's row and FREE; the saving badge is gone.
- Product page: `OfferSlot` moved from under the coupon cards to the top of the buy box, above the title.

## Verification
- typecheck and lint 17/17; web tests 248 passed (two updated for the new layout); build ok; product page JS 47.53 KB of 50.
- **Live check (production, brandsewa, 2026-11-08, owner's go-ahead):** product page: the "Offer unlocked: Buy 2 Dalle get 1 free" card at the top of the buy box above the title, then the title, and "Available offers" below Add to cart. Cart page and side cart: three columns (picture with a small x; "200g x 180 x 2" under the name; stepper over 360), the free line below with a green "Offer" tag after the name and FREE; the 375 px phone cart reads the same with no cut-off. Checkout: the free row shows the name with an "Offer" tag, "200g x 1" and FREE, no saving badge; Place Order 459. No order placed.

## NOT verified
- Placing an order (checkout totals were read, no order was placed). Phone view was checked for the cart page only.

## Docs updated
- [x] `docs/ARCHITECTURE.md` section 22; no migration, env var or pipeline change
