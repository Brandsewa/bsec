# Discounts and offers upgrade plan

- **Status:** approved by the owner 2026-11-07 (section 8). Built on `feat/discounts-engine` (phases 0 to 5, section 9 lists what differs from this plan); not merged yet, see `progress.md` "In flight".
- **Author:** Claude (2026-11-07)
- **Area:** `packages/domain` (orders, storefront, admin), `packages/db` (marketing schema), `packages/contracts`, `apps/admin` discounts screens, `apps/web` cart, checkout and product page.
- **Related:** ADR-040 (markets), AGENTS.md rules 1, 4, 6, 12, 14. A new ADR (section 5.1) is required before Phase 1.

## 1. What exists today (audit, read from code on 2026-11-07)

| Piece | Where | State |
|---|---|---|
| `discounts` table | `packages/db/src/schema/marketing.ts` | Columns: `code` (null = automatic), `type` (`percent`, `fixed`, `free_shipping`, `buy_x_get_y`), `value`, `applies_to` jsonb, `min_subtotal`, `min_qty`, `customer_eligibility` jsonb, `usage_limit`, `per_customer_limit`, `used_count`, `combinable`, `starts_at`, `ends_at`, `status`, `show_on_storefront` |
| `discount_redemptions` | same file | One row per order, guarded `used_count` increment |
| Rules engine | `packages/domain/src/orders/discounts.ts` `evaluateDiscount` | One code; checks status, window, min subtotal, min qty, total usage. Applies `percent`, `fixed` (whole order) and `free_shipping`. Refuses `buy_x_get_y` and any `applies_to` other than `all` |
| Pricing | `packages/domain/src/orders/pricing.ts` | `priceOrder` + `allocateDiscount` (goods discount split across lines pro rata, tax on the net) |
| Cart | `packages/domain/src/storefront/cart.ts` | One code per cart (`discount_codes[0]`); re-validated on every load |
| Checkout | `packages/domain/src/orders/checkout.ts` | Server recompute, redeem inside the order transaction (good, matches rule 12) |
| Storefront coupon cards | `packages/domain/src/storefront/coupons.ts`, `apps/web/src/components/product/Coupon*.tsx` | Lists codes with "Show on storefront" |
| Admin | `apps/admin/src/routes/_store/discounts*.tsx` | List, create, edit. Create offers percent, fixed, free shipping; min order value; total and per-customer limits; combinable; schedule; storefront toggle |
| Shipping-rate "free above threshold" | `packages/domain/src/orders/shipping-rates.ts` | Store-wide shipping config, not a discount. Stays as is |
| Draft orders | `admin.orders.createDraft` | Manual order discount with reason (separate path) |

### 1.1 Requested types against today

| Requested type | Today | Action |
|---|---|---|
| 1. Amount off products (specific products or collections) | Not working: `applies_to` exists but checkout refuses it; no picker in admin | **Build** |
| 2. Buy X get Y (2+1, X free, by quantity) | Not working: type exists, checkout refuses it, admin hides it | **Build** |
| 3. Amount off order (percent or fixed on order total) | **Works** for percent and fixed on the whole order | **Upgrade** only (cap, tiers, product scope for eligibility). Not rebuilt |
| 4. Free shipping (flat, or above an amount) | **Works**: free-shipping code, optional minimum order value | **Upgrade** only (zone/market limit, max shipping waived). Not rebuilt |

### 1.2 Defects found while auditing (fix in Phase 0, before new types)

