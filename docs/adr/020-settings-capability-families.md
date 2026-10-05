# ADR-020: Settings Capability Families and Granular Authorization

- **Status:** Accepted
- **Date:** 2026-10-04
- **Deciders:** Owner (decision on record 2026-10-04), Antigravity (builder)
- **Plan reference:** `docs/SETTINGS-SCHEMA.md` §3, `docs/SETTINGS-REBUILD-PLAN.md` §2 & §3.3, `docs/SETTINGS-REBUILD-REMAINING-PHASES.md` §3, ADR-014

## Context

Until Phase 2, store settings mutations and visibility relied almost exclusively on a coarse, monolithic permission string: `settings.write` (along with `staff.manage` for team administration). Any role holding `settings.write` effectively gained authority over every store configuration area, including storefront visibility, order number sequences, return policies, taxes, brand assets, and potentially payment credentials.

Furthermore, platform support sessions (`SUPPORT_WRITE_PERMISSIONS` and `SUPPORT_READ_PERMISSIONS`) derive their permissions from `STORE_PERMISSIONS`. Support sessions are explicitly forbidden from acquiring settings, users, payment, export, refund, or sensitive configuration authority (`AGENTS.md` rule 9, `context.ts`).

As part of the Settings rebuild, `docs/SETTINGS-SCHEMA.md` §3 defines granular capability families to isolate concerns (e.g. `payments.manage`, `staff.manage`, `audit.read`, `taxes.manage`, `shipping.manage`, etc.) without disrupting running stores or requiring destructive role database migrations.

## Decisions

### 1. Granular Capability Families
We introduce the following new store permissions into `STORE_PERMISSIONS` alongside the legacy `settings.write` and `staff.manage`:
- `settings.read`: View non-sensitive setting status.
- `settings.manage`: Store details, locale, and units.
- `branding.manage`: Brand assets, theme styles, and design tokens.
- `storefront.manage`: Visibility, password protection, and maintenance state.
- `checkout.manage`: Checkout rules and customer account behavior.
- `payments.manage`: Payment method configuration, gateways, and credentials.
- `shipping.manage`: Delivery profiles, zones, rates, and packages.
- `taxes.manage`: GST/tax configuration and seller tax identity.
- `orders.settings.manage`: Numbering sequences, fulfillment defaults, and staff alerts.
- `returns.manage`: Return policies, rules, and reasons.
- `notifications.manage`: Event preferences and customer notification templates.
- `domains.manage`: Custom domains and primary domain configuration.
- `policies.manage`: Published store policies (refund, terms, privacy).
- `privacy.manage`: Consent controls, tracking categories, and customer privacy requests.
- `audit.read`: Tenant-scoped settings activity and mutation history.

### 2. Owner-Approved Delegation Matrix (`SYSTEM_STORE_ROLES`)
Per owner decision on record (2026-10-04):
- `payments.manage` is **owner-only**. `store_admin` (Manager) must NOT hold `payments.manage`.
- `staff.manage`, `audit.read`, `domains.manage`, and all other capability families are held by both `store_owner` and `store_admin`.
- Concretely, in `packages/auth/src/index.ts`:
  - `store_owner` holds all `STORE_PERMISSIONS`.
  - `store_admin` holds all `STORE_PERMISSIONS` except `payments.manage`.

### 3. Check-Time Aggregate Mapping for Legacy Roles (Expand / Migrate / Contract)
To avoid rewriting stored role rows in Postgres (and breaking custom roles or active memberships), a check-time aggregate mapping is implemented in `@bs/auth`:
- When evaluating `hasPermission(granted, needed)`:
  - If `granted` contains the legacy `settings.write`, it satisfies every migrated capability family **except** `payments.manage` (which is strictly owner-only) and `staff.manage` (which was always a separate permission).
  - Explicitly, the legacy `settings.write` satisfies:
    `settings.read`, `settings.manage`, `branding.manage`, `storefront.manage`, `checkout.manage`, `shipping.manage`, `taxes.manage`, `orders.settings.manage`, `returns.manage`, `notifications.manage`, `domains.manage`, `policies.manage`, `privacy.manage`, and `audit.read`.
  - A role granted a specific capability directly (e.g. `audit.read`) satisfies only that capability.
- In a later contract phase (after all services and interfaces have migrated to specific permissions), stored custom roles will be migrated to granular arrays and the aggregate fallback will be removed.

