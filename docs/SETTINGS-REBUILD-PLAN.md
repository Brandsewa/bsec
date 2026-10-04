# Store Admin Settings rebuild plan

## 0. Goal and product stance

Rebuild Settings as the merchant's reliable operating console: a place to configure the store, safely manage sensitive capabilities, and understand what is ready to sell. It must be easy for a first-time Indian D2C merchant, but specific enough for an operations or technical staff member to run the business without exposing unsafe platform controls.

**Design read:** an operations-focused D2C SaaS workspace for store owners and staff. The direction is compact, calm and trust-first: high information density, clear section hierarchy, no decorative motion, and progressive disclosure for risky or infrequent controls.

This plan uses Shopify and FluentCart as product references, not implementation models. Shopify separates sensitive settings through granular permissions, while FluentCart's gateway cards make availability and configuration state clear. See [Shopify settings permissions](https://help.shopify.com/en/manual/your-account/users/roles/permissions/settings-permissions), [FluentCart payment settings](https://docs.fluentcart.com/guide/settings-configuration/payment-settings), and [FluentCart store settings](https://docs.fluentcart.com/guide/settings-configuration/store-settings?by=100).

## 1. Non-negotiable boundaries

These decisions refine the requested list to fit bsec's existing architecture.

| Requested capability | Product decision | Reason |
|---|---|---|
| Plans & billing | Merchant may view plan, usage and invoices, and request a plan change. Platform staff owns plan catalog, charging, refunds, and final plan changes until self-service SaaS billing is live. | Platform subscription billing is separate from customer checkout billing (ADR-014). |
| Payment gateways | Store-specific payment methods live here. Credentials are write-only and encrypted; a merchant never sees secrets after save. A gateway is hidden or marked unavailable until the end-to-end checkout provider is live. | Prevents configuration that cannot take payment and protects tenant secrets. |
| Storage options | Replace “choose Local/S3/R2” with read-only **Storage usage** and **Media management**. Storage provider, buckets, credentials, retention, and backups are platform operations. | Tenant object isolation and backups must remain centrally controlled. |
| Maintenance mode | A storefront availability control under **Storefront**, not a policy editor. Owner-level, audited, optionally scheduled, with a customer-safe maintenance page and 503/Retry-After behaviour. | Store status already has a supported `maintenance` mode. |
| Policies | Editable customer-facing policies, versioned and published as safe rich text/validated blocks only—never merchant HTML, CSS or JavaScript. | ADR-010 prohibits merchant-controlled code. |
| Notifications | Event enablement, recipient routing and approved templates only. Sending occurs after commit through pg-boss; no provider call in a request. | Preserves ADR-006 and the platform mailer architecture. |
| Privacy | Consent controls, cookie banner, marketing preferences, export/deletion requests and an opt-out page. Do not expose legal conclusions as toggles. | India DPDP obligations and existing consent/export/deletion work require auditable behaviour. |

## 2. Target information architecture

Settings opens on **Overview**, not a form. It shows setup progress, live-store health, pending actions, plan/usage summary, and deep links to missing configuration. Existing onboarding progress becomes an input to this view rather than a second competing checklist.

### Navigation groups and routes