| # | Severity | Defect |
|---|---|---|
| D1 | High | **Automatic discounts never apply.** Admin says "leave the code empty to apply automatically", but the cart only evaluates the typed code (`discount_codes[0]`). A no-code discount can be created and does nothing |
| D2 | High (money) | `per_customer_limit` is saved but never checked at apply or redeem time |
| D3 | Medium | `combinable` is saved but ignored (one code per cart). The checkbox misleads merchants |
| D4 | Medium | `createAdminDiscount` writes no `audit_logs` row (update and delete do). Breaks AGENTS.md rule 6 |
| D5 | Medium, *confirm* | Fixed-amount codes: the admin tip says they apply only in the base currency, but `evaluateDiscount` does not check the cart currency. A ₹100 code (10000 paise) may apply as 100.00 of a foreign currency. Needs a real-DB test to confirm |
| D6 | Low | `min_qty` and `customer_eligibility` exist in the table but have no admin field and (eligibility) no checkout rule |
| D7 | Low | Order records keep only `discount_total` and per-line `discount_amount`; the code/title applied is only reachable through `discount_redemptions`. Invoices, refunds and reports need the applied discount on the order itself |

## 2. Research: what good platforms offer (2026)

Sources: Shopify discount docs (types, buy X get Y, combinations), Shopify Admin API 2026-10 `Discount` union, Indian checkout vendors (Shopflo, GoKwik, Nimbus, Cashfree one-click). Summary:

- **Shopify model** (the de facto standard merchants know): three classes, **product**, **order**, **shipping**; four types: amount off products, buy X get Y, amount off order, free shipping. Each is a **code or automatic**. Combinations are set per class (order + shipping, product + shipping, product + product). Buy X get Y has two triggers: buy a quantity, or spend an amount. Free item out of stock means no discount.
- **Indian D2C extras** (GoKwik, Shopflo, Nimbus): **prepaid discount** (extra off for UPI/card vs COD, because RTO on COD is far higher), COD fee waiver, cart-level tiered offers, free-shipping nudges, bank/card offers, first-order codes, influencer codes.
- **Common guardrails**: "X% off **up to ₹Y**" cap (very common in India), exclude items already on sale, minimum quantity, per-customer limit by phone/email (guest COD), one-use codes for retention.

### 2.1 Candidate additional types, ranked

| Rank | Type | Value for Indian D2C | Effort | Recommendation |
|---|---|---|---|---|
| 1 | **Percent with max cap** ("20% off up to ₹500") | Very high, expected by shoppers | S | Phase 1, an option on every percent discount |
| 2 | **Tiered / spend more save more** (₹999 → 10%, ₹1999 → 15%; or buy 2 → 10%, buy 3 → 15%) | High AOV lever | M | Phase 2 (order) and Phase 3 (quantity tiers on products) |
| 3 | **Free gift with purchase** (spend ₹1499, get product G free; auto-added) | High | M | Phase 3, a buy X get Y variant with an "amount spent" trigger and auto-add |
| 4 | **Bundle / mix and match** ("any 3 for ₹999") | High for apparel, beauty | M | Phase 3, fixed-price BXGY variant |
| 5 | **First order / new customer** | High | S | Phase 4 (customer eligibility) |
| 6 | **Customer-specific / tag or segment** (VIP, wholesale) | Medium | S | Phase 4 |
| 7 | **Bulk unique codes** (500 single-use codes for influencers, retention, CRM exports) | Medium-high | M | Phase 4 |
| 8 | **Shareable discount link** (`/discount/CODE` or `?discount=CODE` applies the code) | High for Instagram/WhatsApp traffic, cheap | S | Phase 4 |
| 9 | **Cart progress nudge** ("₹200 more for free shipping / for 15% off") | High conversion | S-M | Phase 5 (watch the JS budget, see 6.3) |
| 10 | **Prepaid / payment-method discount**, COD fee waiver | Very high in India | M | **Blocked**: online checkout is deferred by the owner (AGENTS.md rule 14). Design the condition now (section 5.3), switch on when online payment goes live |
| 11 | Abandoned-cart recovery codes | High | M | **Blocked**: email delivery is not live |
| 12 | Bank / card offers | Medium | L | Out of scope (needs a live gateway and bank BIN data) |
| 13 | Gift cards, store credit, loyalty points | High, but a different domain (liability ledger, not a discount) | L | Out of scope; separate plan if wanted |
| 14 | Scheduled sale price (compare-at) | Medium | S | Not a discount: product pricing. Separate small item if wanted |

