# ADR-015: Quota Resolution Hierarchy & Immutable Checkout Invariant

- **Status:** Accepted
- **Date:** 2026-09-30
- **Plan reference:** PLAN §6.1, §14, §15

## Context
PLAN §6.1 establishes resource quotas per tenant (products, staff seats, media storage, custom domains, API rpm, etc.) to prevent noisy neighbours and maintain platform stability. M7 introduced minimal rate-limit counters and size tiers. M8 formalizes the complete quota lifecycle across XS, S, M, and L presets while reconciling with plan limits.

Critical platform requirements:
1. Effective limits must resolve deterministically across multiple layers (overrides, size tiers, and plans).
2. Existing live tenants (Store #1) must experience zero disruption or unexpected downgrades.
3. Under no circumstances may quota limits block storefront browsing, customer checkout, or payment webhooks.

## Decision
1. **Three-Tier Resolution Hierarchy:**
   The effective numerical limit for any quota key is resolved strictly in order:
   ```
   1. Active Tenant Quota Override (tenant_quota_overrides where expires_at IS NULL or expires_at > NOW())
          ↓ (if none)
   2. Tenant Size Tier Default (tenant_size_tiers mapping -> quota_definitions tier column)
          ↓ (if none)
   3. Plan Limits (plans.limits jsonb for the tenant's active plan)
          ↓ (if none)
   4. Hard Fallback (Default XS tier threshold from quota_definitions)
   ```
2. **Hard vs. Soft Enforcements:**
   - **Hard Enforcements** (`enforcement = 'hard'`): Gated strictly on the admin write paths (e.g. creating a product, inviting staff, adding a custom domain, uploading media). If current count >= effective limit, the admin procedure rejects with `QuotaExceededError` (HTTP 403/429).
   - **Soft Enforcements** (`enforcement = 'soft'`): E.g. orders per month and transactional emails. These emit `quota_events` records (`pct_80`, `pct_100`) and notify the merchant, but **never block execution**.
3. **The Inviolable Checkout Immunity Invariant:**
   - Quotas **never block checkout, storefront reads, or webhooks**.
   - Even if a store exceeds 100% of products, storage, orders, or rate limits, customer storefront queries and order checkout placements must succeed unconditionally.
4. **Existing Tenant Non-Regression:**
   - Migration `0011_m8_saas_platform.sql` explicitly assigns existing tenants size tier `L` so no legacy operations are restricted.

## Consequences
- Guaranteed business continuity for merchants during viral traffic spikes.
- Predictable headroom adjustments for agency clients without forcing plan changes.
