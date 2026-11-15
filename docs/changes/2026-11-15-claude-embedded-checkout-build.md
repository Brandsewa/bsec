# Embedded checkout and platform billing gateway order (build)

- **Date:** 2026-11-15
- **Agent:** claude
- **Branch:** `feat/embedded-checkout` (merged in #263, 90ad236; the Stripe part is superseded by ADR-048)
- **Area:** db, payments, domain, contracts, web, admin, platform, superadmin
- **Type:** feature
- **Supersedes:** none (builds the plan in `2026-11-15-claude-embedded-checkout-plan.md`)

## Summary
Stripe now takes payment inside the store's checkout page when the store saved a Stripe publishable key (Embedded Checkout). Razorpay stays in its window. Platform billing opens Razorpay's window in the admin app and has a primary and a backup gateway per region (India: Razorpay then Cashfree; outside India: PayPal then Razorpay in USD). Admin refunds of Razorpay and Stripe payments now go to the gateway. Decisions are in ADR-046.

## What changed
- **Stripe (store checkout):** `StripeProvider` embedded mode (`ui_mode=embedded`, `return_url` with the session placeholder, no `cancel_url`, client secret out, `retrieveSession` returns status and client secret). `startHostedPayment` returns `stripeEmbedded` or `checkoutUrl`; it reuses an open session and replaces an expired one (new idempotency key). Web: `lib/stripe-client.ts`, `StripeEmbeddedOverlay`, `CheckoutForm`, and `PayNowButton` now uses `/api/storefront/checkout/pay` so Pay now works for Stripe and PayPal as well (it only handled Razorpay before). Store admin payments sheet has an optional "Publishable key" field for Stripe (stored encrypted as `key_id`, mode must match the secret key).
- **Platform billing window:** `subscribeToPlan` returns `razorpayCheckout`; admin `lib/razorpay-subscription-checkout.ts`, Activate screen and Plan and billing use it; the hosted URL is the fallback; the webhook alone activates the plan.
- **Region gateways:** migration `0106_billing_region_gateways` (`international_provider`, two backup flags, `platform_razorpay_plans.currency`); `resolveBillingGateways`; `subscribeToPlan` loops primary then backup; USD Razorpay plans (`syncBillingPlans` with `currency: "USD"`, `usdCentsOf`); a USD Razorpay charge is invoiced in USD with no GST. Super Admin: backup switches, international primary choice, "Sync USD plans" and USD columns.
- **Refunds:** `refundAdminOrder` sends Razorpay and Stripe refunds to the gateway before recording them.

## Decisions and trade-offs
- The "Stripe uses embedded" switch is the presence of a publishable key, not a separate flag (fewer states).
- The signature confirm procedure in the plan was dropped: the page polls and the webhook is the only thing that activates a plan.
- Stripe.js is loaded from the `clover` train because `STRIPE_API_VERSION` is `2025-09-30.clover`; the embedded method was renamed in a later train, so both must be moved together.
- The gateway refund runs inside the refund transaction after the amount guards (credentials are read before it); a crash between the gateway accepting and the commit could leave a refund the database does not know about. Stripe has an idempotency key; Razorpay rejects a refund above what remains.
- R1 (expire unpaid online orders) is **not built**: a late payment on an expired order would settle against released stock. It needs a provider-side check first; follow-up below.

## Verification
- Ran: `pnpm typecheck` pass; `pnpm lint` 0 errors (existing warnings); `pnpm build` pass; `pnpm docs:check` ok; payments unit tests 57 pass; web unit tests 256 pass (including the production page-weight budget); `@bs/domain` real-database suite (Docker Postgres) 145 files, 2998 tests pass (three files crashed their worker once with a Windows exit code and passed on re-run: themes, security-fixes, shipping-offered). New suites: `stripe-embedded-checkout` 6, `platform-billing-gateways` 12, `admin-refund-gateway` 5, plus added cases in `payment-providers` and `platform-billing-subscribe`.
- NOT verified: any real Stripe, Razorpay or PayPal call (all gateways faked at fetch); the Stripe embedded form, the Razorpay subscription window and the new Super Admin and admin screens in a browser; migration `0106` against a database that has billing settings rows (defaults only, read not run on production data); Razorpay international recurring availability on the platform account (Q1); QuickBuy on a phone (slice R0); the e2e suite.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (checkout paragraph, platform billing, migration 0106, last verified)
- [x] ADR-046; `docs/adr/README.md`
- [x] `DEPLOYMENT.md` not needed (no env vars, ports or services)
- [x] `progress.md` In flight line

## Follow-ups and open questions
- R1: expire unpaid online orders (needs a check at the gateway before releasing stock).
- Q1: ask Razorpay to enable international recurring cards; until then the USD sync is refused and PayPal is the only international path.
- Accountant to confirm wording of USD invoices without GST before live.
- First live runs by the owner: one small Stripe test-mode embedded payment, one Razorpay test subscription through the window, one USD Razorpay subscription once enabled, one refund per gateway.

## Definition of done
Gate run locally (typecheck, lint, build, docs:check, unit and domain real-database tests); apps/platform and db suites, e2e and browser checks not run. Notion updated (Change Log x2, Decisions x2, Work Item, Risks x2); Feature rows and Docs Library not edited. No secrets or generated files in the diff.
