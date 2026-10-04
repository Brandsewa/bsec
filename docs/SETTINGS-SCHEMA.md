# Store Admin Settings — target schema

## 0. Purpose and status vocabulary

This document is the data and contract companion to [the Settings rebuild plan](SETTINGS-REBUILD-PLAN.md). It defines the target setting groups before implementation. It is not a migration: existing columns, routes and contracts remain authoritative until an implementation phase lands.

Every setting is classified as one of:

| Status | Meaning |
|---|---|
| **Current** | Exists and has server-enforced behaviour today. |
| **Migrate** | Exists but moves to a clearer canonical route/shape. |
| **Planned** | Requires a contract, domain service, migration and behaviour before it appears in the UI. |
| **Platform-owned** | Merchant can view status/usage, but cannot configure credentials, infrastructure or provider-wide policy. |
| **Deferred** | Do not build or expose until an explicit owner decision and provider/domain work exist. |

## 1. Schema rules

1. All merchant data is tenant-scoped. A new table uses `tenantTable()` and its migration includes `forceRlsSql(name)`; cross-tenant references use `tenantForeignKey`.
2. Setting changes are domain mutations: validate in `packages/contracts`, authorize in `packages/domain`, write `audit_logs`, then invalidate tenant cache after commit.
3. JSON groups have a mandatory `v` field and a parser whose missing-value defaults preserve current store behaviour.
4. Secrets live only in `tenant_secrets` encrypted with `TENANT_SECRETS_KEY`. APIs return status/hints only—not secrets, ciphertext, IVs or tokens.
5. A setting is not rendered until a domain consumer enforces it. A disabled feature must show why; no decorative toggle may imply behaviour.
6. Provider calls and notifications happen through pg-boss after the setting transaction commits.
7. Monetary values are integer paise; timestamps are UTC `timestamptz`; presentation uses store locale/timezone; identifiers are UUIDv7.

## 2. Core tenant settings

`store_settings` remains the one-row-per-tenant aggregate for small, independently versioned values with the same lifecycle. It must not become an unbounded dumping ground.

### 2.1 Columns

| Field | Type / validation | Status | Purpose |
|---|---|---|---|
| `tenant_id` | UUID, unique, tenant scoped | Current | Tenant identity. |
| `store_name` | text, 1–120 | Current | Public store name. |
| `legal_name` | text, 1–200, nullable | Current | Seller/invoice legal entity name. |
| `business_type` | enum `individual \| proprietorship \| partnership \| llp \| private_limited \| public_limited \| trust \| other`, nullable | Planned | Business classification; do not infer legal/tax treatment from it. |
| `owner_profile` | see §2.2, nullable | Planned | Owner display profile only; not login/ownership transfer authority. |
| `support_email` | citext email, nullable | Current | Customer-facing support/reply-to address. |
| `support_phone` | E.164-compatible text, nullable | Current | Customer-facing support phone. |
| `address` | see §2.3, nullable | Current/Migrate | Registered/dispatch address. |
| `currency` | ISO 4217 char(3), default `INR` | Current | Store currency; immutable after financial activity in V1. |
| `locale` | BCP-47, default `en-IN` | Planned | Presentation locale. Do not expose language selection until translations ship. |
| `timezone` | IANA identifier, default `Asia/Kolkata` | Current/Migrate | Presentation and scheduling timezone. |
| `date_format` | enum `dd_mm_yyyy \| dd_mmm_yyyy \| iso`, default `dd_mmm_yyyy` | Planned | Admin/customer date presentation. |
| `time_format` | enum `twelve_hour \| twenty_four_hour`, default `twelve_hour` | Planned | Admin/customer time presentation. |
| `unit_system` | enum `metric \| imperial`, default `metric` | Planned | Default product/shipping unit system. |
| `weight_unit` | enum `g \| kg \| oz \| lb`, default `kg` | Current/Migrate | Default product/shipping weight unit. |
| `social` | versioned JSON, nullable | Current | Store social profile links; validate allowed destinations. |
| `checkout` | versioned JSON, nullable | Current/Migrate | Checkout setting group; see §5. |
| `notifications` | versioned JSON, nullable | Current/Migrate | Small notification preferences only; see §9. |
| `return_settings` | versioned JSON, nullable | Current | Return eligibility group; see §8. |
| `auto_publish_reviews` | boolean, default false | Current/Migrate | Move to a future Reviews setting or customer-content section. |
| `standing_consent_for_support` | boolean, default false | Current/Migrate | Move to support-access data/service; owner-only. |
| `created_at`, `updated_at` | timestamptz | Current | Standard audit timestamps. |

