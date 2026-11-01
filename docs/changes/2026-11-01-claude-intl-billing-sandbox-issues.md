# International merchant billing: issues found in the PayPal sandbox walkthrough (running log)

- **Date:** 2026-11-01
- **Agent:** claude
- **Branch:** not created yet (edits are uncommitted in the `docs/plan-editor-merged` checkout; move to a `fix/...` branch before committing)
- **Area:** admin, docs
- **Type:** fix
- **Supersedes:** none

## Summary
The owner signed up a US store (USD) with PayPal sandbox credentials accepted in Super Admin, then hit the "Activate" screen after login. That screen still said Razorpay and showed rupee prices. This file logs each issue from the walkthrough, newest last; the owner is sending more.

## Issues
### 1. Activate screen shows Razorpay and INR for a US store (fixed, not yet exercised in the browser)
- **Steps:** sign up with country US, choose a plan, log in to admin, land on "Activate <store>".
- **Expected:** USD prices, PayPal wording, PayPal sandbox hint.
- **Actual:** "use Razorpay test payment details", plan prices in rupees, "card or UPI" copy.
- **Cause:** the server was already right (`getPlanAndBilling` returns `billing.provider = "paypal"` and `currency = "USD"` for a tenant whose country is not IN, and `subscribeToPlan` uses PayPal). `apps/admin/src/components/billing/activate-store.tsx` ignored both fields: it hard-coded Razorpay for any non-Cashfree provider, read a `currency` field that plans never have (so always INR), and priced from the paise columns.
- **Fix:** the screen now follows `billing.provider` and `billing.currency`, prices from `priceMonthlyUsdCents` / `priceYearlyUsdCents` (falling back to paise / 80, the same rule `changeTenantPlan` uses), and names PayPal in the copy. Free-period and percent-off copy is rupee-gateway wording, so it is hidden for PayPal.

### 2. "Return to merchant" from PayPal lands on a 404 (fixed, not exercised)
- **Steps:** Activate screen, Pay, PayPal error page, Return to merchant.
- **Actual:** `https://bcom.si/settings/plan-and-billing?token=...` shows the storefront 404.
- **Cause:** the activate screen sent no `returnUrl` for PayPal (only for Cashfree), so `PayPalBillingSubscriptionProvider` fell back to `APP_URL` (the storefront host) + `/settings/plan-and-billing`, a path only the admin app has.
- **Fix:** the screen now sends `window.location.origin + "/"` for PayPal, and the fallback in `packages/domain/src/saas/billing.ts` is the admin host (`ADMIN_HOST`, default `admin.bcom.si`).

### 3. PayPal: "This seller doesn't accept payments in your currency" (open, cause not confirmed)
- **Steps:** Pay with a sandbox buyer on the USD order.
- **Known:** the order is created in USD (`createSubscription`, `currency_code: "USD"`). The error is PayPal's, raised at approval, so the order itself was accepted.
- **Likely cause (not confirmed):** the sandbox business account that owns the REST app, or the buyer, is India-region, which cannot receive or pay in USD that way. To check: create a US-region sandbox Business account and a US Personal buyer, make a new REST app under that business account, and put its keys in Super Admin.

## Decisions and trade-offs
- The percent-off coupon and free-months copy is not shown to PayPal merchants. The server computes the coupon discount in paise and `PayPalBillingSubscriptionProvider` ignores `firstPaymentPaise`, so showing a discount would promise something the charge would not do. Needs an owner decision (see below).

## Verification
- Ran: `pnpm --filter @bs/admin exec tsc --noEmit` passes.
- NOT verified: the screen in a browser, the PayPal sandbox payment itself, and the `pnpm lint` / `pnpm build` / `pnpm docs:check` gate.

## Docs updated
- [ ] `docs/ARCHITECTURE.md` not needed (no structure change)
- [ ] ADR not needed
- [ ] `DEPLOYMENT.md` not needed
- [ ] `progress.md` not changed yet (add an "In flight" line when the branch exists)

## Follow-ups and open questions
- Owner: should coupons and free periods apply to PayPal (USD) merchants? If yes, the server needs a USD path for them.
- More issues from the walkthrough will be appended here.

## Definition of done
Not done: branch, lint, build and docs gate still to run.
