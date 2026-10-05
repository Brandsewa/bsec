# Settings Phase 4 Rebuild: Checkout, Customer Accounts, Order Settings

- **Date:** 2026-10-05
- **Agent:** antigravity
- **Branch:** `feat/settings-rebuild-phase-4` (not merged yet)
- **Area:** db, domain, contracts, admin, web
- **Type:** feature
- **Supersedes:** none

## Summary
Rebuilt Store Settings Phase 4 covering Checkout settings, Customer Account authentication settings, and Order Processing configurations according to `docs/prompts/settings-rebuild-phase-4.md`. Slices 4A through 4F establish first-class persistence via a new tenant table `customer_account_settings` and `order_settings` JSONB column on `store_settings`, wire domain invariants across checkout, customer login/registration, consent recording, and order lifecycle, and implement dedicated responsive Admin UI pages with unsaved guards and pending skeleton compliance.

## What changed
- **Database & Migrations (`packages/db`)**:
  - Migration `packages/db/migrations/0033_settings_phase4.sql` registered in `meta/_journal.json`.
  - Added tenant table `customer_account_settings` with `forceRlsSql`, RLS isolation policy, unique constraint on tenant_id, and check constraint requiring at least one sign-in method (`email_password_enabled OR phone_otp_enabled`).
  - Added `order_settings` JSONB column to `store_settings`.
  - Added `text_version` and `ip_hash` columns to `customer_consent_events`.
- **Contracts (`packages/contracts/src/admin.ts`)**:
  - Added `CheckoutSettings`, `UpdateCheckoutSettingsInput`, `CustomerAccountSettings`, `UpdateCustomerAccountSettingsInput`, `OrderSettings`, and `UpdateOrderSettingsInput`.
  - Registered procedures in `adminContract`: `checkoutSettings.get`, `checkoutSettings.update`, `customerAccountSettings.get`, `customerAccountSettings.update`, `orderSettings.get`, `orderSettings.update`.
- **Domain Services & Invariants (`packages/domain`)**:
  - `packages/domain/src/admin/checkout-config.ts` & `checkout-settings.ts`: Checkout config parser, getter and updater enforcing COD phone requirement and login-method invariants.
  - `packages/domain/src/admin/customer-account-settings.ts`: Customer account settings getter, updater (with `auth.settings.manage` permission and tenant cache invalidation), and internal reader with tenant RLS context.
  - `packages/domain/src/admin/order-settings-config.ts` & `order-settings.ts`: Order processing config parser, getter and updater under `orders.settings.manage`.
  - `packages/domain/src/orders/checkout.ts`: Enforced `guestCheckout`, `phoneRequired`, `minimumOrderPaise`, dynamic `stockHoldMinutes` reservation TTL, and audit consent logging with textVersion & ipHash.
  - `packages/domain/src/customers/auth.ts`: Enforced `emailPasswordEnabled` during login and registration.
  - `packages/domain/src/customers/otp.ts`: Enforced `phoneOtpEnabled` during OTP request.
  - `packages/domain/src/orders/manual-lifecycle.ts`: Enforced `allowSelfServeReturns` on returns portal; implemented `cancelOrderByToken` allowing shoppers to cancel unpaid/COD orders before fulfillment with automatic stock release and payment void.
  - `apps/web/src/app/api/storefront/orders/[token]/cancel/route.ts`: Storefront cancellation API route with rate limiting.
- **Admin UI (`apps/admin`)**:
  - New route `apps/admin/src/routes/_store/settings/checkout.tsx`: Guest checkout, phone requirements, marketing consent toggles, and abandoned cart reminder notices with `pendingComponent` and `useUnsavedGuard`.
  - New route `apps/admin/src/routes/_store/settings/customer-accounts.tsx`: Sign-in methods switches, self-serve returns and cancellation switches, social login roadmap badge, and `pendingComponent`.
  - Updated route `apps/admin/src/routes/_store/settings/orders.tsx`: Added `stockHoldMinutes` and `minimumOrderRupees` fields with input constraints and related settings navigation.
  - Updated `apps/admin/src/components/settings/settings-nav.ts`: Grouped Checkout and Customer Accounts under Selling group.

## Decisions and trade-offs
- Internal settings lookup for public customer auth and checkout uses `readCustomerAccountSettingsInternal` which establishes tenant RLS session config (`app.tenant_id`) ensuring rows are safely retrievable under Postgres RLS without bypassing security.
- Minimum order value in DB and contracts is stored in integer paise (`minimumOrderPaise`) and mapped cleanly to user-facing Rupees (`minimumOrderRupees`) in the Admin UI.
- Cancel order by token (`cancelOrderByToken`) uses actor type `{ type: "anonymous" }` when guest or `{ type: "customer", customerId }` when customer-owned, strictly conforming to `TenantContext` actor invariants.

## Verification
- `pnpm typecheck`: Clean across all 15 workspaces (exit code 0).
- `pnpm lint`: Clean across all 15 workspaces (exit code 0).
- `pnpm build`: Clean across all workspaces including web static prerendering (exit code 0).
- `pnpm docs:check`: `docs:check ok`.
- `pnpm --filter @bs/domain test:fast`: 35 files passed, 281/281 tests passed.
- `pnpm --filter @bs/admin test`: 10 files passed, 66/66 tests passed.
- Integration tests:
  - `packages/domain/test/checkout-settings.int.test.ts`: 8/8 passed against real Postgres.
  - `packages/domain/test/customer-account-settings.int.test.ts`: 9/9 passed against real Postgres.
  - `packages/domain/test/isolation.int.test.ts`: 953/953 passed against real Postgres (all admin procedures isolation-verified).

## Docs updated
- [x] `docs/ARCHITECTURE.md` (Sections 1, 2, 7, 8, 9, 13; bumped Last verified)
- [x] `docs/adr/020-settings-capability-families.md` (updated Phase 4 status and table mapping)
- [x] `progress.md` (updated In flight status)

## Follow-ups and open questions
- Proceeding immediately to Phase 5 (`docs/prompts/settings-rebuild-phase-5.md`): Payments catalogue & COD, plan and billing, plan-change requests.

## Definition of done
- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (real-DB test for anything touching tenancy, money, auth or permissions).
- [x] `docs/ARCHITECTURE.md` updated if you changed structure, routes, tables, jobs, auth, blocks, env vars or gates; "Last verified" commit bumped.
- [x] ADR written or updated if you made or changed an architectural decision.
- [x] `DEPLOYMENT.md` / `infra/coolify/RUNBOOK.md` updated if env vars, services, ports or the deploy pipeline changed.
- [x] A change record in `docs/changes/` (required) and `progress.md` status/known-gaps/in-flight updated if a milestone item changed state.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: what you verified live, what you only read, what you did not do.