### 2.2 Owner profile JSON

```ts
type OwnerProfileV1 = {
  v: 1;
  name: string;           // 1–120
  designation?: string;   // 1–100
  contactEmail?: string;  // display/contact only; not auth identity
  contactPhone?: string;  // E.164-compatible
};
```

The actual owner is the membership/account with owner authority. Changing it requires a separate, re-authenticated ownership-transfer flow that updates membership state, logs before/after actors, revokes inappropriate sessions and never merely changes `owner_profile`.

### 2.3 Address JSON

```ts
type AddressV1 = {
  v: 1;
  countryCode: string; // ISO 3166-1 alpha-2; `IN` default for V1
  line1: string;
  line2?: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
};
```

Use this same normalized shape for seller/dispatch address. Customer shipping/billing addresses retain their order snapshot schemas and must not mutate when the store address changes.

## 3. People, roles and permissions

### 3.1 Existing identity tables

`users`, `memberships`, `roles` and invitations remain the source of truth for staff identity/access. The current `settings.write` and `staff.manage` permissions are a starting point, not sufficient for the finished Settings area.

### 3.2 Planned permission families

| Permission | Grants | Default roles |
|---|---|---|
| `settings.read` | View non-sensitive setting status | Owner, Manager, Operations, Technical support |
| `settings.manage` | Store details, locale and units | Owner, Manager |
| `branding.manage` | Brand assets and tokens | Owner, Manager, Content |
| `storefront.manage` | Visibility, password and maintenance state | Owner, Manager |
| `checkout.manage` | Checkout and account behaviour | Owner, Manager |
| `payments.manage` | Payment method setup/disconnect | Owner only initially |
| `shipping.manage` | Profiles, zones, rates and packages | Owner, Manager, Operations |
| `taxes.manage` | GST/tax configuration | Owner, Manager |
| `orders.settings.manage` | Numbering, fulfilment defaults, staff alerts | Owner, Manager, Operations |
| `returns.manage` | Return rules | Owner, Manager, Operations |
| `notifications.manage` | Event preferences and templates | Owner, Manager |
| `domains.manage` | Custom domains and primary domain | Owner, Technical support |
| `policies.manage` | Published store policies | Owner, Manager, Content |
| `privacy.manage` | Consent controls and data requests | Owner, Manager |
| `audit.read` | Settings activity/history | Owner, Manager |
| `staff.manage` | Invitations and roles | Owner, Manager if delegation is approved |

This requires an ADR and an expand/migrate/contract authorization rollout. During migration, map `settings.write` to the appropriate aggregate only in the domain layer; do not grant new sensitive capability simply because a navigation item is visible.

## 4. Plans, usage and billing — platform scoped

The merchant-facing screen is a safe projection over existing global `plans`, `subscriptions`, `platform_invoices` and quota/usage tables. It must not create a tenant copy of billing data.

### 4.1 Merchant read model

```ts
type PlanAndBillingView = {
  plan: {
    code: string;
    name: string;
    interval: "monthly" | "yearly";
    status: "trialing" | "active" | "past_due" | "suspended" | "cancelled";
    currentPeriodEnd: string | null;
    features: Record<string, boolean | string | number>;
    limits: Record<string, number>;
  } | null;
  usage: Array<{
    key: "products" | "staff_seats" | "storage_mb" | "orders_month" | "emails_month" | "custom_domains";
    used: number;
    limit: number | null;
    enforcement: "hard" | "soft" | "notify";
  }>;
  invoices: Array<{
    id: string;
    number: string;
    issuedAt: string;
    paidAt: string | null;
    amountPaise: number;
    taxPaise: number;
    status: "issued" | "paid" | "void";
    downloadable: boolean;
  }>;
};
```

**Permission:** any member may view a redacted plan/usage summary; only the owner may request a plan change. The platform controls plan changes and charges until self-service SaaS billing exists. This is separate from customer payments by ADR-014.

