# Cart, mini cart and checkout redesign; offers as coupon cards

- **Date:** 2026-11-08
- **Agent:** claude
- **Branch:** `feat/cart-redesign` (merged in #248, ac9e470; deployed, all jobs of the main run passed)
- **Area:** `apps/web` (cart page, mini cart, checkout summary, product page), `packages/domain` (storefront coupons and product offers)
- **Type:** feat
- **Supersedes:** none (reworks the UI of `2026-11-08-claude-offer-ui.md`)

## Summary
After seeing the first version live the owner asked for: offers shown as the existing coupon cards on the product page (the ones for the product first, the rest in the View all drawer) instead of a single line; compact cart lines that read "weight, price x quantity"; the free item as its own line below the item the shopper chose (price 0 x 1), not a card above; the mini cart without the reassurance row; checkout lines with weight x quantity and the free line below with a small saving badge; on the cart page the free-shipping card moved to the top of the order summary column, the shipping estimator and the trust lines removed; all good on a phone.

## What changed
- `cartRows`: a line with free units becomes the shopper's own quantity plus a free line right under it. Used by the cart page (`CartItemRow`, `FreeItemRow`), the mini cart and the checkout summary.
- Cart page: compact rows (picture, name, weight, price x quantity, stepper, Remove, line price; stacks on a phone); free-shipping and next-offer cards at the top of the summary column; `ShippingEstimator` deleted; trust lines no longer drawn.
- Mini cart: price x quantity, free line below, one-line "Offer unlocked" note above the free-shipping bar, reassurance row removed, total now net of offers (it showed the subtotal before).
- Checkout: weight x quantity per line, free line below with "Offer unlocked, save X" badge and FREE.
- Product page: automatic offers are cards like coupon codes ("Applied automatically", no copy button), merged with the coupon cards; product-specific first. `getStorefrontCoupons` and `getStorefrontProductOffers` now list everything with an `appliesHere` flag instead of hiding what does not apply to the product. The single-line bar (`ProductOfferBar`) is gone; the live "Offer unlocked" card stays under the cards.

## Decisions and trade-offs
- The "Offer unlocked" notice also exists on the product page (card under the coupon cards when the shopper's cart has earned it): kept from the earlier request, say if it should go.
- The theme options `showTrustPoints` and `showShippingEstimator` no longer have any effect on the cart page (their screens still exist in the theme editor).
- Cart lines no longer show the SKU.
- Behaviour change: a coupon made for other products is now listed on a product page (after the ones for it) instead of hidden.

## Verification
- typecheck and lint 17/17; web tests (new `free-items-ui.test.tsx`, updated mini cart and cart tests) and the domain tests for coupons and offers pass; build ok; product page JS 47.51 KB of 50 (budget test passes).
- **Live check (production, brandsewa, 2026-11-08, owner's go-ahead), desktop and a 375 px phone:** product page showed "Available offers" with the offer as a coupon card ("Buy 2 Get 1 Free", "Applied automatically") and the unlocked card under it. Cart page: paid line "200g, 180 x 2" 360, the free line below ("0 x 1", FREE, "Offer unlocked: ... save 180"), the free-shipping card at the top of the order summary column, no estimator, no trust lines, estimated total 360. Side cart: compact lines, free line, one-line note above the shipping bar, no reassurance row, Total 360. Checkout: "200g x 2, 180 each" 360, free line below with a small badge and FREE, total 459. Phone: no horizontal overflow on checkout; cart, product page and side cart read cleanly. Right after the deploy the site answered 503 for under a minute while the containers swapped.
- Seen: on a phone the offer name in the free-line badge is cut with an ellipsis when long.

## NOT verified
- Placing an order (checkout totals were read, no order was placed).

## Docs updated
- [x] `docs/ARCHITECTURE.md` section 22 (showing the offer); no migration, env var or pipeline change
