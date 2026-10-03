# Verification fixes for Customers Phase 0

- **Date:** 2026-10-03
- **Agent:** claude
- **Branch:** `feat/customers-phase-0`
- **Area:** db, domain, tests
- **Type:** fix
- **Supersedes:** none

## Summary
Claude verified Antigravity's Phase 0 (metrics, guest customers, consent). The gate was green (heavy suite 63 files, 1190 tests). Two defects were found by reading the code and fixed here, each with a test.

## What changed
- **Registration bypassed the consent writer.** `registerCustomer` wrote `accepts_marketing = true` directly, so a shopper who ticked the box had `marketing_state = not_subscribed` and no consent event: the exact disagreement 0c exists to prevent. It now calls `setMarketingConsent` (source `account_page`) for a newly created row.
- **The guest backfill in migration 0028 could abort a deploy.** It copied the raw order phone into `customers.phone`, which is unique per store, so two order emails sharing a phone (or a phone already on a customer) would fail the whole migration. Phones are now normalised to digits (as checkout does) and only given to the first customer; the rest are left empty. The migration was unapplied, so it was edited in place.
- **Tests:** registration with and without the marketing box; the migration's guest statement run against orders whose emails share a phone, twice (idempotent).

## Verification
- typecheck, lint, docs:check, build, domain fast 238, web 164, admin 25, heavy 1190 pass on Antigravity's commits; after these fixes the customer, isolation and store-settings heavy files pass (782 tests) and `customers-phase0.int.test.ts` passes 5/5.

## Follow-ups and open questions
- `setMarketingConsent` accepts `channel: "sms"` but would overwrite the email consent columns; restrict to email until SMS has its own columns.
- A guest checkout with the email of an existing account attaches the order to that account (it shows in that person's order history). Acceptable now; revisit if abuse appears.
- The customer metrics lateral matches orders by `customer_id` or by email; check the query plan on a large store before Phase 2 builds on it.