## 5. Checkout and customer accounts

### 5.1 `store_settings.checkout`

```ts
type CheckoutSettingsV1 = {
  v: 1;
  guestCheckout: boolean; // default true
  accountCreation: "none" | "optional" | "after_completed_order";
  contactMethod: "email" | "phone_and_email";
  phoneRequired: boolean; // existing default preserved until explicitly changed
  fieldRules: {
    companyName: "hidden" | "optional" | "required";
    addressLine2: "hidden" | "optional";
    billingAddress: "same_as_shipping" | "optional" | "required";
  };
  termsConsent: { enabled: boolean; policyHandle: "terms"; required: boolean };
  marketing: {
    email: { enabled: boolean; label: string; defaultChecked: false };
    sms: { enabled: boolean; label: string; defaultChecked: false };
    whatsapp: { enabled: boolean; label: string; defaultChecked: false };
  };
  cod: { enabled: boolean; feePaise: number; minOrderPaise?: number; maxOrderPaise?: number };
  abandonedCheckout: {
    enabled: boolean;
    detectAfterMinutes: number; // 15–10080
    steps: Array<{ enabled: boolean; delayHours: number; templateKey: string }>;
  };
};
```

**Validation/invariants:**

- `termsConsent.required` is true when enabled; no pre-checked legal consent.
- Marketing defaults are always `false`; write immutable consent event records with text/version/time/source.
- A server-owned field cannot be hidden if a shipping/tax/payment path requires it.
- `after_completed_order` creates an account only through an ADR-019-supported verified identity flow; never invents a password.
- Recovery steps are 0–3, ordered, capped, and disabled until mail delivery is enabled.
- Checkout UI and domain validation read the same parsed configuration in the same tenant context.

### 5.2 `customer_account_settings` (new tenant table)

Use a dedicated table because account access has different permissions and auditing from general store settings.

| Field | Type | Status / notes |
|---|---|---|
| `tenant_id` | UUID unique | Tenant table / RLS. |
| `showSignInLinks` | boolean default true | Planned. Header/checkout use it. |
| `emailPasswordEnabled` | boolean default true | Current capability under ADR-019. |
| `phoneOtpEnabled` | boolean default true | Current capability under ADR-019. |
| `googleEnabled` | boolean default false | Deferred; requires provider adapter and secret storage. |
| `facebookEnabled` | boolean default false | Deferred; requires provider adapter and secret storage. |
| `allowSelfServeReturns` | boolean default true | Planned; delegates to return eligibility service. |
| `allowSelfServeCancellation` | boolean default false | Planned; requires order-state rules. |
| `updated_at` | timestamptz | Standard timestamp. |

Do not add Google/Facebook switches to a merchant UI before the sign-in provider, callback security, account-linking and deletion impacts have an approved design.

## 6. Payments and provider credentials

### 6.1 `payment_methods` (new tenant table)

One row per configured provider/method. This contains metadata, not credentials.

| Field | Type / validation |
|---|---|
| `id`, `tenant_id` | UUIDv7 / tenant-scoped |
| `provider` | enum `cod \| bank_transfer \| money_order \| razorpay \| stripe \| paypal` |
| `display_name` | text 1–80 |
| `status` | enum `disabled \| pending_setup \| active \| unavailable \| error` |
| `mode` | enum `live \| test`, nullable for manual methods |
| `sort_order` | integer >= 0, unique per tenant among active rows |
| `public_config` | versioned JSON; shopper-safe labels/instructions only |
| `setup_state` | versioned JSON; safe status/errors/hints only |
| `enabled_at`, `disabled_at`, `updated_at` | timestamptz |

`tenant_secrets` remains one encrypted row per `(tenant_id, provider, key_name)`. Examples: Razorpay `key_id`, `key_secret`, `webhook_secret`; never add a generic untyped secret blob.

### 6.2 Method-specific shopper-safe config

```ts
type CodPublicConfigV1 = { v: 1; feePaise: number; minOrderPaise?: number; maxOrderPaise?: number };
type BankTransferPublicConfigV1 = { v: 1; instructions: string; referenceLabel?: string }; // planned
type ProviderSetupStateV1 = {
  v: 1;
  configured: boolean;
  requiredSecretsPresent: string[]; // names only
  lastValidatedAt?: string;
  lastErrorCode?: "credentials_invalid" | "webhook_invalid" | "provider_unavailable";
};
```

