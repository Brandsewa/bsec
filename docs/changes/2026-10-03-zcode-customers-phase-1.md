# Customers Phase 1: rebuilt list, detail/edit, CSV import, delete/anonymise

- **Date:** 2026-10-03
- **Agent:** zcode
- **Branch:** `feat/customers-phase-1`
- **Area:** db, domain, contracts, web, admin
- **Type:** feature
- **Supersedes:** none

## Summary

Implemented Customers Phase 1 (steps 1A, 1B, 1C of `docs/CUSTOMERS-IMPLEMENTATION-PLAN.md`, one commit each) plus two required pieces that fell out of the plan's requirements: enforcement of the blocked-customer rule in the two paths that did not check it, and a measured rewrite of the Phase 0 metrics fragment whose per-customer lateral shape could not scale.

## What changed (commits in order)

1. **`feat(customers): Phase 1A rebuilt customers list`** — Tabs All/Customers/Guests/Blocked; stats strip (total, new this month, repeat, subscribers, total spend, average order value) in its own boundary reading the Phase 0 metrics fragment; marketing-state, store-wide tag and location (default-address state) filters; guest/blocked badges; last-order column; bulk add/remove tag and set status with "N done, M skipped, first issue" reporting; filtered CSV export with subscribers-only on by default; anonymised (`deleted_at`) customers hidden from the list. New procedures: `customers.stats`, `customers.tags`, `customers.setStatus`, `customers.setTags`.
2. **`fix(customers): blocked customers cannot sign in via OTP or check out`** — password login and session resolution already refused non-active customers, but phone-OTP login and storefront checkout did not. OTP verification now fails with the wrong-code error and creates no session; checkout refuses with a neutral message and writes nothing. Per-store isolation of a block is tested.
3. **`perf(customers): metrics fragment from per-customer lateral to grouped aggregates`** — see "Measured" below.
4. **`feat(customers): Phase 1B customer detail and edit`** — two-column detail page: editable profile (email only for guests/unverified accounts; a change clears `email_verified` and is audited), staff address CRUD, full order history with status filter, activity timeline from existing tables (orders, returns, quotes, reviews, abandoned carts, consent events), status card with blocked behaviour, marketing card backed by `customer_consent_events` through the single writer with a confirm dialog, tags editor with store-wide suggestions, notes timeline in the new `customer_notes` table. `setMarketingConsent` now **rejects non-email channels** with a clear error (Phase 0 follow-up; it would have overwritten the email record). Migration `0029_customers_phase1.sql` creates `customer_notes` (tenantTable, forceRlsSql, composite FK, `_journal.json` entry) and migrates the single `customers.note` into the first note idempotently; the column is no longer read or written by the app and stays for this release (expand/contract). New procedures: `customers.update`, `customers.orders`, `customers.activity`, `customers.consentSet`, `customers.addresses.{add,update,delete}`, `customers.notes.{list,add,delete}`.
5. **`feat(customers): Phase 1C CSV import and delete/anonymise`** — browser-parsed CSV with dry-run preview (created, updated, duplicates in file, subscribe count, invalid rows) then commit; files over 500 rows are queued on the new `customers.import` pg-boss queue and processed by the worker. Consent is recorded **only** when the row's `marketing_consent` is yes/subscribed/true (source `import`, through the single writer); existing customers get name and merged tags only — consent and phone are never overwritten from a file. Row issues are downloadable as an error CSV; cap 10,000 rows. Delete: hard-delete without orders (children cascade), anonymise with orders (identity → `deleted-<shortid>@invalid`, password and sessions destroyed, addresses/notes/wishlist/tags removed, consent unsubscribed via the single writer, `deleted_at` set, orders untouched). New procedures: `customers.importPreview`, `customers.importCommit`, `customers.delete`.

All new procedures are mapped in `packages/domain/test/isolation.int.test.ts`. Every mutation writes `audit_logs`. `docs/ARCHITECTURE.md` updated (tables, migration 0029, queues, API surface).

## Measured (metrics fragment)

`EXPLAIN ANALYZE` on a seeded store (6,000 customers, 24,000 orders) in a scratch database on the disposable test container:

