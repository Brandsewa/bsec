# Settings Phase 5 Rebuild: Payments Catalogue & COD, Plan & Billing, Plan-Change Requests

- **Date:** 2026-10-05
- **Agent:** antigravity
- **Branch:** `feat/settings-rebuild-phase-5` (not merged yet)
- **Area:** db, domain, contracts, admin, web, platform
- **Type:** feature
- **Supersedes:** none

## Summary
Rebuilt Store Settings Phase 5 covering the Payments Catalogue & COD configuration, Plan & Billing inspection, and Platform Plan-Change Requests flow according to `docs/prompts/settings-rebuild-phase-5.md`. Slices 5A, 5C, and 5D establish first-class persistence via new tenant tables `payment_methods` and `plan_change_requests` with dual-read/write migration bridges, enforce server-side bounds and permissions (`payments.manage`, owner-only plan changes), integrate platform-side staff review and audit logging, and provide responsive Admin UI pages with unsaved guards and pending skeleton compliance. Slice 5B (live Razorpay adapter) remains gated and deferred per requirements.

## What changed
- **Database & Migrations (`packages/db`)**:
  - Migration `packages/db/migrations/0034_settings_phase5.sql` with journal index 34 created and applied.
  - Added tenant table `payment_methods` with `forceRlsSql`, unique constraint on `(tenant_id, provider)`, and check constraints for provider and status.
  - Added tenant table `plan_change_requests` with `forceRlsSql`, foreign keys to users, status check constraints, and unique constraint on `(tenant_id, id)`.
  - Added `plan.change_requested` to `packages/db/src/queues.ts`.
- **Contracts (`packages/contracts`)**:
  - `packages/contracts/src/admin.ts`: Added `PaymentMethodItem`, `UpdateCodInput`, `PlanAndBillingView`, `AvailablePlanSummary`, and `RequestPlanChangeInput`. Registered `adminContract.paymentMethods.{list,updateCod}` and `adminContract.planAndBilling.{get,availablePlans,requestChange,cancelRequest}`. Redacted `adminContract.billing.getSubscription` and removed self-service `changePlan`.
  - `packages/contracts/src/platform.ts`: Added `platformPlansContract.listRequests` and `decideRequest`.
- **Domain Services & Invariants (`packages/domain`)**:
  - `packages/domain/src/admin/payment-methods.ts`: Dual-read reader `getTenantPaymentMethods` (reading `payment_methods` or synthesising from `store_settings.checkout.cod`), `listPaymentMethods` (`settings.read`), and `updateCodMethod` (enforcing `payments.manage`, ₹0–₹500 fee range, min/max bounds, audit logging, and dual-writing to `store_settings.checkout.cod`).
  - `packages/domain/src/orders/checkout.ts`: Enforced active payment method status, adapter presence, and min/max order value bounds at `placeOrder`.
  - `packages/domain/src/admin/store-config.ts`: Explicitly rejects updating COD through generic `updateStoreSettings` with clear direction to `admin.paymentMethods.updateCod`.
  - `packages/domain/src/admin/plan-and-billing.ts`: `getPlanAndBilling` (aggregating plan details, usage counters, and invoices), `listAvailablePlans`, `requestPlanChange` (strictly owner-only, max 3/day rate limit, single open request invariant, enqueues `plan.change_requested`), and `cancelPlanChangeRequest` (owner-only).
  - `packages/domain/src/platform/plan-change-requests.ts`: `listPlatformPlanChangeRequests` and `decidePlatformPlanChangeRequest` (requires `platform_admin`, updates subscription on approval, and writes `platform_audit_logs`).
- **Admin UI (`apps/admin`)**:
  - `apps/admin/src/routes/_store/settings/payments.tsx`: Rebuilt with catalogue cards (COD active, Razorpay unavailable/deferred, coming soon cards), COD configuration form (enabled, rupees conversion, bounds, unsaved guard, `pendingComponent`).
  - `apps/admin/src/routes/_store/settings/plan-and-billing.tsx`: Plan & usage tab with progress meters, invoices tab with download affordance, pending request banner with cancel button, request plan change modal dialog, `pendingComponent`.
  - `apps/admin/src/components/settings/settings-nav.ts`: Updated `Payments` to require `payments.manage`, added `Plan & billing` (`settings.read`) under People & account.
- **API Mounts (`apps/web` & `apps/platform`)**:
  - `apps/web/src/server/api.ts`: Mounted `paymentMethods` and `planAndBilling` procedures with permissions; redacted `admin.billing.getSubscription`.
  - `apps/platform/src/app.ts`: Mounted `platformPlansContract.listRequests` and `decideRequest`.

## Decisions and trade-offs
- **Slice 5B Gating**: Razorpay live adapter remains unconfigured and deferred per project instructions. Domain checkout logic explicitly validates payment adapter registry and returns a shopper-friendly error advising COD if an unconfigured online payment method is attempted.
- **Dual-Read / Dual-Write**: To support rolling zero-downtime deploys without a flag-day migration, COD updates dual-write to both `payment_methods` and `store_settings.checkout.cod`.
- **Request-Only Plan Changes**: Merchants cannot self-service modify subscription tiers. Store owners submit change requests via `plan_change_requests` that platform staff review and approve/decline.

## Verification
- `pnpm typecheck`: Clean across all 15 workspaces (exit code 0).
- `pnpm lint`: Clean across all 15 workspaces (exit code 0).
- `pnpm build`: Clean across all workspaces including Next.js web production build (exit code 0).
- `pnpm docs:check`: `docs:check ok`.
- `pnpm --filter @bs/domain test:fast`: 35 files passed, 281/281 tests passed.
- Integration tests:
  - `packages/domain/test/settings-phase-5.int.test.ts`: 7/7 passed against real Postgres.
  - `packages/domain/test/isolation.int.test.ts`: 962/962 passed against real Postgres.
  - `packages/domain/test/store-settings.int.test.ts`: 18/18 passed against real Postgres.
  - `packages/domain/test/checkout-place-order.int.test.ts`: 3/3 passed against real Postgres.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (Sections 7, 11; bumped migration 0034 and queue `plan.change_requested`)
- [x] `progress.md` (updated In flight status)

## Follow-ups and open questions
- Proceeding immediately to Phase 6 (`docs/prompts/settings-rebuild-phase-6.md`): Shipping & delivery settings.
