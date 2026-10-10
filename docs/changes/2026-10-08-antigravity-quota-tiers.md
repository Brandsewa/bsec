# Quota Tiers Normalisation, Pricing Display, and Limits Matrix (Phase 3)

- **Date:** 2026-10-08
- **Agent:** antigravity
- **Branch:** `feat/admin-improvements-phase-3` (not merged yet)
- **Area:** platform, superadmin, db, domain, contracts, ui, docs
- **Type:** feature
- **Supersedes:** none

## Summary
Implements Phase 3 of `docs/ADMIN-IMPROVEMENTS-PLAN.md` (SE-3). Normalises the platform quota tier architecture out of hardcoded columns into dedicated platform-scoped tables `quota_tiers` and `quota_tier_limits` with composite primary key `(tier_code, quota_key)`. Adds catalogue display pricing (`price_monthly_paise`, `price_yearly_paise`) stored strictly as integer paise with no floating-point math, while intentionally decoupling tier prices from billing/invoicing (ADR-025). Retains backwards compatibility by maintaining write-through sync to `quota_definitions.tier_xs/s/m/l` without dropping columns. Implements full Super Admin management UI at `/quotas` featuring two tabs: "Tiers & Pricing" with price editing drawer and deactivation safeguards, and "Limits Matrix" with inline editing, dirty tracking, atomic batch persistence, and an impact confirmation modal ("N stores affected"). Includes the critical ADR-015 non-regression test proving storefront checkout and webhooks remain unblocked even when all hard quotas are set to 0.

Also includes the two assigned Phase 2 follow-ups:
1. Added real-database integration test in `packages/domain/test/admin-orders-phase2.int.test.ts` verifying deletion of an archived cancelled order with both a discount redemption and a payment intent/attempt.
2. Cleaned up unused `"order"` cache tag kind from `packages/domain/src/cache-tags.ts`.

## What changed
- **Database Schema & Migrations (`packages/db`)**:
  - Defined `quotaTiers` and `quotaTierLimits` tables in `packages/db/src/schema/quotas.ts`.
  - Added migration `packages/db/migrations/0051_quota_tiers.sql` with indices, primary keys, and runtime grants (`app_platform` ALL, `app_rw` SELECT). Registered in `_journal.json`.
  - Verified migrations and role grants with `packages/db/test/b2-grants.int.test.ts`.
- **Contracts (`packages/contracts`)**:
  - In `packages/contracts/src/platform.ts`, added views and mutation schemas:
    - `QuotaTierView`, `QuotaDefinitionView`, `QuotaTierLimitView`, `QuotaMatrixView`
    - `platformQuotaContract`:
      - `matrix`: Query returning full matrix of tiers, definitions, and limits with computed `storeCount`.
      - `createTier`: Mutation to add custom size tier with integer paise pricing (`assertRoleAtLeast("platform_admin")`).
      - `updateTier`: Mutation to update tier metadata and pricing (`assertRoleAtLeast("platform_admin")`).
      - `deactivateTier`: Mutation to deactivate a tier, strictly refused if `storeCount > 0`.
      - `updateLimits`: Mutation for atomic batch limit updates with write-through to legacy columns (`assertRoleAtLeast("platform_admin")`).
      - `updateDefinition`: Mutation to update quota definition metadata (`unit`, `description`, `enforcement`) without mutating code-defined keys.
- **Domain Services (`packages/domain`)**:
  - In `packages/domain/src/system/quotas.ts`:
    - Refactored `resolveEffectiveQuota` to query normalized `quota_tier_limits` joining `quota_tiers` and `tenant_size_tiers`.
    - Maintained fallback to tier `XS` for unknown assigned tiers, and un-tiered stores default to `L` for backward compatibility with test stores.
  - In `packages/domain/src/platform/quotas.ts`:
    - Implemented `getPlatformQuotaMatrix`, `createPlatformQuotaTier`, `updatePlatformQuotaTier`, `deactivatePlatformQuotaTier`, `updatePlatformQuotaLimits`, and `updatePlatformQuotaDefinition`.
    - Enforced deactivation refusal when tenant stores are assigned to the target tier.
    - Write-through syncing to `quota_definitions.tier_xs/s/m/l` whenever limits for XS, S, M, or L are updated.
    - Emits structured `platform_audit_logs` for every tier and limit mutation with before/after diffs.
