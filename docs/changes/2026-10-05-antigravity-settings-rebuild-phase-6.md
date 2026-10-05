# Settings rebuild Phase 6: shipping, delivery, taxes, credit notes, and GST engine

- **Date:** 2026-10-05
- **Agent:** antigravity
- **Branch:** `feat/settings-rebuild-phase-6` (not merged yet)
- **Area:** db, domain, contracts, admin, shipping
- **Type:** feature
- **Supersedes:** none

## Summary
Implements Phase 6 of the Store Settings Rebuild per `docs/prompts/settings-rebuild-phase-6.md`. Upgrades the GST tax engine to comply with Indian tax rules under the `settings.gst_v2` feature flag (with complete fail-closed fallback to existing calculations when disabled). Adds tax classes management, immutable tax line snapshots on order items, idempotent credit notes on refunds linked to parent invoices, interactive shipping rate preview calculation in store admin, and shipping permission enforcement.

## What changed
- **Migration & Schema (`0035_settings_phase6.sql`):**
  - Added `tax_classes` table with tenant isolation, unique code constraint, and default fallback.
  - Added foreign key `products.tax_class_id` and indexed `tax_classes.is_default`.
  - Added `taxable_value_paise` and `tax_paise` snapshot columns to `order_items`.
  - Added `return_id` and `parent_invoice_id` to `invoices` with partial unique index for idempotent credit notes.
- **GST Validation & Calculation Utilities:**
  - Added pure Mod-36 GSTIN checksum validator (`packages/domain/src/orders/gst-validation.ts`) matching official state code assignments.
  - Added tax calculation engine (`packages/domain/src/orders/tax-engine.ts`) supporting tax-inclusive / tax-exclusive pricing, largest-remainder proportional discount distribution, half-up rounding to paise, and odd-paise allocation to SGST.
- **Domain Services & Orders:**
  - Added `packages/domain/src/admin/tax-settings.ts` with tax classes CRUD, lazy-seeded "Standard 18%" default tax class, GSTIN verification against seller registered state, and permission checks (`taxes.manage`).
  - Added rate preview calculator in `packages/domain/src/orders/shipping-rates.ts` and hardened shipping mutation permissions to `shipping.manage`.
  - Updated `checkout.ts` and `admin/orders.ts` to calculate and snapshot order item taxes and validate missing destination/seller state when `settings.gst_v2` is enabled.
  - Updated `manual-lifecycle.ts` and `invoices.ts` to issue negative-signed, idempotent credit notes on refunds linked to original invoices.
- **Contracts (`@bs/contracts`):**
  - Added oRPC endpoints `admin.taxSettings.{get,update}`, `admin.taxClasses.{list,create,update,delete}`, and `admin.shipping.preview`.
  - Added `taxClassId` and `hsn` fields to product creation/update schemas.
- **Admin UI:**
  - Modernized `apps/admin/src/routes/_store/settings/taxes.tsx` with dual-read/dual-write contracts, GSTIN validation feedback, and tax classes CRUD table with confirmation dialogs.
  - Enhanced `apps/admin/src/routes/_store/settings/shipping.tsx` with live shipping rate preview calculator and trace viewer.
  - Added "Taxes & GST" configuration card to product edit view (`apps/admin/src/routes/_store/products/$id.tsx`).

## Decisions and trade-offs
- **Chartered Accountant (CA) Review Alignment:**
  1. *Shipping Tax Treatment:* Under composite supply principles, shipping tax defaults to `highest_line_rate` of the order lines rather than an arbitrary flat rate.
  2. *Odd-paise CGST/SGST Split:* Any rounding remainder of 1 paisa between CGST and SGST is allocated consistently to SGST to ensure `cgst + sgst === totalTax`.
  3. *Credit Notes:* Invoiced refunds under `settings.gst_v2` issue credit notes with negative-signed lines and totals (`grandTotal < 0`), referencing both `returnId` and `parentInvoiceId`.
  4. *Gated Slices:* Slices 6E and 6F (complex automated carrier rates / zone-based tax classes) remain deferred per project decision 7.

## Verification
- `pnpm docs:check`: Passed.
- `pnpm --filter @bs/domain exec vitest run test/tax-engine.test.ts test/gst-validation.test.ts`: Passed (14 tests).
- `pnpm --filter @bs/domain exec vitest run test/gst-parity.test.ts`: Passed (5 tests, 100% parity preserved with flag off).
- `pnpm --filter @bs/domain exec vitest run test/settings-phase-6.int.test.ts`: Passed (7 tests in real Postgres container).
- `pnpm --filter @bs/domain test:fast`: Passed (300 tests across 38 files).

## Docs updated
- [x] `docs/ARCHITECTURE.md` (sections 7 and 8)
- [ ] ADR: not needed (follows PLAN §15 / §11.2)
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed (no new runtime infrastructure or external keys)
- [x] `progress.md`: in-flight status updated

## Follow-ups and open questions
- Ready for Claude verification and gate verification. Slices 6E and 6F remain intentionally gated.

## Definition of done
- [x] Code follows rules and conventions.
- [x] Real-DB tests pass against Postgres container (`test/settings-phase-6.int.test.ts`).
- [x] `docs/ARCHITECTURE.md` updated and `docs:check` passes.
- [x] No secrets or generated files in git diff.