**Activation rule:** the domain service validates provider requirements, checks that an actual checkout adapter is enabled, saves an audit diff, then marks `active`. Disconnecting a provider affects future checkout only; it cannot erase or rewrite historical payment records.

Razorpay is the first supported online provider when explicitly authorized. Stripe and PayPal remain catalogue/deferred entries; no SDK, key fields, dependencies or live-looking toggles before a provider adapter ships.

## 7. Shipping and delivery

The current shipping zones/rates remain valid for the existing simplified screen. Expand them rather than replacing or duplicating them.

### 7.1 Target entities

| Entity | Key fields | Rules |
|---|---|---|
| `shipping_profiles` | `id`, `tenant_id`, `name`, `is_default`, `active` | One default profile; product/profile mapping uses tenant composite FK. |
| `shipping_profile_products` | `tenant_id`, `profile_id`, `product_id` | Product belongs to at most one explicit non-default profile; default catches remaining products. |
| `shipping_zones` | existing `id`, `tenant_id`, `profile_id`, `name`, `is_default`, `coverage` | `coverage` v1 has countries, states and pincode include/exclude patterns. Validate and normalize server-side. |
| `shipping_rates` | existing `id`, `tenant_id`, `zone_id`, `method`, `rate_type`, `amount`, `conditions`, `active`, `sort_order` | `amount` is paise or basis points according to `rate_type`; never float. |
| `shipping_classes` | `id`, `tenant_id`, `name`, `slug`, `description` | Product handling group; optional until a profile uses it. |
| `shipping_packages` | `id`, `tenant_id`, `name`, `length_mm`, `width_mm`, `height_mm`, `empty_weight_g`, `active` | Dimensions/weight normalized to metric storage. |

### 7.2 Rate condition JSON

```ts
type ShippingRateConditionsV1 = {
  v: 1;
  minOrderPaise?: number;
  maxOrderPaise?: number;
  minWeightGrams?: number;
  maxWeightGrams?: number;
  minItemCount?: number;
  maxItemCount?: number;
};

type ShippingRateType =
  | "flat_order"        // amount paise
  | "per_item"          // amount paise per item
  | "weight_tier"       // fixed/rules encoded in conditions, selected server-side
  | "percentage"        // basis points of eligible goods subtotal
  | "free";
```

All shipping choices/prices are recalculated inside checkout from server-owned cart, profile, destination and rate records. Client-provided shipping totals/rates are hints only and are never trusted.

Carrier, pickup and local-delivery provider configuration is deferred. Shiprocket must not be touched without explicit owner authorization.

## 8. Orders, refunds and returns

### 8.1 `order_settings` JSON

The current `number_sequences` row remains authoritative for prefix, padding and next value. Put related processing defaults in a versioned group, either `store_settings.order_settings` or a dedicated table if it grows beyond one lifecycle.

```ts
type OrderSettingsV1 = {
  v: 1;
  stockHoldMinutes: number; // 5–120, default 30
  minimumOrderPaise: number; // default 0
  autoDeliverAfterDays?: number; // only when automation exists
  cancelUnconfirmedCodAfterDays?: number; // only when confirmation workflow exists
  staffNewOrderAlert: { enabled: boolean; recipientEmail?: string };
};
```

The existing `admin.orderSettings` contract handles number prefix/padding/next value. It should be extended only when the corresponding checkout/job behaviour and tests ship.

### 8.2 `return_settings` JSON

Current shape becomes explicit versioned schema:

```ts
type ReturnSettingsV1 = {
  v: 1;
  acceptReturns: boolean;
  allowExchanges: boolean;
  returnWindowDays: number; // 1–90
  reasons: Array<{
    id: string; // stable, max 50 chars
    label: string; // 1–60
    photoRequirement: "required" | "optional" | "not_asked";
  }>; // 1–12
  instructions: string; // max 1,000
  policyText: string; // max 1,000; migrate to policy reference when policies ship
};
```

