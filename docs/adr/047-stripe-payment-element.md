# ADR-047: Stripe Payment Element inline at the store checkout

- **Status:** Accepted (owner decision 2026-11-15: card fields inline in the checkout page, for conversion)
- **Date:** 2026-11-15
- **Supersedes:** the Stripe Embedded Checkout part of ADR-046 (point 2). The rest of ADR-046 (Razorpay window, platform billing gateways, refunds) stands.

## Context
ADR-046 put Stripe's Embedded Checkout in a panel that opened after Place Order. Shoppers expect what Shopify shows: the card fields inside the Payment Method section, then one button. A panel over the page adds a step and shows Stripe's own order summary beside ours.

## Decision
- Stripe with a publishable key uses the **Payment Element** on a **PaymentIntent**, mounted inside our Payment Method card with a **deferred intent** (`elements({ mode: "payment", amount, currency })`), so the fields appear before the order exists. The amount follows the order total on the page; the server still recomputes it.
- Place Order checks the fields (`elements.submit()`), places the order, creates the PaymentIntent for it (`uiMode: "elements"`, metadata `tenant_id` and `order_id`, idempotency key `bsec-pi-<order id>`), then confirms it on the page. Stripe redirects to our return route, which settles from the PaymentIntent read with the store's key. The `payment_intent.succeeded` webhook is the backstop; the merchant subscribes to it.
- A refused card keeps the held order and its PaymentIntent: the button becomes "Try payment again" and confirms the same payment; "Cancel this order and start over" releases it. A cancelled PaymentIntent is replaced under a new idempotency key.
- The PaymentIntent id is stored in `payment_intents.provider_order_id` (as the Checkout Session id was). Refunds use it as the payment id.
- Without a publishable key nothing changes: the hosted Checkout redirect.
- Card data stays in Stripe's iframe, so our PCI scope is unchanged (SAQ A). Stripe.js is loaded only when the shopper picks Stripe; the product-page JavaScript budget is untouched.

## Consequences
- The merchant's Stripe webhook must also send `payment_intent.succeeded` (DEPLOYMENT.md updated).
- The deferred amount must match the PaymentIntent. A difference (a rate that changed between page load and Place Order) makes Stripe refuse the confirm; the shopper sees the message and the order is held.
- Orders placed with the Embedded Checkout panel (ADR-046) and still unpaid keep working: their saved id starts with `cs_`, so "Pay now" creates a PaymentIntent for them.
- Unpaid online orders are still not expired automatically (R1).

## Alternatives considered
- Keep Embedded Checkout: simpler code, but a panel and a second order summary.
- Create the order before showing the fields: avoids the deferred intent, but leaves an unpaid order for every shopper who only looked at the payment section.
