# Platform billing slices B5 and B6: dunning and invoice PDF

- **Date:** 2026-10-18
- **Agent:** claude
- **Branch:** `feat/platform-billing-b5-b6`
- **Area:** db, domain, contracts, platform, web, admin, superadmin
- **Type:** feature
- **Supersedes:** none (continues `2026-10-18-claude-platform-billing-b2-b4.md`; plan `docs/PLATFORM-BILLING-PLAN.md`)

## Summary
A failed plan payment no longer goes unnoticed: the owner gets a failure notice, a reminder two days before the grace period ends, and the store moves to the restricted tier if it is still unpaid after the grace period. Every plan payment now has a downloadable GST tax invoice PDF with the platform's issuer details and the configured tax rate.

## What changed
- **B5:** migration `0071` adds `subscriptions.past_due_since` and `dunning_stage`. The webhook stamps `past_due_since` on the first `pending` or `halted` event and clears it on the next successful charge or resume. `runBillingDunningSweep` (hourly, `apps/platform`) sends the failure notice, the reminder (when the grace period is 3 days or more) and limits the store (restricted tier, audit row `billing.store_limited`). The limit never depends on the email: with email off the notice is skipped and the store is still limited. Lapsed trials are untouched (the trial sweep limits them). Grace days are set in Super Admin, Platform billing.
- **B6:** Super Admin, Platform billing, **Invoice details** (legal name, GSTIN with format check, address, state, SAC, GST rate). New invoices compute tax from the configured rate instead of a fixed 18%. `GET /api/admin/billing/invoices/:id/pdf` returns the PDF for the signed-in store's own invoice (another store gets 404); the Plan and billing invoices tab has a "Download PDF" button. CGST and SGST are shown when the platform and the store are in the same state, otherwise IGST.
- New dependency `pdfkit` 0.17.2 (pure JavaScript, no browser or native build) with `@types/pdfkit`, pinned exactly, in `packages/domain`: there was no PDF library in the monorepo.

## Decisions and trade-offs
- The PDF is rendered on demand, not stored: it always matches the database and needs no storage. Standard PDF fonts have no rupee sign, so amounts read "Rs.".
- The invoice prefix `BS` and the GST registration details are still placeholders until the owner enters them in Super Admin; an invoice printed before that says the seller GST details are not configured.

## Verification
- Ran: typecheck for contracts, domain, platform, web, admin, superadmin; lint for the same (0 errors); real-database `platform-billing-dunning` (9 tests: stamping, notice, reminder, limit, paying restores, email off, trials ignored, escaped emails, profile validation, tax rate, tax split, real PDF, cross-store 404), plus the settings, subscribe and lifecycle suites.
- NOT verified: the screens and the PDF in a browser or a PDF viewer (only that the file is a valid PDF of plausible size); real emails through ZeptoMail; the full domain heavy suite (CI).

## Docs updated
- [x] `docs/ARCHITECTURE.md`, `progress.md`

## Follow-ups and open questions
- B7 Super Admin subscriptions and revenue view, B8 percent-off promotions, B9 end-to-end run with the owner's test keys.
- Owner: enter the invoice details (GSTIN, legal name, address, state, SAC, rate) in Super Admin, Platform billing.

## Definition of done
Gate partly run (see Verification); CI runs the rest.