Existing defaults must be retained: returns/exchanges enabled, 7-day window and the default reasons. Refund execution settings are deferred until the payment/refund provider lifecycle exists; policy wording alone must not claim automatic refunds.

## 9. Notifications

### 9.1 `store_settings.notifications` — preference group

Use this only for small tenant preferences consumed by the notification dispatcher; keep message delivery history in dedicated records.

```ts
type NotificationPreferencesV1 = {
  v: 1;
  sender: { displayName?: string; replyToEmail?: string };
  customer: {
    orderConfirmation: boolean;
    paymentStatus: boolean;
    shipment: boolean;
    delivery: boolean;
    cancellation: boolean;
    refund: boolean;
    returnUpdates: boolean;
    accountSecurity: boolean; // transactional, not marketing
  };
  staff: {
    newOrder: boolean;
    paymentException: boolean;
    returnOrDispute: boolean;
    fulfillmentRequest: boolean;
  };
  channels: {
    email: true;
    sms: boolean; // false/unavailable until provider + consent work
    whatsapp: boolean; // false/unavailable until provider + consent work
  };
};
```

### 9.2 Supporting tables

| Table | Purpose |
|---|---|
| `notification_templates` | Tenant-selected approved template key, locale, subject overrides where permitted and version; no raw code execution. |
| `notification_deliveries` | Event id, tenant, channel, recipient hash/address as appropriate, status, provider message ID, attempts, timestamps, error code. Retention/PII policy required. |
| `marketing_consents` | Immutable customer consent events: tenant, customer/order/session reference, channel, purpose, text/policy version, granted/revoked time, source/IP hash. |

All transactional delivery jobs test the preference at execution time. They do not condition legally necessary order/security notifications on marketing consent.

## 10. Brand, theme and storefront availability

### 10.1 `brand_settings` (existing tenant table)

Target public asset/token group:

```ts
type BrandSettingsV1 = {
  v: 1;
  assets: {
    logoLightMediaId?: string;
    logoDarkMediaId?: string;
    faviconMediaId?: string;
    appIconMediaId?: string;
    socialImageMediaId?: string;
  };
  colors: {
    primary: string; secondary?: string; accent1?: string; accent2?: string;
    background?: string; surface?: string; text?: string;
  };
  typography: { heading: string; body: string; scale: "sm" | "md" | "lg" };
};
```

All media IDs use tenant composite FKs. Colors must be validated and accessibility warnings are advisory, not a bypass of theme contrast enforcement. Branding changes have their own draft/publish/version state and must not overwrite theme-specific tokens without an explicit product rule.

### 10.2 `store_status` (existing tenant table)

```ts
type StoreStatusMode = "live" | "coming_soon" | "password" | "maintenance";
type StoreStatusV1 = {
  mode: StoreStatusMode;
  headline?: string;
  message: Array<ValidatedBlock>; // no raw HTML
  launchAt?: string;
  showCountdown: boolean;
  collectEmails: boolean;
  backgroundMediaId?: string;
  retryAfterMinutes: number; // 1–1440
  maintenance?: { startsAt?: string; endsAt?: string; allowStaffPreview: boolean };
};
```

Passwords and bypass tokens are hash-only values. Maintenance mode returns the correct temporary-unavailable HTTP semantics from the server and must have an audited activation/deactivation trail.

## 11. Domains

Use the existing tenant `domains` table and ADR-017 state machine. Merchant-visible domain fields are a projection only.

| Field | Type / rule |
|---|---|
| `hostname` | normalized lower-case hostname; validate public suffix/domain syntax. |
| `type` | `subdomain \| custom`. |
| `status` | `requested \| awaiting_dns \| verifying \| ssl_pending \| active \| failed \| removing \| removed`. |
| `is_primary` | true only for an active domain; one primary per tenant. |
| `verification_method` | `cname \| prevalidate_txt`; show exact required records only. |
| `provider_hostname_id` | internal/provider reference; never browser-editable. |
| `failure_code`, `failure_message` | safe supportable state, no provider credential detail. |

Cloudflare token/zone configuration remains platform environment configuration. Domain provisioning/polling is a background workflow.

## 12. Policies and customer privacy

### 12.1 `store_policies` (new tenant table)

