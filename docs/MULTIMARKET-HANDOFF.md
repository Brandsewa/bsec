# Multi-market: what is built, and the hand-off to Antigravity

Read this with `docs/MULTIMARKET-PLAN.md` and `docs/adr/040-markets.md`. Written 2026-10-28 by Claude when the owner asked to stop after Phase 1 and hand the rest to Antigravity in several chats, with Claude verifying afterwards.

**Everything stays local until the whole build is done** (owner rule, 2026-10-28): commit on local branches, do not push, do not open or merge PRs, do not turn on live provider keys. All work so far is on the local branch `docs/multimarket-phase0` in the worktree `C:\dev\bsec-multimarket` (the plan docs and ADR-040 are also on `main` via PR 149). Antigravity works in its **own worktree branched from `docs/multimarket-phase0`**, one chat per work package below, in the order given.

## 0. Where we are (2026-10-29)

Waves 1 to 3 (WP-1a/1b/1c, WP-2, WP-3, WP-4, WP-5, WP-6) are built by Antigravity, verified by Claude and merged on the local branch `docs/multimarket-phase0`. WP-7 (test round) ran the automated gate (domain 3,212, web 243, admin 108, platform 138 and the rest pass) but its walkthrough has no evidence. WP-8 (this documentation) is done. **Remaining before any push:** a browser walkthrough with screenshots, PayPal/Stripe sandbox runs with the owner's keys, then the steps in `docs/MULTIMARKET-PUSH-CHECKLIST.md`. The "not built" wording in sections 3 and 5 below describes the state when the hand-off was written; the work packages listed there are now merged.

## 1. Status

Claude built Phase 1 and, because the domain pieces are small and test-friendly, most of the **server side** of Phases 2 to 6. What is verified, and how, is in section 2. What is not built is listed as work packages WP-1 to WP-8 in section 3, each with acceptance criteria.

### Built and verified (real Postgres unless said otherwise)