- Old fragment (per-customer LATERAL with `customer_id = c.id OR (customer_id IS NULL AND email = c.email)`): **13,140,134 shared-buffer hits** for one page of 25 rows — a full orders scan per customer; the OR defeats every index (partial and plain email indexes did not change the plan, with or without RLS in a minimal repro).
- New fragment (grouped aggregates over the tenant's orders/returns, joined back by plain equality): **2,448 buffer hits** for the same page (~5,400× less). Semantics unchanged: the Phase 0 and Phase 1 exact-number suites (16 tests) pass on real Postgres.

## Verification (what ran, with counts)

- `pnpm typecheck` — **PASS** (15/15 packages).
- `pnpm lint` — **PASS** (after fixing 7 domain + 11 admin findings the first run reported; no remaining).
- `pnpm build` — **PASS** (all workspace targets; one pre-existing Windows long-path symlink warning for a `safe-stable-stringify` pnpm store link, unrelated).
- `pnpm docs:check` — **PASS**.
- `pnpm --filter @bs/domain test:fast` — **PASS** (28 files, 238 tests).
- `pnpm --filter @bs/domain test:heavy` (real Postgres 18 via the repo's shared test server, `TEST_PG_ADMIN_URL`) — **64 files, 1,303 tests passed, 0 test failures.** Two full-suite runs each threw a handful of *unhandled teardown errors* (Postgres `57P01 ProcessInterrupts` on pooled connections killed as the shared server drops per-file clone databases) and three worker crashes with the documented Windows flake exit code 3221226505 (`admin-auth`, `platform-staff`, `returns`); each of those files passes when run alone (3 files, 38 tests). The failing command exit codes come from these unhandled errors, not from failing tests. Not run: the heavy suite inside CI's own Postgres.
- `pnpm --filter @bs/web test` — **PASS** (18 files, 164 tests).
- `pnpm --filter @bs/admin test` — **PASS** (4 files, 32 tests).
- `packages/domain/test/customers-phase1.int.test.ts` (new, real Postgres) — **26 tests**: every 1A filter/sort/tab, stats strip, store-wide tag/location options, status and tag mutations with audit rows, read-only-staff refusals, cross-store isolation, blocked-customer OTP + checkout enforcement end to end, profile update rules (guest email fix clears verification; verified email staff-immutable), consent switch + SMS refusal, staff address CRUD with audits, notes author-or-owner delete rule, 0029 note migration idempotency, order history and activity ordering, import preview/commit parity, consent-only-when-stated, 10,000-row cap, phone collisions, both delete paths, sessions destroyed, orders kept.
- Isolation suite — **840 tests passed** (was 755 before Phase 1: +85 for the 17 new procedures).

## Browser check (admin at 1280px and 375px, against the local demo store)

Ran my worktree's web (port 3010) and admin (port 5175) dev servers against the local demo database with migration 0029 applied. Verified in a real browser:

- Desktop list: stats strip, tabs, tag/marketing/location filters, table columns, Guest/Marketing badges, Import/Export buttons — correct with real demo data (screenshot evidence in session).
- Desktop detail: sticky header, five stat tiles, profile fields with Save disabled until dirty, addresses, order history with status chips linking to orders, activity timeline, status card, marketing card — subscribe flow shows a confirm dialog, writes through the consent writer and the list/stats reflect it ("Subscribed" badge, subscriber count 1, consent history entry). Notes: add works, author and date render, delete button present.
- 375px list and detail: two-column stat cards, horizontally scrolling tabs, mobile cards, stacked detail cards, no horizontal overflow.
- Import dialog opens with the column docs and the consent-responsibility notice.
- **Not drivable in the browser:** the actual CSV file upload (the in-app browser runtime does not support file choosers) — the import round-trip is covered by the real-DB tests instead. Console logs could not be collected in this runtime; no visible error states occurred during the run. One cosmetic finding, not fixed here (pre-existing pattern shared with the Orders page): the Orders cell renders "1 orders" without singularisation.

## Docs updated

- [x] `docs/ARCHITECTURE.md`: `customer_notes` table, migration 0029, `customers.import` queue, admin customers API surface.
- [x] `progress.md`: Customers Phase 1 milestone section.

## Follow-ups and open questions

- The `customers.note` column still exists (expand-only); dropping it is a contract step for a later release.
- `commitImportRows` runs one transaction per file (up to 500 rows inline); per-row try/catch keeps one bad row from blocking the rest, but a very large queued import holds one transaction for its duration — acceptable at the 10,000-row cap; revisit if stores hit it.
- The metrics fragment now computes two grouped scans per query; if a tenant's orders grow past ~10⁵, materialising per-customer aggregates (the existing refresh job) may become the better sort path. The cached columns and the sweep are already in place from Phase 0.
- Phase 2 (segments) is not started; the `segment` URL param is reserved and the Segments card is absent (hidden until Phase 2).

## Definition of done

- [x] Code follows AGENTS.md §2/§3; the §4 gate passes (counts above).
- [x] Tests added/updated; real-DB tests for tenancy, money-adjacent metrics, auth and permissions.
- [x] `docs/ARCHITECTURE.md` updated in the same change set.
- [x] ADR not needed (no architectural decision; follows ADR-002/006 patterns).
- [x] `DEPLOYMENT.md`/RUNBOOK unchanged (no new env vars; the new queue is created by the migrate step as designed).
- [x] Change record written; `progress.md` updated.
- [x] No secrets, no generated files, no unrelated edits (staged by explicit path throughout).
- [x] Honest status: everything above was run; browser file-upload and CI-internal heavy run noted as not done.
