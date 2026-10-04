# Fixes from a live walkthrough of the Orders work

- **Date:** 2026-10-03
- **Agent:** claude
- **Branch:** `fix/live-test-findings`
- **Area:** domain, web, blocks, docs
- **Type:** fix
- **Supersedes:** none

## Summary
After the Orders work reached production, Claude drove the live admin and storefront of a test store (create order, confirm, ship with carrier and tracking, deliver, storefront COD checkout, customer return request, admin return review, manual refund cap, exchange, close, pre-order, price on request, quote form). Everything below was found that way and is pinned by a test.

## What changed
- **COD cash was never collected on orders created in the admin.** They recorded their payment as `created`; delivery only collected `cod_pending`, so a delivered order stayed "COD pending" and never counted as revenue. New admin COD orders now record `cod_pending` like a storefront checkout, and delivery collects every open COD payment, repairing already-stuck `created` rows in place (the payment state machine, which has no `created -> cod_pending` step by design, is unchanged).
- **"Partially fulfilled" on a fully shipped order.** The roll-up called anything shipped-but-not-delivered partial. It now compares units shipped with units ordered: all shipped reads fulfilled, a split order stays partial.
- **Unfulfilled tab listed cancelled orders.** Cancelled and returned orders are excluded.
- **Price on request destroyed the price.** Turning it on overwrote every variant price with 0, and turning it off did not restore them (the real price of a live product was lost). The flag alone now does the job (the storefront hides the price; cart and checkout already refuse the product); prices are left alone, on create and update.
- **Related products showed "₹0" for a price-on-request product.** Theme block cards now receive `priceOnRequest` and show "Price on request".
- **Quote requests (and any public storefront form) failed with "Origin not allowed" for a signed-in store owner.** The staff-cookie CSRF guard also covered `/api/storefront/*`, and the admin cookie is scoped to the parent domain, so it rode along to the storefront. The guard is now a tested pure function (`apps/web/src/server/csrf.ts`) that exempts the public storefront API.
- **Customer order status page printed raw values** ("PENDING", "Payment: cod_pending"); it now uses the shopper wording, and `describePayment` handles `cod_collected`, `partially_refunded`, `failed`.
- **Pre-order notice was unreadable** on a browser in dark mode (light text on a light page from `dark:` variants); removed on that notice.

## Decisions and trade-offs
- Price-on-request no longer rewrites prices. A store that already switched a product on has prices at 0 and must re-enter them; this cannot be recovered by code.
- Existing orders stuck as "COD pending" are fixed at their next delivery step, not by a data migration.

## Verification
- Ran in the worktree: typecheck, lint, build, docs:check, contracts, domain fast, admin, web, blocks and `@bs/domain test:heavy` (results in the hand-off message).
- Exercised by hand on the live store before the fix: every defect above reproduced; the fix itself is verified by tests, not yet re-run against production.
- NOT verified: the live walkthrough was not repeated after deploy; the admin "Convert quote to order" step and the quote form could not be run end to end live (the form was blocked by the CSRF bug, now fixed).

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed (one small server helper, no structure change)

## Follow-ups and open questions
- Not fixed, reported: "Mark shipped" is not disabled for a held pre-order (the server refuses it and says so); Settings > Orders only has the numbering section though its menu text promises more; admin return sheet says "Replacement" where the customer sees "Exchange"; the Refund/Exchange choice in the portal has no visible selected state; breadcrumbs differ between order pages; the storefront uses `dark:` classes in several components though its pages are light only; the first storefront visit after a product edit can show the old page.
- Owner: a live test store now contains clearly labelled test records (ORD-00003 to ORD-00005, return RET-0001, test customers).

## Definition of done
Gate and tests as listed; no secrets, no generated files.
