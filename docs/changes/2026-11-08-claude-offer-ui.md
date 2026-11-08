# Showing free-item offers to the shopper

- **Date:** 2026-11-08
- **Agent:** claude
- **Branch:** `feat/offer-ui`
- **Area:** `apps/web` (cart page, mini cart, checkout summary, product page), `packages/domain` (storefront product offers)
- **Type:** feat
- **Supersedes:** none (follows `2026-11-08-claude-discount-auto-add.md`)

## Summary
The owner saw that the free item is added correctly, but a shopper who raises the quantity does not know where the extra item came from and may think it was added by mistake. Asked for: an "Offer unlocked" card with the free product above the free-shipping bar in the side cart, the same on the checkout, and on the product page a promotion bar ("Buy 2 Get 1 Free") under Add to cart that turns into an unlocked card with a small picture, price and saving once the offer is earned.

## What changed
- `FreeItemsCard`: "Offer unlocked: <offer name>", the free product's picture, name, FREE, normal price crossed out and the saving. Shown on the cart page (above the free-shipping bar), in the mini cart (above its free-shipping bar) and at the top of the checkout summary; the checkout item row also says "N free with your offer".
- Product page: `ProductOfferBar` (server-rendered) under the Add to cart row, fed by `getStorefrontProductOffers` (new, cached with the product): automatic buy-x-get-y offers the product can earn, worded "Buy 2 Get 1 Free" or "Spend X, get <gift> free", with "added to your cart automatically". `OfferSlot` loads `ProductOfferLive` (the same card from the live cart) only when the cart count cookie shows a cart or after an add to cart.
- No new theme element: the bar is part of the existing Add to cart (`actions`) element.

## Decisions and trade-offs
- The product page JS budget (50 KB gzip) had 1.7 KB of room. The bar is server-rendered; the live part and the mini-cart card are lazy chunks. Measured 48.49 KB after (was 48.23): +267 bytes; the budget test passes.
- The unlocked state on the product page shows the shopper's cart's free items, not only those of this product's offer (simplest, and what the shopper wants to see).
- The bar is shown for every automatic offer the product can earn, including ones that do not add items by themselves (then without the "added automatically" note).

## Verification
- `pnpm typecheck` and `pnpm lint`: 17/17. Web production build ok; `perf-budget-bundle.int.test.ts` passes (48.49 KB).
- New: `apps/web/test/free-items-ui.test.tsx` (card, cart page, checkout summary, promotion bar), `discounts-autoadd.int.test.ts` (offers worded for the product page, real database, 14 tests in the file).
- See the PR for CI. The live check on the production store is recorded in the PR or the next record.

## NOT verified
- Not looked at in a browser yet (done after deploy, on the live store, with the owner's go-ahead).

## Docs updated
- [x] `docs/ARCHITECTURE.md` section 22; no migration, env var or pipeline change