- **Platform API Handlers (`apps/platform`)**:
  - In `apps/platform/src/app.ts`, mounted `quotas` procedures under `platformRouter.quotas`.
  - Added procedures to `audit-coverage.int.test.ts` and `rbac.int.test.ts`.
- **Super Admin UI (`apps/superadmin`)**:
  - Rebuilt `apps/superadmin/src/pages/Quotas.tsx` using tokenized `@bs/ui` components:
    - Tab 1: **Tiers & Pricing**:
      - Full-width table listing tiers with sort, monthly price (₹), yearly price (₹), active store count badge with link to `/tenants`, public/active badges, Edit and Deactivate actions.
      - Slide-over drawer (`Sheet`) for creating and editing tiers, enforcing integer paise conversion.
      - `ConfirmDialog` warning when attempting to deactivate tiers, reflecting server-side refusal error when stores are assigned.
    - Tab 2: **Limits Matrix**:
      - Table listing all quota resources with unit, enforcement badge (`hard`, `soft`, `notify`), and tier columns (XS, S, M, L, custom) showing store counts in header.
      - Inline numeric inputs with visual highlighted border for modified cells.
      - Unsaved changes sticky banner tracking dirty inputs with "Discard" and "Save Changes".
      - "N stores affected" batch confirmation dialog detailing modified limits (`products_max (XS): 50 → 100`) and total affected tenants.
  - **Tenants List & Bulk Assignment (`apps/superadmin/src/pages/TenantsList.tsx`)**:
    - Dynamically generates bulk tier assignment options directly from active tiers queried via `client.quotas.matrix()`.
    - Each option renders tier code, name, INR monthly display price (e.g. `₹4,999/mo`), and key limits (e.g. `10,000 products`).
    - Enforces typed confirmation `TIER <tier> <count>` before enabling the action button.
- **Claude Verification Review Fixes**:
  1. **Dynamic Active Tier Assignment**:
     - `packages/contracts/src/platform.ts`: Replaced hardcoded `z.enum(["XS", "S", "M", "L"])` in `bulkChangeTier` with a validated tier code string schema (`trim().min(1).max(32).regex(...)`).
     - `packages/domain/src/platform-services.ts`: In `bulkChangePlatformTenantTier`, validated inside the write transaction that the target tier exists and is `is_active = true`. Refuses unknown and inactive tiers with descriptive errors.
     - `packages/domain/test/quotas-phase3.int.test.ts`: Rewrote the custom tier assignment test to execute end-to-end through `bulkChangePlatformTenantTier` (instead of raw SQL `UPDATE`). Added explicit refusal tests for unknown tiers and inactive tiers.
  2. **Atomic Deactivation Guard**:
     - `packages/domain/src/platform/quotas.ts`: In `updatePlatformQuotaTier`, moved the `inUseCount` ("stores on this tier") query inside the database transaction (`rt._db.db.transaction`) alongside the update, closing any race condition window between store assignment and tier deactivation.
- **Phase 2 Follow-ups**:
  - Added test case in `packages/domain/test/admin-orders-phase2.int.test.ts` verifying order deletion cleanly cascades past `discount_redemptions`, `payment_intents`, and `payment_attempts`.
  - Removed unused `"order"` entry from `TagKind` in `packages/domain/src/cache-tags.ts`.
- **Documentation**:
  - Authored [ADR-025: Quota Tiers Normalisation and Display Pricing](../../docs/adr/025-quota-tiers-normalisation.md).
  - Updated `docs/ARCHITECTURE.md` sections 1.1, 1.2, 3.1, and ADR index.