### 4. Support Session Invariant
Per `AGENTS.md` and `packages/domain/src/context.ts`, platform support sessions never acquire users, payment, export, refund, or settings capability:
- In `packages/domain/src/context.ts`, neither `SUPPORT_READ_PERMISSIONS` nor `SUPPORT_WRITE_PERMISSIONS` includes any of the new settings capability families (nor `settings.write`, `staff.manage`, `exports.run`, `orders.refund`).
- Specifically:
  - `settings.read` and `audit.read` are explicitly excluded from `SUPPORT_READ_PERMISSIONS` (even though they end in `.read`).
  - All `*.manage`, `audit.read`, and `settings.read` are excluded from `SUPPORT_WRITE_PERMISSIONS`.
- Support sessions retain access only to catalog, orders (read/standard write), discounts, and storefront content.

### 5. API and Direct Route Denial Behavior
- Every newly restricted domain service verifies authorization via `assertPermission(ctx, permission)`.
- If permission is missing, the service immediately throws standard domain error:
  `Forbidden: missing required permission '<permission>'`.
- In the API layer (`apps/web/src/server/api.ts`), missing permissions map to HTTP 403 `FORBIDDEN` via `ORPCError`.
- Direct URL access to a forbidden route in the Store Admin SPA renders an explicit permission-denied / error state; it never silently redirects to a placeholder or masks the error.

### 6. Out of Scope Operations
- **Store Ownership Transfer:** Transferring ownership of a store requires a separate, re-authenticated flow that changes membership records, verifies credentials, logs security audits, and invalidates sessions. It is not managed via simple role update or `staff.manage`.
- **Platform SaaS Plan Changes & Subscriptions:** Managed at the platform layer via `apps/platform` and Superadmin; not delegated to store settings roles.

## Consequences

- Backward compatibility is preserved for existing stores and roles holding `settings.write` without requiring database migration scripts.
- `store_admin` can safely manage users and view settings activity, but cannot configure or view payment gateway secrets (`payments.manage`).
- New procedures (like `settingsActivity.list`) enforce least-privilege using `audit.read`.

## Enforcement status (updated at Phase 8, 2026-10-05)

The capability families are *defined* for every area, and enforced across all settings domain services and API routes:
- `settings.read`: non-sensitive getters across all settings domains (`branding.get`, `storefront.getStatus`, `domains.list`, `checkoutSettings.get`, `customerAccountSettings.get`, `orderSettings.get`, `shippingSettings.get`, `taxSettings.get`, `returns.getSettings`, `notificationSettings.get`, `policySettings.list`, `privacySettings.get`, `storageUsage.get`, `storefront.listTransitions`).
- `audit.read`: `settingsActivity.list` (tenant-scoped audit trail, route and domain service).
- `payments.manage` (**Store Owner only**): `payments.saveRazorpay`, `payments.clearRazorpay`, and payment credential mutations.
- `storefront.manage`: `storefront.updateStatus` (live/password/coming_soon modes).
- `storefront.manage` + **Store Owner only** (Decision 10): `storefront.scheduleMaintenance`, `storefront.cancelScheduledMaintenance`, `storefront.endMaintenance` (route and domain service enforce `ctx.roles.includes("store_owner")`; Manager `store_admin` denied).
- `branding.manage`: `branding.update` and `branding.publish`.
- `domains.manage`: `domains.add`, `domains.verify`, `domains.setPrimary`, and `domains.remove`.
- `checkout.manage`: `checkoutSettings.update` and `customerAccountSettings.update`.
- `shipping.manage`: `shippingSettings.updateRates`, `shippingSettings.updateZones`.
- `taxes.manage`: `taxSettings.update`.
- `orders.settings.manage`: `orderSettings.update` (stock hold duration, minimum order value).
- `returns.manage`: `returns.updateSettings`.
- `notifications.manage`: `notificationSettings.update` (granular store and customer alert preferences).
- `policies.manage`: `policySettings.createDraft`, `policySettings.publish`, `policySettings.archive`.
- `privacy.manage`: `privacySettings.updateControls`, `privacyRequests.process`.
- `storageUsage.get`: read-only, enforces `settings.read`. Has no mutation procedure.
- `staff.manage`: team membership and roles.
- Support session invariant holds: support read/write sessions are forbidden from all settings capabilities.
- All settings procedures are locked and verified by the declarative authorization matrix suite (`packages/domain/test/settings-authorization.int.test.ts`).
