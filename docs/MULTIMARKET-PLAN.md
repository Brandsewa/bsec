# Multi-market stores: plan

| | |
|---|---|
| Status | **Proposed, not started.** Owner decisions recorded in section 12 (2026-10-28); questions A-D answered; no open questions remain |
| Author | Claude Code (planner/verifier), 2026-10-28 |
| Builders | assigned per phase by the owner (section 11) |
| Related | ADR-002 (RLS), ADR-004 (cache), ADR-008 (payment adapter), ADR-013/015 (quotas), ADR-017 (custom domains), `docs/CUSTOM-DOMAIN-ROUTING-PLAN.md`, `docs/ORDERS-RETURNS-PLAN.md`, `docs/FINANCE-PLAN.md`, `docs/PLATFORM-BILLING-PLAN.md`. **New ADR-040 (markets) is written in Phase 0.** |
| Launch scope | India, USA, Canada. Other countries are added later as data, not code |

## 1. Goal

A store has **one base market** (where the business operates) and can add **more markets**. A market is a set of countries that share one currency and one set of selling rules. Each market has its own:

- currency and prices (fixed or derived from the base price),
- catalog (which products are sold there),
- domain or URL path,
- payment gateway,
- shipping zones and rates,
- return and cancellation policy,
- taxes and duties.

A shopper is placed in a market automatically (by country), can switch it, sees prices in the market currency, and checks out and pays in that currency. A US merchant signs up, gets the US as base market, connects Stripe, and sells in USD. An Indian merchant keeps India (INR, Razorpay, GST) and adds an "International" market (USD, PayPal, or Razorpay international payments if their account has it; Stripe only with an invited Indian Stripe account) and a "Canada" market.

Out of scope for launch: merchant-of-record / duties collection at checkout (Shopify Managed Markets style, which needs a partner like Global-e), per-market languages and translations, marketplaces, B2B price lists, automatic exchange rates, a tax service, market-specific domains (subfolder markets only), live payment keys (test/sandbox only until the owner says otherwise).

## 1A. v1 principles: least compliance, least complexity (owner, 2026-10-28)

v1 is built so that Brand Sewa stays a **software provider** and never becomes a party to the merchant's sales. Every choice below follows from that.

