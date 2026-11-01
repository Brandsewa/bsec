# Plans and pricing strategy (draft for owner decision)

Status: proposal, 2026-11-01. Author: Claude. Nothing here is built. It feeds the plan editor and the intro-pricing work in `docs/PLATFORM-BILLING-PLAN.md`.

**Confidence note.** Competitor prices below come from search results, mostly third-party blogs that disagree with each other. They are good enough to position against, not to quote publicly. Check each vendor's own pricing page before we print a comparison anywhere. Shopify India figures are partly from the owner's screenshots of shopify.com/pricing (2026-11-01), which are the most reliable.

## 1. Market read

| Platform | Entry price | Mid | Top | Transaction fee on own gateway | Notes |
|---|---|---|---|---|---|
| Shopify India (owner screenshots) | Basic ₹1,994/mo, ₹1,800/mo yearly | Grow ₹7,447 / ₹6,700 | Advanced ₹30,164 / ₹27,100; Plus from ₹1,75,000 | 2% / 1% / 0.6% (Plus 0.2%) on top of the gateway's own fee | Promo: 3 days free, then ₹20/mo for 3 months. Prices ex-GST. Shopify Payments is not available in India, so every Indian merchant pays the fee. Staff: 5 on Grow, 15 on Advanced. |
| Shopify global | about $39 Basic | about $105 Grow | about $399 Advanced; Plus from about $2,300 | 2% / 1% / 0.6% without Shopify Payments | Sources differ on current names and prices. |
| Dukaan (India) | free tier, paid listings range ₹375 to ₹1,499 | up to ₹3,899 | up to ₹14,490 | per-order service fee on some tiers (reported) | Listings conflict; unverified. Cheap, chat-first, thin on D2C depth. |
| Zoho Commerce (India) | about ₹840 to ₹1,000 | about ₹2,100 to ₹3,000 | Premium / Plus | none reported | Good if the merchant already uses Zoho. Plan prices unverified. |
| Wix | $17 Light | $29 to $36 Core, $39 Business | $159 Business Elite | none from Wix | Cheap entry, site-builder feel. |
| Squarespace | $23 to $27 | $33 | n/a | 0 to 2% on the lowest commerce tier | Design-led. |
| BigCommerce | $39 | $105 | $399 | none (one source says a 2026 change added fees on unapproved gateways) | Strong catalog and B2B; revenue caps per plan. |

**What this tells us**

1. Shopify's real cost to an Indian store is the plan price plus a 0.6% to 2% platform cut on every online order. A store doing ₹4 lakh a month pays Shopify about ₹8,000 on Basic in fees alone, more than the plan.
2. Everyone gates by staff seats, reports and transaction fee. Almost nobody sells "India-specific operations" as a plan feature, because Indian operations (COD, pincode rules, GST invoices, RTO control) are bolted on with paid apps. That is the gap.
3. Intro pricing (₹20 for 3 months) is now the Indian norm. Our ₹10 for 3 months idea matches the market and also proves the mandate and payment path end to end.
4. Entry price of about ₹1,000 and mid of about ₹2,500 put us at roughly half of Shopify, at a level Dukaan and Zoho already occupy, but with Shopify-class storefront depth.

## 2. Positioning

> **Built for Indian D2C, ready for the world. No platform transaction fee on any plan.**

- Do not fight Shopify on ecosystem (apps, themes, POS, Capital). We cannot win that and should not claim it.
- Win on: **zero transaction fee, COD and GST handled natively, multi-market selling from day one, and an agent-ready catalogue**. Each is a real, checkable claim.
- Honest limits stay honest: we run on a small shared platform, so product, order and storage limits are real numbers, not "unlimited". Say the number.

## 3. The three plans (proposal)

Keep three public plans, since the database already has three (`starter`, `growth`, `pro`). Rename the codes only if the owner wants new marketing names; codes can stay.

