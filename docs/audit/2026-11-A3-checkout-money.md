# Audit A3: checkout, orders and money

- **Date:** 2026-11-15
- **Auditor:** claude
- **Plan:** `docs/PLATFORM-AUDIT-PLAN.md` section A3
- **Code audited:** `main` e152e4b plus the dependency bumps of PR #274
- **How:** code read, existing tests read, and new real-database probes in `packages/domain/test/audit-checkout-probes.int.test.ts`, since renamed `checkout-cart-revalidation.int.test.ts` when A3-01 and A3-02 were fixed (local test Postgres). Nothing was run against production.

## Result

Two defects are confirmed by test, one more by reading the code. A shopper cannot send a price to the server, and totals, shipping, payment method and stock are decided server-side. The gap is that checkout trusts what the cart saved earlier instead of the catalog as it is now.

| ID | Severity | Title | Status |
|---|---|---|---|
| A3-01 | High | An order is charged the price saved when the item entered the cart, not the current price | fixed in `fix/checkout-revalidate-cart`, test `checkout-cart-revalidation.int.test.ts` |
| A3-02 | Medium | A product that was unpublished or deleted can still be ordered from an old cart | fixed in `fix/checkout-revalidate-cart`, same test file |
| A3-03 | Medium | Turning off guest checkout blocks every order, including signed-in customers | open, from code |
| A3-04 | Medium | Order placement has no per-visitor limit and no bot check | open, from code |
| A3-05 | Low (owner decision) | "For these customers only" discounts go to anyone who types that customer's email or phone | by design today |
| A3-06 | Low | The order-created job is sent after the payment transaction commits, not inside it | open, from code |
| A3-07 | Low | Cart quantity has no upper limit | open, from code |
| A3-08 | Low | The place-order route builds its own context with a staff role | open, from code |

## Findings

### A3-01 Orders are charged the cart's saved price, not the current price (High)

- **Rule:** rule 12 ("prices and totals are recomputed on the server at checkout").
- **Where:** `packages/domain/src/storefront/cart.ts:213` (line total from `unit_price_snapshot`), `:506-523` (snapshot written only when an item is added), `packages/domain/src/orders/checkout.ts:249` (`subtotal = cart.subtotal`). The snapshot is refreshed only when the shopper changes market or state (`repriceCartToMarket`, `repriceCartToRegion`).
- **Reproduce (before the fix):** `audit-checkout-probes.int.test.ts`, "a price raised after the item went into the cart is the price charged". A variant priced 10.00, 2 in the cart; the merchant corrects the price to 1,000.00; `placeOrder` returns subtotal 2,000 minor units where 200,000 is expected.
- **Expected:** the order uses the variant's price at the moment of ordering (or the shopper is told the price changed).
- **Actual:** the old price is charged. The cart cookie lasts 30 days and an abandoned cart can still be opened, so the window is at least a month.
- **Impact:** a merchant who fixes a pricing mistake, or ends a sale by raising the price, keeps selling at the old price to anyone who already has the item in a cart. A shopper can keep a cart on purpose. It also works the other way: a price cut is not given to existing carts.
- **Suggested fix (M):** in `loadCartWithItems` (or at least in `placeOrder` with `strict`), re-resolve each line through `resolveVariantForCart` and write the fresh price back; if it differs, block the order once with "prices in your cart were updated" the same way `cart.discountNotice` does.

### A3-02 Unpublished or deleted products can still be ordered (Medium)

- **Where:** `packages/domain/src/orders/checkout.ts:412-430`: the variant lookup at checkout joins `products` without the status and `deleted_at` filter that `resolveVariantForCart` (`cart.ts:561`) applies when adding.
- **Reproduce:** same test file, "a product taken off sale ..." and "a deleted product ...". Add to cart, set the product to `draft` (or set `deleted_at`), `placeOrder` succeeds.
- **Expected:** the order is refused with a clear message, or the line is removed.
- **Impact:** a merchant withdraws a product (recall, legal, out of season) and still receives orders for it.
- **Suggested fix (S):** the same re-resolve as A3-01 covers it.

### A3-03 Turning off guest checkout blocks every order (Medium)

- **Where:** `packages/domain/src/orders/checkout.ts:311` (`if (!checkoutSettings.guestCheckout && !input.customerId) throw`), and `apps/web/src/app/api/storefront/checkout/place-order/route.ts:136-159`, the only caller, which never reads the customer session and never passes `customerId`.
- **Steps:** Admin, Settings, Checkout: switch "Guest checkout" off. Sign in as a customer on the storefront and place an order.
- **Expected:** signed-in customers can order; guests are asked to sign in.
- **Actual (from code, not run in a browser):** every order fails with "Guest checkout is not permitted for this store".
- **Side effect of the same gap:** a signed-in customer's order is linked to a customer record by the email typed in the form, not by who is signed in.
- **Suggested fix (S):** read the customer cookie in the route (`currentCustomer`) and pass its id; add a route-level test.