## 3. Target model

Follow the Shopify classes so merchants recognise it, plus a cap and tiers.

| Class | Types | Applies to |
|---|---|---|
| `product` | `amount_off_products`, `buy_x_get_y` (incl. free gift, bundle price) | Matching cart lines |
| `order` | `amount_off_order` (flat, percent, tiered) | Goods subtotal, optionally only counting eligible products |
| `shipping` | `free_shipping` | Shipping charge (all or up to a cap; optional zones/markets) |

Each discount: **method** (`code` or `automatic`), **class**, **type**, a typed **rules** object, **eligibility** (all / new customers / tags / specific customers), **limits** (total, per customer, one per order), **combines with** (product / order / shipping), **schedule**, **status**.

Stacking default (owner to confirm, 8.2): at most **one order discount + one shipping discount + any number of product discounts on different lines**, and only if each discount allows combining with the other's class. Automatic discounts are evaluated on every cart load; when two non-combinable discounts compete, the one worth more to the shopper wins. At most **5 codes per cart** (Shopify's limit).

## 4. Phases

Each phase ends with the gate (AGENTS.md section 4), real-DB tests for money and limits, isolation mapping for new `admin.*` procedures, and a local walkthrough at 375 px and desktop.

### Phase 0: fix foundations (no new types)
1. Pure engine `packages/domain/src/discounts/engine.ts`: `evaluateCart(cart, candidateDiscounts, customer) → applications[]`. No DB access; called by cart, checkout and draft orders. Old `evaluateDiscount` becomes a thin wrapper.
2. Automatic discounts apply (D1). Per-customer limit enforced at apply and at redeem, by customer id, else normalised phone or email (D2), with a guarded insert in the order transaction.
3. Audit row on create (D4). Currency rule for fixed amounts (D5, see 8.4). Remove or wire the misleading `combinable` checkbox (D3).
4. New `order_discount_applications` table (tenantTable, `forceRlsSql`): order, discount, code, title, class, amount, target lines (D7). Shown on admin order detail, thank-you page, invoice email.

**Acceptance:** an automatic 10% discount applies to a cart with no code; a code with per-customer limit 1 is refused on the same phone's second COD order (real-DB test); the create action writes an audit row; a ₹ fixed code on a USD cart behaves per 8.4 (test); order detail shows the applied code; all existing discount tests still pass.

### Phase 1: amount off products + cap
- Rules: `{ valueType: percent|fixed, value, maxDiscount?, appliesTo: { products[], collections[] }, excludeOnSale?, minQty?, minSubtotal?, oncePerOrder? }`. Fixed means per item unless `oncePerOrder`.
- Only matching lines are discounted; allocation per line feeds tax as today.
- Percent cap ("up to ₹Y") added to order discounts too.
- Admin: type picker (four cards, Shopify-style) on `/discounts/new`, then a type-specific form using `product-picker-dialog` and a collection picker; summary card explains the offer in plain words.
- Storefront: product page coupon cards list only coupons that apply to that product.

**Acceptance:** 20% off collection "Shirts" discounts only shirt lines in a mixed cart; cap holds; excluded sale items are not discounted; tax is on the net line amount; the product page of a non-shirt does not show the shirt coupon.

### Phase 2: amount off order upgrades + free shipping upgrades
- Order: tiers `[{ minSubtotal | minQty, valueType, value }]`, highest reached tier wins; optional "count only eligible products towards the minimum".
- Free shipping: flat (any order) or above an amount (exists); add limit to shipping zones / markets and "waive up to ₹X" (so express is not fully free). Never edits shipping rates (rule 12/14: no courier code touched).

**Acceptance:** tier boundaries tested at minus one paisa, exact, plus one; free-shipping code limited to India does not apply to a US-market cart; waive-up-to leaves the remainder charged.

