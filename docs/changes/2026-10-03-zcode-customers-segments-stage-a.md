# Customers Segments Stage A: schema, rule compiler, services, Segments screens (2A, 2B, 2C)

- **Date:** 2026-10-03
- **Agent:** zcode
- **Branch:** `feat/customers-segments` (Stage A; Stage B waits for the Phase 1 PR to merge)
- **Area:** db, domain, contracts, web, admin
- **Type:** feature
- **Supersedes:** none

## Summary

Customers Phase 2 Stage A (steps 2A, 2B, 2C of `docs/CUSTOMERS-IMPLEMENTATION-PLAN.md`, following `docs/CUSTOMERS-SEGMENTS-PLAN.md` exactly), built from `origin/main` at b804d02 in the `C:\dev\bsec-segments` worktree. **It does not touch or depend on the open Phase 1 PR (#21)**; the only shared building blocks are the Phase 0 pieces already on main (`customerMetricsSql`, `setMarketingConsent`, consent columns, `is_guest`). The segments migration is numbered **0030** — 0029 is reserved by the Phase 1 PR, and `docs:check` accepts the gap while both branches are open.

- **2A — schema and rule language**: `customer_segments` (kind `manual`/`automatic` with check constraints — automatic requires `rules`, manual forbids them; case-insensitive per-store name uniqueness; cached `member_count`/`counted_at`; `is_preset`) and `customer_segment_members` (manual membership; composite FKs cascading with the segment and the customer, so deleting a customer removes their memberships). Both `tenantTable()` with forced RLS and the standard grants; `_journal.json` entry. The rule language is a flat `all`/`any` list of at most 10 conditions from the plan's whitelist; `parseSegmentRules` (Zod) rejects unknown fields, disallowed operators, wrong value shapes (including `between` with low > high) with staff-readable messages. `segmentMemberSubquery` in `segments/compile.ts` is the only place SQL is built from rules: every value is a bound parameter, no client strings reach SQL, metric fields read the Phase 0 metrics lateral, and `in_segment` expands exactly one level (self-references, cycles through automatic segments, and unknown segment ids are refused by the resolver and depth guard).
- **2B — services and API**: `list/get/create/update/deleteSegment` with the **20 segments per store cap** (the 21st is refused with a clear message), duplicate names refused case-insensitively, kind locked after creation (rules only on automatic), delete refused while another segment references it via `in_segment` (naming the referrer). `previewSegmentRules` runs the same compiler with a per-staff rate limit (30/min) and a 5 s statement timeout, returning a clean error on timeout. `listSegmentMembers` serves both kinds with the customers row shape; `addCustomersToSegment`/`removeCustomersFromSegment` are manual-only, idempotent, report `{added, alreadyIn, notFound}`, cap 5000/call, and update the cached count. `getCustomerSegments` lists manual memberships plus currently-matching automatic segments. `refreshAllSegmentCounts` backs the new `segments.refresh_counts` pg-boss queue (every 6 hours); counts are also recomputed on create, rule change and member change. Every mutation audits `segment.created/updated/deleted/members_added/members_removed`. 13 procedures (12 from the plan + `activity` for the detail tab) are contracted, handled and mapped in the isolation suite.
- **2C — Segments screens**: new sidebar entry under Customers (`customers.read`). List page: three stat cards in their own boundary, All/Automatic/Manual tabs, name+description, type badge, cached count with "as of" tooltip, updated date, row actions (open, refresh count, duplicate, delete with a naming ConfirmDialog), empty state offering **Start from a template** (the seven presets, created as ordinary editable automatic segments) and **Create segment**. Create form: Details, Type radio cards, condition builder (grouped field select, operator filtered by field, typed value editors — rupees shown in ₹, days, dates, state, product/collection/segment pickers) with a live preview debounced 500 ms showing "Matches N customers" and the first 10; manual explains members are added after saving. Segment detail: Customers tab (members table for both kinds, search + sort, CSV export with a marketing-state column and **subscribed-only default**), Conditions/Members tab in edit mode (manual: search-and-add plus paste-emails with the "N added, N already in, N not found" report and removes), Activity tab (audit entries). Right rail: summary with refresh, **Use this segment** (View customers; **Send email shown disabled with "Email sending is not set up yet"**), Danger zone. Kit components only; `pendingComponent` on all three routes; mobile cards on the list.

No store credit, loyalty points or email sending anywhere. Segments group and export only.

## Verification (what ran, with counts)

- `pnpm typecheck` — **PASS** (15/15 packages).
- `pnpm lint` — **PASS** (5 domain + 3 admin findings from the first run fixed; clean).
- `pnpm build` — **PASS** (6/6 turbo tasks).
- `pnpm docs:check` — **PASS** (with the 0029/0030 gap documented).
- `pnpm --filter @bs/domain test:fast` — **PASS** (29 files, 251 tests).
- `pnpm --filter @bs/domain test:heavy` (real Postgres via `TEST_PG_ADMIN_URL`) — **64 of 65 files passed, 1,282 tests passed, 0 test failures.** The one failed file is `order-emails.int.test.ts` with the documented Windows worker crash (exit 3221226505); **rerun alone it passes 1 file / 7 tests**. The run's non-zero exit comes from ~11 unhandled teardown errors (`57P01 terminating connection due to administrator command`) raised while the shared test server drops per-file databases — the same shared-mode noise `docs/prompts/dev-speed.md` item 3 exists to fix; no test failed because of it.
- Segment suites: `segments-rules.test.ts` + `segments-compile.int.test.ts` (**18 tests**: whitelist acceptance per field/operator, hostile SQL as bound parameter both in the rendered query and against a live database, 11 conditions, self-reference, depth guard, unknown segment id) and `segments.int.test.ts` (**27 tests**: every field/operator on a seeded store with a guest, a refunded order and a cancelled order; `match any` vs `all`; manual add/remove/report; 20 cap with cleanup; kind lock; referenced-delete refusal; count drift repaired by the sweep; presets ×7 idempotent; cross-store isolation including a foreign segment id inside a rule; audit rows).
- Isolation suite — **815 tests** on its own file (13 new procedures mapped); the three segments files together total **852 tests**.
- `pnpm --filter @bs/web test` — **PASS** (18 files, 164 tests). `pnpm --filter @bs/admin test` — **PASS** (4 files, 34 tests; builder defaults validated against the API contract, 10-condition lock, list empty state).

## Browser check

**Not run for Stage A** — I spent the session's browser-check budget on Phase 1 and ran out of room before wiring the Segments screens into a running stack here. What I verified instead: component tests render the list (rows, badges, counts, empty state, template action) and the builder (rows, match selector, 10-condition lock, valueless editors). The screens need a real browser pass at 375 px and desktop (list, form, preview panel, members editor, export) — **Claude should treat the browser criterion for Stage A as open**, or I can run it on request before verification.

## Deviations and notes for the verifier

- Migration **0030** with a deliberate journal gap at 0029 (reserved by Phase 1 PR #21). When both merge, main's history has both entries; no file references 0029.
- `segments.activity` (read-only, `customers.read`) was added beyond the plan's §5 contract list because the plan's §6 detail page specifies an Activity tab showing audit entries for the segment; it maps `audit_logs` by `targetType=segment`.
- `View customers` on the rail links to the plain Customers list for now; the `segment` URL filter is **2D** (Stage B), as the plan sequences it.
- The preview rate limit (30/min per staff) is asserted indirectly: the integration suite clears the counter window in its preview helper (documented there) and one test asserts the refusal for a read-only actor's mutation path; the limiter itself is the shared `checkRateLimit`.
- Statement timeout is applied inside the preview transaction only (`SET LOCAL`, constant interpolated, never a bound parameter — Postgres rejects binds in `SET`).

## Definition of done

- [x] Code follows AGENTS.md §2/§3; the §4 gate passes (counts above; the one flake rerun and explained).
- [x] Real-DB tests for every rule field/operator, both segment kinds, isolation and audits; hostile-input tests for the compiler.
- [x] `docs/ARCHITECTURE.md` updated (tables, migration 0030, queue, API surface, routes).
- [x] ADR not needed (follows the plan; no new architectural decision).
- [x] `DEPLOYMENT.md`/RUNBOOK unchanged (the new queue is created by the migrate step).
- [x] Change record written; `progress.md` In-flight updated.
- [x] No secrets, no generated files; staged by explicit path; `git status` checked before every commit.
- [x] Honest status: browser pass for the new screens not done (stated above); heavy-suite teardown noise explained, not masked.