| Area | Where | Verified by |
|---|---|---|
| Money and weight helpers (`formatMoney`, minor-unit exponents, grams to oz/lb/kg) | `packages/contracts/src/money.ts`, `units.ts` | `packages/contracts/test/money-units.test.ts` (10) |
| Tables: `markets`, `market_countries`, `platform_countries`, `market_prices`, `market_fx_history`, `market_products`, `market_payment_methods`, `market_policies`, `market_tax_rules`; columns on `store_settings`, `carts`, `orders`, `shipping_zones`, `plans`; backfill of one base market per store; PayPal in provider checks | migrations 0087, 0088 | `packages/db/test/markets-backfill.int.test.ts` (6, builds a database at 0086 with old-shape stores, then migrates) |
| Market scope in SQL (price function, catalog visibility policy) | migration 0089, `packages/domain/src/markets/scope.ts` | `packages/domain/test/markets-storefront.int.test.ts` (7) |
| Pure rules: price derivation, rounding, tax arithmetic, readiness, prefixes, gateway-currency check, country-aware addresses | `packages/domain/src/markets/rules.ts`, `gateways.ts`, `addresses.ts` | `market-rules.test.ts` (19), `market-addresses.test.ts` (7) |
| Markets admin service (create, update, countries, status gates, prices, fixed overrides, payment methods, policy, tax rows, compliance acknowledgement, catalog visibility, plan limit) | `packages/domain/src/markets/service.ts` | `markets.int.test.ts` (14) |
| Market-aware cart and checkout (market prices, zones, gateways, tax, order snapshot, base-currency total, policy snapshot) | `storefront/cart.ts`, `orders/checkout.ts`, `markets/lookup.ts` | `markets-checkout.int.test.ts` (8) plus the 93 existing checkout/cart/payment tests still passing |
| PayPal provider (Orders v2, hosted approval, capture, refund, webhook verify) | `packages/payments/src/providers/paypal.ts` | `packages/payments/test/paypal.test.ts` (11, mocked `fetch`) |
| Hosted Stripe/PayPal payment start, return settle, "Pay now", settle with amount and currency checks, webhook branches | `domain/src/payments/online-checkout.ts`, `razorpay-checkout.ts` (`settleProviderPayment`), `system/webhooks.ts` | `markets-checkout.int.test.ts` (settle ignores wrong currency/amount, refuses another order's approval, idempotent) |
| PayPal credentials for a store (save, test, activate) | `admin/payment-providers.ts` | typecheck; covered through `markets-checkout.int.test.ts` setup |
| Admin API: 14 `admin.markets.*` procedures, permission `markets.manage`, isolation mapping | `packages/contracts/src/markets.ts`, `apps/web/src/server/api.ts` | `isolation.int.test.ts` (1670) |
| Storefront: market resolution (URL prefix, cookie, `CF-IPCountry` suggestion only), middleware prefix rewrite, switcher and suggestion banner, hreflang, `bs_market` cookie, market-aware cart/checkout/product/collection/category/home/search/quick-buy reads, country-aware checkout form, Stripe/PayPal redirect, `/api/storefront/checkout/pay` and `/return` | `apps/web/src/...` (see section 4) | typecheck only. **No browser walkthrough has been done.** |
| Emails and the new-order alert use the order's currency | `domain/src/system/email-templates.ts`, `jobs.ts` | `email-templates.test.ts` (17) |

Gate state at hand-off: `pnpm typecheck` passes for all 15 packages; domain lint clean; `pnpm docs:check` ok; the full domain suite result is in the change record `docs/changes/2026-10-28-claude-multimarket-phase1.md` (updated at hand-off).

### Not verified, on purpose

- No page of the storefront or admin was opened in a browser (the owner's rule: UI changes must be run). Everything under `apps/web` that is new is typechecked only.
- PayPal and Stripe were exercised with mocked `fetch` only. PayPal Subscriptions for an India-registered platform account is still unverified (ADR-040 fallback: a payment link per cycle).
- Web and e2e test suites were not run.

## 2. Design rules the next chats must keep (from ADR-040)

1. The merchant is the seller of record; each store connects **its own** gateway account; Brand Sewa never holds funds, takes no fee from orders, collects no duties. No Stripe Connect, no PayPal marketplace flow.
2. Prices, totals and tax are recomputed on the server from the cart's market; the client only shows them.
3. Geography only **suggests** a market; it never changes a price.
4. Money is integer minor units plus an ISO code. Never write a currency sign by hand: use `formatMoney` (`@bs/contracts/money`), `useMoney()` in storefront client components, `Money` from `@bs/ui`.
5. Tax rates, policies and exchange rates are merchant-entered. We pre-fill none. Activation needs the compliance acknowledgement.
6. Sandbox/test only for PayPal, Stripe and Razorpay. No live keys.
7. `apps/*` never import `@bs/db`; the web app reads markets through `@bs/domain` (`listStorefrontMarkets`, `getStorefrontCheckoutOptions`).
8. Every storefront read that shows a price goes through `withMarketScope` (domain) or a cached loader that takes `marketId` as an argument (web), so two markets never share a cached price.
9. **Product page JS budget (50 KB gzip, `apps/web/test/perf-budget-bundle.int.test.ts`).** Main had 10 bytes of headroom; the multi-market work now sits at 48.6 KB after lazy-loading `RequestQuoteDialog`. Client components use `useMoney()` (backed by the tiny `apps/web/src/lib/money-client.ts`), never `formatMoney` from `@bs/contracts/money`. Any chat that touches storefront client components runs `pnpm --filter @bs/web build` and that test before saying done, and states the number.
10. Migrations are expand-only. Next free migration number: **0090**. Next ADR number: **041**.

## 3. Work packages (one Antigravity chat each, in order)

Each chat gets its prompt from `docs/prompts/multimarket-wpN-*.md`. Claude verifies each package against its acceptance criteria and the gate before the next starts.

### WP-1: Money formatting everywhere (Phase 1c), split into WP-1a storefront (wave 1), WP-1b domain and email (wave 2), WP-1c admin sweep (wave 3)
Replace every hardcoded rupee sign and `en-IN` in source files (not tests, not marketing) with the helpers.
- Storefront (web): `components/cart/{CartItemRow,CartView,ShippingEstimator}.tsx`, `components/checkout/OrderSummary.tsx`, `components/product/{VariantSelector,ProductDetailSection,ProductCustomField}.tsx`, `components/catalog/{ProductCard,CardCartButton,PriceSlider}.tsx`, `components/storefront/{MiniCartDrawer,SearchModalPanel}.tsx`, `BlockRenderer` (pass `{ currency, locale }` into the block `RenderContext` from `getMarketContext`; `RenderContext` already has the fields and `@bs/blocks` already uses them), coupon texts in `domain/src/storefront/coupons.ts`, product structured data and the sitemap (price and currency of the market).
- Domain messages: `orders/discounts.ts`, `orders/manual-lifecycle.ts`, `orders/return-state-machine.ts`, `orders/shipping-rates.ts`, `finance/*`, `saas/*` (Brand Sewa's own plan prices stay rupees via `formatMoney(x, "INR")`).
- Admin and Super Admin (`apps/admin`, `apps/superadmin`): a `useStoreCurrency()` hook fed by store settings; order lists show the charged currency and, when different from the base, the base total (`orders.base_grand_total`). Platform plan prices: INR or USD per plan.
- Acceptance: `grep -rn "₹\|en-IN" apps packages --include=*.ts --include=*.tsx` lists only tests, marketing copy, demo data and the helpers themselves (list each remaining hit in the change record with why); INR stores render exactly as before ("₹1,299"; ".50" only when there is a fraction); a USD market shows `$` everywhere a price appears (home, product, collection, search, mini cart, cart, checkout, order pages, emails); unit tests for each helper change; walk the storefront at 375 px and desktop in an INR and a USD market.

### WP-2: Markets admin UI (Settings > Markets)
Route(s) under `apps/admin/src/routes/_store/settings/markets*` following `docs/admin-ui-standards.md` (shared kit, no native `select`, `confirm-dialog`, drawers about 40 percent wide, border tokens, hints behind an (i) hover pop-up, every route has `pendingComponent`). Backend is done: use the `admin.markets.*` client.
- List: base badge, status, countries, currency, URL prefix, gateways, plan limit ("1 of 2 extra markets").
- "Add market" wizard with presets (USA/USD, Canada/CAD, India/INR, International/USD) and a readiness checklist (the API returns `readiness.items`).
- Editor tabs: General (name, currency, countries, URL prefix, unit system, tax display), Pricing (rate with last-updated and a 30-day staleness note, adjustment, rounding, a variant table from `listPrices` with inline fixed price and "clear", CSV import/export), Catalog (`all` / `selected`, per-product switch), Payments (the store's connected gateways, with each gateway's `blocking` and `warning` text), Shipping (link to the zones of this market; show a rate count), Returns and cancellation (merchant text, labelled examples to copy, never published defaults), Taxes (collect yes/no, shipping taxed, rows of country/region/name/rate), compliance acknowledgement (checkbox with the wording in plan 8.1; the API records who and when).
- Disabling, deleting (only without orders) and the downgrade note.
- Add the PayPal connect card to Settings > Payments (client id, secret, webhook id, sandbox/live; `saveCredentials` already accepts `mode`) and show PayPal and Stripe as "checkout live".
- Update the e2e specs' selectors if sidebar text changes. Add the sidebar entry behind `markets.manage`.
- Acceptance: each tab saves and re-reads; a market cannot be activated until the checklist is green (the API refuses, the UI explains); keyboard and 375 px checked; screenshots in `docs/test-evidence/`; e2e spec for create, price, activate.

### WP-3: Shipping, returns and policy surfaces per market
- Shipping settings UI: zones belong to a market (zone form gets a market selector; countries limited to the market's; rates shown in the market currency; weight tier fields in the market's unit system via `@bs/contracts/units`). Create/update/delete zone procedures must accept `marketId` (domain `orders/shipping-rates.ts` already filters by market; the admin write paths `updateAdminShippingSettings` and the zones procedures still assume India).
- Storefront: show the market's policy text (`order.policy_snapshot`, `market_policies`) on the order page, in the order emails and the return request flow; returns settings resolve market overrides over the store policy.
- Acceptance: a US zone with a USD rate and a weight tier in lb saves and prices a US order; the policy shown on an old order never changes after the merchant edits it; tests (real DB) for the admin shipping write paths with `marketId`.

### WP-4: Signup by country and the unit-system setting (Phases 1B and 1d)
- Signup (`apps/web/src/app/signup`, `domain/src/saas/signup.ts`, `provisioning.ts`): country picker from `platform_countries` (IN, US, CA); it sets currency, timezone, locale, unit system, default shipping zone (country and a sensible default rate), base market (name, handle, countries, tax display), and which tax-ID fields show (GSTIN only for India). Remove the hardcoded `IN`, `INR`, `Asia/Kolkata` defaults.
- Store settings UI: metric/imperial (`store_settings.unit_system`), default weight unit; product and variant weight inputs and shipping weight tiers use `@bs/contracts/units` (grams stay the stored value).
- Acceptance: a US and a Canadian test merchant sign up locally and get a USD/CAD store, an imperial or metric default, a matching zone; Indian signup unchanged (existing tests green); weight round-trips (1 lb entered stores 454 g and shows 1 lb); real-DB provisioning test per country.

### WP-5: Platform billing by PayPal for global merchants (Phase 4B)
Follow the Cashfree precedent (ADR-037, `docs/PLATFORM-BILLING-PLAN.md`): a third provider behind the existing billing seam in `saas/billing.ts`. Indian merchants keep Razorpay and INR; merchants outside India see the USD price (`plans.price_monthly_usd_cents`, `price_yearly_usd_cents`) and pay by PayPal. Sandbox only.
- Super Admin: set the USD price per plan; PayPal platform credentials as platform secrets (never `tenant_secrets`); webhook with idempotent settle; dunning follows the existing schedule.
- First verify in the PayPal sandbox whether **PayPal Subscriptions** works for the Brand Sewa account; if not, use the fallback in ADR-040 (Orders v2 payment link per billing cycle driven by the dunning schedule) and record which.
- Acceptance: a sandbox global merchant subscribes, renews, fails and is suspended; Indian billing unchanged; platform audit rows written (`audit-coverage.int.test.ts` stays green); change record says which PayPal mechanism is used and why.

### WP-4B (small, can ride with WP-5): quota and plan display
Plan limits UI in Super Admin (`max_extra_markets`), downgrade behaviour (extra markets disabled, newest first, never deleted; the API enforces creation only today).

### WP-6: SEO and sitemap per market
Sitemap includes each prefixed market's URLs (only products and collections that market sells), canonical for prefixed pages points to the prefixed URL, JSON-LD price and `priceCurrency` use the market, `hreflang` already emitted by the layout (verify it, add region-less fallbacks), robots unaffected. Acceptance: validate the output for an INR + USD store; no duplicate canonical; `x-default` is the base URL.

### WP-7: Test round and walkthrough
ZCode or Antigravity: run `pnpm gate:quick`, the full domain heavy suite, `pnpm --filter @bs/web test`, e2e against a local stack. Walk, at 375 px and desktop, the **Indian store selling abroad** (the first pilot): add a USD market, set a rate, create PayPal sandbox credentials, switch market from the banner and the switcher, buy in USD with PayPal sandbox and in INR with COD, check the order page, emails, admin order list and finance totals. Then a US-based store and a Canadian-based store. Record defects with steps in `docs/changes/` (`Type: test`). No live store, no live keys.

### WP-8: Docs and closing
`docs/ARCHITECTURE.md` sections 5, 7, 8, 9, 11, 14 (markets, resolution flow, routes, cache argument, env vars if any), `progress.md` (move the in-flight line, list known gaps honestly), a runbook note for the owner's compliance to-dos (PayPal purpose code and PAN, CA question on GST LUT, lawyer review of merchant terms), change records per package. Do not merge.


## 3A. Parallel lanes (what can run at the same time without conflicts)

Packages are split by the files they own. Run the packages of one **wave** in parallel, each in its own worktree and branch off `docs/multimarket-phase0`; Claude verifies each, merges the branches locally in the order shown, then the next wave starts from the merged result.

| Wave | Chat | Owns (may edit) | Must NOT touch |
|---|---|---|---|
| 1 | **WP-1a** storefront money | `apps/web/src/components/**` (cart, checkout summary, product, catalog, storefront, blocks/BlockRenderer), `apps/web/src/app/{cart,products,collections,categories,search}/**`, `packages/blocks/**` | `apps/web/src/components/checkout/CheckoutForm.tsx`, `apps/web/src/app/{signup,orders,o}/**`, anything in `packages/domain`, `apps/admin`, `apps/superadmin` |
| 1 | **WP-2** markets admin UI | new `apps/admin/src/routes/_store/settings/markets*`, `apps/admin/src/components/markets/**`, `settings/payments.tsx` (PayPal card), the admin sidebar entry | `settings/shipping.tsx`, `settings/plan-and-billing.tsx`, product forms, `packages/domain` (API already exists; if a missing field is needed, write it in Open questions) |
| 1 | **WP-5** PayPal platform billing | `packages/domain/src/saas/billing*.ts`, `dunning.ts`, `packages/payments` (platform side only), `apps/superadmin/src/pages/{Plans,integrations/BillingIntegrations}.tsx`, `apps/admin/src/routes/_store/settings/plan-and-billing.tsx`, migration **0090** | storefront, markets files, shipping |
| 1 | **WP-6** SEO and sitemap | `apps/web/src/app/sitemap.xml/**`, `robots.txt/**`, `packages/domain/src/storefront/seo.ts`, metadata functions of the product/collection pages (only the `generateMetadata` part) | component files (WP-1a), checkout |
| 2 | **WP-3** shipping and policy surfaces | `apps/admin/src/routes/_store/settings/shipping.tsx`, `packages/domain/src/orders/shipping-rates.ts`, `shipping-rules.ts`, `apps/web/src/app/{orders,o}/**`, `packages/domain/src/system/email-templates.ts` (policy text only), return flow files | markets admin files (WP-2), signup |
| 2 | **WP-4** signup by country and units | `apps/web/src/app/signup/**`, `packages/domain/src/saas/{signup,provisioning}.ts`, store-settings units UI, product and variant weight inputs (`apps/admin/src/components/product/**`), migration **0091** if needed | shipping settings (WP-3), billing (WP-5) |
| 2 | **WP-1b** domain and email money | `packages/domain/src/**` messages only (`orders/{discounts,manual-lifecycle,return-state-machine}.ts`, `storefront/coupons.ts`, `finance/*`, `segments`, `customers/import.ts`, `system/email-templates.ts` currency args outside WP-3's policy text) | anything WP-3 and WP-4 own |
| 3 | **WP-1c** admin and Super Admin money sweep | the remaining `₹`/`en-IN` in `apps/admin`, `apps/superadmin` and `packages/ui` | (everything else is merged already, so no conflicts) |
| 4 | **WP-7** test round, then **WP-8** docs | read-only, then docs | |

Rules that keep parallel chats from colliding:
1. **Own your files; convert the money in them.** Every chat that edits a file with a hardcoded `₹` converts it while it is there (this is why WP-1c is last and small).
2. **Shared files are append-only and small.** `packages/contracts/src/admin.ts`, `apps/web/src/server/api.ts`, `packages/domain/test/isolation.int.test.ts` and `packages/domain/src/index.ts` take new blocks at a clearly separate place (new object keys, new `case` lines, new `export *` lines). Prefer a new contract file over editing `admin.ts`. Do not reformat or reorder existing lines.
3. **Migrations:** only WP-5 (0090) and WP-4 (0091) may add one. Any other chat that needs a column writes it under Open questions.
4. **Do not edit** `docs/ARCHITECTURE.md`, `progress.md`, `docs/MULTIMARKET-HANDOFF.md` or another chat's change record. Put your doc changes in your own change record under "Docs to update"; Claude applies them once, after the merge (WP-8).
5. No chat pushes, opens or merges a PR. Claude merges the local branches one by one and resolves conflicts.

## 4. Where things are (storefront side, for WP-1 to WP-6)

- Resolution: `apps/web/src/middleware.ts` (prefix rewrite, `x-bs-market-prefix` and `x-bs-path` set only there), `apps/web/src/server/market.ts` (`getMarketContext`), `apps/web/src/lib/market-constants.ts`, `app/api/storefront/status/evaluate/route.ts` (returns `marketPrefixes`, 30 s in-process cache), `app/api/storefront/market/select/route.ts`.
- UI: `components/market/{MarketProvider,MarketBar}.tsx`; `app/layout.tsx` wraps children and writes hreflang.
- Cached loaders take `marketId` (`server/cached-storefront.ts`); pages obtain it from `getMarketContext(tenantId)`; a store with a single market passes `null` (nothing to scope).
- Cart and checkout: `app/api/storefront/cart*`, `app/cart/page.tsx`, `app/checkout/page.tsx`, `components/checkout/*`, `app/api/storefront/checkout/{place-order,pay,return}`.
- Domain entry points: `getStorefrontCheckoutOptions` (what the shopper may choose), `getOrCreateCart(rt, ctx, token, tx?, marketId?)`, `placeOrder`, `startHostedPayment`, `confirmHostedReturn`, `startPaymentByToken`.

## 5. Known gaps and risks to keep in view

- `BlockRenderer` does not yet pass currency into block product cards (WP-1); until then block grids on a USD market still format as INR even though the amounts are USD. **Do not enable a second market on a real store before WP-1 is verified.**
- Storefront client components still show `₹` (WP-1).
- Admin shipping write paths and the zone editor assume India (WP-3).
- Signup assumes India (WP-4).
- The sitemap and canonical are not market-aware (WP-6).
- The evaluate route's prefix cache means a new market answers on its URL within 30 seconds.
- A restrictive RLS policy on `products` (`market_visibility`) hides products from storefront reads in a market that does not sell them. It is inert whenever `app.market_id` is unset (admin, worker, base market, single-market stores). Treat any change to `withMarketScope` or migration 0089 as security-sensitive.
