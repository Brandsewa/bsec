# Customers Segments Stage B: customers integration (2D), rich tables, Stage A fixes

- **Date:** 2026-10-04
- **Agent:** zcode
- **Branch:** `feat/customers-segments` (same PR as Stage A)
- **Area:** db, domain, contracts, web, admin
- **Type:** feature
- **Supersedes:** none

## Summary

Customers Segments **Stage B** (step 2D), plus the fixes and table upgrades found in Stage A's browser check. Built with the owner's explicit instruction to proceed without waiting for Phase 1's PR: **`feat/customers-phase-1` was merged into this branch** (merge commit `1e56905`), so this PR now contains Customers Phase 1, Segments Stage A and Stage B together for one review.

## What changed

1. **Stage A fixes (from the Stage A browser check)** — segment detail header: the type badge no longer truncates beside "Done editing" at 375 px (badge wraps, name truncates); the header count is singularised; `?edit=1` from the create form deep-links into edit mode.
2. **Rich tables** — the segment detail's Customers tab was a hand-rolled table; it is now the orders-style kit stack: `DataTable` with row checkboxes and sortable headers, `TableToolbar` (search, sort, subscribed-only export toggle, Export CSV), `BulkBar` with Export-selected and — for manual segments in edit mode — **bulk remove** with a confirm dialog, URL-state search/sort, server-side paging, mobile cards. The **Segments list** gained the same selection pattern with a bulk delete (naming ConfirmDialog, sequential delete, per-segment error toasts).
3. **2D — customers integration**:
   - `admin.customers.list` gains `segmentId`; the domain filters by manual membership or the compiled automatic rule query via a new exported `segmentMembershipSubquery` helper (segments service) that fails closed on a segment id not belonging to the store. The filter combines with all other list filters.
   - Customers list UI: **Segment** filter (`segment` URL param — the param reserved in Phase 1) with store-wide options and a named chip; bulk action **Add to segment** opens a dialog to pick a manual segment or **create-and-fill a new one**, reporting "N added, N already in, N not found".
   - Customer detail: **Segments card** via `segments.forCustomer` — manual memberships with a remove button (confirm), automatic matches as read-only chips linking to the segment.
4. **Post-merge correctness fix** — Phase 1 replaced the per-customer metrics lateral with a grouped subquery that must be joined on `metrics.customer_id = customers.id`. `segmentMemberSubquery` and `listSegmentMembers` still used `LEFT JOIN … ON true`, which fanned out member lists and counts (found immediately by the segment suite: a 3-member list reported 21). Both joins fixed; all suites green.

No new pg-boss queues, no new migrations, no new procedures (the filter is a parameter on the existing `customers.list`; the card reuses `segments.forCustomer`), so the isolation-suite map is unchanged.

## Verification (what ran, with counts)

- `pnpm typecheck` — **PASS** (15/15 packages, on the merged branch). `pnpm lint` — **PASS**. `pnpm build` — **PASS** (6/6 tasks). `pnpm docs:check` — **PASS**.
- `pnpm --filter @bs/domain test:fast` — **PASS** (29 files, 251 tests).
- `pnpm --filter @bs/domain test:heavy` (real Postgres) — **65/66 files, 1,397 tests, 0 failures.** The one failed file is `segments-compile.int.test.ts` with the documented Windows worker crash (exit 3221226505); **rerun alone it passes 1 file / 5 tests**. The run's non-zero exit remains the ~11 shared-server teardown `57P01`s, not failing tests.
- Segments suite — **29 tests** (27 previous + 2 new 2D cases: filter by manual segment, by automatic rules, combined with other filters, foreign segment id fails closed).
- `@bs/admin` — **5 files, 43 tests** (new: the segment param → `segmentId` API mapping and chip; the detail Segments card rendering manual memberships, automatic chips and the read-only note).
- `@bs/web` — **18 files, 164 tests**.

## Browser check (1280 px and 375 px, local demo store, this branch's dev servers)

- **Customers list**: Segment filter renders in the toolbar; picking "Marketing subscribers" shows exactly Meera Das with a "Segment: Marketing subscribers ×" chip and "1–1 of 1"; Clear filters resets. Ticking a customer and using **Add to segment → name a new segment** created "GUI 2D picks" and reported "Added to segment: 1 added."; adding two more via the picker reported "1 added" (the third attempt with an unpicked segment correctly refused with "Pick a segment or name a new one." — the empty-selection guard). Verified the toast and counts on the segment.
- **Customer detail (Meera)**: Segments card shows the manual membership "GUI 2D picks" with a Remove button and the automatic matches ("Marketing subscribers", "New customers") as read-only chips linking to the segment; remove confirmed and the card refreshed.
- **Segment detail rich table**: checkbox column, toolbar (search, sort, subscribed-only toggle, Export CSV), ticking a row shows the BulkBar with Export selected and **Remove from segment** (edit mode, manual); bulk remove confirmed and counts stayed consistent (header count, empty state after removing the only member).
- **Fixes confirmed**: header badge no longer truncates at 375 px ("Automatic" wraps fully); "1 customer" singular; `?edit=1` deep-link.
- **Not drivable in the browser**: CSV download saving (no download support in the test browser; server round-trip covered by integration tests). Console logs not collectable in this runtime; no visible error states occurred. One deliberate behaviour noted: the stats strip stays store-wide while the list is filtered by segment (stats are independent of filters, matching the Orders page).

## Definition of done

- [x] Gate passes (counts above; the one flake rerun alone and explained).
- [x] Real-DB tests for the filter (manual/automatic/combined/foreign-fail-closed); component tests for the new UI.
- [x] `docs/ARCHITECTURE.md` current (no structural changes in 2D; table/migration/queue entries already updated in Stage A).
- [x] Change record written; progress.md In-flight updated.
- [x] No secrets, no generated files; explicit-path staging.
- [x] Honest status: everything above was run; CSV download saving not drivable in the test browser.
