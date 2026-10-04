# Store Admin Settings rebuild — Phase 4 builder prompt (checkout, customer accounts, orders and returns)

Paste this whole file as the first message of a new coding session in the `bsec` repo. You are the builder for **Phase 4 only**. Claude verifies against section 9 before Phase 5 starts; you never merge your own PR.

Read first, in order: `AGENTS.md`; `docs/SETTINGS-PHASES-3-8-HANDOFF.md` (**owner decisions §1 and shared standards §3 bind you**); `docs/ARCHITECTURE.md`; the newest `docs/changes/` records; `docs/SETTINGS-REBUILD-REMAINING-PHASES.md` §5 and §10; `docs/SETTINGS-SCHEMA.md` §5 and §8; `docs/ORDERS-SETTINGS-PLAN.md`; `docs/adr/019-customer-auth-and-platform-mailer.md`; `docs/adr/020-settings-capability-families.md`; `docs/admin-ui-standards.md`; `docs/migrations.md`.

## 0. Gate and state
- **Phase 3 must be merged.** Check `gh pr list --state merged --search "settings-rebuild-phase-3"` and `git log origin/main`. If not, stop and tell the owner.
- Branch from the latest `origin/main`; own worktree `../bsec-settings-p4`, branch `feat/settings-rebuild-phase-4`; add your claim to `progress.md` "In flight".
- Next free migration number: re-check `packages/db/migrations` and the journal (0033 or later).

## 1. Objective
Give merchants real, server-enforced control over checkout, customer accounts and order processing, while keeping low-friction guest purchase. **Every option that is displayed changes domain behaviour and has a test that proves it.** Where the behaviour does not exist yet, the option is absent or visibly unavailable with a reason.

## 2. Owner decisions that apply (HANDOFF §1)
- Guest checkout on; account creation `after_completed_order` (verified identity per ADR-019). This is the **default and equals today's behaviour**: a store with no saved settings must behave exactly as now (test it).
- India only: INR, English, GST. No new regional or language options.
- Email is the only channel. SMS and WhatsApp marketing consent are not offered (the consent writer already rejects non-email channels).
- COD is the only manual method; its fee/limits move to Phase 5. Phase 4 only links to Payments.

## 3. Audit of the code (verified 2026-10-04; re-verify before relying on it)

| Area | Where | Today |
|---|---|---|
| Checkout config | `packages/domain/src/admin/store-config.ts` (`parseStoreConfig`, `readStoreConfig`), `store_settings.checkout` jsonb | Only `cod {enabled, feePaise}` and `tax {gstin, sellerState, pricesIncludeTax}` are parsed. No guest, account, field or consent options exist. |
| Checkout | `packages/domain/src/orders/checkout.ts` (`placeOrder`, `PlaceOrderInput` with required `email` and `phone`), `apps/web/src/app/checkout`, `apps/web/src/app/api/storefront/checkout/place-order` | Guest checkout always on; phone always required; guest customer rows created without overwriting existing names/phones (Customers Phase 0b). |
| Accounts | `packages/domain/src/customers/auth.ts` (register, verify email, login, reset), `otp.ts`, storefront routes `apps/web/src/app/api/storefront/customer/*`, `components/account/*`, `components/orders/CreateAccountCard.tsx` (thank-you card) | Email+password and phone OTP both always available; sign-in links always shown. |
| Consent | `packages/domain/src/customers/consent.ts` (`setMarketingConsent`, single writer), `customer_consent_events` (channel, state, source, actor, ip, at) | Writer exists; rejects non-email channels; **stores the raw IP**. |
| Order numbers | `packages/domain/src/admin/order-settings.ts`, `orders/sequences.ts`, `/settings/orders` | Prefix, padding and next value are editable. **Nothing else from `ORDERS-SETTINGS-PLAN.md` §4.2-4.5 is built.** |
| Stock hold | `packages/domain/src/catalog/inventory-reservations.ts:74` | `ttlMinutes ?? 30`, hard-coded default. |
| Abandoned checkouts | `packages/domain/src/system/abandoned-carts.ts`, `admin/abandoned-checkouts.ts`, `/abandoned-checkouts` | Detection and recovery email exist with fixed behaviour; no merchant settings. |
| Returns | `admin/return-settings.ts`, `store_settings.return_settings`, `/settings/returns` | Built and canonical. Do not duplicate. |
| Storefront sign-in links, minimum order | `apps/web` header/checkout | No setting; no minimum order enforcement. |

