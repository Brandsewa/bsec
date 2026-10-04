# Store Admin Settings rebuild — Phase 5 builder prompt (payments, plan and billing)

Paste this whole file as the first message of a new coding session in the `bsec` repo. You are the builder for **Phase 5 only**. Claude verifies against section 10 before Phase 6; you never merge your own PR.

Read first, in order: `AGENTS.md` (**rule 14: do not touch Razorpay or Shiprocket unless the task is explicitly about them; credentials are deferred by the owner**); `docs/SETTINGS-PHASES-3-8-HANDOFF.md` (owner decisions §1, standards §3); `docs/ARCHITECTURE.md`; newest `docs/changes/`; `docs/SETTINGS-REBUILD-REMAINING-PHASES.md` §6 and §10; `docs/SETTINGS-SCHEMA.md` §4 and §6; `docs/adr/014-platform-billing-separation.md`; `docs/adr/019-customer-auth-and-platform-mailer.md`; `docs/adr/020-settings-capability-families.md`; `docs/admin-ui-standards.md`; `docs/migrations.md`.

## 0. Gate and state
- **Phase 4 must be merged.** If not, stop and tell the owner.
- Own worktree `../bsec-settings-p5`, branch `feat/settings-rebuild-phase-5`; claim in `progress.md`.
- **Slices 5A-5D are unconditional. Slice 5B (Razorpay) is GATED:** do not write any Razorpay code, add any dependency, or ask for keys until the owner has written, in your session, an explicit authorisation ("authorise Razorpay provider work") and supplied **test-mode** keys through the encrypted Settings form (never in chat, code, env files you commit, or tests). Without that, ship 5A, 5C, 5D and report 5B as not started, which is the expected outcome.

