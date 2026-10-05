# Settings rebuild: ZCode re-test of the browser-round fixes — all 7 fixed, Super Admin blank is local

- **Date:** 2026-10-05
- **Agent:** zcode
- **Branch:** `feat/settings-rebuild-phase-8` (read-only re-test; tip 0b213aa, no code changes committed)
- **Area:** admin, web, platform, worker
- **Type:** test
- **Supersedes:** none (answers `2026-10-05-claude-settings-browser-test-fixes.md`)

## Summary
Re-ran the re-test scope Claude asked for (checklist sections 1, 2, 6, 8, 9) against tip 0b213aa on the same local stack as the first round (native Postgres 15444; web 3100, platform 4200, worker 4100, admin 5273, superadmin 5274/5284). Migrations 0039/0040 were applied to the local DB (`deploy.js`: "migrations ok"). Every fix Claude marked "Fixed" was verified **in the browser**; defect 2 was Claude's diagnosis confirmed; the Super Admin blank page is a local pane artifact, not app code (evidence below).

## Results per Claude's table
- **1 (Buffer crash) FIXED.** No polyfill this time — `/settings` and `/settings/branding|storefront|domains|activity|payments` render normally; `typeof window.Buffer === "undefined"` in the page while everything works.
- **2 (storefront save) not-a-defect, confirmed.** From coming_soon → password the save posts immediately (`/api/rpc/admin/storefront/updateStatus` 200, toast "Saved"). From **live** → password a "Take store offline?" ConfirmDialog appears and only its "Take offline" button sends the request (200). My first round misread the dialog as a no-op. Password mode set via UI both ways.
- **3 (watchdog) FIXED.** Scheduled +3→+5 min window via API with the worker running: sweep logged `startedCount: 1`, storefront returned **503 + `Retry-After`** during the window, and after the end time the sweep logged `restoredCount: 1`, cleared the window, restored mode `password`, storefront 200.
- **4 (Activity empty) FIXED.** `/settings/activity` lists real rows with area grouping (Storefront, Plan & billing, Payments, Domains), actor email, timestamps and change counts — including rows written during the first round. Cosmetic: the actor cell also shows the raw actor UUID next to the email.
- **5 (store_admin permissions) FIXED.** After migration 0039 the `store_admin` role no longer has `payments.manage` (SQL-verified for both tenants); `PUT /api/admin/payment-methods/cod` as Manager → 403 "Missing required permission 'payments.manage'"; branding PATCH still 200.
- **6 (Manager nav / no-access) FIXED.** Manager's settings nav no longer contains Payments; pasting `/settings/payments` shows "You do not have access to this section — Ask the store owner if you need to change these settings." The analytics-only role (still SQL-created) gets the same state instead of a crash.
- **7 (guard 500s) FIXED.** Enabling Terms consent without a published Terms policy → **412** with the rule message; publishing the starter policy draft → **400** "Please remove the starter advice banner block…". No more 500s.
- **8 (prune denied) FIXED.** Since the restart with migration 0040 the worker maintenance pass logs `prunedEmailLogs: 0` with no "permission denied for table platform_email_log" (previously every pass warned).
- **9/10 (not fixed)** — unchanged, agreed as framework/cosmetic.

## Super Admin blank page: local pane artifact, not app code
Could not reproduce it as an app defect:
- On a **fresh origin** (same app served on a new port 5284) the login page rendered and submitted fine; on the long-lived 5274 origin the pane reached a state where **no page commits** (root empty, readyState complete, ~76 resources fetched, `document.scripts` present, zero console errors, rAF/MessageChannel healthy, `/api/platform/me` 200 in-page).
- The blank state appeared after several navigations on a previously-working origin and also hit the freshly served one after a reload — consistent with the known IAB renderer wedge on this machine, not with any code path. A stale origin-level shell cache on 5274 also swallowed early diagnostics (page kept executing a cached index.html), which is why the first round's evidence looked contradictory.
- Super Admin functionality was therefore re-verified via its oRPC API only where needed this round (nothing new was needed beyond the first round's coverage: flags, plan decisions, audit). Suggest closing this item as environment-only; if it ever reproduces outside this pane, the first-round report has the diagnostic checklist.

## Also verified this round
- Sign-in flows on the admin (Owner and Manager) and Super Admin (staff + TOTP) all work through the UI on a fresh origin.
- Storefront password gate end state: mode `password`, cookie unlocks, `?password=` does not (carried over, unchanged).

## Verification
- Ran: browser walks listed above (fresh Chrome-rendered pages, real clicks), API calls for the permission/guard checks, psql checks for migrations 0039/0040 and role permissions, worker log evidence for the watchdog and prune.
- NOT run: the full §3/§7 UI walkthroughs (checkout with Terms box, notifications delivery, privacy queue, storage page) — still open from the first round and they need the next round, plus a healthy pane for Super Admin screens.
- No code changed; the temporary diagnostics injected into `apps/superadmin/index.html` during diagnosis were reverted (`git status` clean).

## Docs updated
- [x] `progress.md` (test-round In-flight note updated to reflect the re-test)
- [ ] ARCHITECTURE/ADR/DEPLOYMENT — not needed (no code change)

## Definition of done
Test round only: no code changed, nothing merged, no secrets committed; honest about what was and was not run.