| Group | Route | Scope | Audience / permission |
|---|---|---|---|
| Overview | `/settings` | readiness checklist, warnings, usage snapshot, latest configuration activity | `settings.read` |
| Store | `/settings/store-details` | legal business, public contact, address, locale, currency, formats and units | `settings.manage` |
|  | `/settings/branding` | logo variants, favicon/app icon, colours and approved typography | `branding.manage` |
|  | `/settings/storefront` | visibility, coming-soon, password and maintenance controls | `storefront.manage` |
|  | `/settings/domains` | platform subdomain, custom-domain request, DNS instructions, verification state and primary-domain selection | `domains.manage` |
| Selling | `/settings/checkout` | guest checkout, account-creation mode, checkout fields, consent, marketing opt-ins and recovery controls | `checkout.manage` |
|  | `/settings/customer-accounts` | sign-in visibility, supported sign-in methods, account access, self-service cancellation/returns | `customer-accounts.manage` |
|  | `/settings/payments` | payment-method cards, order, availability, test/live state, provider setup drawers and manual methods | `payments.manage` |
|  | `/settings/shipping` | profiles, zones, rates, classes, packages, local delivery/pickup when supported | `shipping.manage` |
|  | `/settings/taxes` | GST configuration, tax-inclusive pricing, registration and product tax classes | `taxes.manage` |
| Operations | `/settings/orders` | numbering, fulfilment defaults, order processing and staff order alerts | `orders.settings.manage` |
|  | `/settings/returns` | eligibility, exchanges, reasons, evidence requirements and customer instructions | `returns.manage` |
|  | `/settings/notifications` | sender identity, event switches, recipients and template previews | `notifications.manage` |
| People & account | `/settings/users` | staff users, roles, invitations, access review and owner transfer request | `staff.manage` |
|  | `/settings/plan-and-billing` | current plan, feature/usage limits, invoices and upgrade/change request | all can view; owner can request change |
| Compliance & advanced | `/settings/policies` | refund, privacy, terms, shipping, legal notice and contact pages | `policies.manage` |
|  | `/settings/customer-privacy` | cookie banner, data-sharing opt-out, marketing consent and privacy requests | `privacy.manage` |
|  | `/settings/support-access` | time-bounded, read-only platform support consent and history | owner only |
|  | `/settings/storage` | media/storage usage, quotas and retention explanation; no provider credentials | `settings.read` |
|  | `/settings/activity` | filtered audit trail of store-setting changes | owner / `audit.read` |

**Navigation behaviour:** desktop has grouped left navigation; mobile/tablet has a searchable section chooser that preserves the group headings. Hide sections the role cannot access rather than showing disabled links. A direct URL must return a proper permission error, not rely on hidden navigation.

## 3. Detailed screen specifications

### 3.1 Overview

Show four compact bands, in priority order:

1. **Action required** — setup blockers such as no active payment method, no shipping rate, missing tax address, unverified custom domain, or store not live.
2. **Store status** — live/coming soon/password/maintenance, primary domain, active theme version and a safe “view store” link.
3. **Plan and usage** — plan name, renewal/status, products, staff seats, storage and orders against limits. Link to billing; do not show platform operational secrets.
4. **Recent changes** — the latest audited settings changes, actor and timestamp.

No overview card may claim a feature is configured until the server verifies the configuration is usable. Each card has one clear next action.

### 3.2 Store details

Split one long page into sections with independent save boundaries:

- **Business identity:** business type, public store name, legal entity name, registered business address, country, GSTIN/Tax ID. Legal name and tax fields feed invoices and tax calculations.
- **Store owner:** owner name, designation, email and phone. This is identity/account data; an owner transfer is a separate audited workflow, never an editable email field that silently changes ownership.
- **Public contact:** support email, phone and optional customer-service address. This is used for storefront contact, reply-to identity, receipts and transactional mail.
- **Regional defaults:** language (initially English only unless storefront i18n ships), timezone, date/time presentation, INR initially, currency display rules, metric/imperial system and weight unit. Currency cannot be casually changed after orders exist; use a guarded migration workflow or make it immutable for V1.

Use canonical IANA timezone identifiers and ISO currency codes internally; localize presentation in the UI. “Language selector” must not appear before translations and content localisation exist.

### 3.3 Users and accounts

Replace the duplicate requested owner/contact/default fields with an access-management area:

- Named preset roles: **Owner**, **Manager**, **Operations**, **Content**, **Fulfilment**, **Technical support**.
- A role detail drawer shows precise capabilities and sensitive exclusions. Do not use only one broad `settings.write` permission.
- Invitation, pending invite, revoke, role change and removal are audited. The last owner cannot be removed; an owner transfer needs re-authentication and a confirmation step.
- Add a periodic “access review” prompt showing inactive staff and pending invitations.

