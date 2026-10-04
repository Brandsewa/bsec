# Antigravity prompt: Customers Phase 1 (list, detail, import, delete)

Prerequisite: Phase 0 is merged and verified by Claude. Branch `feat/customers-phase-1` from the latest `origin/main`. Read `AGENTS.md`, `docs/CUSTOMERS-IMPLEMENTATION-PLAN.md` (Phase 1 is your scope: steps 1A, 1B, 1C, one commit each), `docs/CUSTOMERS-SECTION-FINDINGS.md`, `docs/admin-ui-standards.md`, and `docs/prompts/catalog-revision.md`.

Scope: Phase 1 only. No segments (reserve the `segment` URL param and leave the Segments card hidden). **No store credit, no loyalty points.** No email sending.

Build exactly what the plan lists: a rebuilt Customers list (stats strip in its own boundary, tabs All, Customers, Guests, Blocked, columns, filters with store-wide tag options, bulk actions that report "N done, M skipped, first issue", server-side CSV export with Subscribed only on by default), a two-column detail and edit page (editable profile, addresses CRUD by staff, orders, activity timeline, status with blocked behaviour, marketing card with consent history, tags editor, notes timeline replacing the single note), CSV import with dry run and error file, and delete that hard-deletes a customer without orders and anonymises one with orders.

Requirements:
1. Use the shared admin kit only (`DataTable`, `TableToolbar`, `ScrollTabs`, `MetricCard`, `ConfirmDialog`, `SimpleSelect`); copy the Orders page structure for URL state and stats. No native `<select>`, no `window.confirm`, no hand-rolled tables. Every route has `pendingComponent`.
2. Contracts first, then the domain service with `assertPermission` (`customers.read` or `customers.write`), then the handler, then the UI. Every mutation writes `audit_logs`. Commit before read-back; invalidate caches after commit.
3. All metrics come from the Phase 0 fragment, never the cached columns. All consent changes go through `setMarketingConsent`.
4. A blocked customer cannot log in or check out (test it end to end in the domain). Import never subscribes anyone unless the file says so. Delete keeps orders intact and destroys sessions.
5. Map every new procedure in the isolation suite. Real-database tests for each mutation, each filter and sort, permission refusals (read-only staff), the import dry run versus commit, both delete paths, and cross-store isolation.
6. Run the admin in a browser at 375 px and desktop and report what you saw; if you cannot, say so plainly.
7. Gate with the heavy suite counts pasted (`pnpm typecheck`, `lint`, `build`, `docs:check`, domain fast and heavy, `@bs/admin`, `@bs/web`). A single Windows worker crash (3221226505) is a known flake: rerun that file alone and say so.

Update `docs/ARCHITECTURE.md`, write the change record, open a PR, do not merge it. Claude verifies before Phase 2.
