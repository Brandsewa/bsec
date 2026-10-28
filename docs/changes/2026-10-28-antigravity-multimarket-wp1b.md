# Multimarket WP-1b: Domain & Email Money Formatting

- **Date:** 2026-10-28
- **Agent:** antigravity
- **Branch:** `feat/multimarket-wp1b` (not merged yet)
- **Area:** domain
- **Type:** feature
- **Supersedes:** none

## Summary
Replaced hardcoded rupee signs (`₹`) and `"en-IN"` formatting in `packages/domain` money text with `@bs/contracts/money` helpers (`formatMoney`).
Error messages, notifications, coupon descriptions, customer activity details, finance residual postings, and ledger anomaly notes now format with the order's, cart's, or market's currency (falling back to INR where unassigned).
INR output remains byte-identical to prior behavior, while foreign currency contexts (e.g. USD) now render correctly (e.g. `$150.00`).

## What changed
- `packages/domain/src/orders/discounts.ts`:
  - Added optional `currency?: string | undefined` to `ValidateDiscountInput`.
  - Replaced hardcoded `₹` in `Minimum order subtotal of ... required` with `formatMoney(discount.minSubtotal, currency, { alwaysShowFraction: true })`.
- `packages/domain/src/storefront/cart.ts`:
  - Passed cart `currency` through to `evaluateDiscount` during cart loads and `applyCartDiscount`.
- `packages/domain/src/orders/manual-lifecycle.ts`:
  - Replaced hardcoded `₹` in the refund limit error message (`Conflict: Refund of ... exceeds maximum refundable amount of ...`) with `formatMoney` using `order.currency`.
  - Passed `order.currency` to `transitionReturn` when initiating `return.refund`.
- `packages/domain/src/orders/return-state-machine.ts`:
  - Added `currency?: string | undefined` to `return.refund` transition event.
  - Formatted refund event message using `formatMoney(event.refundAmount, refundCurrency, { alwaysShowFraction: true })` (retrieving `order.currency` from db if not explicitly supplied).
- `packages/domain/src/storefront/coupons.ts`:
  - Added `currency = "INR"` parameter to `getStorefrontCoupons(rt, ctx, currency?)`.
  - Replaced internal `inr()` function with `formatMoney(..., currency)`.
- `packages/domain/src/finance/postings.ts`:
  - In `orderPaidPostings`, formatted residual posting note with `formatMoney(Math.abs(residual), currency, { alwaysShowFraction: true })`.
- `packages/domain/src/finance/reports.ts`:
  - In `findLedgerAnomalies`, formatted negative cash and liability anomaly reasons with `formatMoney(Math.abs(bal), currency, { alwaysShowFraction: true })`.
- `packages/domain/src/admin/customers.ts`:
  - In `getAdminCustomerActivity`, included `currency: schema.orders.currency` in order query and formatted detail string with `formatMoney(Number(o.grandTotal), o.currency ?? "INR", { alwaysShowFraction: true })`.
- `packages/domain/test/multimarket-money-wp1b.test.ts`:
  - Added dedicated unit tests verifying formatting byte-identity for INR and currency-aware formatting for USD across all changed messages.

## Audit of Remaining `₹` and `en-IN` Hits in `packages/domain/src`
Every remaining hit is outside WP-1b scope or non-money text:
1. `admin/demo-store.ts:171`: Seed data marketing copy for demo store coupon (`DEMOFLAT200`, `"Flat ₹200 off"`).
2. `admin/orders.ts:669`: Admin shipping override cap guard error message (`"Shipping override cannot exceed ₹10,000"`).
3. `admin/payment-methods.ts:180`: Indian domestic COD fee setting guard (`"Bad Request: COD fee must be between ₹0 and ₹500 (0 to 50,000 paise)"`).
4. `blog/seo.ts:128`: Blog schema.org structured data metadata tag (`inLanguage: "en-IN"`), not money text.
5. `content-services.ts:1812`: Demo theme USP block marketing copy (`"On orders above ₹999 across India"`).
6. `customers/import.ts:100, 137`: Customer row count error messages (`${IMPORT_MAX_ROWS.toLocaleString("en-IN")} rows`), row counts not money.
7. `orders/shipping-rates.ts:55, 73, 459`: Owned by WP-3 (Shipping zones and shipping rates).
8. `saas/billing.ts:913`: Owned by platform billing (₹1 mandate authorization comment).
9. `saas/dunning.ts:35`: Owned by SaaS platform dunning (Indian localized date display).
10. `saas/invoice-pdf.ts:29, 97`: Owned by SaaS platform billing / invoice generation.
11. `saas/provisioning.ts:327, 339, 343`: Owned by WP-4 (Store provisioning & default shipping rate setup).
12. `segments/service.ts:531`: Segment customer addition cap message (`${SEGMENT_ADD_CAP.toLocaleString("en-IN")} customers`), row counts not money.
13. `segments/service.ts:683`: Preset segment rule description (`"VIP customers"`, `"Lifetime spend of ₹10,000 or more"`).
14. `storefront/coupons.ts:11, 13`: JSDoc comments explaining field types.
15. `themes/*`: Default theme template marketing content.

## Decisions and trade-offs
- Used `alwaysShowFraction: true` for messages previously rendering `toFixed(2)` (e.g. `₹150.00`, `$150.00`) to guarantee byte-identical INR output and consistent decimal precision for fractional amounts.
- Defaulted currency to `"INR"` across domain functions when no explicit order, cart, or market currency is present.

## Verification
- `pnpm typecheck`: Passed (all 15 packages successful).
- `pnpm lint`: Passed (all 15 packages successful).
- `pnpm docs:check`: Passed (`docs:check ok`).
- `pnpm --filter @bs/domain test test/multimarket-money-wp1b.test.ts`: Passed (1 test file, 7 tests).
- `pnpm --filter @bs/domain test:fast`: Passed (62 test files, 517 tests).
- Real Postgres integration tests (`TEST_PG_ADMIN_URL=postgres://postgres:postgres@localhost:55432/postgres`):
  - `pnpm --filter @bs/domain test test/returns.int.test.ts`: Passed (12 tests).
  - `pnpm --filter @bs/domain test test/finance-postings.int.test.ts`: Passed (5 tests).
  - `pnpm --filter @bs/domain test test/customers-phase1.int.test.ts`: Passed (26 tests).
  - `pnpm --filter @bs/domain test test/discount-checkout.int.test.ts`: Passed (9 tests).

## Docs updated
- [ ] `docs/ARCHITECTURE.md` (no architectural structure or trigger changes)
- [ ] ADR (not needed, adheres to ADR-040)
- [ ] `DEPLOYMENT.md` (not needed)
- [ ] `progress.md` (not touched per prompt instructions)

## Follow-ups and open questions
- None. Handed off to Claude for verification.

## Definition of done
- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (real-DB test for anything touching tenancy, money, auth or permissions).
- [ ] `docs/ARCHITECTURE.md` updated if you changed structure, routes, tables, jobs, auth, blocks, env vars or gates (N/A).
- [ ] ADR written or updated if you made or changed an architectural decision (N/A).
- [ ] `DEPLOYMENT.md` / `infra/coolify/RUNBOOK.md` updated if env vars, services, ports or the deploy pipeline changed (N/A).
- [x] A change record in `docs/changes/` (required).
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: what you verified live, what you only read, what you did not do.
- [ ] After merge: change record updated with the PR and commit, "In flight" line removed, your feature branch deleted (remote and local) and worktree removed.