Initial capability families: `settings.manage`, `payments.manage`, `checkout.manage`, `shipping.manage`, `taxes.manage`, `domains.manage`, `policies.manage`, `privacy.manage`, `notifications.manage`, `staff.manage`, `audit.read`, plus the existing commerce permissions. This needs an ADR before code because it changes the authorization model.

### 3.4 Plan and billing

Two tabs exactly as proposed:

- **Plan & usage:** current plan, status, billing interval, included limits, current usage, enabled feature entitlements and a request-to-change-plan action.
- **Invoices:** paginated table: invoice number, issue date, amount, tax, status, due/paid date and secure invoice download when available.

V1 is read-only to merchants except for a plan-change request. Do not mix this with payment gateway setup. The plan catalog and platform invoice records are global platform data and remain behind the platform API per ADR-014.

### 3.5 Branding and storefront

Keep two related but distinct areas:

- **Branding** owns reusable identity assets: light/dark logos, favicon, app icon, social share image, primary/secondary/accent colours, and approved typography.
- **Online Store** owns theme, pages, navigation and blocks. It consumes branding defaults but maintains its own draft/publish/rollback lifecycle.
- **Storefront settings** owns availability: live, coming soon, password and maintenance. It also links to SEO and Domains; those remain their own pages.

Unify the publishing model: changes must say whether they are saved as draft, live immediately, or require explicit Publish. Branding must not unexpectedly overwrite theme-specific visual choices. Use preview links and version/audit information rather than duplicate color editors.

### 3.6 Payments

Use a gateway catalogue of cards, grouped into **Active**, **Available**, **Coming soon**, and **Manual methods**. A card shows logo, shopper-facing name, status, supported currencies, test/live state, last updated, and actions.

- Toggle only activates a gateway after required validation succeeds.
- “Set up” opens a focused drawer; secrets are write-only, masked after save, never logged and never returned by the API.
- “Disconnect” uses a clear impact statement and confirmation; it disables new checkout use but keeps historical payment records intact.
- Gateway order controls checkout display order.
- COD is a supported manual method now. Bank deposit and money order remain planned manual methods; do not present them as active until their instructions, reconciliation and order state behaviour are built.
- Razorpay is first when the owner authorizes provider work. Stripe and PayPal are catalogue entries only—not configuration screens or dependencies—until provider adapters, credentials, webhooks and real checkout flows exist.

### 3.7 Orders, refunds and returns

Keep this deliberately separate from Checkout:

- **Orders:** numbering, fulfilment defaults, stock hold rules, documented manual order workflow and staff alerts.
- **Refunds:** refund policy defaults and customer communication choices only after the refund lifecycle is implemented. Never promise automatic payment refunds while provider integrations are deferred.
- **Returns:** retain the shipped settings: eligibility, exchanges, window, reasons, proof requirements, instructions and policy copy.

The existing [Orders Settings plan](ORDERS-SETTINGS-PLAN.md) remains the implementation source for current order-numbering and return work. This plan supersedes only its navigation placement once this wider rebuild begins.

### 3.8 Checkout and customer accounts

Shopify and FluentCart both distinguish checkout configuration from customer account configuration. Follow that split.

**Checkout:**

- Guest checkout: enabled/disabled; default enabled for ordinary D2C purchases.
- Account creation: no account, opt-in at checkout, or automatic after completed payment. Automatic mode requires a confirmed identity and must not make a password silently.
- Contact method: email or phone + email; preserve the existing phone requirement until a product decision and migration change it.
- Address fields: only permitted fields may be hidden/optional/required; required shipping and legal/tax data cannot be made optional. Every field setting must change the server validation and the storefront form together.
- Consent: terms acceptance, marketing opt-ins for email/SMS/WhatsApp, unchecked by default, consent text/version and timestamp stored server-side.
- Abandoned checkout: enablement, trigger timing, up to three email steps, frequency caps, suppression/unsubscribe and preview. It stays disabled until delivery is live.

