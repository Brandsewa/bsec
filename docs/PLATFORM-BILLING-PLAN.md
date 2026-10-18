# Platform billing plan: charging merchants for their plan

Status: plan, not started (2026-10-18). Builder: Claude Code unless the owner assigns another. Builds on ADR-014 (billing is separate from store checkout) and ADR-035 (promotions and free periods). This plan **changes** one ADR-014 rule (where the platform's Razorpay keys live); an ADR must record that before slice B1 merges.

## 1. Goal

A merchant signs up, uses the 14-day trial (or a promotion), then pays for their plan automatically, every month or year, through the platform's own Razorpay account. If a payment fails, the store gets a grace period and clear messages, then is limited. The platform owner can see who pays, who is late, and invoices, and can set up the gateway without touching servers.

## 2. What exists today (read from code, not run)

| Piece | State |
|---|---|
| Plans, subscriptions, platform invoices tables | Exist (`plans`, `subscriptions`, `platform_invoices`). `plans` has nullable `razorpay_plan_id_monthly` and `_yearly`. |
| Razorpay subscription client | `RazorpaySubscriptionProvider` in `packages/domain/src/saas/billing.ts`: create and cancel subscription, verify webhook signature. Reads keys only from env vars `RAZORPAY_PLATFORM_KEY_ID`, `_KEY_SECRET`, `_WEBHOOK_SECRET`. |
| Webhook | `/api/webhooks/platform-billing`: signature check (fails closed), idempotent inbox, handles lifecycle events. |
| Signup | Starts a 14-day trial with no payment method (`subscriptions.status = trialing`). |
| Trial expiry | Sweep moves a lapsed trial to `past_due` and drops the store to the restricted XS tier. Paying (webhook) restores the plan's tier. |
| Plan change in admin | Settings, Plan and billing: the merchant **requests** a plan; the platform team reviews it. No self-service payment. |
| Promotions | Grants record the promise (free months, percent off) and end dates. They do not change what Razorpay charges. |
| Super Admin | No screen for platform Razorpay keys, plan sync, subscriptions, or revenue. |

## 3. Gaps to close

1. No way to enter the platform's Razorpay keys (and webhook secret) in Super Admin; env vars only.
2. Razorpay Plan IDs are never created or stored; a subscription cannot be created without them.
3. No "Subscribe / Pay now" for the merchant; no card or UPI mandate step; no change or cancel flow.
4. Free months and percent-off promotions are not reflected in what Razorpay charges.
5. No GST tax invoice (PDF) per payment; platform GSTIN and SAC code are unknown.
6. No failed-payment handling beyond the sweep: no reminder emails, no grace period setting, no retry visibility.
7. No revenue view (MRR, active, trialing, past due, churn) for the owner.
8. Test-mode versus live-mode separation for the platform account.

## 4. Owner decisions (2026-10-18: recommended defaults accepted)

Accepted: no card at signup (pay when the trial ends or on upgrade); platform Razorpay keys stored encrypted in Super Admin; free months first, percent-off later; 7-day grace; monthly and yearly intervals; cancel at period end; test mode first. **Still open:** GST details (item 5), yearly discount, refund policy. The original questions follow for reference.


1. **When does the card come in?** (A) Pay when the trial ends or the merchant upgrades, with no card at signup: recommended, lowest friction. (B) Collect the card or UPI mandate at signup: fewer lapsed trials, more drop-off.
2. **Keys in Super Admin.** Store the platform Razorpay keys encrypted in the database (same `TENANT_SECRETS_KEY` scheme) with a test and a live slot, entered by the owner in Super Admin; env vars stay as a fallback. This replaces ADR-014 point 1. Recommended yes.
3. **Percent-off promotions.** Razorpay plan amounts are fixed, so a percent-off promotion needs either a discounted Razorpay plan created on demand, or a Razorpay offer. Free months are simple (delay the first charge). Recommended: free months first; percent-off via on-demand discounted plans in a later slice.
4. **Grace period** after a failed payment before the store is limited (suggest 7 days) and how many reminder emails.
5. **GST:** the platform's GSTIN, legal name and address, SAC code and rate (software service, normally 18%), and whether listed prices include GST. A chartered accountant should confirm.
6. **Billing intervals:** monthly and yearly (yearly discount?), or monthly only at launch.
7. **Cancellation:** immediate or at period end (recommended: at period end), and refunds policy.
8. **Test first:** run the whole flow with Razorpay test keys and the owner's test store before live keys (the owner has both).

## 5. Design

**Credentials.** New platform table `platform_billing_settings` (one row): provider, mode (test or live), encrypted key id and secret and webhook secret for each mode, `grace_days`, `updated_by`. Only `app_platform` writes; the webhook and billing code read through a domain service. Secrets are shown in the UI only as set or not set. Every change writes `platform_audit_logs`.

**Plans.** Super Admin, Billing, Plans: a "Sync to Razorpay" action creates the Razorpay plan for each public plan and interval (amount from `plans`) and stores the IDs; changing a price creates a new Razorpay plan (they are immutable) and keeps the old ID for existing subscribers.

**Subscribe flow (decision 1A).** Store admin, Plan and billing: a banner shows trial days left. "Subscribe" creates a Razorpay subscription for the chosen plan and interval with `start_at` = end of trial or end of the promotion's free period, then opens Razorpay's authentication (card, UPI AutoPay or e-mandate). The webhook marks the subscription `active` after the first charge. Plan changes upgrade or downgrade through the same flow (Razorpay update or a new subscription at the next cycle). Cancel at period end. Update payment method re-opens authentication.

**Webhook events handled:** `subscription.authenticated`, `activated`, `charged`, `pending`, `halted`, `cancelled`, `completed`, `payment.failed`. Each updates `subscriptions`, the size tier, writes a `platform_invoices` row and an audit row; idempotent through the existing inbox.

**Dunning.** `past_due` starts the grace period; reminder emails go out through the platform mailer (pg-boss jobs, after commit, ADR-006); after grace the store drops to the restricted tier (storefront and checkout keep working, per the existing rule); paying restores it instantly.

**Invoices.** On each successful charge create a numbered GST tax invoice (existing `platform_invoices`), PDF rendering, emailed to the merchant and downloadable from Plan and billing.

**Super Admin Billing area.** Provider settings (keys, mode, webhook URL to copy: `https://<root domain>/api/webhooks/platform-billing`), plans sync, subscriptions list with status filters, invoices, simple revenue cards.

## 6. Build order (small slices, each with real-database tests and the gate)

| Slice | Content | Acceptance |
|---|---|---|
| B0 | ADR (supersedes ADR-014 point 1), this plan's decisions recorded | ADR merged |
| B1 | `platform_billing_settings` table, encrypted storage, Super Admin "Billing provider" page (keys, mode, test connection, webhook URL), audited; provider reads DB keys with env fallback | Keys saved and masked; test connection succeeds with Razorpay test keys; audit row written |
| B2 | Plan sync to Razorpay, IDs stored, price-change handling | Plans show Razorpay IDs for both intervals in test mode |
| B3 | Merchant Subscribe, change, cancel, update method in Plan and billing; `start_at` after trial or free period | A test store subscribes with a Razorpay test card/UPI and shows Active after the webhook |
| B4 | Webhook lifecycle complete, invoices on charge, size tier restore | Simulated and real test-mode events move the subscription and tier correctly; duplicate events ignored |
| B5 | Dunning: grace period, reminder emails, limit after grace | A failed payment test card leads to reminders and the limit; paying restores |
| B6 | GST invoice PDF and email | Invoice downloads with correct tax split and number sequence |
| B7 | Super Admin subscriptions list, revenue cards | Numbers match the database for a seeded set |
| B8 | Promotions: free months defer the first charge; percent-off via discounted plan | A 3-month-free code delays the first charge by 3 months |
| B9 | End-to-end test run on the owner's test domain, then one small live payment (owner enters live keys, refunds it after) | Change record with evidence |

## 7. Safety rules for this work

- Test mode only until B9; live keys are typed by the owner in Super Admin, never in chat, code, env files or logs.
- Platform billing code and tables stay separate from store checkout (ADR-014 points 2 and 3 stay).
- Every platform mutation writes `platform_audit_logs`; secrets are never returned by any API.
- Migrations are expand-only (docs/migrations.md); new `admin.*` or platform procedures are mapped in the isolation and audit suites.
- Webhooks fail closed on signature and are idempotent.

## 8. Not in scope

Store checkout payments (separate plan: `MERCHANT-JOURNEY-PLAN.md` section 9), usage-based billing, multiple currencies, coupons inside Razorpay Dashboard, Stripe for platform billing.