| Field | Type / validation |
|---|---|
| `id`, `tenant_id` | UUIDv7 / RLS |
| `handle` | enum `refund \| privacy \| terms \| shipping \| legal_notice` |
| `title` | 1–120 |
| `draft_content` | validated JSON blocks, max documented size |
| `published_content` | validated JSON blocks, nullable until published |
| `version` | integer >= 1 |
| `published_at`, `published_by` | audit metadata |
| `created_at`, `updated_at` | timestamps |

Unique `(tenant_id, handle)`. Publish creates an immutable version/history record (`store_policy_versions`) or equivalent append-only snapshot. Customer checkout references published policy version/URL; it never renders draft content.

### 12.2 `privacy_settings` (new tenant table)

```ts
type PrivacySettingsV1 = {
  v: 1;
  cookieBanner: {
    enabled: boolean;
    necessary: true;
    analytics: { available: boolean; defaultEnabled: false };
    marketing: { available: boolean; defaultEnabled: false };
    bannerPolicyVersion: string;
  };
  dataSharingOptOut: { enabled: boolean; pageSlug: string };
  privacyContactEmail?: string;
};
```

The UI must not represent disabled tracking as consent. It records explicit choices, exposes withdrawal, and links to the published privacy policy. Customer export/deletion requests reuse the existing secure export/deletion lifecycle, with status only—not raw archives—in the Settings view.

## 13. Storage and support access

### 13.1 Storage view (no merchant configuration)

```ts
type StorageUsageView = {
  usedBytes: number;
  limitBytes: number | null;
  mediaCount: number;
  providerLabel: "Platform managed storage";
  publicMediaConfigured: boolean;
};
```

No `bucket`, endpoint, access key, secret, retention-configuration or backup controls enter the merchant API. Object keys remain tenant-prefixed. Private return-photo storage stays physically separate from public media.

### 13.2 Support access

The existing consent/session history is migrated toward dedicated, auditable support-access records:

| Field | Type / rule |
|---|---|
| `tenant_id` | tenant scoped |
| `standing_consent` | boolean, owner-only |
| `session_id` | UUID |
| `requested_by`, `approved_by` | actor identities |
| `scope` | initially `read_only` only |
| `consent_type` | `owner_approved \| standing_consent \| emergency` |
| `starts_at`, `expires_at`, `revoked_at` | timestamps; max duration enforced |
| `reason` | required support explanation |

This must never grant `settings.manage`, payment secret access, staff management, exports or refunds to a support session.

## 14. Required contracts and tests

Each settings domain has a narrow `get` and `update` contract; compound actions are separate (`publish`, `activate`, `disconnect`, `requestDomain`, `requestPlanChange`, `transferOwnership`). Do not build one untyped `updateSettings` endpoint.

Minimum test evidence per mutation:

- Zod boundary tests for accepted/rejected shapes and precise limits.
- Domain permission tests for allowed and denied role.
- Real-Postgres isolation test: caller from another tenant cannot read or mutate it.
- Audit test with no secret values in `diff`.
- Behaviour test proving the setting changes the relevant checkout/storefront/job path.
- UI test for loading, error, dirty, saved, unavailable and permission-denied states.

For payments, taxes, shipping, checkout, customer identity and privacy requests, add real-database tests before declaring the feature complete.

## 15. Migration sequence

1. Add readers/parsers and API projections first, preserving existing defaults.
2. Add new tables/columns via append-only migration with RLS/foreign keys; backfill only safe derived values.
3. Ship domain enforcement and tests behind a feature flag where rollout risk exists.
4. Ship the UI only once its action has server behaviour.
5. Redirect legacy routes to the new canonical route; retain old read adapters until data migration/telemetry confirms safety.
6. In a later release, remove deprecated fields/endpoints. Never rename/drop in the same release that stops using them.

## 16. Out of scope for this schema

- Merchant-owned storage credentials or backups.
- Arbitrary custom JavaScript, CSS, HTML, email template code or checkout scripting.
- Razorpay, Stripe, PayPal, Shiprocket, SMS or WhatsApp implementation without explicit owner approval and provider-specific plans.
- International taxes/duties, multi-currency settlement or localisation before the underlying tax/market engine exists.
- Loyalty points and store credit settings; current owner direction excludes them.
