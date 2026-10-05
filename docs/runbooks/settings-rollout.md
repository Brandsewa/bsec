# Store Admin Settings Rebuild — Rollout & Feature Flag Runbook

> **Platform Operations & SRE Standards**  
> System: Brand Sewa E-Commerce Platform (`bsec`)  
> Target Infrastructure: Super Admin Platform API, `feature_flags`, `tenant_feature_overrides` (ADR-011)  
> Scope: Settings Rebuild (Phases 3 through 8)  
> Last Updated: October 2026

---

## 1. Overview & Gating Principles

All settings rebuild features across Phases 3 through 8 are deployed behind database-driven feature flags (`feature_flags` and `tenant_feature_overrides` evaluated via `isFeatureEnabled()`, ADR-011).

- **Default Off**: All new capability flags are seeded with `default_on = false`. Existing production stores remain on their established baseline behavior until intentionally enabled.
- **Fail-Safe Fallbacks**: Each feature has a graceful fallback path ensuring zero customer-facing outage if a flag is off or toggled off mid-operation.
- **Append-Only Data**: Disabling a flag rolls back the user-facing enforcement or UI view, but never drops, truncates, or corrupts data already written to database tables.

---

## 2. Feature Flag Catalog (Phases 3–8)

| Flag Key | Default | What It Gates | Fallback Behavior When Off | Rollback Method | Data NOT Reverted on Rollback |
|---|---|---|---|---|---|
| `settings.gst_v2` | `false` | GST v2 tax rules, state-code resolution, CGST/SGST/IGST breakdown on orders, and B2B invoice generation with GSTIN validation. | Falls back to legacy unified tax calculation (`store_settings.checkout.tax` rate) without line-item breakdowns. | Set override to `false` or toggle kill-switch in Super Admin. | Invoices and order tax line items already generated under GST v2 remain immutable in Postgres. |
| `settings.policies` | `false` | Serving merchant-published policy content on `/policies/[type]` (verified against `apps/web/src/app/policies/[type]/page.tsx`). | Storefront policy pages keep the platform boilerplate. | Set the override to `false` in Super Admin. | Drafts, versions and published rows stay in `store_policies` / `store_policy_versions`. |
| `settings.customer_accounts` | `false` | Enforcement of the sign-in method toggles in `/settings/customer-accounts`: email/password registration and sign-in, and phone OTP (`isSignInMethodBlocked`). | Every sign-in method stays available, exactly as before the toggles existed. Nothing is hidden and no route is disabled. | Set the override to `false` in Super Admin. | Saved toggle values stay in `customer_account_settings`; accounts and sessions are untouched. |
| `settings.notifications` | `false` | Execution-time evaluation in `sendTransactionalEmail`: customer notification preferences and marketing-consent gating. **While on, abandoned-cart recovery emails go only to shoppers with subscribed marketing consent** (owner decision pending, see change record `2026-10-05-claude-settings-phases-3-8-verification.md`). | Every email is sent as before, with no preference or consent evaluation. | Set the override to `false` in Super Admin. | Saved preferences stay in `store_settings.notifications`; `email_log` rows already written (including `skipped` ones) remain. |
| `settings.storage` | `false` | The Storage page and `admin.storageUsage.get`: usage breakdown and quota warnings. | `admin.storageUsage.get` refuses with `FeatureDisabledError` (503); the page shows its error state. | Set the override to `false` in Super Admin. | Files and media rows are untouched. |
| `settings.maintenance` | `false` | Owner scheduling of future maintenance windows (`storefront.scheduleMaintenance`). | Scheduling is refused with `FeatureDisabledError`. Manual maintenance mode, cancelling and ending a window, and the transition log keep working. | Set the override to `false` in Super Admin; an already-scheduled window still runs (cancel it first). | `store_status_transitions` rows and audit entries are append-only and remain. |

---

## 3. Rollout Order & Phases

To ensure zero merchant disruption, rollouts must follow this staged progression:

```
[ Internal Dogfood Store ] 
         │ (24h soak, smoke checks passed)
         ▼
[ Friendly Pilot Merchant ]
         │ (48h soak, zero tickets / errors)
         ▼
[ Cohort 1: Low Volume Stores (10%) ]
         │ (24h telemetry review)
         ▼
[ General Availability (100% via default_on = true) ]
```

### Pre-Enablement Readiness Checks

1. **`settings.gst_v2`**:
   - Store has configured a valid 15-character GSTIN under Settings → Taxes.
   - Merchant's chartered accountant (CA) has verified the tax slab assignments on high-volume catalog categories.
   - Shipping state code mapping is verified against Indian state GST codes (01 to 38).