## 4. Scope

### 4A. Checkout settings (`/settings/checkout`, new)
Contract `admin.checkoutSettings.{get,update}`; service `packages/domain/src/admin/checkout-settings.ts`; permission `checkout.manage` (read: `settings.read`), route middleware **and** service; optimistic concurrency on `updatedAt`.

Extend the `store_settings.checkout` JSON group to `v: 1` with a dedicated parser module `checkout-config.ts` (keep `cod` and `tax` keys exactly as they are; they are owned by Phases 5 and 6; do not move them here):

```ts
type CheckoutSettingsV1 = {
  v: 1;
  guestCheckout: boolean;                         // default true
  accountCreation: "none" | "after_completed_order"; // default "after_completed_order"
  phoneRequired: boolean;                         // default true (today's behaviour)
  addressLine2: "hidden" | "optional";            // default "optional"
  companyName: "hidden" | "optional";             // default "hidden"; only if checkout collects it (see below)
  marketingEmail: { enabled: boolean; label: string }; // default enabled=false; never pre-checked
  abandoned: {                                    // see 4D
    detectAfterMinutes: number;                   // 15..10080, default 60
    recoveryEnabled: boolean;                     // default false
    steps: Array<{ delayHours: number }>;         // 0..3, ascending, each 1..720
  };
  // cod, tax: unchanged keys preserved verbatim (Phases 5 and 6 own them)
};
```
Rules, all server-enforced and tested:
- Parse with defaults equal to today; unknown/legacy keys preserved on write (never drop `cod`/`tax`).
- `guestCheckout=false` means `placeOrder` requires an authenticated customer session (clear `401`-style error; the storefront redirects to sign-in and returns to checkout). **At least one customer sign-in method must be enabled (4B) before guest checkout can be turned off.**
- `accountCreation="none"` hides the thank-you `CreateAccountCard`; `after_completed_order` keeps it. Account creation always goes through the ADR-019 verified flow: never create a password or session silently.
- `phoneRequired=false`: `placeOrder` accepts a missing phone. **Guard:** if COD is enabled and the cart's shipping path needs a phone (courier contact), keep it required: the service refuses to save `phoneRequired=false` while COD is enabled, with an explanation. (Information needed by shipping, payment or tax calculation can never be hidden.)
- `addressLine2`, `companyName`: only implement a field rule if checkout already collects the field; otherwise omit it. Verify in `checkout/page.tsx` and `placeOrder`; do not invent fields.
- `marketingEmail`: when enabled, checkout shows an **unticked** checkbox with the merchant's label (1-120 chars, plain text, escaped); a ticked box calls `setMarketingConsent` with `source: "checkout"`; unticked never subscribes and never withdraws existing consent. Consent changes are immutable events.
- **Terms consent is not part of Phase 4.** It needs the published policy version of Phase 7; do not render a terms setting now (the parser reserves `termsConsent` and ignores it).
- The checkout page and the domain service read the **same parsed config in the same tenant context**; the client's view is a projection returned by the storefront API, never trusted.

### 4B. Customer accounts (`/settings/customer-accounts`, new)
New tenant table (schema below), contract `admin.customerAccountSettings.{get,update}`, permission `checkout.manage` (same family: SETTINGS-SCHEMA §3.2 groups "checkout and account behaviour"), audit, stale-write protection.
- `showSignInLinks` (default true): header and checkout render sign-in links from it.
- `emailPasswordEnabled` and `phoneOtpEnabled` (both default true): enforced in `registerCustomer`/`loginCustomer` and `requestCustomerOtp`/`verifyCustomerOtp` and hidden in `LoginForm` when off. **Invariant:** at least one is on whenever `guestCheckout=false` or `showSignInLinks=true`; the service rejects a combination that locks every customer out. Password reset keeps working while `emailPasswordEnabled` is true; turning it off never deletes passwords.
- `allowSelfServeReturns` (default true): delegates to the return eligibility service; when off the portal hides the return form (server refuses the request too). Return window and reasons stay in `/settings/returns`.
- `allowSelfServeCancellation` (default **false**): build it only as specified in 4E; otherwise omit the column and the control.
- Google and Facebook sign-in: **absent**. Show one muted "Not available yet" line, no toggles, no key fields (SETTINGS-SCHEMA §5.2).

### 4C. Orders settings (extend `/settings/orders`; keep numbering as is)
New JSON column `store_settings.order_settings` (expand-only, nullable), parsed by `parseOrderSettings` with defaults equal to today:

