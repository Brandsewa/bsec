# ADR-040: Markets: one base market plus extra markets, merchant as seller of record

- **Status:** Accepted
- **Date:** 2026-10-28
- **Plan reference:** `docs/MULTIMARKET-PLAN.md` (extends ADR-002, ADR-004, ADR-008, ADR-013)

## Context
A store sells in India only: currency, prices, shipping, tax, returns and the payment gateway are single per-store values (`INR` is the column default in about a dozen tables). The owner wants stores to sell in other countries (India, USA, Canada first), with their own currency, prices, catalog, gateway, shipping, policies and taxes, and for a shopper to be placed in the right market automatically. Brand Sewa must not become a regulated party in the merchant's sales.

## Decision

### 1. Model
- A **market** is a set of countries sharing one currency and one set of selling rules. Every store has exactly one **base market** (from `tenants.country/currency`); more can be added up to the plan limit (extra markets on top of the base: Starter 1, Growth 2, Enterprise 5). A country belongs to at most one market per store; the currency belongs to the market, not the country.
- New tenant tables (`markets`, `market_countries`, `market_prices`, `market_products`, `market_payment_methods`, `market_policies`, `market_tax_rules`, `market_fx_history`) use `tenantTable()` and `forceRlsSql`. Country support is data in a platform table (`platform_countries`), seeded with IN, US, CA.
- The base currency is locked after the store's first order.

### 2. Money
Integer minor units plus an ISO currency code, never floats. Column names ending `_paise` stay and mean "minor units of the row's currency". One pricing function (derived = `round(base * rate * (1 + adjust))`, then the market rounding rule, or a fixed per-variant override) is used by catalog, cart and checkout. Checkout recomputes everything on the server. An order stores its charged currency, the exchange rate used and the base-currency total; finance reports use the base-currency total. Exchange rates are **merchant-entered** in v1, each change audited. Tax is computed per line in minor units, half-up, then summed.

### 3. Market resolution
Order: URL prefix (`/us`), the shopper's signed cookie, the Cloudflare `CF-IPCountry` header (only when the request is proven to come through Cloudflare), then the base market. Location only **suggests** (a banner); there is no forced or silent redirect, and bots are never redirected. Authority for pricing is the market stamped on the cart by the server, never the header. v1 uses subfolder URLs on the store's existing host; market domains come later. `market` is an argument of the cached storefront loaders; cache tags stay tenant-prefixed (ADR-004).

### 4. Brand Sewa stays a software provider (the v1 compliance stance)
- The merchant is the seller of record; their name and tax numbers appear on checkout and invoices.
- Each store connects its **own** gateway account (Razorpay, Stripe, PayPal). Money goes from the shopper to the merchant. We use no Stripe Connect or PayPal marketplace flow, take no fee from orders, split no payments, hold no balances and make no payouts, so we do not pool funds (the line that makes a payment aggregator under RBI rules).
- No card data on our pages: hosted Stripe Checkout, PayPal approval redirect, Razorpay's existing modal.
- Tax rates, registrations, policies and export treatment are merchant-entered and merchant-owned; we pre-fill no rates and give no advice. Duties and import taxes are not collected (shopper pays on delivery, stated at checkout). A required acknowledgement is audited.
- Any feature that takes a fee from orders, collects duties, or settles funds needs a new ADR and legal review first.

### 5. Gateways
PayPal joins Razorpay and Stripe (owner decision 2026-10-28, rule 14 updated). A market lists which gateways it offers (`market_payment_methods`); a gateway's availability depends on the merchant's country and the market currency (Stripe is invite-only in India, so Indian merchants use Razorpay for INR and PayPal for foreign currencies). Sandbox/test mode only until the owner approves live mode.

### 6. Brand Sewa's own billing
Indian merchants see rupees and pay by Razorpay (unchanged). Global merchants see USD and pay by PayPal (USD only). Platform PayPal credentials are platform secrets, never in `tenant_secrets`.

## Verification notes (Phase 0)
- PayPal publishes a REST currency list that depends on payment type and receiving account; some currencies are limited to in-country accounts ([PayPal currency codes](https://developer.paypal.com/api/rest/reference/currency-codes/)). The connect screen and the market editor must check the market currency against the gateway and the account.
- **Not verified, to settle in the Phase 4B sandbox:** that PayPal Subscriptions is available to an India-registered platform account. Fallback if not: Orders v2 with a payment link per billing cycle driven by our existing dunning schedule.
- Not verified: Razorpay international currency list for the owner's account (Razorpay's own page lists about 19 currencies for PayPal-through-Razorpay, a different product).

## Consequences
- Easier: adding a country or market is data and configuration; finance stays in one base currency.
- Harder: every price, discount and shipping amount needs a currency; fixed-amount discounts apply only where the market currency equals the base currency in v1; `₹` and `en-IN` are hardcoded in about 100 files and must go (Phase 1).
- Enforce: isolation suite mapping for `admin.markets.*`; real-database tests for currency/amount checks at settlement; a cache test showing two markets never share a price.

## Alternatives considered
- **One store per country:** duplicates catalog and orders; rejected.
- **Adaptive Pricing / merchant of record (Stripe, Global-e):** fees, onboarding, and a regulated role for the provider; deferred.
- **Country-specific tax code:** needs constant upkeep and liability; rejected for v1 in favour of one generic merchant-entered rule engine.
- **Automatic exchange rates:** needs a provider and monitoring; deferred.
- **Market domains first:** DNS work for merchants; deferred behind subfolders.