| | **Starter** | **Growth** (most popular) | **Scale** (today's `pro`) |
|---|---|---|---|
| For | new brands and solo founders | growing brands with a small team | established brands selling in more than one market |
| India price / month | ₹999 | ₹4,999 | ₹9,999 |
| India price / month, yearly billing | ₹833 (₹9,990 per year) | ₹4,166 (₹49,990 per year) | ₹8,333 (₹99,990 per year) |
| Global price / month (USD, PayPal), suggested | $15 | $59 | $119 |
| Intro offer | India ₹10 a month for 3 months; global $1 a month for 2 months, then list price (all plans) | same | same |
| Platform transaction fee | **0%** | **0%** | **0%** |
| Products | 1,000 | 5,000 | 10,000 |
| Variants (sizes, colours; counted separately) | 3,000 | 15,000 | 30,000 |
| Orders per month | no cap shown; fair-use review above 2,000 | no cap shown; review above 10,000 | no cap shown; review above 50,000 |
| Staff accounts | 2 | 5 | 15 |
| Media storage | 5 GB | 25 GB | 100 GB |
| Custom domains | 1 | 3 | 10 |
| Emails per month (all store emails, soft cap) | 2,000 | 6,000 | 25,000 |
| SMS | paid add-on with prepaid credits (not part of the plan) | same | same |
| Extra selling markets (country, currency, shipping) | 0 (home market only) | 2 | 5 |
| Remove "Powered by Brand Sewa" | no | yes | yes |
| Custom product fields | no | yes | yes |
| Support | email, help centre | priority email | priority email and chat (and onboarding call) |

**Limits changed by the owner on 2026-11-01 (second round: products 1,000 / 5,000 / 10,000; international markets from Growth only):** products 1,000 / 5,000 / 10,000, variants counted separately at 3,000 / 15,000 / 30,000, no visible order cap (decided 2026-11-01, see section 11), and prices ₹999 / ₹4,999 / ₹9,999; more of either is sold later as an add-on (section 9).

**Enforcement does not match the old advertised numbers.** Starter's extra-markets limit is 1 today and becomes 0, so existing Starter stores with an extra market need a decision (grandfather or move up). The database `plans.limits` text says 500 / 5,000 / 25,000 products and 300 / 3,000 / 20,000 orders, but what is enforced comes from the size tiers (`quota_tier_limits`, via `TIER_FOR_PLAN`: Starter = S, Growth = M, Pro = L). Today S allows 500 products and 3,000 orders, M 5,000 and 20,000, L 25,000 and 1,000,000. Variants are a separate quota today (S 2,000, M 20,000, L 100,000); the owner chose to keep them separate with looser limits (about three variants per product), so no combined rule is needed. The limits move from 2,000 / 20,000 / 100,000 to 3,000 / 15,000 / 30,000. Adopting the new numbers means changing the tier limits (or giving each plan its own limits) and the plan rows together, and the editor must show the enforced value so the two cannot drift.

**Global prices**: set for the PayPal USD path, scaled up from the owner's new INR prices (₹4,999 is about $58, ₹9,999 about $118). $15 / $59 / $119 sit under Shopify Grow and BigCommerce Growth/Scale and are an owner decision. Subject to PayPal fee check (about 3.5% to 5% on small ticket) and the owner's margin.

**Yearly**: two months free (about 17% off). Shopify's yearly discount is about 10%, so this is a visible but affordable hook.

## 4. What each plan says: short version (cards on signup and in Plan and billing)

**Starter** — "Launch your brand"
- Online store with themes and the page builder
- COD, UPI and cards through your own gateway (0% platform fee)
- GST invoices and PIN code serviceability
- Up to 1,000 products (3,000 variants)
- Sell in your home market (India for Indian stores)
- 1 custom domain, 2 staff

**Growth** — "Grow without per-order fees"
- Everything in Starter
- 5,000 products (15,000 variants), 5 staff
- Sell worldwide: 2 extra markets with their own currency, prices and shipping
- 3 custom domains
- Remove Brand Sewa branding
- Custom product fields, customer segments, abandoned checkout recovery
- Priority support

**Scale** — "Sell in more markets"
- Everything in Growth
- 10,000 products (30,000 variants), 15 staff
- 5 extra markets with their own currency and prices
- 10 custom domains, 100 GB storage
- Chat support and an onboarding call

Footer on every card: **No transaction fees. Ever.** and a "Compare all features" link.

## 5. Long version (compare table)

Groups, in order. Cells are a tick, a number or "Coming soon". The plan editor must support exactly these row types (see section 8).

**Pricing**: monthly, yearly (per month), intro offer, transaction fee (0%).

**Core store (all plans)**: themes and page builder; unlimited pages and blog; products, variants, collections; discounts and promotions; customer accounts; product bulk import and export; mobile-friendly storefront; SEO basics (sitemap, meta, redirects).

**India operations**: cash on delivery; PIN code serviceability and per-store shipping rates; GST engine and tax invoices; returns and credit notes; abandoned checkout recovery; order tracking page.

**Selling worldwide (Growth and Scale only)**: extra markets (none / 2 / 5); per-market currency and prices; per-market shipping zones and tax; market URL prefixes with hreflang; PayPal, Stripe and Razorpay on your own account.

**Growth tools**: customer segments; custom product fields; notification manager (email templates); staff roles and permissions; activity log.

**Limits**: products, variants, emails per month, staff, custom domains, emails per month; storage as a generous "5 / 25 / 100 GB" row only in the compare table.

**Brand and domain**: custom domain; remove platform branding; free SSL.

**Support**: help centre; email; priority; chat; onboarding call.

**Coming soon (shown with a "Soon" tag, never as a tick)**

| Item | Plans | Honest status |
|---|---|---|
| Agent-ready catalogue: structured product feed, `llms.txt`, schema markup | all | We can build this from catalogue data we already hold. |
| Agent protocols (Google UCP and OpenAI ACP) | Growth, Scale | Needs a spike. Reports say ChatGPT Instant Checkout was scaled back in March 2026 and discovery is the live part; UCP launched January 2026 with Shopify and Google. Sell this as "discoverable by AI shopping agents", not "checkout inside ChatGPT". |
| Store API and MCP access for your own AI agents | Scale | Natural fit with the contracts-first API. |
| WhatsApp order confirmation and COD-to-prepaid nudges | Growth, Scale | Strong India RTO story (COD is roughly half or more of D2C orders in the sources we found). Needs a WhatsApp provider decision. |
| COD OTP verification and risk flags | Growth, Scale | Same. |
| Courier and shipping labels | all | Owner has deferred shipping integrations; keep it off the page or tag "Soon" only on the owner's say. |
| Online payment live checkout for platform default | all | Per-store gateways work now; do not imply more. |

The "agentic ready" promise is the one place we can be early. Because the real protocols are still moving, the page should say "Agent-ready: coming soon", collect interest, and avoid dates.

## 6. Intro offer and billing rules this implies

- India: ₹10 a month for the first 3 months on every plan, then list price. Global: $1 a month for the first 2 months. Free trial length: owner decision (Shopify uses 3 days; we have 14).
- The intro price must be a **plan-level, per-market setting** (price, number of cycles), shown on cards and invoices. It is not a coupon.
- Gateway mechanics differ: Razorpay and PayPal Subscriptions support a different first-cycle price. Cashfree charges one amount per cycle, so it needs a separate design. This goes in the billing plan, not here.
- GST: confirm with the CA whether the ₹10 is billed with 18% GST and whether the foreign USD invoices need an LUT.

## 7. Risks and open questions for the owner

1. Keep today's names (Starter, Growth, Pro) or rename (suggest Scale for the top plan)?
2. Prices set by the owner (2026-11-01): ₹999 / ₹4,999 / ₹9,999. The database still has ₹999 / 2,499 / 5,999, so Growth and Pro need a price change and new Razorpay plans; USD prices are suggestions.
3. Free trial plus intro offer, or intro offer only? Both lowers drop-off but delays the first real payment by months.
4. "0% transaction fee on every plan": confirm we never want to add a fee later, because we are about to print it.
5. Which coming-soon items to show publicly, and on which plans.
6. Competitor numbers in section 1 are unverified. Do not publish a comparison table until checked.
7. Cashfree intro pricing design, PayPal Subscriptions and sandbox runs are still open in the billing plan.

## 8. What the plan editor must support

From sections 4 and 5, the Super Admin plan editor needs, per plan:

- name, tagline, "for" line, badge ("Most popular"), sort, public on or off
- prices: INR monthly and yearly, USD monthly and yearly, intro price and number of cycles per market
- short card bullets (ordered list)
- compare table rows: group, label, tooltip, value per plan (tick, none, text, number, "Soon")
- real limits and flags stay in `limits` and `features` (these drive enforcement); the display rows are a separate editable layer, optionally linked to a limit so the number cannot drift from the enforced value
- one renderer shared by signup, Plan and billing, and the marketing site

## 9. Ways to earn beyond the subscription (to plan and model later)

Principle: keep "0% transaction fee on every plan" (decision pending, section 7). Earn from things that cost us something to run, or from stores outgrowing their plan. Nothing below is built; each needs its own plan before work starts.

| Idea | How it earns | Effort | Notes |
|---|---|---|---|
| Plan upgrades as a store grows | product and variant limits, markets, staff and features push Starter to Growth (about 2.5 times the price) and Growth to Scale | low (limit warnings and an upgrade prompt exist in part) | The main lever. Warn at 80%, upgrade in one click. |
| Order and product add-on packs | for example +500 orders a month or +500 products, monthly | medium (billing add-ons, quota overrides already exist) | The owner's idea for beyond the limits. Needs add-ons in the billing engine. |
| WhatsApp order confirmation and COD to prepaid nudges | per-message credits with a margin over the provider cost | high (provider choice, templates, consent) | Strongest India fit: cuts return-to-origin losses. |
| COD OTP and risk checks | per check or monthly bundle | high | Same buyer as above. |
| Extra email volume | monthly packs above the plan allowance (for example +5,000 emails) | low | Uses the existing email quota. About ₹21 of cost per 1,000 emails, so price packs at a healthy margin. |
| SMS credits (prepaid wallet) | merchant tops up credits, each SMS deducts; margin on the per-SMS price | high | See section 12. Same wallet can later carry WhatsApp and COD OTP. |
| Extra staff seats and storage | small monthly add-ons | low | Cheap to run, easy to explain. |
| Extra markets | monthly per extra market above the plan allowance | low | Markets are already limited per plan. |
| Gateway referral or reseller commission | Razorpay, Cashfree, PayPal partner programmes pay us when merchants sign up | low to medium | Merchant pays nothing extra. Check each programme's terms. |
| Done-for-you setup | one-time fee: theme setup, product import, domain and gateway setup | service, not code | Good early revenue and learning. |
| Premium themes or templates | one-time or monthly | medium | Later, once there are enough stores. |
| Agent-ready features | included in Growth and Scale, or a paid bundle (feed, protocols, store API and MCP) | high | Only when the protocols are stable. |
| Domain resale | margin on domain registration | medium | Small, but it adds convenience. |
| Optional "plan plus per-order fee" choice | a cheaper plan with a stated 1% fee, chosen at signup | medium | Only if shown on day one; conflicts with the "no fee on any plan" headline, so it needs an owner decision. |

To model next: a simple sheet with stores by plan, add-on take rate, churn and support cost, to see what mix pays for a team of a given size. The earlier estimate was about 300 stores at an average of ₹1,500 to ₹2,000 each for a small team.

## 10. Capacity check (database size, traffic, load)

Estimates, not measurements; nothing was load-tested. Server assumed KVM4 (4 cores, 16 GB RAM, 200 GB disk, shared with other Brand Sewa projects). Media lives on R2, not on this disk.

**Database size.** A product row is about 5 KB and a variant about 2 KB with indexes; an order with items, addresses and events is about 10 KB.

| Store at its limits | Products | Variants | Orders per year | Database |
|---|---|---|---|---|
| Starter | 1,000 (5 MB) | 3,000 (6 MB) | 3,600 (36 MB) | about 50 to 100 MB per year |
| Growth | 5,000 (25 MB) | 15,000 (30 MB) | 12,000 (120 MB) | about 200 to 300 MB per year |
| Scale | 10,000 (50 MB) | 30,000 (60 MB) | 60,000 (600 MB) | about 0.8 to 1.2 GB per year |

Worst case, with a planned mix of 200 Starter, 60 Growth and 15 Scale stores all at their limits: about 2 million variant rows, roughly 10 GB the first year. Real stores sit at 20% to 40% of their limits, so expect 2 to 4 GB. Disk and the Postgres cache are fine on KVM4.

**Traffic.** Assume about 2% of visits become orders and about 5 pages per visit.

| Store at its order limit | Visits per month | Page views per month |
|---|---|---|
| Starter (300 orders) | about 15,000 | about 75,000 |
| Growth (1,000) | about 50,000 | about 250,000 |
| Scale (5,000) | about 250,000 | about 1.2 million |

All 275 stores at their limits: about 40 million page views a month, about 15 a second on average and perhaps 150 a second at peak. Storefront pages are cached, so only a share reaches the server. At realistic usage (a third of the limits), peaks are well within 4 cores. At the full mix at the limits, one box is tight, which is the signal to move Postgres to its own server. Orders themselves are light: the whole mix at its limits is about 195,000 orders a month, about 4 a minute on average.

**What bigger catalogues actually cost.** Bigger variant counts slow admin lists, imports, exports and the sitemap, not shoppers. The existing quotas (admin API and storefront requests per minute, daily exports, job concurrency) already protect the box per tier. Keep them, and consider a per-product variant cap (Shopify's is 2,048 per product, BigCommerce reportedly 600).

**Upgrade triggers.** Postgres memory pressure, sustained CPU above about 60%, or about 30 to 50 active stores, whichever comes first.

## 11. Do competitors cap orders per month?

Short answer: none that I found. The owner was right to doubt it.

| Platform | Monthly order cap? | Other fences |
|---|---|---|
| Shopify | None found on any current plan (unlimited products and orders reported) | staff seats, locations, transaction fee, reports, Plus-only features; 2,048 variants per product, 3 options |
| Wix | None found | storage, features per plan |
| Squarespace | None found | transaction fee on the lowest plan |
| BigCommerce | No order cap, but reported annual sales caps (Core about $30K a year, then auto-upgrade; sources disagree) | 600 variants per product (one source) |
| Zoho Commerce | No monthly cap; an older article reports a $150,000 yearly online-sales cap | features per plan |
| Dukaan | None found | features per plan |

Sources are third-party and sometimes older than the current plans; Shopify's own plan pages should be checked before we print anything.

**What this means for us.**
- A visible "300 orders a month" is unusual and will read as a limitation. Orders cost us almost nothing (about 10 KB each), so the cap is a pricing fence, not a cost control.
- Never block checkout: an order we refuse is a sale the merchant loses. The quota is already "soft" (warns, does not block); keep it that way.
- Options: (A) keep the limits as "included orders", warn at 80% and 100%, and later bill add-on packs for extra orders; (B) drop order caps from the cards and fence upgrades on markets, staff, products, support and agent features instead.
- **Decision (owner, 2026-11-01): B, no order cap on the cards.** Fair-use review thresholds stay internal (below).
- Original recommendation was A, worded as "includes 300 orders a month" with a friendly nudge, because it is the fairest way to link price to success. If the merchant is likely to compare us with Shopify's unlimited orders, B is safer for acquisition. This is an owner decision.

**Why others can skip the cap, and what we do instead.** Shopify and Squarespace earn from every order through their transaction fee, so more orders means more revenue and no cap is needed. We have chosen no per-order fee, so orders bring us cost (email, support, load) but no revenue. The fence has to move elsewhere:

1. **Fence on what costs us or marks a bigger business:** extra markets (Growth and up), staff seats, products and variants, custom domains, support level, and Growth-only tools (segments, custom fields, branding removal, agent-ready features).
2. **Earn from per-order services as add-ons:** transactional email packs, WhatsApp confirmations, COD OTP checks. They scale with orders and are the per-order revenue in disguise (section 9).
3. **Keep an unadvertised fair-use review** (monthly orders above 2,000 on Starter, 10,000 on Growth, 50,000 on Scale): never block checkout, but contact the merchant and move them to the right plan. Put it in the terms. This stops a very large store sitting on ₹999.
4. **Watch the real numbers** for the first 6 months (orders per store, emails per order, support tickets per order) and revisit the thresholds with data.

## 12. Email caps and SMS credits

**Emails: what a cap should count (best practice).** Transactional mail (order confirmation, shipping update, password reset, invoice) is what a store cannot run without, so it is never blocked. Marketing and campaign mail is what gets capped, because that is what abuses sender reputation and costs money. Our quota today is one soft number (`emails_month`, tier S 15,000, M 80,000, L 300,000), which is far above the owner's examples.

**Cost reality.** At about $2.5 per 10,000 emails on ZeptoMail (an assumption to check), one email costs about ₹0.02. 15,000 emails is about ₹315 a month, a third of a Starter plan, so the current number is too generous. An order sends about 3 emails (confirmation, shipped, delivered), plus abandoned-checkout reminders, so a store with 300 orders sends roughly 900 to 1,200 transactional emails a month. A 500 cap would stop a Starter store at around 170 orders, so it cannot count transactional mail.

**Proposal.**

| | Starter | Growth | Scale |
|---|---|---|---|
| Emails per month included (all kinds) | 2,000 | 6,000 | 25,000 |
| Worst-case cost at ₹0.02 each | about ₹42 | about ₹126 | about ₹525 |
| Share of net plan revenue | 5% | 3% | 6% |

- Soft cap: warn at 80% and 100%.
- After 100%, campaign and reminder mail pauses; order and account mail keeps flowing until twice the cap, then the merchant is contacted. Never drop an order confirmation.
- Extra emails are sold as add-on packs (section 9).
- Per-notification caps (for example 500 a month for one notification type) are not needed for now; the notification manager already controls which notifications are on.

**SMS: separate from the plans.**
- A plan does not include SMS. The plan editor only decides **who may buy it** (a yes/no per plan) and the **price per SMS** lives in a separate add-ons and credits settings page.
- It is a prepaid wallet, not a monthly quota: the merchant tops up through our gateway (Razorpay, Cashfree or PayPal), each SMS deducts, a low-balance alert goes out, and sending stops at zero balance.
- India needs DLT registration (TRAI): a registered sender ID and approved message templates per merchant or per platform. This is the main work and risk, so it needs its own plan and a provider decision (for example MSG91, Gupshup or Twilio) before any build.
- Top-ups need GST invoices like plans do, and a ledger of credits and debits for disputes.
- Design it once as a generic credits wallet, so WhatsApp messages and COD OTP checks (section 9) can use the same balance.

## Sources (search results, unverified third parties unless noted)

- Shopify pricing page, owner screenshots 2026-11-01
- https://sociolabs.in/shopify-pricing-india-2026-plans-costs-guide/
- https://payglocal.in/blog/shopify-pricing-india
- https://ecommerce-platforms.com/articles/shopify-pricing-in-india
- https://www.blackbeltcommerce.com/compare-shopify-vs-wix-vs-squarespace-find-your-best-fit/
- https://theguidex.com/resources/best-shopify-alternatives
- https://www.swell.is/content/zoho-commerce-pricing
- https://www.softwaresuggest.com/dukaan/pricing
- https://naturaily.com/blog/agentic-commerce-shopify-guide
- https://www.hillteck.com/blog/reduce-rto-ecommerce.html