**Customer accounts:**

- Header and checkout sign-in links.
- Current supported methods: email/password and phone OTP, as implemented by ADR-019. Google/Facebook are explicitly “not available” until a provider-backed identity flow is designed; do not make a non-functional switch.
- Self-service returns/cancellations are controlled here only as links to the underlying lifecycle settings; eligibility stays enforced in the domain service.

### 3.9 Shipping and delivery

Move from one default-zone screen to a safe shipping model in phases:

- Shipping profiles scope products to a set of rules; default profile first.
- Zones match countries/states/pincodes according to supported capabilities.
- Rates support flat per-order, per-item, weight-based, percentage-based, free-shipping threshold and conditional rules. Each rate has a readable condition summary and checkout preview.
- Shipping classes label product handling characteristics; packages carry dimensions/weight for future carrier calculation.
- Carrier and pickup/local-delivery functionality remain hidden until their adapters and operational workflow exist. Shiprocket is explicitly deferred.

All rates stay tenant-scoped, are priced/revalidated on the server during checkout, and have no client-trusted totals.

### 3.10 Taxes and duties

For V1 India D2C, make this **GST settings**, not a misleading generic international duties page:

- tax collection enabled/disabled;
- GSTIN and legal entity/seller address;
- price display inclusive/exclusive of GST;
- place-of-supply source and IGST versus CGST/SGST calculation;
- product tax classes/HSN linkage and rate assignment;
- shipping tax treatment;
- invoice/credit-note requirements and validation warnings.

Use safe defaults and explain their impact at checkout and on invoices. International tax registration, duties, VAT reverse charge and multi-currency markets are out of scope until the tax engine supports them. FluentCart's separation of global tax configuration from rate/class configuration is a useful pattern; see [its tax configuration guide](https://docs.fluentcart.com/guide/tax-%26-duties/configuration-and-classes).

### 3.11 Notifications

Split configuration from delivery infrastructure:

- **Sender identity:** display name, platform-approved sender domain, support reply-to; no raw SMTP/API credentials in merchant settings.
- **Customer events:** order confirmation, payment pending/paid/failed, shipment, delivery, cancellation, refund, return, account verification/reset, marketing consent and abandoned checkout.
- **Staff events:** new order, payment exception, low stock (when supported), fulfilment request, return/dispute updates.
- **Channels:** email available through the platform mailer; SMS/WhatsApp visible as planned only until their provider, consent and cost controls ship.
- **Templates:** selected approved templates, localisation-ready variables and preview/test-send workflow. No arbitrary code, raw HTML or template scripting.

Every event is off/on per tenant and checked by the queued job after the business transaction commits. Transactional messages are not marketing messages; marketing consent never suppresses order-critical notices.

### 3.12 Domains, policies, privacy, storage and support

- **Domains:** show subdomain, custom-domain state machine, exact DNS records, verification attempt/status, primary-domain selection and removal request. Use ADR-017; never expose Cloudflare credentials.
- **Policies:** structured policy editor with templates and version/publish dates for Refund, Privacy, Terms, Shipping and Legal Notice. Storefront/checkout links always point to published versions.
- **Customer privacy:** cookie categories, banner text, data-sharing opt-out page, marketing preferences, subject-access export, deletion request status and privacy contact. Default non-essential marketing/analytics off until explicit consent.
- **Storage:** usage and quota only; explain that media is managed by the platform. Do not offer bucket keys or provider changes.
- **Support access:** retain consent/history but gate standing consent to the owner. Explain duration, read-only scope and audit trail.

## 4. UX and interaction rules

