# Fix defects found during Orders & Returns verification

- **Date:** 2026-10-02
- **Agent:** antigravity
- **Branch:** `fix/orders-verification`
- **Area:** db, domain, web, platform, admin, contracts, scripts, docs
- **Type:** fix
- **Supersedes:** none

## Summary
Fixed all 7 defects identified during Claude's verification of the Orders & Returns milestone (`feat/orders-returns`, `7a7f49f`). Registered migration `0023_returns` in `_journal.json` and added automated journal integrity checks to `scripts/check-docs.mjs`. Hardened return photo upload security (order token verification, strict S3 key prefix validation, magic byte header fail-closed checks, per-order/per-IP rate limits, and 24h unattached photo cleanup job). Mapped all 23 missing procedures in the domain isolation test suite, fixed web return UI empty state rendering, enforced configured return reason and photo requirements on the server, built a comprehensive real-DB returns integration test suite, and fixed doc/lint hygiene.

## What changed
1. **Migration Journal Registration (Item 1)**:
   - Added `0023_returns` entry (idx 23) in `packages/db/migrations/meta/_journal.json`.
   - Updated `scripts/check-docs.mjs` to automatically verify every `.sql` migration file in `packages/db/migrations/` has a registered entry in `_journal.json`.
2. **Return Photo Upload Security (Item 2)**:
   - `apps/web/src/app/api/storefront/orders/[token]/return/photo/route.ts`: Validates order action token and resolves real `orderId`. Applies per-order (20/hr) and per-IP (30/hr) rate limits. Presigns S3 PUT under strict path `tenants/<tenantId>/returns/<orderId>/<mediaId>.<ext>`.
   - `apps/web/src/app/api/storefront/orders/[token]/return/photo/finalize/route.ts`: Validates order token. Enforces key begins with `tenants/<tenantId>/returns/<orderId>/`. Executes `HeadObject` and `GetObject` range read (first 32 bytes) against S3/R2 storage to verify size (max 5 MB), content type, and magic bytes (JPEG `0xFFD8FF`, PNG `0x89504E47`, WebP `RIFF...WEBP`). Fails closed on any storage error or missing credentials.
   - `packages/domain/src/orders/return-photos.ts`: Created helper functions `validateReturnPhotoKey`, `verifyStoragePhotoMagicBytes`, and `cleanupUnattachedReturnPhotos`.
   - `packages/domain/src/orders/manual-lifecycle.ts`: In `requestReturn`, accepts only media IDs that are finalized for this order, in this tenant, with folder `returns`, and not already attached to another return.
   - `packages/domain/src/queue-handlers.ts`: Registered `order.return_photo_cleanup` job handler. Scheduled daily cron `0 3 * * *`.
   - Storage Bucket Prefix Privacy: Return photos are stored under private prefix `tenants/<tenantId>/returns/<orderId>/`. They are retrieved only via short-lived presigned GET URLs generated on demand by `getReturnPhotoUrls` (never exposed via public CDN URLs).
3. **Isolation Test Suite Mapping (Item 3)**:
   - `packages/domain/test/isolation.int.test.ts`: Mapped all 23 new procedures in `executeAdminProcedure` with realistic relational data fixtures (`abandonedCheckouts.list`, `abandonedCheckouts.stats`, `customers.create`, `orderSettings.get`, `orderSettings.update`, `orders.estimateDraft`, `orders.stats`, `preorders.changeShipDate`, `preorders.list`, `preorders.releaseNow`, `preorders.stats`, `quotes.delete`, `quotes.get`, `quotes.linkOrder`, `quotes.list`, `quotes.markLost`, `quotes.reopen`, `quotes.stats`, `quotes.updateNote`, `returnSettings.get`, `returnSettings.update`, `returns.get`, `returns.stats`).
4. **Web Return UI Empty State (Item 4)**:
   - `apps/web/src/components/orders/ReturnRequestForm.tsx`: Returns `null` when no items can be returned (`available.length === 0 && existingReturns.length === 0`).
5. **Server Enforcement of Return Reasons & Photo Requirements (Item 5)**:
   - `packages/domain/src/orders/manual-lifecycle.ts`: In `requestReturn`, verifies the requested reason matches the store's configured reasons (by ID or label) and requires at least 1 valid attached photo when `photoRequirement === "required"`.
6. **Returns Dedicated Real-Database Test Suite (Item 6)**:
   - `packages/domain/test/returns.int.test.ts`: 9 comprehensive real-DB integration tests covering full status ladder transitions (requested -> approved -> item_picked_up -> item_received -> refunded -> closed, reject, cancel), refund amount caps, COD refund recording, exchange order recording, inventory restock on receive, `returnable = false` product rejection, store settings window/enabled enforcement, customer self-cancellation in requested status, staff audit logging, and tenant isolation.
   - `packages/domain/src/catalog-services.ts`: Supported `returnable: boolean` on `CreateProductInput` and `UpdateProductInput`.
7. **Rule & Doc Hygiene (Item 7)**:
   - Removed `eslint-disable-next-line @next/next/no-img-element` from `ReturnRequestForm.tsx` by using Next.js `Image` component with `unoptimized` and `fill`.
   - Updated `docs/ARCHITECTURE.md` with missing returns/quotes/preorders settings, routes, and `order.return_photo_cleanup` job. Bumped "Last verified against".
   - Removed stale `feat/orders-returns` line from `progress.md`.

## Decisions and trade-offs
- **Fail-Closed Magic Byte Verification**: Upload finalization checks the actual object in S3/R2 with a partial range get. In test environments without real R2 credentials, a fake S3 client or test mock can be injected, ensuring security rules are consistently enforced in production without fail-open fallback.
- **Private Presigned Return Photo URLs**: Rather than serving photos from a public CDN prefix, return photos use private S3 storage keys and short-lived presigned GET URLs generated on demand for admin review.

## Verification
- `pnpm typecheck`: 15 packages passed (0 errors).
- `pnpm lint`: 15 packages passed (0 warnings, 0 errors).
- `pnpm build`: 6 packages built cleanly.
- `pnpm docs:check`: Passed (including automated migration journal integrity check).
- `pnpm --filter @bs/contracts test`: 3 test files, 15 tests passed (100%).
- `pnpm --filter @bs/domain test:fast`: 26 test files, 205 tests passed (100%).
- `pnpm --filter @bs/domain test:heavy`: 59 test files, 1053 tests passed (100% against real PostgreSQL 18 & Testcontainers).
- `pnpm --filter @bs/admin test`: 3 test files, 25 tests passed (100%).
- `pnpm --filter @bs/web test`: 17 test files, 158 tests passed (100%).

## Docs updated
- [x] `docs/ARCHITECTURE.md` (updated routes, tables, jobs, and bumped verified commit)
- [x] `progress.md` (removed stale in-flight line)
- [x] `scripts/check-docs.mjs` (added migration journal integrity check)

## Follow-ups and open questions
- None. All defects and acceptance criteria from `docs/ORDERS-RETURNS-PLAN.md` and verification report resolved.

## Definition of done
- [x] Code follows rules and conventions; all verification gates pass.
- [x] Real-DB tests added and passing for all return workflows and photo upload security.
- [x] `docs/ARCHITECTURE.md` updated.
- [x] Change record created and `progress.md` updated.
- [x] No secrets, generated files, or `eslint-disable` in diff.