### Phase 3: buy X get Y, free gift, bundles
- Rules: `{ buy: { trigger: quantity|amount, value, appliesTo }, get: { quantity, appliesTo, effect: free|percent|fixed_price }, maxUsesPerOrder }`. Covers "buy 2 get 1", "buy X get X free", "buy 2 get 50% off the third", "spend ₹1499 get G free" and "any 3 for ₹999".
- Cheapest qualifying item is the free one (state it in the summary). Same product can be both X and Y.
- Free gift: optional auto-add of the gift line (₹0 line, own reservation); removed when the cart stops qualifying; out of stock means no gift and a clear notice.
- Quantity tiers on products ("buy 2 → 10%, buy 3 → 15%").

**Acceptance:** buy 2 get 1 with three items of different prices frees the cheapest; with six items applies twice unless `maxUsesPerOrder` = 1; gift auto-adds and auto-removes; refund of a paid line in a BXGY order refunds its allocated net (test).

### Phase 4: who gets it, and how codes travel
- Eligibility: all, new customers (no prior non-cancelled order by id/phone/email), customer tags, specific customers.
- Bulk unique codes: new `discount_codes` table (tenantTable) for one discount with N single-use codes; generate, export CSV, see usage. Code lookup checks both tables.
- Shareable link `/discount/CODE?redirect=/products/x` sets the code on the cart (storefront route + `loading.tsx`, rule 11).
- Multiple codes per cart (up to 5) using the stacking rules in section 3.

**Acceptance:** first-order code refused for a returning phone number; tagged-customer code refused for others; 500 codes generated, each usable once, concurrent redeem test proves no double use; link applies the code and lands on the target page.

### Phase 5: storefront nudges and reporting
- Cart and drawer progress bar towards the next tier / free shipping (server-computed numbers, no client pricing).
- "Offer applied" badges on cart lines; savings line in cart, checkout, thank-you, emails.
- Admin discount detail: uses, revenue, AOV and total given away, by date; list column "Applied automatically".
- e2e selectors updated if admin menu or labels change.

### Later (blocked or out of scope)
Prepaid / payment-method discount and COD fee waiver (blocked on online checkout, owner decision on record); abandoned-cart codes (blocked on email delivery); bank offers; gift cards, store credit, loyalty (separate plan).

## 5. Technical design notes

### 5.1 ADR
New ADR "Discount engine": classes, stacking and best-deal rule, pure-engine boundary, where applications are stored, currency rule. Required before Phase 1 (AGENTS.md section 1.5).

### 5.2 Schema (append-only, expand/migrate/contract, rule 10)
- Expand: add `method`, `discount_class`, `rules` jsonb (Zod schema in `packages/contracts`, versioned), `max_discount`, `combines_with` jsonb, `currency` (null = any, see 8.4). New tables `order_discount_applications`, `discount_codes`, both via `tenantTable()` + `forceRlsSql`, composite `tenantForeignKey`s.
- Migrate: backfill existing rows (`percent`/`fixed` → `amount_off_order`, `free_shipping` → `free_shipping`); engine reads new columns.
- Contract (a later release): stop reading old `type` values and `combinable`.

### 5.3 Conditions designed for later
The rules object has a `conditions` list (`payment_method`, `market`, `sales_channel`) so the prepaid discount slots in when online checkout is live, without another schema change. The engine re-prices when the shopper changes payment method; the final price is recomputed in `placeOrder` as today.

### 5.4 Correctness and abuse
- Server recomputes everything at checkout (rule 12); the client only sends codes.
- All redemption checks (total, per customer, single-use code) run in the order transaction with guarded updates; real-DB concurrency tests.
- Discount never takes a line below 0 or the order below the shipping + COD fee; rounding remainder on the last line (as `allocateDiscount` does).
- Cache: discount changes invalidate tenant-tagged storefront tags via `cache-invalidation.ts` (rule 5) so coupon cards stay correct.
- Permissions: `discounts.write` in every domain service (rule 4); audit rows for create/update/delete/code generation (rule 6).

