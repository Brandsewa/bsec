# ADR-025: Quota Tiers Normalisation, Display Pricing, and Safe Resolution

- **Status:** Accepted
- **Date:** 2026-10-08
- **Plan reference:** `docs/ADMIN-IMPROVEMENTS-PLAN.md` §5 (SE-3), ADR-013, ADR-015

## Context

Prior to this change, platform quota definitions were stored with four hardcoded tier columns in `quota_definitions`: `tier_xs`, `tier_s`, `tier_m`, and `tier_l`. This schema had several limitations:
1. Adding a new size tier (e.g., `XL`, `ENTERPRISE`, or custom agency tiers) required schema alterations and code modifications across domain services and contracts.
2. Tier display pricing was not tracked in the database, preventing transparent catalogue comparison and resource tier presentation.
3. Super Admin staff could only view limits in a static table; inline adjustments and tier management were unavailable.
4. Schema evolution had to strictly observe the expand-migrate-contract rule (Rule 10 in `AGENTS.md`) and uphold the immutable checkout invariant established in ADR-015 (quotas never block storefront, customer checkout, or payment webhooks).

## Decisions

We normalise quota tiers into relational platform tables, introduce integer paise display pricing, maintain backward-compatible write-through synchronization, and provide a dedicated Super Admin management interface:

1. **Relational Table Normalisation (Expand Phase):**
   - **`quota_tiers`**: Platform-scoped table (no RLS) storing tier code (`code` PK), name, description, sort order, display prices (`price_monthly_paise`, `price_yearly_paise`, non-negative integer paise), currency (`INR`), `is_public`, and `is_active`.
   - **`quota_tier_limits`**: Relational limit table with composite primary key `(tier_code, quota_key)`, referencing `quota_tiers(code)` on delete cascade and `quota_definitions(key)` on delete cascade.
   - **Append-Only Migration `0051_quota_tiers.sql`**:
     - Populates initial tiers (`XS`, `S`, `M`, `L`).
     - Backfills existing `tier_xs`, `tier_s`, `tier_m`, and `tier_l` column values from `quota_definitions` into `quota_tier_limits`.
     - In accordance with expand-migrate-contract, the legacy columns `quota_definitions.tier_xs/s/m/l` are **retained**; mutations in `updateLimits` perform write-through synchronization to these legacy columns to maintain zero downtime for any services referencing the older columns.

2. **Deterministic Resolution with Safe Fallback to XS:**
   - The domain service `resolveEffectiveQuota` in `packages/domain/src/system/quotas.ts` queries `quota_tier_limits` first.
   - If a store is assigned an unrecognised, deleted, or unconfigured tier code, the resolver safely falls back to tier `XS` rather than throwing an exception or granting unlimited resources.

3. **Strict Integer Pricing with No Float Arithmetic:**
   - Tier display prices are represented exclusively in integer paise (`price_monthly_paise`, `price_yearly_paise`), formatted in user interfaces via `Intl.NumberFormat("en-IN")`.
   - **Billing Isolation Invariant:** Tier pricing is strictly catalog/display only. It is **NOT** wired to live customer billing, payment gateway recurring subscriptions, or automated invoices.

4. **Immutable Checkout Invariant Preserved (ADR-015):**
   - Quotas govern administrative and operational ceilings (products, staff seats, media uploads, custom domains, API rpm).
   - Even if all hard quotas are set to 0, storefront catalog browsing, cart operations, checkout order placement, and payment webhook ingest run unconditionally with full immunity.

5. **Guardrails Against Orphaned Tenants:**
   - Tiers cannot be deactivated or deleted if active tenants are currently assigned (`tenant_size_tiers.tier = tier_code`). Attempts to deactivate return a descriptive refusal error with the count of affected stores.
   - Quota definition keys remain code-defined to ensure domain services always have corresponding enforcement logic.

6. **Super Admin Management Interface:**
   - Route `/quotas` in `apps/superadmin` provides two tabs:
     - **Tiers & Pricing**: List of tiers with display pricing, store usage counts, drawer for editing/adding tiers, and refusal-guarded deactivation.
     - **Limits Matrix**: Grid displaying all quota definitions across all active tiers with inline numeric inputs, client-side dirty tracking, discard functionality, and an **"N stores affected"** impact confirmation modal before atomic batch commits.
   - All mutations enforce `assertRoleAtLeast("platform_admin")` and record `platform_audit_logs` entries with before/after diffs.

## Consequences

- **Extensibility**: Platform operators can configure new tiers (e.g. `XL`, `ENTERPRISE`) without running database migrations.
- **Safety**: Tenant operations remain continuous and non-regressive during tier modifications, with guaranteed fallback to `XS`.
- **Zero Disruption**: Storefront checkouts remain completely decoupled and immune to quota limit settings.
- **Auditability**: Every limit change is logged with actor metadata, tenant impact metrics, and explicit before/after diffs.
