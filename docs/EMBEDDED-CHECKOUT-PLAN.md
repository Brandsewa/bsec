# Embedded checkout plan: merchant checkout (Stripe, Razorpay) and platform billing (Razorpay, India and international)

Status: plan, not started (2026-11-15). Research and plan only; no code changed. Builder: Claude Code unless the owner assigns another. Follows ADR-008 (provider adapter), ADR-014 (billing is separate from store checkout), ADR-040 section 5 and 6 (gateways, Brand Sewa's own billing), `PLATFORM-BILLING-PLAN.md`, `ADMIN-IMPROVEMENTS-PLAN.md` 6.4. Rule 14 of `AGENTS.md` applies: test or sandbox mode only until the owner says otherwise (the owner lifted it for Razorpay store checkout on 2026-10-26).

## 1. Goal

1. A shopper pays on the store's own checkout page without leaving it: Stripe card form in the page, Razorpay in its overlay window. No redirect to a provider page for Stripe.
2. A merchant pays Brand Sewa for their plan inside the admin app, in an on-page Razorpay window, for Indian stores (INR) and stores outside India (USD), with automatic renewal for both.

## 1a. Owner decisions (2026-11-15)

1. **Razorpay stays in its current pop-up window** (Standard Checkout). No Magic Checkout, no custom card fields. Only Stripe moves to embedded.
2. **Check Razorpay QuickBuy on Standard Checkout** (section 4.1a).
3. **Platform billing defaults:** India = Razorpay, backup Cashfree. International = PayPal, backup Razorpay (USD cards). See 5.2.

## 2. What exists today (read from code, not run)

| Area | State |
|---|---|
| Store checkout, Razorpay | Already an on-page window: `apps/web/src/lib/razorpay-client.ts` loads `checkout.razorpay.com/v1/checkout.js` and opens the Standard Checkout modal; `/api/storefront/checkout/razorpay/verify` checks the signature; webhook is a backstop (`2026-10-26-claude-razorpay-checkout.md`). |
| Store checkout, Stripe | Hosted redirect: `StripeProvider.createIntent` creates a Checkout Session and the shopper is sent to `checkoutUrl` (`payments/online-checkout.ts`, `CheckoutForm.tsx:356`). No Stripe script on our pages. Per-store secret key only; **no publishable key is stored**. API version pinned `2025-09-30.clover`. |
| Platform billing, Razorpay | `RazorpaySubscriptionProvider.createSubscription` returns Razorpay's `short_url`; admin does `window.location.assign(checkoutUrl)` (`activate-store.tsx`, `admin/plan-and-billing.ts:728`). A hosted page, not on-page. |
| Platform billing, Cashfree | Already on-page via its JS SDK (`openCashfreeCheckout`). |
| Platform billing, international | PayPal one-time Orders in USD. **No auto-renewal** (known gap in `2026-11-01-claude-platform-billing-gateways.md`). Stripe is a disabled "Build later" row. |
| CSP | No Content-Security-Policy is set by the apps today (only on media downloads), so no allow-list change is needed now; section 7 covers adding one later. |

## 3. Research findings (provider docs, checked 2026-11-15)

**Stripe Embedded Checkout** ([quickstart](https://docs.stripe.com/checkout/embedded/quickstart)):
- Same Checkout Session API, but `ui_mode` is set to the embedded value and the response carries a `client_secret` instead of a `url`. The browser mounts it with Stripe.js.
- Naming is in flux: the current quickstart says `ui_mode: embedded_page`; older samples say `embedded`; the client method `initEmbeddedCheckout` was renamed `createEmbeddedCheckoutPage` ([changelog 2026-03-25](https://docs.stripe.com/changelog/dahlia/2026-03-25/rename-init-embedded-checkout-to-create-embedded-checkout-page)) and the old name throws on the new API version. **Our pinned API version (`2025-09-30.clover`) must be matched to the Stripe.js version; check in slice S0 before writing code.**
- `return_url` (must hold `{CHECKOUT_SESSION_ID}`) replaces `success_url`; `cancel_url` is **not allowed** in embedded mode, so abandon handling needs another route (section 5.1).
- Do not place Checkout inside another iframe (some methods redirect).
- CSP hosts per Stripe's [security guide](https://docs.stripe.com/security/guide): `checkout.stripe.com` in `script-src`, `frame-src`, `connect-src`; `*.stripe.com` in `img-src`; Stripe.js adds `js.stripe.com` and `api.stripe.com`, and 3-D Secure needs `hooks.stripe.com`.
- Stripe in India is invite-only for cross-border; INR payouts only; no automatic FIRC/eFIRC ([Stripe India support](https://support.stripe.com/questions/cross-border-payment-services-in-india), [exports](https://docs.stripe.com/india-exports)). This is the merchant's own account (we keep per-store keys, no Connect), so we must tell merchants, not solve it.

**Razorpay**:
- Standard Checkout is an overlay window by design ([docs](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps)). I found no inline-in-page variant of Standard Checkout. Razorpay's "embedded" options are separate products (Magic Checkout, custom UI), with more PCI scope and onboarding. **Decision proposed: the overlay window is Razorpay's "embedded" experience; do not build custom card fields.**
- Subscriptions plug into the same window: pass `subscription_id` instead of `order_id` ([subscriptions guide](https://razorpay.com/docs/payments/subscriptions/integration-guide.md)). The success callback returns the payment id, subscription id and a signature we verify on the server.
- International recurring: USD is on the supported currency list for cards, UPI is INR only, settlement is in INR ([subscriptions page](https://razorpay.com/subscriptions/), [international subscriptions](https://razorpay.com/blog/international-subscriptions-india/)). Needs international payments **and** international recurring enabled on the platform's Razorpay account by Razorpay support; sources disagree on details, so this is the first thing to confirm (open question Q1).
- No official CSP host list found. Expect `checkout.razorpay.com`, `api.razorpay.com`, `cdn.razorpay.com` in `script-src`/`frame-src`/`connect-src`; verify in the browser console.

## 4. Part 1: merchant checkout

### 4.1 Razorpay (store checkout): nothing to rebuild, harden

The window is already on-page and live-capable. Remaining work from the 2026-10-26 follow-ups, in scope here because they decide whether it is "done":
- R1. Expire unpaid online orders and release stock (no expiry job today).
- R2. Refund from admin through `RazorpayProvider.refund` (today refunds are recorded by hand).
- R3. Keep the browser-first settle plus webhook backstop; add a test that a payment captured after the shopper closed the window still settles via webhook.
- R4. Pass `method` hints and `theme` from store settings; no new data.

### 4.1a Razorpay QuickBuy on Standard Checkout

Read from Razorpay's [QuickBuy docs](https://razorpay.com/docs/payments/payment-gateway/features/quickbuy/) and [QuickBuy 2.0 post](https://razorpay.com/blog/quickbuy-the-future-is-now/):
- A half-page overlay for **returning shoppers who are logged in to Razorpay Checkout** on that device: pre-selects their most-used method (UPI intent, saved UPI, saved cards), auto-applies the best offer, one tap to pay. Anyone else sees the normal window.
- **India, mobile only** (mobile web plus native SDKs). Not shown on desktop.
- **On by default** for eligible Standard Checkout merchants on mobile web; no `checkout.js` option or code change is documented. Disabling is via Razorpay support (docs) or the dashboard (blog; sources disagree).
- No fee is mentioned. Subscriptions are **not mentioned**, so assume it does not apply to platform billing until Razorpay confirms.

What this means for us: **nothing to build; it should already work** on our `payWithRazorpay` flow because that is Standard Checkout with a server-created order. It cannot be switched on from our code. To make it as likely as possible to appear: keep passing `order_id`, and keep prefilling `contact` and `email` (already done in `razorpay-client.ts`). Acceptance (slice R0): on a real phone with a Razorpay-remembered number, a test-mode payment shows QuickBuy; if it does not, ask Razorpay support whether it is enabled for the account and whether test mode shows it. A separate "Embedded Quick Buy" (saved method shown on our cart/product page) exists in Razorpay's docs; I did not read it and it would add script weight to pages under the 50 KB budget, so it is **not** proposed.

### 4.2 Stripe (store checkout): hosted redirect to embedded

Design (additive; hosted stays as fallback behind a per-store flag until verified):
1. **Credentials:** store a Stripe **publishable key** per store next to the secret key and webhook secret (`tenant_secrets`, same `TENANT_SECRETS_KEY` scheme). It is public by design but must match the secret key's account and mode; validate the prefix (`pk_test_`/`pk_live_` against `sk_test_`/`sk_live_`) and extend "Test connection" to compare the account id from `GET /v1/account` with the key's. Admin shows set/not-set only for secrets; the publishable key may be shown.
2. **Provider:** `StripeProvider.createIntent` takes `uiMode: "hosted" | "embedded"`. Embedded sends the embedded `ui_mode` and `return_url`, omits `cancel_url`, returns `clientSecret` (no `checkoutUrl`). Keep the idempotency key `bsec-checkout-<orderId>`; note that a session is single-use and expires (Stripe default 24 h), so "Pay now" must create a new session when the old one is expired or complete.
3. **Domain:** `startHostedPayment` returns `{ kind: "embedded", clientSecret, publishableKey }` for Stripe. `confirmHostedReturn` is unchanged (it already reads the session with the store's secret key and settles through `settleProviderPayment`, checking amount and currency).
4. **Web:** a lazy `StripeEmbeddedCheckout` component on the checkout page. `loadStripe` runs only after the shopper picks Stripe, so the product page JS budget (50 KB gz) is untouched; verify with the existing page-speed test. The shopper's return page is `/api/storefront/checkout/return?provider=stripe&ot=…&session_id={CHECKOUT_SESSION_ID}`.
5. **Abandon:** with no `cancel_url`, "changed my mind" is a button in our own UI that calls the existing abandon route and unmounts the form; unpaid orders also fall under the R1 expiry job.
6. **Webhook:** unchanged (`checkout.session.completed` / `async_payment_*` already handled). Add `checkout.session.expired` so an expired embedded session cancels the held order.
7. **Tenancy and money:** amounts stay server-recomputed (rule 12); the client secret is returned only for the order the order token proves; rate-limit the new start route like the Razorpay one.

Not chosen: Payment Element on our own PaymentIntent (more code, we own more edge cases), Stripe Connect (India cross-border limits, platform liability, ADR-040 section 4 says we stay a software provider).

## 5. Part 2: platform billing

### 5.1 Razorpay on-page for Indian stores (INR)

- Replace the `short_url` redirect with the checkout window: the subscribe procedure returns `{ provider: "razorpay", keyId, subscriptionId }` (key id is public; the secret never leaves the server). The admin app loads `checkout.js`, opens it with `subscription_id`, and on success posts the three returned values to a new `confirmSubscriptionPayment` procedure that verifies the signature with the platform secret.
- **Source of truth stays the webhook** (as in `activate-store.tsx` today: "the gateway's signed webhook, never this page"). The signature check only lets the UI show "Confirming…" sooner; it must not activate the store by itself. The signature is HMAC-SHA256 over `payment_id|subscription_id` for subscriptions (confirm exact formula against the docs in slice P0, it differs from the order one).
- Keep `short_url` as fallback if `checkout.js` fails to load or is blocked (the page already handles `res.checkoutUrl`).
- Same change for "update payment method" and plan upgrade flows in Plan and billing.

### 5.2 Gateway defaults and backups

| Store country | Primary | Backup |
|---|---|---|
| India (INR) | Razorpay | Cashfree |
| Outside India (USD) | PayPal | Razorpay (USD cards) |

How "backup" works (owner confirmed 2026-11-15: automatic fall-through plus manual switch): the owner configures a primary and a backup per region in Super Admin. The backup is used (a) automatically when the primary is switched off, has no keys for the current mode, or cannot create the payment at start (API error), and (b) by the owner flipping the primary. It is **not** a split of traffic, and a subscription that already exists stays with the gateway that created it (a store is never charged by two gateways for the same plan; changing gateway for an existing subscriber is a manual migration, out of scope).

Today `platform_billing_settings` has one national `provider` (razorpay or cashfree) and a `paypal_enabled` flag. Change (expand-only migration):
- Add `international_provider` (`paypal` | `razorpay`, default `paypal`) and `backup_enabled` per region (`national_backup`, `international_backup`), defaulting to the table above. Keep `provider` and `paypal_enabled` until a later contract release.
- Domain resolves the gateway from store country, then falls through to the backup on the three conditions above, and records which gateway served each attempt on the subscription (needed for webhooks and refunds).
- Super Admin overview shows two rows (India, International), each with primary, backup, key status for both, and a switch.

Razorpay as the international backup needs:
- Razorpay account with international payments and international recurring cards enabled (Q1; if not enabled, the backup row shows "not available" and PayPal is the only international path, as today).
- USD plans: add `razorpay_plan_id_monthly_usd/_yearly_usd` to `plans` (expand-only); plan sync creates them from `priceMonthlyUsdCents/priceYearlyUsdCents` (plans without a USD price keep the existing rupee price / 80 fallback, flagged in the UI).
- The same on-page window as 5.1; cards only for USD (UPI is INR only).
- Note: PayPal remains one-time Orders (no auto-renewal), so a store paying by PayPal is not renewed automatically. Failover to Razorpay therefore also gives that store a renewing subscription; the Activate screen should say which gateway is being used.
- Dunning, invoices, grace reuse the existing webhook lifecycle. USD invoices to foreign merchants carry **no GST** (owner decision 2026-11-15); invoice code must skip tax for non-Indian stores and say so on the invoice. Owner to have the accountant confirm the export-of-services wording (LUT) before live.

### 5.3 Stripe for platform billing

Out of scope here (`PLATFORM-BILLING-PLAN.md` section 8 and the "Build later" row). If the owner wants it, it is a separate plan: Stripe Billing subscriptions + Embedded Checkout (`mode: subscription`), with the Stripe India cross-border constraints above applied to **Brand Sewa's own** account.

## 6. Slices

Each slice: contracts first, domain service, UI; real-DB test for anything touching money, tenancy or permissions; change record; gate. Order puts verification of external assumptions first.

| Slice | Content | Acceptance |
|---|---|---|
| P0 | Confirm with Razorpay support: international payments and international **recurring** enabled for the platform account, USD currency, settlement currency, subscription signature formula. Confirm Stripe `ui_mode` value and Stripe.js method name for pinned API version. Short ADR-043 recording the decisions below. | Answers pasted into the ADR; no code |
| R0 | QuickBuy check on a real phone in test mode; ask Razorpay support if absent (section 4.1a) | Evidence in a change record |
| S1 | Stripe publishable key per store: secret storage, validation, admin field, test-connection account match | Real-DB test: key saved encrypted, mismatched mode refused, audit row, never returned by an API |
| S2 | `StripeProvider` embedded mode + unit tests (form body, no `cancel_url`, `return_url` template, idempotency); `checkout.session.expired` handling | Provider tests; webhook inbox test |
| S3 | Domain start/confirm returns embedded payload; abandon route; per-store `stripeUiMode` flag (default hosted) | Real-DB tests: wrong order token, expired session, amount or currency mismatch ignored |
| S4 | Web `StripeEmbeddedCheckout` (lazy), return page, 375 px and desktop walkthrough with Stripe test cards (success, 3-D Secure, decline) | Browser evidence; page-speed budget test unchanged |
| R1 | Unpaid online order expiry + stock release (pg-boss job after commit) | Real-DB test; job idempotent |
| R2 | Admin Razorpay refund | Real-DB test; audit row |
| P1 | Platform Razorpay window for INR subscribe, confirm procedure, fallback to `short_url`, webhook still authoritative | Test-mode subscription goes Active only after webhook; duplicate and forged signature ignored |
| P2 | Region defaults and backups: migration for `international_provider` and backup flags, resolver with fall-through, Super Admin India and International rows, Activate screen names the gateway | Real-DB tests: India primary off falls to Cashfree; PayPal off or erroring falls to Razorpay; existing subscribers keep their gateway; forged webhooks ignored |
| P2b | USD Razorpay plans migration + sync + USD subscribe through the window | Test-mode USD subscription created and activated by webhook; renews in a second test cycle; PayPal path unchanged |
| P3 | Docs: `ARCHITECTURE.md`, `DEPLOYMENT.md` (webhook URL, no new env), merchant help text, subprocessors list; owner-run small live payment for each provider, refunded after | Change records with evidence |

Parallelism: S1–S4 (store checkout) and P1–P2 (platform billing) touch different files and can go to two worktrees; R1 touches `orders/` and should not run beside S3.

## 7. Cross-cutting rules and risks

- **No secrets in the browser except public keys.** Only Razorpay key id and Stripe publishable key reach the page. Secrets, webhook secrets and client-secret reuse across orders are never exposed.
- **CSP:** none today. If a CSP is added later (recommended by Stripe), allow-list per provider only on the pages that need it: checkout and admin Activate.
- **Rule 13:** the provider order/session is created after the order commits; all fulfilment waits for the signed webhook or the server-side return check, never the browser callback alone.
- **Rule 8 / ADR-010:** the new scripts are ours loading provider scripts on fixed pages; merchants cannot inject any.
- **Idempotency:** one settle function (`settleProviderPayment`) for return, verify and webhook; tests run all three orderings.
- **Risk:** Stripe API/Stripe.js naming change (S0/P0 gate). **Risk:** Razorpay international recurring may not be enabled for our account, which blocks P2; fallback is PayPal as today. **Risk:** Stripe India restrictions for merchants: add plain-language note in the Stripe settings page.
- Every platform mutation writes `platform_audit_logs`; new `admin.*`/platform procedures are mapped in the isolation and audit suites.

## 8. Open questions for the owner

| # | Question | Recommendation |
|---|---|---|
| Q1 | Is international **recurring** card billing enabled (or enable-able) on the platform Razorpay account? Settlement in INR acceptable? | Ask Razorpay support now; it gates P2 |
| Q2 | Backup behaviour | **Decided 2026-11-15: automatic fall-through plus manual switch; never two gateways on one subscription** |
| Q3 | GST on USD charges to foreign merchants | **Decided 2026-11-15: no GST.** Accountant to confirm invoice wording before live |
| Q4 | Keep Stripe hosted as a per-store fallback after embedded works, or remove it? | Keep until one live store has used embedded for 30 days |
| Q5 | Stripe for platform billing: wanted now? | No; separate plan if needed |
| Q6 | Razorpay pop-up window instead of Magic Checkout | **Decided 2026-11-15: keep the pop-up** |

## 9. Not verified

Everything in section 3 is from provider documentation read through search results; none of it was run against a Razorpay or Stripe account. Code facts in section 2 were read from the repo, not executed. Estimates are not given; slices are sized by acceptance criteria.