1. Every screen has one clear owner, brief purpose text and either section-level Save or an explicit draft/publish state—never both ambiguously.
2. Use the existing `SettingsPageFrame`, `SettingsSection`, `HeaderActions`, `SimpleSelect`, `ConfirmDialog`, skeletons and inline error patterns. No native selects or browser confirmations.
3. Use a sticky save bar only for long multi-section forms; show “Saved”, “Unsaved changes” and server validation near the action.
4. Every destructive or high-impact operation states the effect: disable checkout payments, make the storefront unavailable, revoke a user, replace a domain or erase data.
5. Sensitive configuration requires recent-password confirmation or step-up authentication where supported, especially owner transfer, payment credentials and standing support consent.
6. Mobile is a first-class form layout: one column, large targets, no side-by-side complex controls, and settings navigation never loses unsaved-change protection.
7. Dark mode, 375px mobile, tablet and desktop are acceptance checks—not polish deferred after build.

## 5. Data, API and security design

### Data approach

- Keep one tenant-scoped `store_settings` row for small, versioned configuration groups only when they have the same lifecycle and access controls.
- Use dedicated `tenantTable()` tables for growing or independently auditable entities: payment method configuration metadata, notification preferences/templates, shipping profiles/classes/packages, policy versions, checkout field rules and activity events.
- Every new tenant table gets `forceRlsSql()` in its append-only migration and composite `tenantForeignKey` relationships.
- JSON shapes have `v` and parsers with defaults equal to current behaviour, so existing stores do not silently change after rollout.
- Payment secrets remain encrypted in `tenant_secrets`; responses expose only status and safe hints.

### API and domain approach

1. Contract first in `packages/contracts` with narrow get/update procedures per section.
2. Domain service in `packages/domain` validates invariants, calls `assertPermission`, writes an audit record, and invalidates tenant-scoped cache after commit.
3. Route handler only derives context and invokes the domain service; the admin remains HTTP-only.
4. Every mutation returns a safe post-save representation, never raw credentials or sensitive tokens.
5. Side effects—emails, domain verification, activity delivery, scheduled maintenance transitions—are queued through pg-boss after commit.

### Permission model

Before implementation, write an ADR that replaces the broad `settings.write` gate with composable permission families. The old permission may remain as a backwards-compatible aggregate temporarily, but no sensitive page may rely on navigation visibility alone. Tests must cover each procedure for allowed role, denied role and cross-tenant refusal.

## 6. Delivery phases

### Phase 0 — Decisions and design system inventory

- Confirm product decisions in section 7.
- Write the permissions ADR and a page-level capability matrix.
- Audit current routes, contracts, domain services, tables and unfinished plans; map each existing setting to its new home.
- Produce desktop/mobile wireframes for Overview, Store details, Payments, Checkout and Shipping.
- Define status vocabulary: Available, Needs setup, Active, Disabled, Unavailable, Coming soon, Error.

**Exit:** approved IA, permission model and no setting is assigned to two editors.

### Phase 1 — Shell, overview and safe migration

- Build grouped Settings navigation, mobile chooser, route redirects and permission-aware empty/denied states.
- Add `/settings` Overview driven by server-verified readiness data and existing onboarding progress.
- Move General to Store details without data loss; make old links redirect.
- Add shared save/publish/status components and UI tests inside a router.

**Exit:** current settings stay usable, all current values render in exactly one new home, and unsaved-change protection works across navigation.

### Phase 2 — Identity, people, plan and storefront foundations

- Deliver Store details, Users, Plan & billing read-only, Branding, Storefront availability, Domains status and Support access.
- Reconcile branding/theme draft-publish lifecycle; preserve current theme editor capability.
- Add activity/audit viewing where authorized.

**Exit:** ownership, staff access, store status and public identity are clear and audited.

### Phase 3 — Checkout, accounts and payments

- Model checkout/account settings with enforced server and storefront behaviour.
- Build payment catalogue and COD configuration; gate Razorpay work behind explicit owner authorization.
- Add customer-account controls only for ADR-019-supported methods.