| Principle | What it means in v1 | What it avoids |
|---|---|---|
| **The merchant is the seller of record** | The merchant's own name, address and tax numbers appear on the storefront, checkout and invoices. Brand Sewa is named only as the software ("Powered by") | Being treated as a marketplace, merchant of record or e-commerce operator (India TCS/e-commerce operator rules, US marketplace-facilitator sales-tax laws) |
| **Money never passes through Brand Sewa** | Each store connects its **own** Stripe, PayPal or Razorpay account. The shopper pays the merchant's account directly. **No Stripe Connect, no PayPal partner/marketplace flows, no split payments, no platform fee taken from orders, no holding balances or payouts** | Payment-aggregator authorisation under RBI rules (an aggregator pools and settles funds; a pure technology provider does not, see [Trilegal](https://trilegal.com/knowledge-repository/rbis-guidelines-on-regulation-of-payment-aggregators-and-payment-gateways/)), money-transmitter licences in the US and MSB registration in Canada |
| **No card data on our servers** | Hosted pages only: Stripe Checkout redirect (already built), PayPal approval redirect, Razorpay modal. No card fields, no stored cards, no gateway scripts in our page bundle except Razorpay's existing modal | PCI DSS scope beyond SAQ A for merchants and beyond the minimum for us |
| **We calculate, the merchant decides** | Tax rates, exchange rates, policies, registrations are merchant-entered. We apply them exactly and show "set by the store". No tax advice, no rate suggestions shown as correct, no filing or remittance | Liability for wrong tax; being a tax agent |
| **No duties collection** | Cross-border orders say "import duties and taxes may be charged on delivery" (DAP) | Customs-broker or merchant-of-record roles |
| **Data stays where it is** | One database and region as today. New personal data is only what checkout already collects (address, phone, email) for foreign shoppers. Privacy policy states storage location and processors (the merchant's own policy for its shoppers; Brand Sewa's policy for merchants) | New data-residency work. No EU/UK markets in v1, so GDPR/UK GDPR are not triggered by this feature |
| **No new cookies that need consent** | The market cookie is strictly necessary (remembers the shopper's chosen country/currency); no geo tracking stored | Cookie-consent changes |
| **Fewest moving parts** | Manual exchange rates, subfolder URLs, one inventory pool shared by all markets, English only, manual fulfilment, flat/weight/price-tier rates already built | New queues, provider integrations, schedulers |

Brand Sewa's own compliance to-dos that this feature creates (owner, not code): PayPal account set to receive international payments with a purpose code and PAN (required for withdrawals in India, [PayPal](https://www.paypal.com/in/smarthelp/article/what-is-purpose-code--faq4279)); invoices to foreign merchants as export of services (GST LUT for Brand Sewa itself; confirm with the CA); merchant terms of service stating the division of responsibility (section 8.1); confirm with a lawyer that the "own gateway account" model keeps Brand Sewa outside the payment-aggregator rules.

## 2. Research summary

What proven platforms do, and what we take from it. Third-party guides were used for Shopify (its own help centre was not reachable by the search tool); verify details against vendor docs before building the matching feature.

| Source | Finding | Decision for bsec |
|---|---|---|
| Shopify Markets ([guide](https://www.fudge.ai/guides/setup-shopify-markets/), [guide](https://help.gempages.net/articles/shopify-international-markets)) | A market = a group of countries sharing currency, catalog, domain/language, tax treatment. One store, many markets. Domains can be subfolder, subdomain or country domain, with hreflang generated | Same entity model. Each country belongs to at most one market |
| Shopify pricing ([EAS](https://help.easproject.com/how-to-configure-market-specific-pricing-in-shopify)) | Prices are auto-converted by default, with a per-market % adjustment and rounding; fixed prices are per market. A fixed price cannot vary by country inside one market | Derived price (rate + adjust % + rounding) with optional fixed override per variant per market. Same "one price per market" rule |
| Shopify tax/duties ([scandiweb](https://scandiweb.com/blog/?p=26113), [addigitech](https://addigitech.com/blog/shopify-markets-sell-internationally)) | Tax-inclusive display where customary. Duties collected at checkout or built into price need a tax engine or a merchant-of-record layer | Launch: tax-inclusive/exclusive flag per market, merchant-entered rates, duties **not** collected (shopper pays on delivery, stated at checkout). Tax engine and MoR are later adapters |
| Stripe pricing ([Adaptive Pricing](https://docs.stripe.com/payments/checkout/adaptive-pricing), [manual prices](https://docs.stripe.com/payments/checkout/multi-currency-prices)) | Adaptive Pricing converts for the shopper but adds a 2-4% fee and applies to Checkout Sessions; manually set currency prices override it. Refunds pay out in the shopper's currency at the current rate | We own prices, so we send the market currency and amount ourselves (no Adaptive Pricing). Refunds are issued in the charged currency |
| Stripe in India ([support](https://support.stripe.com/questions/stripe-india-support-for-marketplaces), [export docs](https://docs.stripe.com/india-exports)) | Stripe is invite-only in India, and Connect charge types are restricted there | **Indian merchants use Razorpay as their gateway; Stripe is for US/Canada merchants** (and Indian merchants only if they hold an invited account). Treat this as a gateway-availability rule per merchant country (section 6.5) |

Not yet researched (Phase 0, sources in the ADR): PayPal Orders v2 and Subscriptions availability for an India-registered platform account, PayPal and Razorpay international currency lists. Tax rules (US nexus, Canada GST/HST/PST/QST, India LUT) are **no longer research items**: the merchant enters them (decisions 4 and 8), so we only need a generic engine. No exchange-rate source is needed (decision 3).

## 3. What the code already has (read 2026-10-28)

| Area | Today | Gap |
|---|---|---|
| Currency | `tenants.currency`, `store_settings.currency`, `orders.currency`, `carts.currency`, `payment_intents.currency`, finance tables all default `'INR'`. Money is `bigint` minor units (`variants.price`, `compare_at_price`). Several columns are named `*_paise` (e.g. `shipping_rates.price_paise`) | Currency is per store, not per order context. Naming says paise. Need to find hardcoded `₹`, `en-IN`, `paise` in UI and domain (audit in Phase 1) |
| Tenant locale | `tenants.country`, `currency`, `timezone`, `locale` exist; `store_settings.weight_unit` defaults `kg`; `variants.weight_grams` | Weight is stored in grams (good, keep). `weight_unit` is a single store switch; no imperial display or shipping-rate UI conversion |
| Shipping | `shipping_zones.countries[]` + `states[]`; `shipping_rates` by flat / free-above / price tier / weight tier (grams), in paise | Rates are in one currency; zones are not tied to a market |
| Tax | `tax_classes`, `admin/tax-settings.ts` with a GST "place of supply state" | India GST only; no US or Canada logic, no inclusive/exclusive per market |
| Returns | `return_settings` JSONB on `store_settings`, `ORDERS-RETURNS-PLAN.md` | One policy per store |
| Payments | `packages/payments`: `cod`, `razorpay`, `stripe` (Stripe Checkout redirect, API version pinned), `cashfree`, `mock`. Razorpay checkout is wired; **Stripe is not offered at checkout yet**. `platform_payment_providers` controls what stores may connect. Credentials in `tenant_secrets` | Gateway is chosen per store, not per market. Stripe checkout flow needs to be built (section 6.5) |
| Domains | Custom domains with DNS check and HTTP probe (migration 0081, ADR-017) | A domain maps to a store, not to a market |
| Cache | `"use cache"` loaders in `apps/web/src/server/cached-storefront.ts`, tags `t:{tenantId}:{kind}` | Cache key does not vary by market |

Checked in the review pass (2026-10-28, grep counts, not a full read):

| Finding | Where | Plan impact |
|---|---|---|
| `₹` appears in **103** source files and `en-IN` in **82** | `apps/*`, `packages/*` | Phase 1 is a real refactor, not a tidy-up: one `formatMoney(amount, currency, locale)` helper in `@bs/ui` (browser-safe) and the domain, then replace call sites package by package. Budget it as the largest Phase 1 task |
| Signup and provisioning default to India | `saas/signup.ts` (`currency \|\| "INR"`), `saas/provisioning.ts` (default shipping zone `countries: ["IN"]`, `countryCode: "IN"`), GSTIN fields on `tenants` and invoices | US/Canadian merchants cannot sign up correctly today. New Phase 1B: country picked at signup drives currency, timezone, locale, unit system, default zone, tax fields shown (GSTIN only for India) |
| 13 schema columns are named `*_paise` | shipping, plans (`price_monthly_paise`) and others | Keep the names in v1 (they are minor units; renaming 13 columns is churn with no user value). Document "paise = minor units of the row's currency" in the schema comments. Rename only if a later cleanup wants it |
| Fixed-amount discounts and free-shipping thresholds have one `amount`, no currency | `marketing.ts` `discounts` | v1: a fixed-amount discount applies only in markets whose currency equals the store base currency; percent and free-shipping discounts work everywhere. Admin shows this rule |
| Stripe appears only in the webhook route, not checkout | `apps/web/src/app/api/webhooks/[provider]/route.ts` | Confirms Phase 4 must build the Stripe checkout path |
| Platform billing is Razorpay-only with INR plan prices | `saas/billing.ts` (`plan_currency: "INR"`), `plans.price_*_paise` | Phase 4B adds a PayPal provider and a USD price per plan |

Latest migration is 0082 (notification manager); latest ADR is 039. This plan uses ADR-040. Shiprocket and any shipping integration stay untouched (rule 14); this plan only changes shipping **rate configuration**, which is per-store data (rule 12).

## 4. Concepts and data model

### 4.1 Vocabulary

- **Base market**: exactly one per store, created automatically from `tenants.country`/`currency`. It cannot be deleted. Its currency is the **store base currency** used for finance and reports.
- **Market**: name, handle, status, a set of countries, one currency, and the settings in 4.3. Created from a preset (India, USA, Canada, "International (rest of world)") or blank.
- **Unit system**: store-wide setting (metric or imperial) with an optional per-market override. It only changes how weight is entered and displayed.

### 4.2 Units: store canonical, convert at the edge

Never store a display unit. Weight stays integer **grams** (`variants.weight_grams`, shipping tiers `*_weight_grams`). Metric shows kg or g; imperial shows lb or oz.

- `packages/domain/src/units.ts`: `gramsToDisplay(g, system, unit)`, `displayToGrams(value, system, unit)`, rounding rules (grams exact; oz to 0.01; lb to 0.001).
- Setting: `store_settings.unit_system` (`metric` | `imperial`) plus `weight_unit` (`g`|`kg`|`lb`|`oz`) for the chosen default input unit. `markets.unit_system` nullable override, used for storefront display and that market's shipping tiers. Admin product and shipping forms use the store setting.
- No data migration of weights. Tests: round-trip conversions at boundaries (1 lb = 453.59237 g).

### 4.3 New tables (all `tenantTable()` + `forceRlsSql`, composite FKs, migrations append-only)

```
markets
  id, name, handle (unique per tenant), is_base (unique where true per tenant),
  status (draft | active | disabled), currency (ISO 4217), unit_system (null = store default),
  price_mode ('fixed' | 'derived'),          -- default for variants without a fixed price
  fx_rate numeric(18,8) null,                -- manual only in v1 (decision 3); base -> market currency
  price_adjust_bps int default 0,
  rounding ('none' | 'nearest_whole' | 'charm_99' | 'charm_95'),
  tax_display ('inclusive' | 'exclusive'),
  path_prefix text null,                      -- '/us'; null for the base market (v1: subfolder only)
  catalog_mode ('all' | 'selected') default 'all',
  locale text, created_at, updated_at
  (market domains/subdomains: a later expand migration adds domain_strategy + domain_id)

market_fx_history                             -- audit of manual rate changes; orders snapshot the rate anyway
  market_id, rate, set_by, set_at

market_countries
  market_id, country (ISO 3166 alpha-2)
  unique (tenant_id, country)                -- a country is in at most one market

market_prices                                 -- fixed override; absent = derived
  market_id, variant_id, price bigint, compare_at_price bigint null

market_products                               -- catalog; absent row = follow market default
  market_id, product_id, published boolean
  (markets.catalog_mode 'all' | 'selected' decides the default)

market_payment_methods
  market_id, provider ('razorpay' | 'stripe' | 'cod' | ...), enabled, sort_order
  (credentials stay in tenant_secrets; this only says which gateway this market offers)

market_policies                               -- returns & cancellation overrides
  market_id, return_settings jsonb null, cancellation jsonb null   -- merged over the store policy

market_tax_rules                              -- 6.7
  market_id, country, region (state/province or '*'), tax_name (GST|HST|PST|QST|SALES_TAX),
  rate_bps, applies_to_shipping boolean, tax_class_id null
```

Changes to existing tables (expand / migrate / contract per rule 10):

- `carts`: add `market_id`. `orders`: add `market_id`, `base_currency`, `fx_rate` (rate used at checkout), `base_grand_total`. `orders.currency` becomes the **presentment** (charged) currency. `payment_intents` and `refunds` already carry currency; add a check that they equal the order currency.
- `shipping_zones`: add `market_id` (nullable, backfilled to the base market). Rates are stored in the market currency in the existing `*_paise` columns (minor units; see section 3 review table, no rename in v1).
- `store_settings.currency` and `tenants.currency` both exist today; the base market's currency becomes the single source and the two old columns are kept in sync until a later contract release. **The base currency is locked once the store has its first order** (finance history depends on it).
- Backfill: every existing store gets one base market from `tenants.country/currency`, all its countries from the zone countries, and all current prices stay as the base prices.
- Platform (non-tenant) table: `platform_countries` (iso2, name, default currency, tax regime, address schema key, `enabled`). Adding a country later is a row, not a deploy. Seeded with IN, US, CA.

### 4.4 Money rules (hard)

1. Amounts are integer minor units plus an ISO currency code, never floats. A currency exponent table (`packages/domain/src/money.ts`) replaces the "paise" assumption (INR/USD/CAD are 2 now; JPY would be 0 later).
2. Prices and totals are recomputed on the server at checkout from the order's market (rule 12). The client sends only cart lines, country and market handle.
3. An order stores its presentment currency, the fx rate used and the base-currency equivalent. Finance reports sum `base_grand_total`, so historical reports never move when rates change.
4. Derived price = `round(base_price × fx_rate × (1 + adjust_bps/10000))`, then the market rounding rule. The result is computed in one function used by catalog display, cart and checkout, so they cannot disagree.

## 5. Market resolution (auto-detect)

Order of precedence for a storefront request:

1. **Path**: a `/us/` style prefix wins (that URL is the market). Implemented as a rewrite in `apps/web/src/middleware.ts` that strips the prefix and passes the market on, so no storefront route is duplicated. Market domains are a later addition (decision 7).
2. **Shopper's explicit choice**: signed cookie `bs_market` (set by the country switcher; the customer's saved address country may pre-select it).
3. **Geo suggestion**: country from the Cloudflare `CF-IPCountry` header (free, no lookup service), trusted only when the request arrived through Cloudflare. It maps country to market through `market_countries`.
4. **Fallback**: the base market.

Rules:

- Geo only **suggests**, always. No forced redirect and no silent switch in v1 (simpler, avoids search engines seeing different content at one URL). The first visit from a country with a different market shows a small banner ("Shop in USD for United States?") with a switch button that goes to the `/us` URL and sets the cookie.
- Never geo-redirect search-engine bots. Each market URL has `rel=canonical` and `hreflang` alternates (`en-IN`, `en-US`, `en-CA`, `x-default`) so Google indexes each version.
- Country not in any market: use the base market if the merchant allows "sell to rest of world", otherwise show "we don't ship here yet".
- Authorisation never depends on geo. The market used for pricing at checkout comes from the cart (which the server stamped), and a shipping country outside that market's countries is rejected or triggers a market switch with a repricing notice.
- **Cache**: `market` becomes an argument of the cached loaders (part of the `"use cache"` key). Tags stay tenant-prefixed through `tenantTag` (rule 5); a price change invalidates the tenant's product tags, which covers every market. No second hand-rolled cache.
- **Performance** (memory: product page is at the 50 KB gz JS limit): the country switcher and banner are server-rendered with the minimal progressive-enhancement script; measure before and after on the product page, header and cart.

## 6. Per-market capabilities

### 6.1 Currency and pricing
Base market prices are the existing variant prices. For other markets the merchant picks derived or fixed per market and can override any variant. Admin: a pricing table per market with columns "Base price", "Derived", "Fixed price", bulk "set adjustment %", bulk CSV import/export. Rate: merchant-entered only in v1 (decision 3), each change written to `market_fx_history` and `audit_logs`, then the tenant's product cache tags are invalidated. The admin shows "last updated" and a reminder if the rate is older than 30 days. A market refuses to go `active` until it has a currency, countries, a gateway, and at least one shipping rate.

### 6.2 Catalog
v1: per market `catalog_mode` = all products or selected products, plus per-product hide. The market's product list, collections, search, sitemap and `/products.json`-style APIs filter by it. Not on sale in a market means 404 for direct product links in that market (with a "available in other markets" hint). Later: separate price lists and market-specific titles, descriptions and media.

### 6.3 Domain
v1 (decision 7): every non-base market gets a subfolder on the store's existing host, whether that is `slug.bcom.si` or a custom domain (`store.com/us`, `store.com/ca`). The base market has no prefix. No DNS work for merchants. Later: subdomain or own domain per market, reusing ADR-017 and the migration 0081 checks, with `host-resolver.ts` returning `{tenant, market}`.

### 6.4 Shipping
Zones belong to a market; countries in a zone must be a subset of the market's countries. Rates use the market currency and the weight tiers stay in grams (shown in the market's unit system). Merchant sets estimated days per zone. Free-shipping thresholds are per market currency. No courier integration or live rate APIs (rule 14).

### 6.5 Payments (one gateway per market)
The merchant assigns a gateway to each market through `market_payment_methods`. Examples: Indian store: India market Razorpay + COD, International market (USD) PayPal. US store: US market Stripe and/or PayPal, Canada market Stripe (CAD). Canadian store: Canada market Stripe and/or PayPal, US market (USD) the same. Every gateway account belongs to the merchant (section 1A); Brand Sewa takes no fee from orders.

- **Availability rule by merchant country**: Stripe cannot be self-onboarded in India (invite only), so the connect screen explains it; a store whose base country is US or CA can connect Stripe directly; Razorpay is shown to Indian merchants. Encode in `platform_payment_providers` (add supported merchant countries and currencies) so Super Admin controls it (existing ADR-008 / ADMIN-IMPROVEMENTS-PLAN 6.4 flow).
- Stripe Checkout flow (hosted redirect, already in `packages/payments/src/providers/stripe.ts`) is not wired to checkout yet. Phase 4 builds: create session in the market currency with our computed amount, webhook settle (idempotent, amount and currency checked, same pattern as `settleRazorpayPayment`), refunds in the charged currency, order page "Pay now".
- Razorpay for non-INR presentment requires international payments enabled on the merchant's Razorpay account; the connect screen shows which currencies the account supports. Verify in Phase 0.
- **PayPal** (rule 14 lifted for PayPal, decision 2): a `paypal` adapter behind the same interface (Orders v2 create + capture, webhook verification, refunds in the charged currency; hosted approval redirect so no PayPal script is added to our pages). Connect screen takes the merchant's own PayPal REST client id and secret (encrypted in `tenant_secrets`). PayPal supports a limited currency list, so the market editor warns when a market currency is not supported by the chosen gateway. Sandbox until the owner approves live mode (decision 11).
- **Brand Sewa's own billing** is separate from store checkout: international merchants pay their subscription by PayPal (phase 4B), kept in the platform billing code, never mixed with tenant credentials.
- PayPal for an Indian merchant is offered only in non-INR markets (PayPal India accounts receive international payments; domestic INR is Razorpay's job).
- COD only for markets that enable it (default India only; off by default for cross-border markets).
- Test/sandbox mode while building. Turning live mode on follows the existing platform switch ("allow live mode", ADMIN-IMPROVEMENTS-PLAN 6.4) and the owner's yes (decision 11: sandbox first).

### 6.6 Returns and cancellation
`market_policies` holds only the **differences** from the store policy: return window days, who pays return shipping, restocking fee, final-sale rules, cancellation window and cut-off (before shipment). The policy shown on the storefront, in emails, the order page and the return request flow is resolved from the order's market, and the policy text is snapshotted onto the order at purchase so later edits never change an existing order. Policy text is the merchant's own (section 8.1); the editor offers labelled examples to copy and edit, never published defaults.

### 6.7 Taxes and duties
v1 has **one generic tax engine for every country**: a market has `collect tax: no | yes`; if yes, the merchant adds rows `(country, region or all, name, rate %, applies to shipping)` and the engine adds every matching row. No country-specific logic beyond India's existing GST, and **we pre-fill no rates** (decision 4 and 8).
- **India**: existing GST with place-of-supply state stays as is for the India market; prices tax-inclusive. For non-India markets of an Indian store the merchant chooses "charge GST on exports: no (zero-rated) / yes"; we do not decide LUT status.
- **USA**: the merchant adds a row per state where they collect (destination-based); prices tax-exclusive by default. States without a row collect nothing.
- **Canada**: the merchant adds rows per province (for example GST + PST, or one HST row); prices tax-exclusive by default.
- Rounding: tax computed per line in minor units, half-up, then summed (documented in ADR-040 so invoices reconcile).
- Later: a tax-service adapter (Stripe Tax or similar) behind the same interface.
- **Duties and import taxes**: v1 shopper pays on delivery (DAP), stated at checkout for cross-border markets; no collection. Later: DDP via a provider adapter.
- Tax is calculated server-side from market + shipping address + tax class, stored on the order lines, shown on invoice (invoice template per market: GSTIN for India, tax lines for US/CA).

### 6.8 Storefront details
- Address forms by country (state/province lists, ZIP/postal-code validation, phone format), driven by `platform_countries.address_schema`.
- `Intl.NumberFormat` with the market locale and currency; no hardcoded `₹` or `en-IN`.
- Customer accounts stay store-wide; saved addresses keep their country.
- Emails use the order's currency and the market's policy snippets; transactional templates unchanged otherwise. Note: transactional email delivery is not live yet (`progress.md`), so foreign shoppers get no confirmation email until it is. That is a launch dependency, not part of this plan.
- Price filters and sorting on collection/search pages use the market price. Product structured data (JSON-LD `Offer.priceCurrency`, `price`) and the sitemap per market use the market's values.
- Inventory is one shared pool across markets in v1 (no per-market stock or locations).
- Quotes, preorders and abandoned-checkout emails carry the cart/order currency, never the store default.
- Store admin dashboards, finance and reports stay in the base currency; order lists show both ("$40.00 USD · ₹3,340").

## 7. Admin and Super Admin

Store admin: **Settings → Markets**.
- Markets list with base market badge, status, countries, currency, domain, gateway.
- "Add market" wizard with presets (USA, Canada, India, International): countries, currency, pricing mode, gateway, shipping, policies, tax, URL prefix, then a readiness checklist before activation (currency + rate, countries, gateway connected for that currency, a shipping rate, policies filled, tax choice acknowledged).
- Market editor with tabs: General (countries, currency, unit system, URL prefix), Pricing, Catalog, Payments, Shipping, Returns and cancellation, Taxes and duties.
- Disabling a market keeps its data and orders; open carts in it are repriced to the shopper's new market on next visit. A market with orders can be disabled, not deleted.
- Where a form shows weight, it uses the unit system; hints sit behind (i) hover pop-ups (memory: info icon rule).
- UI follows `docs/admin-ui-standards.md` (shared kit, no native `select`, `confirm-dialog`, drawers about 40% wide, border tokens); every admin route declares `pendingComponent`.

Super Admin: supported-countries registry (`platform_countries`), per-plan market quotas (extend ADR-013/015 quota definitions: Starter 1, Growth 2, Enterprise 5 extra markets on top of the always-present base market, decision 6; on a downgrade, extra markets are disabled, newest first, never deleted), feature flag `multi_market` for staged rollout (ADR-011), and gateway availability by merchant country (6.5).

Permissions: new `markets.manage` (store_owner, store_admin); prices and policies follow existing catalog and settings permissions. `assertPermission` in the domain services (rule 4); audit rows for every change (rule 6).

## 8. Security, correctness and compliance checks

- Every new table via `tenantTable()` + `forceRlsSql`; composite FKs; isolation suite updated; new `admin.markets.*` procedures mapped in `isolation.int.test.ts`.
- Real-database tests for: country-in-one-market uniqueness, cross-tenant market access denied, checkout reprice in market currency, mismatched currency/amount rejected at settlement, refund currency equals charge currency.
- Contracts first (`packages/contracts`), then handlers, domain, UI (section 3 of AGENTS.md).
- Secrets never in logs or responses; gateway keys remain in `tenant_secrets`.
- Geo header is advisory and never used for authorisation or price trust; header is ignored unless the request is proven to come via Cloudflare.
- Consumer-law notes the merchant must handle (surfaced in the UI, not enforced by us): US/Canada return and refund disclosure, Canada bilingual requirements for Quebec, India Consumer Protection (E-Commerce) rules. Flag for the owner's legal review.
- Platform billing for foreign merchants: PayPal (decision 1, phase 4B). Its credentials are platform credentials, stored like the other platform provider secrets, never in `tenant_secrets`.

### 8.1 Compliance stance: the merchant owns it

Decision 8: we provide the tools, not legal or tax advice.
- Return, cancellation and shipping policy text is written by the merchant. The editor offers clearly labelled **examples to edit**, not defaults that publish by themselves; a market cannot activate with an empty policy.
- Tax rates, registrations (GSTIN, US state IDs, Canadian GST/QST numbers) and export treatment (India LUT) are merchant-entered fields. Each market's tax and policy tab has a short notice and a required acknowledgement ("I am responsible for the accuracy of these rates and policies"), stored with who/when in `audit_logs`.
- The Markets help page links to official sources (GST portal, state revenue departments, CRA) rather than restating rules.
- Invoices print the merchant's own tax numbers and lines; we do not file or remit anything.
- Terms of service for merchants (lawyer to review, with the licence) state this division of responsibility.

## 9. Phases

Each phase is its own branch and PR, ships behind the `multi_market` flag, passes the full gate, and has a change record in `docs/changes/`. "Done" means verified by Claude against these criteria.

| # | Phase | Scope | Acceptance criteria |
|---|---|---|---|
| 0 | **Decisions and ADR** | Verify PayPal Orders v2 / Subscriptions availability for an Indian platform account and the currency lists of PayPal and Razorpay international; write ADR-040 (market model, money rules, tax rounding, resolution order, cache key, "merchant is seller of record"); update `AGENTS.md` rule 14 and `progress.md` decisions and "In flight" | ADR merged; rule 14 text matches decision 2; verification notes with sources in the ADR |
| 1B | **Signup outside India** | Country picker at signup (IN, US, CA from `platform_countries`) sets currency, timezone, locale, unit system, default shipping zone and which tax-ID fields show; GSTIN optional and India-only; provisioning stops hardcoding `IN` | A US and a Canadian test merchant sign up locally and get a USD/CAD store with an imperial or metric default and a matching zone; Indian signup unchanged (existing tests green) |
| 1 | **Foundation, no behaviour change** | `money.ts` (exponents, formatting), `units.ts`, remove hardcoded `₹`/`en-IN`/`paise` (audit list in the change record), `store_settings.unit_system`, imperial display for weight inputs, `markets` + `market_countries` tables, backfill one base market per store, `orders/carts` get `market_id`/base fields (nullable, backfilled) | All existing stores behave identically; round-trip unit tests; isolation suite green; backfill test on a database seeded with the old shape; migration is expand-only |
| 2 | **Markets CRUD, subfolder URLs and resolver** | Contracts, domain service, admin Markets list/editor (General tab), Super Admin country registry and quota, middleware rewrite for `/us`-style prefixes, resolver (path, cookie, `CF-IPCountry`), switcher and banner, `market` in cache keys, hreflang + canonical, sitemap per market | Add USA market; `/us/products/x` renders with the US market; `CF-IPCountry: US` shows the banner, never a redirect; explicit switch persists; cache test proves two markets do not share a cached price; hreflang set validates; product page JS budget re-measured |
| 3 | **Pricing and catalog** | `market_prices`, derived price function, rounding, bulk edit/CSV, `market_products`, listing/search/sitemap filtering, fx rate entry (+ history), readiness checklist | Same variant shows INR in India and USD in the US; fixed override beats derived; unpublished product is 404 in that market; rate change reprices derived prices after cache invalidation; money tests including rounding edge cases |
| 4 | **Checkout and payments per market** | Cart/checkout reprice by market, order stores presentment + base currency + fx, `market_payment_methods`, Stripe Checkout wired, PayPal adapter (Orders v2, hosted approval, webhook, refunds), Razorpay for INR market, gateway availability by merchant country and currency, refunds in charged currency, finance base-currency reporting, fixed-amount discount rule (section 3) | End-to-end sandbox orders: India (Razorpay, INR), Indian store international (PayPal, USD), US (Stripe and PayPal, USD), Canada (Stripe, CAD); server recompute ignores client totals; wrong currency/amount rejected; refund currency equals charge currency; finance totals in base currency match the ledger |
| 5 | **Shipping, returns and addresses** | Zones tied to markets, rates in market currency, weight tiers shown in market unit, `market_policies` + resolved policy snapshot on order, country-aware address forms and validation, policy text templates | US order only sees US zone rates; policy shown matches the order's market and does not change after later edits; invalid ZIP/postal rejected |
| 6 | **Taxes** | Generic `market_tax_rules` engine (no pre-filled rates), collect yes/no, inclusive/exclusive display, tax on shipping toggle, India "GST on exports" choice, merchant acknowledgement, invoices with the merchant's own tax IDs | Fixtures with merchant-entered rows give the expected arithmetic (one row, two stacked rows such as GST + PST, no row = no tax, inclusive vs exclusive, per-line rounding); India GST unchanged; invoice shows correct lines; order tax stored per line |
| 4B | **Platform billing via PayPal** | PayPal subscriptions (or invoices) for international merchants in `saas/billing.ts`, plan prices per currency, webhook with idempotent settle, `PLATFORM-BILLING-PLAN.md` update; PayPal sandbox only (decision 11); USD price per plan | Sandbox merchant subscribes, renews and is suspended on failure; Indian billing unchanged; platform audit rows written |
| 7 | **Hardening and rollout** | Load test with markets, a11y on switcher/banner, walkthrough at 375 px and desktop, docs (`ARCHITECTURE.md` sections 5, 7, 8, 9, 14; runbook), local rehearsal with the three pilot store shapes (Indian selling abroad, US, Canadian), then pilot behind the flag (the Indian store selling abroad first, decision 14), then enable by plan | Full gate green, heavy tests counts pasted, ZCode test round recorded in `docs/changes/`, no regression on COD India checkout or Taste of Hills |
| Later | **Not v1** | Market domains/subdomains, auto exchange rates, tax service, duties collection, per-market languages and content, per-market inventory, multi-currency fixed discounts | Each needs its own plan |

Order: 0 → 1 → 1B → 2 → 3 → 4 → 5 → 6 → 7. Phase 4B depends only on Phase 0 and can run in parallel with 1-3 (different files: platform billing). Phases 5 and 6 can swap.

Suggested ownership (the owner decides, per AGENTS.md section 6): Claude does Phase 0 and every verification; one builder takes Phases 1-3, then Phases 4-6 (payments and tax are the highest risk, Claude reviews every PR line by line); ZCode runs a test round after Phases 2, 4 and 6. One phase, one owner, claimed in `progress.md` "In flight". Never merge a second PR while a `main` run is in progress.

## 10. Key risks

| Risk | Mitigation |
|---|---|
| Price mismatch between display, cart and charge | One pricing function; server recompute at checkout; settlement checks amount and currency |
| Cache serving the wrong market's price | `market` in the cache key; test with two markets; no per-request shared state |
| Breaking live India store (Taste of Hills) | Phase 1 is expand-only with backfill; flag-gated; COD India regression test every phase; migration rehearsed on a copy |
| FX loss and rate staleness | Manual rate (decision 3); adjust % margin; order snapshots rate; 30-day staleness reminder |
| Brand Sewa drifting into regulated roles (aggregator, merchant of record, tax agent) | Section 1A rules are written into ADR-040; any future "take a fee from orders" or "collect duties" feature needs a new ADR and legal review |
| Wrong tax | Merchant-entered rates with a clear disclaimer; fixtures per jurisdiction; tax-engine adapter later |
| Gateway not available to merchant's country | Availability rules in Super Admin; connect screen explains why |
| Product page JS budget | Server-rendered switcher; measure each phase |
| SEO duplication across market URLs | canonical + hreflang ship with the subfolder URLs in Phase 2 |
| Scope creep into MoR/duties/languages | Explicitly out of scope; adapter seams only |

## 11. Definition of done (per phase)

Copy the AGENTS.md section 7 checklist into the phase's change record. Extra for this work: unit and money round-trip tests, isolation suite mapping, `ARCHITECTURE.md` (sections 5, 7, 8, 9, 11, 14) and `progress.md` updated, an ADR for any change to the rules above, and a note of what was seen in a browser versus only read.

## 12. Decisions on record (owner, 2026-10-28)

| # | Topic | Decision | Effect on this plan |
|---|---|---|---|
| 1 | Platform billing for foreign merchants | International merchants pay Brand Sewa through **PayPal** (account ready). Razorpay International or Stripe may replace it later | New phase 4B: platform subscriptions via PayPal behind the existing billing seam. `PLATFORM-BILLING-PLAN.md` gets a PayPal section. Indian merchants keep the current billing |
| 2 | PayPal | **Rule 14 is lifted for PayPal.** Brand Sewa billing uses PayPal, and store admins can connect **Stripe and PayPal** for their own checkout | PayPal adapter built in Phase 4 (store checkout) and 4B (platform billing). Phase 0 PR must update `AGENTS.md` rule 14 and the "Decisions on record" list in `progress.md`. Sandbox first, see decision 11 |
| 3 | Exchange rates | **Manual** for v1 | No auto-rate job. Rate history table stays (audit) |
| 4 | Taxes | **Merchant-entered** US/Canada rates | No tax-service integration at launch; adapter seam only |
| 5 | Duties | **Shopper pays on delivery**, stated at checkout | As designed (6.7) |
| 6 | Plan limits | Starter 1, Growth 2, Enterprise 5 markets | Quota definitions (7). Limits are **extra markets on top of the base market** (decision 12) |
| 7 | Domains | **Subfolder markets for launch**; custom market domains later | Subfolder URLs, hreflang and sitemaps moved into Phase 2. Market domains and subdomains move to "Later" |
| 8 | Legal and tax advice | **Merchant handles it outside our system** | Compliance design in 8.1: we provide no legal or tax advice, merchant enters and owns their policies, rates and registrations, with recorded acknowledgement |
| 9 | Pilots | Three other stores: an Indian store selling internationally, a US store selling globally, a Canadian store selling globally | Taste of Hills (live) stays untouched. These three are the Phase 2-6 test and pilot stores |
| 10 | Market grouping | Merchant's choice. A US store can add Canada as its own market. An Indian store can put US and Canada in **one market with one currency** | Already supported: the currency belongs to the market, not the country (section 4.1). Rates, tax and shipping are then keyed by country and region inside the market (4.3, 6.7) |
| 11 | Live PayPal | PayPal account exists; **build and test in the PayPal sandbox first** | No live PayPal credentials until the owner says |
| 12 | Plan limits counting | Limits are **extra markets on top of the base market**: Starter 1, Growth 2, Enterprise 5 (plus the base) | Quota counts non-base markets |
| 13 | Brand Sewa's own pricing | Indian merchants see **rupees** and pay by **Razorpay** (default); global merchants see **USD** and pay by **PayPal**. **USD only**, no CAD | One USD price per plan next to the existing INR price; phase 4B |
| 14 | Pilot and build order | First pilot is the **Indian store selling abroad**. The owner builds and tests the plan **one phase at a time** | Phase order in section 9 is followed strictly; each phase is verified before the next starts |