```ts
type OrderSettingsV1 = {
  v: 1;
  stockHoldMinutes: number;     // 5..120, default 30; replaces the hard-coded ttlMinutes
  minimumOrderPaise: number;    // 0..10_000_00, default 0 (none)
};
```
- `stockHoldMinutes` is passed to the reservation call in `placeOrder`/cart (`inventory-reservations.ts:74` keeps `30` only as the parser default). Test: a store with 10 minutes creates reservations that expire in 10 minutes; null settings still produce 30.
- `minimumOrderPaise`: `placeOrder` refuses an order whose **server-computed goods total after discounts** is below it (clear message with the shortfall); the cart and checkout show the shortfall from the same server value. Admin-created orders (`createAdminDraftOrder`) are exempt (staff override) and say so in the UI. Money is entered in rupees, stored in paise.
- Permission `orders.settings.manage` (read `settings.read`) for this group; the numbering form moves to the same family. Do not add auto-deliver or auto-cancel automation in this phase (decision: automation waits for a courier/payment lifecycle); do not add staff new-order alerts (Phase 7).
- Show **Related settings** links (Shipping, Payments, Taxes, Returns) as plain links, never duplicate fields.

### 4D. Abandoned checkout recovery (inside `/settings/checkout`, section "Abandoned checkouts")
- `detectAfterMinutes` drives the sweep in `system/abandoned-carts.ts` instead of the fixed value; `recoveryEnabled` (default **false**) gates the email; `steps` (0-3, ascending delays) schedule reminders after detection. Each step is one idempotent job keyed `(cart id, step)`: re-running never sends twice; a recovered/ordered cart stops the sequence; a customer who unsubscribed (consent state) is skipped; recovery email is a **marketing-adjacent** message: it must respect `customer_consent_events` per the existing rule for abandoned-cart mail (verify what the current code does and keep or tighten it; document the legal basis decision in the change record for the owner).
- While platform email delivery is not configured, the UI states "Recovery emails can't be sent until email delivery is enabled for the platform" (read the platform mailer status; do not guess). The setting still saves.

### 4E. Self-serve order cancellation (build only this; otherwise omit the switch)
`orders.cancelByCustomer` via the existing order-view token (`/o/[token]`): allowed only when the order is not fulfilled or shipped, payment status is unpaid/COD-pending, and `allowSelfServeCancellation` is true; reuses the existing admin cancel path (stock released, COD payment voided, timeline entry with actor `customer`, audit row, cancellation email through the Phase-7-ready mailer hook). Rate-limited by token and IP; CSRF (`sameOrigin`) like the other storefront mutations. If you cannot finish this with real-DB tests, **omit the column, the switch and the route** and say so.

### 4F. Returns
No new fields. `/settings/returns` stays canonical. Verify and test that `allowSelfServeReturns=false` is enforced by the server, and that the nav and Overview link correctly.

## 5. Schema and migrations (expand-only; one migration per concern)

**M-A `customer_account_settings`** (new tenant table; `tenantTable()` + `forceRlsSql`):
```
id                         uuid pk default uuidv7()
tenant_id                  uuid not null  -- from tenantTable(); unique(tenant_id)
show_sign_in_links         boolean not null default true
email_password_enabled     boolean not null default true
phone_otp_enabled          boolean not null default true
allow_self_serve_returns   boolean not null default true
allow_self_serve_cancellation boolean not null default false   -- only if 4E ships
version                    integer not null default 1           -- optimistic concurrency
updated_at, created_at     timestamptz not null default now()
check (email_password_enabled or phone_otp_enabled)             -- never zero login methods
unique (tenant_id, id)                                          -- composite FK target convention
```
No row means defaults (parser/service default, no backfill needed). Grants follow the existing tenant-table pattern (`app_rw` DML; check `packages/db/migrations/*grants*` conventions and `b2-grants.int.test.ts`).

**M-B `store_settings.order_settings jsonb null`** (expand). **M-C** only if you add `customer_consent_events` columns: `text_version text null`, `ip_hash text null` (hash, with a per-tenant pepper, replacing raw `ip` writes going forward; keep the old column readable; do **not** rewrite old rows in this phase; a later contract step drops it). Record the consent label text version at write time.

The `store_settings.checkout` JSON group needs **no migration** (new keys optional).

