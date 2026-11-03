# ADR-044: State Pricing: per-variant prices by Indian state, detected automatically, locked on the cart

- **Status:** Accepted
- **Date:** 2026-11-03
- **Plan reference:** `docs/STATE-PRICING-PLAN.md` (extends ADR-040, ADR-043; rules 5, 12)

## Context
An Indian customer sells the same product at different prices in different states and wants the right price to show without the shopper doing anything.

## Decision
### Data and price
- `state_prices (tenant, variant, state_code, price, compare_at_price)` (`tenantTable`, composite FK to `variants`). A state without a row follows the variant's own price. State codes are ISO 3166-2:IN from the platform table `platform_in_states` (36 rows). Money stays integer minor units.
- One price path. `market_variant_price` (migration 0096, replacing 0089's body) returns the state price when `app.price_region` is set and the request is in the base market, else the market price, else the variant price. With the setting empty it is byte-identical to before. The product page and cart use `loadStatePriceMap`. Another market keeps its own currency and prices.

### Detection (shopper never has to act)
1. Cloudflare `cf-region-code` when the request carries `cf-ray` and `cf-ipcountry` is `IN`.
2. MaxMind GeoLite2-City (optionally an India-only extract), path in `GEOIP_DB_PATH`, as the fallback. Absent file means no fallback.
3. Otherwise the default price. Crawlers always get default prices so structured data matches what anyone can verify.
Codes from either source are normalised (`OR`->`OD`, `TS`->`TG`, `UK`->`UT`, `DN`/`DH`->`DD`).

### Manual mode (app setting)
When the store sets mode to manual, a pincode popup appears as soon as the store opens: a plain HTML form post (no client JavaScript, the product page budget has no headroom). The pincode maps to a state through `platform_in_pincodes` (India Post directory, loaded by `apps/platform` `import:pincodes`) and is remembered in a cookie. "Continue with standard prices" keeps defaults for the session. In automatic mode there is no pincode box.

### Cart and checkout
The cart is stamped (`carts.price_region`) by the server and repriced when the state changes. **The price is locked to the detected or entered state**: a different shipping address does not reprice (owner decision 2026-11-03, so a shopper cannot get another state's price by typing another address). The order stores `orders.price_region`.

### Cache
The market scope string passed to every cached storefront loader is `<marketId>@<state>`, so two states never share a cache entry (rule 5, ADR-004). Stores without the app never get a state in the scope.

## Consequences
- A shopper whose IP resolves to the wrong state (VPN, some mobile carriers) pays that state's price; manual mode is the remedy. Accuracy of the free sources for Indian mobile networks is unverified and must be measured on real traffic before the customer relies on it.
- No MRP guard and no blocked states in v1 (owner decision); the merchant is responsible for legal-metrology compliance.
- The India-only extract is a derived MaxMind database: licence and attribution apply and the file stays out of the public repo.

## Alternatives considered
- **Reprice from the shipping address at checkout:** fairer on detection mistakes, but reopens the loophole the owner wants closed.
- **DB-IP / IP2Location Lite:** attribution links on storefront pages and weaker accuracy than MaxMind; not used.
- **Zones and percent rules:** deferred; the owner wants explicit per-product per-state prices.