## Decisions and trade-offs
- **Decoupled Pricing from Billing**: Quota tier prices (`price_monthly_paise`, `price_yearly_paise`) are strictly display-only / informational for public comparison and catalog display. They are intentionally NOT connected to Razorpay, Stripe, or billing subscriptions (per ADR-025 and prompt rules).
- **Expand-Only Migration**: Migration `0051_quota_tiers.sql` normalises limits into `quota_tier_limits` without dropping legacy columns on `quota_definitions`. All updates write through to legacy columns to ensure zero downtime.
- **Storefront Non-Regression (ADR-015 Invariant)**: Set all hard resource limits to 0 in test suite and verified that storefront checkout, customer browsing, and webhook ingestion proceed unblocked without throwing 429 / 403 quota errors.

## Acceptance Criteria Checklist (Plan §5.3)
- [x] Size tiers normalised into `quota_tiers` + `quota_tier_limits` (expand only; `quota_definitions.tier_xs/s/m/l` kept populated by write-through, not dropped).
- [x] Backfill from existing columns so every store's effective quota is identical before and after (snapshot test passes).
- [x] Quota keys stay code-defined (UI edits limits and metadata only).
- [x] ADR-015 invariant (quotas never block checkout / storefront / webhooks) gets a real-DB test with every hard quota at 0.
- [x] Deactivating or deleting a tier that tenants use is refused by the domain service.
- [x] All mutations use `assertRoleAtLeast("platform_admin")`, write `platform_audit_logs` with before/after diffs, and are added to `apps/platform` audit-coverage and RBAC suites.
- [x] Super Admin `/quotas` gets two tabs (Tiers with price editing in a drawer; Limits matrix with inline edit, dirty tracking, atomic batch save, and an "N stores affected" confirmation) using shared kit only.
- [x] Tier price stored as integer paise, formatted as INR, no float math. Tier price NOT wired into billing or invoices (strictly display-only).
- [x] ADR-025 written.
- [x] Real-DB tests passing for snapshot equality, refusal when tier in use, write-through sync, unknown/inactive tier refusal, and zero-quota storefront safety.
- [x] Browser walkthrough performed on desktop (1280x800) and mobile (375x812) with zero defects.

## Verification
- **Test Gate**:
  - `pnpm docs:check`: Passed (`docs:check ok`).
  - `pnpm typecheck`: Passed (15/15 packages clean).
  - `pnpm lint`: Passed (15/15 packages clean).
  - `pnpm build`: Passed (Clean builds across monorepo packages, Next.js standalone, Vite apps).
  - `pnpm --filter @bs/db test:fast`: Passed (3/3 files, 27/27 tests).
  - `pnpm --filter @bs/platform test`: Passed (7/7 files, 93/93 tests).
  - `pnpm --filter @bs/domain test:fast`: Passed (45/45 files, 374/374 tests).
  - `pnpm --filter @bs/domain test:heavy` (serial via `pnpm test:heavy:local`): Passed (90/90 files, 1,930/1,930 tests).
- **New Real-DB Test Suite (`quotas-phase3.int.test.ts`)**:
  - 10/10 tests passed verifying:
    1. Schema backfill snapshot equality before and after normalisation.
    2. Editing a limit updates `resolveEffectiveQuota` immediately.
    3. Write-through invariant: updating XS/S/M/L limits keeps legacy `quota_definitions` columns populated.
    4. Adding tier XL with pricing and assigning a tenant end-to-end via real `bulkChangePlatformTenantTier`.
    5. `bulkChangePlatformTenantTier` refuses unknown and inactive tiers.
    6. Refuses to deactivate a tier that tenants are currently assigned to.
    7. Unknown tier code falls back safely to XS tier threshold.
    8. Prices stored as integer paise, formatted as INR with round-trip precision.
    9. ADR-015 invariant: quotas never block checkout or storefront even with hard quotas at 0.
    10. Updates quota definition metadata without altering code-defined keys.