**Exit:** no visible checkout/payment switch lacks real server behaviour; all secret flows are write-only and audited.

### Phase 4 — Shipping, GST and order operations

- Expand shipping safely from the current default zone/rates to profiles, zones, conditions, classes and packages in staged migrations.
- Rebuild GST configuration with calculation/invoice tests before exposing broader controls.
- Fold current Orders and Returns plans into the new navigation without duplicating settings.

**Exit:** checkout recomputes shipping and tax entirely server-side for every supported configuration; real-DB isolation and pricing tests pass.

### Phase 5 — Notifications, policies, privacy and maintenance

- Ship notification preferences only alongside working queued delivery and consent controls.
- Build policy publishing, privacy controls, customer data requests and audited maintenance scheduling.
- Add storage usage and media quota visibility; no merchant storage-provider controls.

**Exit:** customer-facing legal/privacy content is safely published, notifications respect consent/type, and maintenance mode is safe to operate.

### Phase 6 — Hardening and rollout

- Feature-flag each section and migrate tenants gradually.
- Add real-database isolation/permission/audit tests, contract tests, UI route tests and browser walkthroughs at 375px, tablet and desktop in light/dark mode.
- Run the full verification gate, publish change records, update architecture documentation, and remove legacy routes only after telemetry/audit review.

## 7. Owner decisions required before Phase 0 completes

1. Which plan-change path is desired before platform billing is live: contact/request only, or merchant self-service when the billing provider is built?
2. Is V1 India-only (INR, English and GST) the intended product boundary? This determines whether language/currency switches are real configuration or future-facing placeholders.
3. Which of the proposed staff roles are needed at launch, and may an owner delegate payment, domain, privacy and support-consent authority?
4. Which manual payment methods are truly required beyond COD, and what reconciliation workflow should each create?
5. Should account creation default to guest checkout with opt-in account creation, or automatic account creation after verified completion?
6. Are abandoned-checkout emails, SMS and WhatsApp in the next release scope, given the current provider/key decision?
7. Do merchants need multi-zone/pincode shipping and package dimensions before a courier integration, or should Phase 4 stop at zones plus flat/value/weight rates?
8. Who supplies and approves the legal policy templates and DPDP wording? The product can provide structure and publishing, not legal advice.

## 8. Acceptance criteria for the rebuild

- [ ] Each setting has one canonical route, one source of truth and observed server behaviour.
- [ ] No tenant can read, mutate or infer another tenant's settings, provider state or audit data.
- [ ] Sensitive credentials, tokens and platform infrastructure settings never reach the browser or logs.
- [ ] Every store-setting mutation has a permission check in the domain service, an audit record and appropriate cache invalidation.
- [ ] Every new tenant table and migration follows tenant RLS requirements.
- [ ] Payment, shipping, tax, checkout and customer-account changes have domain tests; tenancy, money, auth and permissions have real-database tests.
- [ ] Unsupported functionality is absent or clearly unavailable; it is never a toggle that appears to work.
- [ ] Mobile, tablet and desktop flows are manually exercised in light/dark mode, including loading, error, empty, permission-denied and unsaved-change states.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`, impacted fast tests and required heavy tests pass before release.

## 9. References in this repository

- `AGENTS.md` — tenant, domain, audit, provider and delivery rules.
- `docs/ARCHITECTURE.md` — current API/UI/data map.
- `docs/adr/014-platform-billing-separation.md` — merchant subscription billing isolation.
- `docs/adr/017-custom-domain-provider-adapter.md` — domain state machine.
- `docs/adr/019-customer-auth-and-platform-mailer.md` — customer accounts and platform mail.
- `docs/ORDERS-SETTINGS-PLAN.md` — current order/return settings implementation plan.
- `docs/admin-ui-standards.md` — required admin UI components and behaviour.
