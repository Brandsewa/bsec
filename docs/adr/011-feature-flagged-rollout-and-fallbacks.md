# ADR-011: Feature-flagged rollout and per-tenant dynamic fallbacks

- **Status:** Accepted
- **Date:** 2026-09-29
- **Plan reference:** PLAN §5.1, §13 (M6), §16

## Context
When migrating Store #1 or onboarding early production merchants, changes across critical platform functional areas—specifically catalog, checkout, and fulfillment—pose operational risk. If an issue occurs with payment gateways (e.g. Razorpay outages), shipping carriers (e.g. Shiprocket API degradation), or catalog search, the platform team must be able to fall back or disable an affected area immediately per-tenant without initiating a code deployment or restarting container processes.

## Decision
1. Seed foundational feature flags in the global `feature_flags` table (`catalog`, `checkout`, `fulfillment`) with `default_on = true`.
2. Evaluate feature enablement at runtime through domain service boundaries (`getStorefrontProduct`, `placeOrder`, `createAdminFulfillment`) using `isFeatureEnabled(db, tenantId, flagKey)`.
3. Support per-tenant dynamic overrides via `tenant_feature_overrides`. Inserting or updating a record `(tenant_id, key, enabled: false)` immediately degrades that area without requiring a deploy:
   - `catalog`: returns `null` on storefront product / collection / category / search requests, falling back to clean not-found or storefront maintenance states.
   - `checkout`: rejects `placeOrder` with an informative error ("Checkout is currently disabled for this store"), stopping cart clearance and stock reservations.
   - `fulfillment`: rejects `createAdminFulfillment` with an informative error ("Fulfillment is currently disabled for this store"), preventing broken outbound carrier sync.
4. When the issue is resolved, flipping the flag back to `true` (or removing the override) immediately restores normal operation.

## Consequences
- Operational incidents in external integrations can be mitigated within seconds by executing a simple SQL update or platform admin toggle.
- Non-affected tenants remain untouched and running normally.
- Fallback logic is enforced at the domain layer, preventing bypassing by storefront API routes or admin controllers.

## Alternatives considered
- **Code deployments / ENV var toggles:** Too slow during incident mitigation; affects all tenants rather than isolating to specific failing stores.
- **Store-wide maintenance mode only:** Too coarse; disabling the entire store when only carrier fulfillment or payment is degraded degrades the merchant experience unnecessarily.