2. **`settings.policies`**:
   - Store Owner has drafted and formally clicked "Publish" on all 4 core policies (Privacy, Terms, Refund, Shipping) in Settings → Policies.
   - Legal/owner review confirmed policy wording adheres to Indian Consumer Protection (E-Commerce) Rules, 2020.
   - Note: If unpublished policies exist when the flag is enabled, unpublished policy URLs will return 404 (ADR-020).

3. **`settings.notifications`**:
   - Super Admin has verified ZeptoMail/SMTP credentials in `platform_email_settings`.
   - Outbound transactional test email passes successfully from the worker node.
   - Store Owner email address is verified and reachable.

4. **`settings.storage`**:
   - Cloudflare R2 / S3 public asset CDN delivery URL (`R2_PUBLIC_URL`) is configured.
   - Store's plan quota in `QUOTA_DEFAULTS` matches merchant agreement.

5. **`settings.maintenance`**:
   - Worker instance is active and running the 1-minute `maintenance.watchdog_sweep` cron.
   - Store Owner has configured store timezone in general settings.

---

## 4. How to Enable / Disable via Super Admin

### Step-by-Step Operator Procedure

1. Log into Super Admin portal (`https://superadmin.bcom.si` or `http://localhost:5174`).
2. Navigate to **Tenants** → Select the target store (e.g., `store_live_01`).
3. Click on the **Features & Overrides** tab.
4. Locate the desired feature flag key (e.g., `settings.policies`).
5. Select **Enabled (True)** from the override dropdown.
6. Enter an operational change reason: e.g., `Rollout Phase 8 pilot verification - ticket SEC-892`.
7. Click **Save Override**. (This writes to `tenant_feature_overrides` and logs to `platform_audit_logs`).
8. Cache invalidation runs immediately; the store begins honoring the new setting within 60 seconds.

### Emergency Kill-Switch Procedure

If an active feature exhibits unexpected latency, crash loops, or security anomalies:
1. In Super Admin → **Feature Flags** (global catalog).
2. Locate the flag key.
3. Toggle the **Kill Switch** to `ACTIVE`.
4. Click **Apply Global Kill Switch**.
5. All tenant evaluations for this flag will immediately return `false` globally, bypassing all tenant overrides within sub-millisecond execution.

---

## 5. Post-Enablement Smoke Verification Checks

Immediately after enabling a flag for a store, run these verification steps:

### A. Storefront Status & Maintenance (`settings.maintenance`)
- [ ] In Store Admin → Settings → Storefront, verify maintenance schedule form renders.
- [ ] Set a 5-minute test maintenance window; confirm banner shows UTC and store local time preview.
- [ ] Access storefront URL without staff session: verify HTTP 503 with `Retry-After` header and `no-store` cache control.
- [ ] Access storefront with staff session / bypass token: verify storefront renders with preview warning bar.
- [ ] Confirm transition entry appears in Transition History table (`store_status_transitions`).

### B. Policies & Checkout Terms (`settings.policies`)
- [ ] Navigate to `/policies/privacy` and `/policies/terms`: verify published version number and date match merchant editor.
- [ ] Navigate to checkout page: verify terms checkbox appears unticked and requires check to place order.
- [ ] Place test order: verify `terms_policy_version_id` is stamped in the resulting `orders` row.

### C. Taxes & GST Breakdown (`settings.gst_v2`)
- [ ] Add item to cart and proceed to checkout with an intra-state pincode: verify CGST + SGST breakdown.
- [ ] Test inter-state pincode: verify IGST breakdown.
- [ ] Verify generated order invoice PDF renders 15-digit GSTIN and HSN codes.

### D. Storage Meter (`settings.storage`)
- [ ] In Store Admin → Settings → Storage, verify quota bar renders correct percentage.
- [ ] Verify breakdown cards (product images, brand assets, theme assets) sum up to total used bytes.
- [ ] Check that no secret credentials, raw S3 endpoints, or bucket keys appear in the DOM or API response.
- [ ] Verify private return photos are neither counted nor listed.

---

## 6. Rollback & Data Safety Guidelines

- **Zero Data Deletion**: Turning off a flag never deletes merchant records. Drafts, published policy texts, and maintenance logs stay preserved.
- **Read-Back Grace**: In the event of a rollback from GST v2 to legacy tax, existing orders retain their immutable tax breakdown rows; new checkouts simply resume single-rate calculation.
- **Audit Requirement**: Every flag override modification must be accompanied by an audit log entry in `platform_audit_logs`.
