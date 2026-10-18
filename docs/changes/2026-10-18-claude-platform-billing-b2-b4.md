# Platform billing slices B2 to B4: plan sync, subscribe and cancel, webhook lifecycle and gapless invoices

- **Date:** 2026-10-18
- **Agent:** claude
- **Branch:** `feat/platform-billing-b2-b4` (not merged yet)
- **Area:** db, domain, contracts, platform, web, admin, superadmin
- **Type:** feature
- **Supersedes:** none (continues `2026-10-18-claude-platform-billing-b1.md`; plan `docs/PLATFORM-BILLING-PLAN.md`)

## Summary
A store owner can now pay for a plan with a card or UPI AutoPay through the platform's Razorpay account, and the subscription charges automatically every month or year. The first charge waits until the trial or a free-months promotion ends. Every successful payment creates one GST invoice with a gapless financial-year number. Everything runs in test mode until the owner switches to live.

## What changed
- **B2, Super Admin, Platform billing:** "Razorpay plans" card with a "Sync plans to Razorpay" button. Razorpay plans are immutable and per mode, so each (plan, interval, mode, amount) is a row in `platform_razorpay_plans`; a price change adds a plan, existing subscribers keep theirs; a price that returns to an older value reuses the older plan. Platform API `integrations.billingPlans`, `syncBillingPlans` (owner only, audited).
- **B3, store admin, Settings, Plan and billing:** owner-only "Pay for your plan" card (plan, monthly or yearly, "Continue to payment" opens Razorpay's hosted authorisation page) and "Cancel subscription" (at the end of the paid period). New `admin.planAndBilling.subscribe` and `cancelSubscription`; the view gains a `billing` block (available, test mode, has subscription, cancel date). `start_at` is the later of the trial end and a free-months promotion end. The plan changes only after the payment webhook confirms the first charge.
- **B4, billing webhook:** handles `subscription.authenticated` (links the provider id, status unchanged), `pending` and `halted` (past due), `cancelled` and `completed` (cancelled, store moves to the restricted tier), `payment.failed` (noted). Invoice numbers are now `BS/<FY>/<5 digits>` from a locked counter (no gaps), and `platform_invoices.provider_payment_id` is unique so one payment is never invoiced twice. The old random `INV-YYYYMM-xxxxxx` format is gone.
- Migration `0070_billing_plans_and_invoice_series`; `app_saas` can read the plan table and use the invoice counter (`saas-grants.ts`).

## Decisions and trade-offs
- Hosted Razorpay subscription page instead of embedded checkout: least code, handles card, UPI AutoPay and e-mandate; revisit if the owner wants it inside the page.
- The invoice prefix `BS` and the 18% inclusive GST rate are placeholders until the owner provides the GST registration details (open decision in the plan).
- Limiting a store after the grace period and reminder emails are slice B5; the webhook only marks `past_due`.

## Verification
- Ran: typecheck for db, contracts, domain, platform, web, admin, superadmin; real-database suites each against a fresh database: `platform-billing-subscribe` (10 tests: sync, price change and revert, failing plan, owner-only, trial and promotion start dates, active-subscription guard, cancel at cycle end, gapless numbers and financial-year rollover, duplicate payment, authenticated, past due, cancelled tier), `platform-billing-settings` 7, `b4-billing-webhook` 2, `billing-lifecycle` 7 (invoice format updated), `b5-unconfigured` 3, `saas-runtime-role` 15; the whole `apps/platform` suite 122 (RBAC, audit and read suites extended). Razorpay was faked in tests (no network).
- NOT verified: any screen in a browser; a real Razorpay test payment (needs the owner's test keys and a synced plan); `pnpm build`; the full domain heavy suite (CI).

## Docs updated
- [x] `docs/ARCHITECTURE.md` (migration 0070, billing paragraph), `progress.md`

## Follow-ups and open questions
- B5 dunning (grace period, reminders, limiting), B6 invoice PDF, B7 Super Admin subscriptions and revenue, B8 percent-off promotions, B9 end-to-end test run with the owner's test keys.
- Owner: GST details (GSTIN, legal name, address, SAC, rate, whether prices include GST).

## Definition of done
Gate partly run (see Verification); CI runs the rest.
