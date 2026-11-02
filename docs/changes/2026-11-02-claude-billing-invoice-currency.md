# Platform invoices in the store's currency, and a payment-successful notice

- **Date:** 2026-11-02
- **Agent:** claude
- **Branch:** `fix/billing-invoice-currency` (not committed or merged yet; the owner asked to hold the commit)
- **Area:** db, domain, contracts, admin, superadmin, docs
- **Type:** fix
- **Supersedes:** none

## Summary
After a PayPal payment worked end to end, the owner found (1) the store opened straight from the Activate screen with no success message, (2) the invoice PDF was in rupees with 18% IGST for a US store (the amount is USD cents, so it printed "Rs. 31.24" with Rs. 4.77 GST), and (3) two invoices for one payment.

## What changed
- **Migration `0094_platform_invoice_currency`:** `platform_invoices.currency` (default INR). Backfill: invoices of PayPal subscriptions become USD with tax 0 (they were cents with GST computed on them by mistake).
- `packages/domain/src/saas/billing.ts`: the `charged` event carries a currency (PayPal sends USD); GST is computed for INR only, USD invoices get tax 0. `PlanAndBillingInvoiceItem` and the platform invoice list return `currency`.
- `packages/domain/src/saas/invoice-pdf.ts`: non-INR invoices are titled "INVOICE", amounts print as `USD 31.24`, no SAC, place of supply or GST rows, and the footer says no GST is charged (export of services). **Owner and accountant to confirm this wording and treatment.**
- Admin Plan and billing invoice list and Super Admin Ledger use the invoice's currency. Ledger fix while there: it showed "Taxable amount" as the paid amount and "Total" as paid plus tax (double counting); now taxable = paid minus tax, total = paid.
- Activate screen: "Payment successful. Opening your store..." for 2.5 s before the redirect.
- Tests: the PayPal activation case asserts one USD invoice with tax 0 and that the same capture under a second event id does not make a second invoice.

## Two invoices
The owner's two PDFs (BS/26-27/00003 and /00004) are identical: same date, Growth monthly, 31.24. The code already gives one invoice per provider payment id (tested), so these are two separate PayPal captures for the store, not one capture invoiced twice. Which order the second came from is not known (a stale approved order captured late, or a resent webhook, are the candidates). Guard added: `CHECKOUT.ORDER.APPROVED` captures only the store's current order (`subscriptions.provider_subscription_id`) and only while the store is not already active, so a stale order or a resent approval can never charge again. The sandbox business account's PayPal activity would show whether two payments really were taken.

## Verification
- Ran: `tsc --noEmit` pass for contracts, db, domain, platform, admin, superadmin; billing and invoice tests, 6 files, 56 pass on real Postgres (paypal, cashfree, subscribe, dunning, invoices, gst-invoices).
- NOT verified: migration 0094 on a database with existing invoices, the PDF opened, the screens in a browser, `pnpm build`, `pnpm lint`, the full gate.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: migration row for 0094 still to add before merge
- [ ] ADR / `DEPLOYMENT.md` not needed
- [x] `progress.md` In flight line; the capture change record marked merged in #190

## Follow-ups and open questions
- GST treatment of USD invoices (zero-rated export, LUT) is the owner's and accountant's call.
- Duplicate invoice cause (above).

## Definition of done
Not done: commit, gate, ARCHITECTURE row, merge steps.
