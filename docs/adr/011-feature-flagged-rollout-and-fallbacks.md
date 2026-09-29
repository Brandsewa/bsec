# ADR-011: Feature-flagged rollout and per-tenant dynamic fallbacks

- **Status:** Accepted
- **Date:** 2026-09-29
- **Plan reference:** PLAN §5.1, §13 (M6), §16

## Context
When migrating Store #1 or onboarding early production merchants, changes across critical platform functional areas—specifically catalog, checkout, and fulfillment—pose operational risk. If an issue occurs with payment gateways (e.g. Razorpay outages), shipping carriers (e.g. Shiprocket API degradation), or catalog search, the platform team must be able to fall back or disable an affected area immediately per-tenant without initiating a code deployment or restarting container processes.

## Decision
1. Seed foundational feature flags in the global `feature_flags` table (`catalog`, `checkout`, `fulfillment`) with `default_on = true` via migration `0008_m6_feature_flags.sql`.
2. Evaluate feature enablement at runtime through domain service boundaries using `isFeatureEnabled(db, tenantId, flagKey)`.
3. Support per-tenant dynamic overrides via `tenant_feature_overrides`. Inserting or updating a record `(tenant_id, key, enabled: false)` immediately degrades that area without requiring a deploy:
   - Global kill switch (`feature_flags.kill_switch = true`) overrides all tenant settings and globally disables the feature.
   - Tenant override (`tenant_feature_overrides.enabled = false`) disables the feature specifically for that tenant.
   - Global default (`feature_flags.default_on`) applies when no tenant override exists.

### Gated vs. Non-Gated Boundaries

To maintain platform stability without causing cascading failures or data inconsistencies, feature flags gate specific entry actions while deliberately leaving background processing, inbound webhooks, and read-only administrative operations ungated:

#### 1. Catalog Area (`catalog` flag)
- **Gated:**
  - Storefront product detail (`getStorefrontProduct`): returns `null`.
  - Storefront collections and categories (`getStorefrontCollection`, `getStorefrontCategory`): returns `null` (blocks product listings).
  - Storefront search and suggestions (`searchStorefrontProducts`, `getSearchSuggestions`): returns empty results.
- **Not Gated:**
  - Store settings, brand identity (logo, favicon, fonts, colors), and navigation menus.
  - Informational CMS pages (`getPage`).
  - Admin catalog management (`listProducts`, `createProduct`, `updateVariant`, `adjustInventory`), ensuring merchants and staff can inspect and repair catalog items while storefront listings are paused.

#### 2. Checkout Area (`checkout` flag)
- **Gated:**
  - Order placement (`placeOrder`): throws `FeatureDisabledError` (HTTP 503 Service Unavailable), blocking inventory reservation, sequence allocation, order creation, and payment intent generation.
- **Not Gated:**
  - Shopping cart exploration and management (`getOrCreateCart`, `addToCart`, `updateCartItemQuantity`, `removeCartItem`).
  - Shipping rate estimation (`estimateCartShipping`).
  - Existing order lookup and order status tracking (`/orders/[token]`).

#### 3. Fulfillment Area (`fulfillment` flag)
- **Gated:**
  - Outbound manual or automated fulfillment creation (`createAdminFulfillment`): throws `FeatureDisabledError` (mapped to oRPC HTTP 503 `SERVICE_UNAVAILABLE`), preventing outbound carrier API calls and label creation during carrier outages.
- **Not Gated:**
  - Inbound carrier tracking webhooks (e.g. Shiprocket `shipped`, `delivered`, `rto` webhook events): inbound events are accepted and processed to keep existing orders up to date.
  - Return requests and refund processing (`handleReturnRequestedJob`, `handleRefundProcessedJob`): post-delivery customer workflows remain active.
  - Admin order inspection and invoice generation (`createAdminOrderInvoice`).

4. When an operational incident is resolved, flipping the flag back to `true` (or removing the override) immediately restores normal operation.

## Consequences
- Operational incidents in external integrations (e.g. carrier API outage, payment gateway degradation) can be mitigated within seconds by executing a simple SQL update or platform admin toggle.
- Non-affected tenants remain untouched and running normally.
- Fallback logic is enforced strictly at the domain layer, preventing bypassing by storefront API routes or admin controllers.
- Inbound webhooks continue processing existing shipments, ensuring zero webhook data loss during fulfillment outages.

## Alternatives considered
- **Code deployments / ENV var toggles:** Too slow during incident mitigation; affects all tenants rather than isolating to specific failing stores.
- **Store-wide maintenance mode only:** Too coarse; disabling the entire store when only carrier fulfillment or payment is degraded degrades the merchant experience unnecessarily.