### 5.5 Performance
Automatic discounts load once per cart evaluation (indexed `tenant_id, status, method`), evaluated in memory. Product page JS budget has almost no headroom (50 KB gz): coupon filtering is server-side; no new client bundle on the product page; nudges live on cart/drawer only, checked against the budget test.

## 6. Testing
- Unit: engine table tests per type, tier and stacking combination (`packages/domain/test/discount-engine.test.ts`).
- Real DB: limits, per-customer, single-use codes, concurrency, isolation of new tables (`packages/domain/test/discounts.int.test.ts`, `isolation.int.test.ts` mapping).
- Web: cart/checkout totals match `priceOrder`; product page coupon filtering.
- Manual walkthrough: admin create for each type, storefront apply, COD order, admin order detail.

## 7. Work split (proposal)
Phase 0 and the ADR: Claude (money and tenancy core). Phases 1 to 5: one builder per phase (Antigravity or ZCode) from prompts in `docs/prompts/`, Claude verifies each phase before the next starts.

## 8. Owner decisions (recorded 2026-11-07)
1. **Scope:** all phases (0-5). Blocked items in "Later" stay parked.
2. **Stacking:** Shopify-style (one order + one shipping + product discounts, each opting in; up to 5 codes; best deal wins a clash).
3. **Plan gating:** none for now; every plan gets every type. Gating can be added later as a plan feature flag.
4. **Fixed amounts in other markets:** base currency only. A fixed-amount discount is refused on a cart in another currency with a clear reason; percent and free shipping work everywhere.
5. **Sale items:** included by default; each discount has an "Exclude items already on sale" option.
6. **Prepaid discount:** stays parked until online checkout is live.

## 9. Implementation status (2026-11-07)

Built on `feat/discounts-engine`, one commit per phase. Where the build differs from the plan above:

| Phase | Built | Differs from the plan |
|---|---|---|
| 0 | Pure engine, automatic discounts, per-customer limit, audit row on create, base-currency rule, `order_discount_applications` shown on the admin order | D6: the engine supports a minimum item count (`min_qty`) but the admin form has no field for it yet. D5 was real (a fixed amount ignored the cart currency) and is fixed and tested |
| 1 | Amount off chosen products or collections (manual and automated collections), percent cap, leave out sale items, once per order, per-line allocation, product-page coupon filtering, admin kind cards and scope pickers | none |
| 2 | Tiers by amount or quantity (optionally counting only the chosen items), free shipping cap ("waive up to"), free shipping limited to markets | Free shipping is limited by **market**, not shipping zone: the cart knows its market, not its destination country |
| 3 | Buy X get Y (quantity or spend trigger, free, percent or fixed price, uses per order, different buy and get items), free gift by spend, bundle price | Auto-adding the free items to the cart was added in a follow-up (2026-11-08, migration 0104): the third item of "buy 2 get 1 free" and the gift of "spend 2,000, get a gift" now appear by themselves. Bundles group the cheapest items first so left-over expensive items pay full price |
| 4 | New, tagged and chosen customers, up to five codes per cart, generated single-use codes (admin panel, search, CSV export), shareable link | "New customer" means no order that was not cancelled, read from the orders. A tagged or chosen-customer code is accepted while browsing and enforced at checkout against the customer found from email or phone |
| 5 | Cart nudge towards the next automatic offer (server-side numbers), per-line offer amounts, Performance card and `admin.discounts.stats`, "Code list" label | The nudge shows on the cart page only (not the mini cart or checkout). The discount name is not yet on the shopper's thank-you page or order emails (they show the discount total) |

Still open: prepaid and payment-method discounts and COD fee waiver (online checkout is deferred by the owner), abandoned-cart codes (email delivery is not live), bank offers, gift cards and loyalty (out of scope).

