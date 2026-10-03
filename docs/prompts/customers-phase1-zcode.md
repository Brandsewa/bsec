# ZCode prompt: Customers Phase 1 (list, detail, import, delete)

You are ZCode. Complete `docs/prompts/zcode-onboarding.md` first (read the rule book and save your note) and confirm to the owner. This prompt assigns you **Phase 1 of the Customers upgrade**. The owner has handed this phase to you, not to Antigravity.

## Spec
Your spec is `docs/CUSTOMERS-IMPLEMENTATION-PLAN.md` (Phase 1: steps 1A, 1B, 1C, **one commit each**) together with `docs/prompts/customers-phase1.md`, which lists the requirements; read "you" wherever it says Antigravity. Also read `docs/CUSTOMERS-SECTION-FINDINGS.md` (what and why), `docs/admin-ui-standards.md`, and the Phase 0 change records (`docs/changes/2026-10-03-antigravity-customers-phase-0.md` and `2026-10-03-claude-customers-phase0-verification.md`).

Scope: Phase 1 only. No segments (reserve the `segment` URL param; leave the Segments card hidden). **No store credit, no loyalty points, no email sending** (owner decisions). Do not touch the Orders code except to read it.

## What Phase 0 already gives you (merged on main; do not rebuild it)
- `packages/domain/src/customers/metrics.ts`: `customerMetricsSql(tenantId)` (the lateral subquery for orders count, total spent, average order value, first and last order, returns count), `refreshCustomerMetrics`, `runCustomerMetricsSweep`. Every list, detail, sort and filter reads this fragment, never the cached `customers.orders_count` or `total_spent` columns (those are only a sorting copy).
- `packages/domain/src/customers/consent.ts`: `setMarketingConsent` is the **only** writer of marketing consent (state, `accepts_marketing`, `customer_consent_events` history, audit row for staff). The admin consent switch, the import and any status change must call it.
- `customers.is_guest`, guest customers created at checkout, `customers.marketing_state`, `marketing_source`, `marketing_updated_at`, table `customer_consent_events`, migration `0028_customers_phase0.sql`.

## Known follow-ups from Phase 0 to respect
- `setMarketingConsent` accepts `channel: "sms"` but would overwrite the email columns: keep every call on `"email"` and, as part of 1B, make the function reject any other channel with a clear error and a test.
- The metrics lateral matches orders by `customer_id` or by email. With 10,000-customer stores in mind, look at the query plan for the list's sorts (`EXPLAIN ANALYZE` on a seeded database of a few thousand customers and orders) and add an index in a new migration if it scans. Report what you measured.
- A guest checkout with the email of an existing account attaches the order to that account. Leave as is; do not change checkout.

## Build exactly what the plan says
1A: rebuilt Customers list (stats strip in its own boundary, tabs All, Customers, Guests, Blocked, columns, store-wide tag filter options, marketing-state and location and joined and repeat filters, bulk actions that report "N done, M skipped, first issue", server-side CSV export with Subscribed only on by default).
1B: two-column detail and edit page (editable profile, staff address CRUD, orders, activity timeline, status with blocked behaviour, marketing card with consent history, tags editor, notes timeline in a new `customer_notes` table replacing the single note).
1C: CSV import with dry run and error file (consent only when the file says so), and delete that hard-deletes a customer without orders and anonymises one with orders.

## Requirements (all of them are checked)
1. Kit components only (`DataTable`, `TableToolbar`, `ScrollTabs`, `MetricCard`, `ConfirmDialog`, `SimpleSelect`); copy the Orders page structure for URL state and stats. Every route has `pendingComponent`. 375 px and desktop checked in a browser, or say plainly what you could not run.
2. Contracts first, then the domain service (`customers.read` or `customers.write` via `assertPermission`), then the handler, then the UI. Every mutation writes `audit_logs`. Commit before read-back; invalidate caches after commit.
3. A blocked customer cannot log in or check out; test it end to end in the domain. Import never subscribes anyone unless the file says so. Delete keeps orders intact and destroys sessions.
4. New tenant tables (`customer_notes`) use `tenantTable()` plus `forceRlsSql`, composite tenant foreign keys, a `_journal.json` entry and grants like the other tables; the single-note column is migrated into the first note, idempotently.
5. Map every new procedure in `packages/domain/test/isolation.int.test.ts`. Real-database tests for each mutation, each filter and sort, permission refusals (read-only staff), the import dry run versus commit, both delete paths, the notes migration, and cross-store isolation.
6. Stage by explicit path in your own worktree (`feat/customers-phase-1`); read `git status` for foreign files before each commit.
7. Gate with counts pasted: `pnpm typecheck`, `lint`, `build`, `docs:check`, domain `test:fast` and `test:heavy`, `@bs/admin`, `@bs/web`. Update `docs/ARCHITECTURE.md` (tables, routes, API surface) and write `docs/changes/2026-10-xx-zcode-customers-phase-1.md` stating exactly what you ran and what you did not.
8. Open a PR, do not merge it, and report the link. Claude verifies against the plan's acceptance criteria before Phase 2 (segments) starts.