## 1. Objective
Separate **customer-payment configuration** (the merchant's own payment methods at checkout) from **merchant SaaS plan visibility** (what the merchant pays bsec), make every status truthful, and close the server-side gaps found in the audit. Owner decisions that apply: COD is the only manual method; Razorpay first but only when authorised; plan changes are **request-only**; India/INR only.

## 2. Audit (verified 2026-10-04; re-verify before relying on it)

| Area | Where | Today |
|---|---|---|
| Payments settings | `packages/domain/src/admin/payments-settings.ts`, `/settings/payments`, contract `admin.payments.{get,saveRazorpay,clearRazorpay}` | COD `{enabled, feePaise}` lives in `store_settings.checkout.cod` and is saved through the **generic `settings.update`** (`settings.write`). Razorpay keys are encrypted in `tenant_secrets` (`key_id`, `key_secret`, `webhook_secret`); `saveRazorpay`/`clearRazorpay` need `payments.manage` (Phase 2 fix). `ONLINE_PAYMENT_AVAILABLE = false` hard-coded. |
| Checkout payment | `packages/domain/src/orders/checkout.ts` (`paymentMethod: "cod" \| "razorpay" \| "online"`), `apps/web/src/app/api/storefront/checkout/place-order/route.ts:25,80` | The **route** refuses non-COD while `ONLINE_PAYMENT_AVAILABLE` is false; the **domain service does not**: `placeOrder` happily creates an order and a `payment_intents` row with a **fabricated provider order id** (`rzp_order_…`) for any non-COD method. The COD fee is read from config but **no minimum or maximum order value** exists. |
| Payment tables | `packages/db/src/schema/payments.ts`: `payment_intents`, `payment_attempts`, `refunds` | Exist (tenant tables). No `payment_methods` table. |
| Webhooks | `packages/domain/src/system/webhooks.ts` (`receiveWebhook`, `processWebhookInboxItem`), route `apps/web/src/app/api/webhooks/[provider]` | Inbox pattern exists; provider processing for Razorpay payments not built. |
| Providers | `packages/payments/src` (`crypto.ts`, `providers/`, `types.ts`) | Encryption and provider types; no live checkout adapter. |
| Billing read | `admin.billing.getSubscription` (`api.ts` ~1685), `packages/domain/src/saas/billing.ts` (`getTenantSubscription`) | **No permission check at all** (any admin session). Reads platform tables (`plans`, `subscriptions`, `platform_invoices`) which have **no RLS**: tenant filtering is by code only. Returns `provider`. |
| Billing write | `admin.billing.changePlan` → `changeTenantPlan` | **Self-service plan change** is exposed to any role with `settings.write` (so `store_admin`). It conflicts with owner decision 6 (request-only) and with the owner-only rule for money. |
| UI | none | No Plan & Billing page exists. |

### Defects to fix first (each with a test that fails before the fix)
1. `placeOrder` must enforce, **in the domain service**, that the chosen method is **active and available** for the tenant (defence in depth; the route guard stays). No code path may create a provider order id that the provider did not issue.
2. COD min/max order value are enforced server-side at `placeOrder` (new, see 5A).
3. `admin.billing.getSubscription` requires an authenticated store member with `settings.read` and returns a **redacted projection** (no `provider`, no provider ids, no plan Razorpay ids).
4. `admin.billing.changePlan` is **removed from the store admin API** (or hard-refused for every role with a clear error) and replaced by the request flow in 5D. Self-service billing is out of scope by decision. Keep `changeTenantPlan` for platform/webhook use only if something else calls it; otherwise leave it unexported from the store router.

## 3. Slice 5A: payment methods catalogue and COD (always)

### Data (expand / migrate / contract)
New tenant table `payment_methods` (SETTINGS-SCHEMA §6.1), `tenantTable()` + `forceRlsSql`:
```
id               uuid pk default uuidv7()
tenant_id        uuid not null (from tenantTable)
provider         text not null  check (provider in ('cod','razorpay'))   -- widen later by migration; do NOT add stripe/paypal/bank_transfer/money_order now
display_name     text not null  check (char_length(display_name) between 1 and 80)
status           text not null default 'disabled' check (status in ('disabled','pending_setup','active','unavailable','error'))
mode             text null      check (mode in ('live','test'))          -- null for COD
sort_order       integer not null default 0 check (sort_order >= 0)
public_config    jsonb not null default '{}'   -- shopper-safe only; v:1 (see below)
setup_state      jsonb not null default '{}'   -- safe status/hints only; v:1
version          integer not null default 1    -- optimistic concurrency
enabled_at, disabled_at timestamptz null; created_at, updated_at timestamptz not null default now()
unique (tenant_id, provider)                                              -- one row per provider per tenant
unique (tenant_id, id)
```
- `public_config` for COD: `{ v:1, feePaise, minOrderPaise?, maxOrderPaise? }` with `0 <= fee <= 50_000` (₹500), `min <= max`.
- **Dual-read migration (never a flag-day):** a reader `getTenantPaymentMethods(tx)` returns the `payment_methods` rows if present, else **synthesises** the COD method from `store_settings.checkout.cod` (default enabled, existing fee). Writes go to `payment_methods` and **also** keep `store_settings.checkout.cod` in sync for one release (so an older web build keeps working during a rolling deploy). A **safe backfill** migration inserts a COD row for each tenant that has a `store_settings` row, copying enabled/fee, idempotently (`ON CONFLICT DO NOTHING`). The contract step (drop the dual-write and the old key) is a **later release**, not this PR.
- Checkout reads the methods from the reader, sorted by `sort_order`; `getStorefrontPaymentOptions` is rebuilt on it. `ONLINE_PAYMENT_AVAILABLE` is replaced by the **provider adapter registry** (`packages/payments`): a method is available only if its status is `active` **and** an enabled adapter exists in the registry. With no Razorpay adapter registered, Razorpay can never be `active`.

### Behaviour
- Settings > Payments shows the catalogue with exact states: **Active**, **Available** (adapter exists, not set up), **Unavailable**, **Coming soon** (Razorpay until 5B ships; Stripe and PayPal listed as "Not available yet", no setup affordance), **Manual** (COD only). No usable control for a provider without an adapter.
- COD: enable/disable, display name, fee, min and max order value; saved through a new narrow contract `admin.paymentMethods.{list,updateCod}` with **`payments.manage` in route and service** (decision 1: owner-only). This moves COD out of the generic `settings.update`: that procedure must **stop accepting the `cod` key** (reject with a clear error) after the dual-write window, or ignore it with a deprecation log if an older admin bundle might still send it (decide, document, test).
- `placeOrder` recomputes the COD fee and checks min/max from the stored method, never from the client; a cart outside the range gets a clear message and the method is hidden or disabled with a reason on the checkout page from the same server value.
- Ordering: `sort_order` editable only for methods that checkout consumes (COD alone today: omit the control until a second method is active).
- Disable/disconnect affects **future checkout only**; existing orders and payment history are never rewritten.

## 4. Slice 5B: Razorpay adapter (GATED, see §0)
Only after explicit authorisation and test keys. Industry-standard integration:
- Adapter behind the provider interface in `packages/payments`: create order (amount in **paise**, currency `INR`, `receipt` = order number, notes with tenant and order ids, **idempotent** via the existing `idempotencyKey`), client-side Checkout.js on the storefront payment step, **server-side signature verification** of `razorpay_order_id|razorpay_payment_id` with HMAC-SHA256 using the tenant's secret, constant-time compare, before marking anything paid.
- Webhook (`payment.captured`, `payment.failed`, `order.paid`, refund events recorded but not acted on): verify `X-Razorpay-Signature` over the **raw body** with the tenant's `webhook_secret`, reject unsigned or stale payloads, **deduplicate by Razorpay event id** (inbox pattern in `webhooks.ts`), process idempotently, tolerate out-of-order delivery, never trust the amount in the webhook body: re-read the payment and compare to the stored `payment_intents.amount`.
- States: `payment_intents` `created → authorized/captured | failed`, `payment_attempts` per try; the order moves to paid only from a verified capture; a **reconcile job** (pg-boss, every 15 minutes) re-checks intents stuck in `created` older than the order-hold window and releases stock for abandoned ones.
- Activation (`payment_methods` → `active`) only after the key pair validates against the provider's API in test mode, the webhook secret is set, and the webhook URL self-test passes; record `setup_state` (`configured`, names of present secrets, `lastValidatedAt`, safe error code). Live mode needs a second explicit owner approval. Disconnect confirmation names the consequence.
- Secrets: write-only, encrypted, never in logs, audit diff, errors, query cache, snapshots; test with a fake provider adapter and recorded payloads, never real keys, never the network.
- **Refund automation, saved cards, UPI intents, EMI and international cards are out of scope.** Refunds remain manual.
If the authorisation is not given, skip this entire slice and say so.

## 5. Slice 5C: Plan and billing (`/settings/plan-and-billing`, always)
Two tabs: **Plan and usage**; **Invoices**. Read model per SETTINGS-SCHEMA §4.1, contract `admin.planAndBilling.get`:
- Source: `plans`, `subscriptions`, `platform_invoices`, quota usage (`packages/domain/src/system/quotas.ts`). These platform tables have no RLS and the web role can read them: the service **filters by `ctx.tenantId` explicitly in every query** and a real-DB test proves tenant A cannot see tenant B's subscription or invoices.
- Output is a **projection**: plan code/name/interval/status/period end, feature and limit maps, usage rows (`products`, `staff_seats`, `storage_mb`, `orders_month`, `emails_month`, `custom_domains` with `used`, `limit`, `enforcement`), invoices (id, number, issuedAt, paidAt, amountPaise, taxPaise, status, downloadable). **Never** provider ids, Razorpay plan ids, payment method details or internal notes.
- Permission: any member sees the **redacted summary** (plan name, status, usage); invoices and the request action need the **owner role** (`store_owner`), checked in service. Trial: show days left from the subscription.
- Invoice PDF download: only if `pdf_key` exists and a presigned-read service exists; otherwise show "Not available yet" (no fake links). Do not build PDF generation here.
- Billing never reads `tenant_secrets` or customer-payment data (ADR-014): add a test/lint-level assertion that the module imports neither.

## 6. Slice 5D: plan-change request (`admin.planAndBilling.requestChange`, always)
Owner decision 6: the merchant requests, Super Admin decides and charges.
- New **tenant** table `plan_change_requests` (`tenantTable()` + `forceRlsSql`, so the merchant side is isolated and platform staff read it through `app_platform`/BYPASSRLS):
```
id uuid pk; tenant_id; requested_by uuid not null; from_plan_id uuid null; to_plan_id uuid not null (platform plans table; plain uuid, no FK across the RLS boundary: validate in the service)
interval text not null check (interval in ('monthly','yearly')); note text null check (char_length(note) <= 500)
status text not null default 'open' check (status in ('open','approved','declined','cancelled'))
decided_by uuid null; decided_at timestamptz null; decision_note text null
created_at, updated_at timestamptz; unique (tenant_id, id)
-- at most one open request per tenant:
create unique index plan_change_requests_one_open on plan_change_requests (tenant_id) where status = 'open';
```
- Owner-only, rate-limited (3 per day per tenant), validates the target plan is public and different, writes `audit_logs`, and **enqueues a notification to platform staff after commit** via pg-boss (platform mailer; no provider call inline). The merchant sees "Request sent, status: open" and can cancel an open request.
- Super Admin side (apps/platform + apps/superadmin): list/filter requests, view tenant and plan context, **approve or decline with a note**. Approve does **not** charge or change the plan by itself: it marks the request approved and tells staff to perform the plan change through the existing Super Admin plan tools (so money stays under existing platform controls). Platform mutations require `assertRoleAtLeast` (platform_admin) and write `platform_audit_logs`; add them to `apps/platform/test/audit-coverage.int.test.ts` and the RBAC map in `apps/platform/test/rbac.int.test.ts` (declared minimum role per procedure, or the suite fails).

## 7. Navigation, UI and permissions
- Settings nav, **Selling** group: `Payments` (`payments.manage`), and `Plan and billing` in **People and account** (`settings.read`; owner-only actions inside). Update `settings-nav.ts` and the specs by prefix.
- Payments page: catalogue cards, COD form (fee, min, max in rupees), clear unavailable reasons, (i) hover hints, dirty guard, saved/live wording ("takes effect on the next checkout"). A Manager sees the catalogue read-only (no forms) with "Only the Store Owner can change payment methods".
- Plan page: usage meters, request dialog (plan, interval, note), invoice table, honest empty states, `pendingComponent`.

## 8. Tests
- **Unit:** COD config parser and bounds, catalogue state derivation (adapter present/absent × status), usage projection, redaction.
- **Real Postgres:** defect 1-4 each failing first; `payment_methods` dual-read parity (store with no row behaves as today; backfill idempotent); COD min/max and fee recomputed server-side; **cross-tenant** on every new procedure including the RLS-less platform reads; owner-only enforcement (Manager denied, `analytics.read`-only denied, support session denied); `settings.update` no longer accepts `cod`; plan request rules (single open request, rate limit, public plan only, audit row, queued notification after commit); platform decide path (`audit-coverage`, RBAC map); `placeOrder` refuses `razorpay`/`online` without an active adapter and never invents a provider id.
- **5B only (if authorised):** signature verify (valid, invalid, tampered amount), webhook dedupe, out-of-order delivery, replay, reconcile job, secrets never in output (snapshot scan), all with a fake adapter.
- **Isolation suite:** map every new `admin.*` procedure. **UI:** catalogue states, COD form, owner vs manager views, plan page states.
- **e2e:** keep specs passing; update any label by prefix.

## 9. Do not build
Stripe, PayPal, bank transfer, money order, UPI/cards beyond Razorpay Checkout, refund automation, saved cards, self-service plan change or charging, invoice PDF generation, SMS/WhatsApp, multi-currency. Do not touch Shiprocket.

## 10. Acceptance criteria
- [ ] Defects 1-4 fixed with tests that failed first; `placeOrder` cannot create a non-COD order unless an active, registered adapter exists.
- [ ] No method is shown or stored as `active` unless checkout can actually take it; Stripe/PayPal/manual bank methods have no usable UI.
- [ ] COD fee, min and max are recomputed from server-owned config; the client cannot influence them.
- [ ] `payments.manage` is enforced in route **and** service for every payments mutation; ADR-020 enforcement section updated (COD now included).
- [ ] Billing projection is redacted, tenant-filtered in code, owner-gated for invoices and requests, and never touches customer-payment credentials/data.
- [ ] Plan change is request-only end to end; the Super Admin queue works and is audited and RBAC-mapped; no self-service charge path remains in the store API.
- [ ] Secrets never appear in logs, audit diffs, API output, query cache or snapshots (tests scan for them).
- [ ] If 5B shipped: signature and webhook verification, idempotency, reconcile job, test-mode only, owner authorisation recorded in the change record.
- [ ] Migrations append-only, increasing journal, RLS forced, dual-read parity proven, backfill idempotent; contract step deferred and written down.
- [ ] Browser check at 375 px, tablet, desktop, light and dark, as Owner, Manager and a denied role (state exactly what you drove). Gate: `typecheck`, `lint`, `build`, `docs:check`, fast suites, `@bs/domain` heavy and `@bs/platform` suites (counts pasted).

## 11. Commit plan
1. `fix(checkout): enforce payment method availability in the domain service` (defect 1, COD min/max stub) 2. `feat(payments): payment_methods table, dual-read, backfill, COD min/max` 3. `feat(payments): payment methods contract and Payments page` 4. `fix(billing): redact and gate subscription read; remove store-side changePlan` 5. `feat(billing): plan and billing read model and page` 6. `feat(billing): plan change requests and Super Admin queue` 7. (gated) `feat(payments): Razorpay adapter, webhook, reconcile` 8. `docs: ADR-020 enforcement status, ARCHITECTURE, change record`.

## 12. Owner questions to raise (do not decide)
Live-mode approval for Razorpay and who holds the live keys; whether COD limits should differ per shipping zone later; plan catalogue visibility rules for requests (public plans only is the default).