- **Browser Walkthrough Part 1: Quota Tiers & Limits Matrix (`e2e/walkthrough-quotas.mjs`)**:
  - Executed via Playwright on Chromium against live `apps/superadmin` (Vite preview on port 5174) and `apps/platform`.
  - Desktop (1280x800):
    - Verified page title, header description, and Tenants link.
    - Verified initial 4 tiers (XS, S, M, L) with INR pricing and active store counts.
    - Verified deactivation refusal on Tier S (5 stores assigned) with warning dialog and 400 Bad Request error toast.
    - Verified adding Tier XL with monthly ₹4,999 (499,900 paise) and yearly ₹49,990 (4,999,000 paise).
    - Verified editing Tier M pricing to ₹3,499 / ₹34,990.
    - Verified switching to Limits Matrix tab, inline editing `products_max` on XS to 100.
    - Verified dirty tracking warning banner and "1 modified" tab badge.
    - Verified "N stores affected" confirmation modal showing "2 stores affected" and diff `products_max (XS): 50 → 100`.
    - Verified batch save application and UI sync.
  - Mobile (375x812):
    - Verified responsive stacked layout for Tiers view.
    - Verified Add Tier Sheet drawer layout on 375 px.
    - Verified horizontal scrolling on wide Limits Matrix table.
  - Screenshots recorded to `apps/superadmin/walkthrough-artifacts/`:
    - `01_desktop_tiers_table.png`
    - `02_desktop_deactivate_refusal_modal.png`
    - `03_desktop_add_tier_drawer.png`
    - `04_desktop_limits_matrix.png`
    - `05_desktop_dirty_changes_banner.png`
    - `06_desktop_save_confirmation_modal.png`
    - `07_mobile_tiers_view.png`
    - `08_mobile_add_tier_sheet.png`
    - `09_mobile_matrix_view.png`
- **Browser Walkthrough Part 2: Dynamic Custom Tier Assignment (`e2e/walkthrough-assign-tier.mjs`)**:
  - Executed via Playwright on Chromium against live `apps/superadmin` (port 5174).
  - Desktop (1280x800):
    - Navigated to `/tenants`.
    - Selected store "Sikkim Supreme" (currently on tier XS).
    - Verified bulk action bar appears with "1 store(s) selected".
    - Clicked "Change Tier"; opened Bulk Change Resource Tier modal.
    - Inspected select options populated dynamically from `quotas.matrix`: verified "XL — Extra Large (₹4,999/mo, 10,000 products)" is available and selectable.
    - Selected tier XL; verified typed confirmation requirement dynamically updated to `TIER XL 1`.
    - Typed confirmation `TIER XL 1` into input and clicked "Apply Tier".
    - Verified RPC call intercepted with payload `{"tenantIds":["t-store-1"],"tier":"XL","confirmation":"TIER XL 1"}`.
    - Verified success toast: "Updated 1 store(s) to tier XL".
  - Mobile (375x812):
    - Navigated to `/tenants` at 375 px viewport.
    - Selected store "Ricwell Organic" (currently on tier S).
    - Opened Change Tier modal, selected XL, typed `TIER XL 1`, and clicked "Apply Tier".
    - Verified RPC call intercepted and success toast appeared.
  - Screenshots recorded to `apps/superadmin/walkthrough-artifacts/`:
    - `10_desktop_tenants_list.png`
    - `11_desktop_store_selected_bulk_bar.png`
    - `12_desktop_bulk_tier_dialog_filled.png`
    - `13_desktop_store_assigned_xl_success.png`
    - `14_mobile_tenants_view.png`
    - `15_mobile_store_selected_bulk_bar.png`
    - `16_mobile_bulk_tier_dialog_filled.png`
    - `17_mobile_store_assigned_xl_success.png`

## Definition of Done
- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (real-DB test for anything touching tenancy, money, auth or permissions).
- [x] `docs/ARCHITECTURE.md` updated if you changed structure, routes, tables, jobs, auth, blocks, env vars or gates; "Last verified" commit bumped.
- [x] ADR written or updated if you made or changed an architectural decision (ADR-025).
- [x] `DEPLOYMENT.md` / `infra/coolify/RUNBOOK.md` updated if env vars, services, ports or deploy pipeline changed (N/A: no infrastructure changes).
- [x] A change record in `docs/changes/` (required) and `progress.md` status/known-gaps/in-flight updated.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: what you verified live, what you only read, what you did not do.