### A3-04 Order placement has no per-visitor limit and no bot check (Medium)

- **Where:** `place-order/route.ts:76`: only `checkStorefrontRateLimit`, a store-wide counter.
- **Impact:** a script can place cash-on-delivery orders as fast as the store-wide limit allows. Each one holds stock for the hold period, takes an order number, creates a customer record and queues notifications. It can also use up the store's shared request quota so that real shoppers get 429.
- **Already known:** go-live hardening plan item 1.7. Listed here so it is not lost.
- **Suggested fix (M):** per-IP and per-phone limits on place-order and pay, Turnstile on the public checkout.

### A3-05 Customer-only discounts go to whoever types the customer's contact (Low, owner decision)

- **Where:** `packages/domain/src/orders/checkout.ts:216-227`: the shopper is identified by the email or phone typed at checkout. The existing test `discounts-engine.int.test.ts:408` encodes this as intended behaviour.
- **Effect:** a code limited to chosen or tagged customers, or to new customers, can be used by anyone who knows an eligible person's email or phone; the use counts against that person's limit. The same lookup attaches the guest's order to that person's customer record.
- **Options:** accept (most small stores work this way), or require sign-in for codes with a customer condition.

### A3-06 The order-created job is sent after commit (Low)

- **Rule:** rule 13 ("enqueue jobs inside the business transaction").
- **Where:** `packages/domain/src/payments/razorpay-checkout.ts:265-268`: `commitReservation` and `jobs.send(ORDER_CREATED)` run after `withTenant` returns.
- **Impact:** if the process stops between the commit and the send, a paid order never gets its confirmation email or downstream work, and its stock stays reserved instead of committed. Nothing retries it, because the next webhook sees "already paid".
- **Suggested fix (S):** enqueue inside the transaction (pg-boss shares the database), or make "already paid" re-send when the job was never recorded.

### A3-07 Cart quantity has no upper limit (Low)

- **Where:** `apps/web/src/app/api/storefront/cart/items/route.ts:23` (`z.number().int().positive()`), `cart.ts:485`.
- **Impact:** a quantity near 2,147,483,647 overflows the integer column on the next increment and returns a 500; very large line totals pass the safe integer range. Stock checks stop a real order, so this is robustness, not money.
- **Suggested fix (S):** `.max(9999)` in the schema and the same bound in `addToCart` and `updateCartItemQuantity`.

### A3-08 The place-order route builds its own context (Low)

- **Where:** `place-order/route.ts:101-108`: `actor: system`, `roles: ["store_admin"]`, `permissions: ["products.read"]`. Other storefront routes do the same.
- **Impact:** none found. It bypasses `buildTenantContext`, so a later change that trusts `ctx.roles` in a storefront path would treat every shopper as store staff.
- **Suggested fix (S):** one `storefrontContext(access)` helper that returns an anonymous or customer actor with no roles.

## Checks that passed

| Check | How | Result |
|---|---|---|
| The client cannot send a price, total, tax or shipping amount | read the route schema and `placeOrder` | pass: only a cart token, address, method ids |
| Shipping method must be one of the server-computed rates for that address | read `checkout.ts:251-262` | pass |
| Payment method must be active for the store and market | read `checkout.ts:263-290` | pass |
| Cash-on-delivery fee, minimum and maximum from store settings | read | pass |
| An applied code that is no longer valid blocks the order instead of changing the price | existing `discount-checkout.int.test.ts:150` | pass (existing test, not re-run) |
| A usage-limited code under 50 parallel orders | existing `discounts-concurrency.int.test.ts` | pass (existing test, not re-run) |
| Same idempotency key, parallel calls, one order | existing `checkout-place-order.int.test.ts:195` | pass (existing test, not re-run) |
| Blocked customers cannot order; existing customer name and phone are not overwritten by a guest | read `checkout.ts:505-530` | pass |
| An unchanged cart is charged the catalog price | new control test | pass |

## Not checked

- Rounding and tax arithmetic (GST engine, market tax rules), multi-market currency conversion.
- The order, fulfilment and return state machines; refunds above the paid amount; partial shipments.
- Oversell under parallel checkouts (an existing test covers reservation; not re-read).
- State pricing, pre-orders, quotes and returns against their plans.
- Whether every money mutation writes `audit_logs`.
- Admin order edits after a payment intent exists.
