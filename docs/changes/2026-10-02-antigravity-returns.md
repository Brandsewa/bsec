# Returns & Exchanges Lifecycle & Workbench Rebuild

- **Date:** 2026-10-02
- **Agent:** antigravity
- **Branch:** `feat/orders-returns`
- **Area:** db, domain, contracts, web, admin
- **Type:** feature
- **Supersedes:** none

## Summary
Implements the end-to-end Returns & Exchanges feature per `docs/ORDERS-RETURNS-PLAN.md` (Hierarchy Item 4: Steps 1-3). Provides full store-configurable return settings (return window, exchange toggle, customizable reasons with photo requirements, customer policy & instructions), storefront guest portal return/exchange requests with presigned photo uploads and cancellation, and a comprehensive Store Admin Returns Workbench with KPI metrics, status tabs, search & filtering, CSV exports, slide-out detail sheet, and complete action dialogs (approve, reject, mark picked up, receive with restock, record refund, record exchange, and close case).

## What changed
- **Database & Migration (`packages/db`)**:
  - `packages/db/migrations/0023_returns.sql`: Expand migration adding `requestedResolution`, `customerComment`, `exchangeRequest`, `decisionMessage`, `instructionsSentAt`, `refundMethod`, `refundReference`, `refundAmount`, `refundedAt`, `exchangeNote`, `exchangeOrderId` to `returns`, `returnable` boolean to `products`, nullable `intentId` + `method` + `reference` to `refunds`, and `returnSettings` JSONB to `storeSettings`.
  - `packages/db/src/schema/shipping.ts`: Updated Drizzle schema for `returns` & `return_items`.
  - `packages/db/src/schema/catalog.ts`: Added `returnable: boolean` to `products`.
  - `packages/db/src/schema/payments.ts`: Made `refunds.intentId` nullable and added manual payment method & reference.
  - `packages/db/src/schema/settings.ts`: Added `returnSettings` JSONB column with typing.
- **Domain Services (`packages/domain`)**:
  - `packages/domain/src/orders/return-state-machine.ts`: Updated state machine with `cancelled` terminal state, new transitions (`cancel`, `pick_up`, `replace`), and action handlers.
  - `packages/domain/src/orders/manual-lifecycle.ts`: Enhanced `requestReturn`, `cancelReturn`, `actOnReturn`, `getOrderReturnsByToken`, `requestReturnByToken` with return window validation, non-returnable product checks, photo proof validation, restock inventory updates, manual refund recording (for COD/offline payments), and audit logging.
  - `packages/domain/src/orders/return-photos.ts` (new): S3 presigned upload generator and photo validation service for return requests.
  - `packages/domain/src/admin/return-settings.ts` (new): Return settings getter and updater with validation and audit logging.
  - `packages/domain/src/admin/returns.ts` (new): Returns workbench KPI metrics (`getAdminReturnStats`), paginated table queries with filtering & search (`listAdminReturns`), and detail query with photo download URLs (`getAdminReturnDetail`).
  - `packages/domain/src/media/storage.ts`: Added `buildPresignedDownloadUrl` helper using AWS S3 `GetObjectCommand`.
  - `packages/domain/src/index.ts`: Barrel exports updated.
- **Contracts & API Endpoints (`packages/contracts` & `apps/web`)**:
  - `packages/contracts/src/admin.ts`: Added return schemas & routes (`returns.stats`, `returns.list`, `returns.get`, `returns.act`, `returnSettings.get`, `returnSettings.update`).
  - `apps/web/src/server/api.ts`: Mounted oRPC handlers for admin returns and return settings.
  - `apps/web/src/app/api/storefront/orders/[token]/return/`: Updated `route.ts`, added `photo/route.ts`, `photo/finalize/route.ts`, and `cancel/route.ts`.
- **Admin UI (`apps/admin`)**:
  - `apps/admin/src/components/settings/settings-nav.ts`: Added Returns navigation item (`RotateCcw`, `/settings/returns`).
  - `apps/admin/src/routes/_store/settings/returns.tsx` (new): Full settings page with unsaved changes guard, policy toggles, reason list editor with photo requirement selectors, and copy editors.
  - `apps/admin/src/routes/_store/returns.tsx`: Rebuilt full workbench with KPI cards, tabs, search, DataTable, review Sheet, and action dialogs.
- **Storefront UI (`apps/web`)**:
  - `apps/web/src/components/orders/ReturnRequestForm.tsx`: Rebuilt return form supporting reason selection, exchange preferences, customer comments, photo uploads, and self-service cancellation.
  - `apps/web/src/app/o/[token]/page.tsx`: Updated to fetch and pass enriched return settings, existing returns, and returnable items.

## Verification
- **Ran:** `pnpm typecheck` — 15/15 workspaces pass with 0 errors.
- **Ran:** `pnpm lint` — 15/15 workspaces pass with 0 errors.
- **Ran:** `pnpm --filter @bs/domain test:fast` — 26 test files (205 tests) pass.
- **Ran:** `pnpm docs:check` — OK (migration table, API contract list, and route maps updated).
- **Ran:** `pnpm build` — 6/6 build tasks pass (Next.js storefront & Vite admin built).
- **NOT verified:** Live visual rendering in the browser (static typechecks, lint, and build passed).

## Definition of done
- [x] Code follows AGENTS.md section 2 and 3; gate passes (typecheck, lint, build, docs:check).
- [x] Real database migrations append-only and expand-compatible (`0023_returns.sql`).
- [x] `docs/ARCHITECTURE.md` updated (sections 7, 8, 9).
- [x] Change record written (`docs/changes/2026-10-02-antigravity-returns.md`).
- [x] `progress.md` updated.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: typecheck, lint, build, fast tests, and docs check verified. UI visually not hand-tested.