## 6. UI (standards in HANDOFF §3.2)
Routes `settings/checkout.tsx`, `settings/customer-accounts.tsx`; extend `settings/orders.tsx`; nav items in the **Selling** group (`Checkout`, `Customer accounts`) with permission `checkout.manage`; every route has `pendingComponent`; dirty guard; saved/queued/live wording; (i) hover hints for explanations; disabled controls explain why; field-level errors; money fields in rupees. Storefront: header sign-in links, login form methods, checkout phone/line2/marketing checkbox, thank-you card, minimum-order shortfall, return portal switch: each reads the server projection.

## 7. Tests (counts go in your change record)
- **Unit:** `parseCheckoutSettings` and `parseOrderSettings` (defaults equal today, unknown keys preserved, clamping), invariants (no zero login methods, phone/COD guard), abandoned step ordering, consent label escaping.
- **Real Postgres:** per procedure allowed / denied (`analytics.read`-only) / cross-tenant; stale write rejected; audit row with before/after and no secrets; **default-behaviour parity** (store with no rows: same stock hold, no minimum, guest allowed, thank-you card shown); `guestCheckout=false` blocks anonymous `placeOrder` and allows a signed-in customer; `phoneRequired` guard; minimum order refused with the shortfall and admin-created exempt; `stockHoldMinutes` reflected in reservation expiry; `marketingEmail` unticked never subscribes, ticked writes one consent event with source `checkout` and text version, and never overrides a prior unsubscribe silently; sign-in methods enforced in register/login/OTP; abandoned steps idempotent (re-run sends once), skip recovered and unsubscribed; `allowSelfServeReturns=false` refused server-side; (4E) cancel rules, stock released, token rate limit.
- **Isolation suite:** map `checkoutSettings.*`, `customerAccountSettings.*`, and the extended `orderSettings.*` procedures.
- **UI (router-context tests):** each page's loading, error, dirty, saved, unavailable, permission-denied states; nav grouping/permissions; storefront components with each setting on/off.
- **e2e:** update `e2e/` where a label or flow changed (prefix match); do not add specs that need provider credentials.

## 8. Do not build
Terms/policy consent (Phase 7); notification preferences or staff alerts (Phase 7); COD fee/limits and payment ordering (Phase 5); GST and shipping (Phase 6); Google/Facebook sign-in; SMS/WhatsApp consent; auto-deliver or auto-cancel automation; loyalty or store credit (owner direction: excluded). Do not touch Razorpay or Shiprocket.

## 9. Acceptance criteria (Claude verifies each against the code and runs the gate)
- [ ] Every displayed option changes domain behaviour and has a test proving it; unsupported options are absent or visibly unavailable with a reason.
- [ ] A store with no saved settings behaves exactly as before (parity test).
- [ ] Guest checkout, account claim and consent remain tenant-scoped and secure under ADR-019; consent is never pre-ticked and every change is an immutable event with text version.
- [ ] Information required for shipping, payment or tax cannot be hidden or made optional by a setting.
- [ ] No state can lock customers out (≥1 sign-in method) or strand checkout.
- [ ] Stale writes rejected; audit rows have no secrets; permissions enforced in route **and** service with denial tests; support sessions get none of the families.
- [ ] Migrations append-only, journal increasing, RLS forced, grants test passes.
- [ ] Browser check by you at 375 px, tablet and desktop, light and dark, including a permission-denied role and the storefront effects (state exactly what you drove).
- [ ] `pnpm typecheck`, `lint`, `build`, `docs:check` on the merged tree; fast suites; `@bs/domain` heavy suite (counts pasted); ARCHITECTURE updated; no secrets or generated files.

## 10. Commit plan
1. `feat(settings): checkout settings parser, contract, service (guest, phone, line 2, marketing)` 2. `feat(accounts): customer account settings table and enforcement` 3. `feat(orders): order_settings (stock hold, minimum order) enforced in checkout` 4. `feat(checkout): abandoned checkout settings and idempotent recovery steps` 5. `feat(orders): self-serve cancellation` (or the omission note) 6. `feat(admin): checkout and customer accounts pages, orders section, nav` 7. `docs: ARCHITECTURE, ADR-020 enforcement status, change record`.

## 11. Owner questions to raise (do not decide)
Legal basis for abandoned-checkout recovery email (consent vs legitimate interest) for Indian D2C; whether guest checkout may ever be disabled for stores with no sign-in method configured (default: refuse). Report in the change record under "Open questions".
