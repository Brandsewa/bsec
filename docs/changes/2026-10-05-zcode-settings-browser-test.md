# Settings rebuild (phases 3-8): ZCode browser test round — 4 defects found, round partially blocked

- **Date:** 2026-10-05
- **Agent:** zcode
- **Branch:** `feat/settings-rebuild-phase-8` (read-only test round; branch tip a898858, no code changes committed)
- **Area:** admin UI, web, platform, worker
- **Type:** test
- **Supersedes:** none

## Summary
Ran the browser test checklist in `docs/prompts/settings-browser-test-zcode.md` against a local stack built from this worktree. Found 4 defects that block large parts of the checklist (settings crash, storefront status save no-op, dead maintenance watchdog, empty Activity page) plus several smaller findings. Because two defects break the primary UI paths, many checklist items were driven through the same HTTP APIs the UIs call instead; these are marked per item below. No code was fixed (per the checklist's ground rules).

## Environment (local only, reproducible)
- Docker Desktop engine was wedged on this machine (docker CLI hangs, container port-forward accepts TCP but queries never complete — also affected other agents' containers). Ran a **native PostgreSQL 16.15** instead (the installed `postgresql-x64-16` binaries) on `127.0.0.1:15444`, db `bsec`, bootstrapped/migrated with `packages/db/dist` bootstrap.js + deploy.js (roles ok, migrations ok).
- Dev servers from this worktree: web **3100**, platform **4200**, worker **4100** (health), admin **5273**, superadmin **5274** (host ports 3000/5173 were occupied by another worktree's dev servers). Root `.env` (uncommitted) with BETTER_AUTH_URL=http://127.0.0.1:3100, ADMIN_ORIGINS :5273, SUPERADMIN_ORIGINS :5274, PREVIEW_BASE_URL etc.
- Data: store `zcode-test` (created via Super Admin API; owner invite accepted via `/api/saas/invite/accept`), demo store seeded (10 products). Users: owner@zcode.local (owner), manager@zcode.local (store_admin), analyst@zcode.local (role `analytics_viewer` with `{analytics.read}` — **created by direct SQL INSERT into `roles` because no UI or API exists to create custom roles**; see open questions). MFA platform staff enrolled programmatically.
- All 6 flags enabled globally via `POST /rpc/features/update` (settings.notifications, settings.customer_accounts, settings.storage, settings.maintenance, settings.policies, settings.gst_v2).
- To make the admin loadable at all I used a **temporary, uncommitted** Buffer/util polyfill (see defect 1); it was reverted after testing (`git status` clean).

## Defects
1. **HIGH — `/settings/*` crashes with "Buffer is not defined" on a fresh checkout.** `apps/admin/src/components/settings/settings-nav.ts:3` imports `hasPermission` from `@bs/auth`; @bs/auth's better-auth/drizzle dependency chain pulls `pg`/`drizzle`/`postgres-bytea` into the browser bundle (`postgres-bytea` runs `Buffer.from` at module scope; `pg` also needs node `util`). Reproduced after clearing `apps/admin/node_modules/.vite/deps` — not a stale cache. Every settings page shows the error boundary. Suggested fix: make `settings-nav.ts` import from a client-safe module (or move `hasPermission`/`StorePermission` there). During testing I unblocked it with a dev-only Buffer+util polyfill (index.html script + vite alias + `buffer@5.7.1` dev-dep), all reverted since.
2. **HIGH — Storefront "Save changes" is a silent no-op unless the target mode is "live".** Selecting Password protected / Coming soon / Maintenance and clicking Save changes sends no network request, no toast, no console error (verified with real keyboard input via CUA + a fetch hook). Only the "Take my store live" path saves. The API (`PATCH /api/admin/storefront/status`) accepts the same changes fine, so password mode was set via API for the rest of the round. File: `apps/admin/src/routes/_store/settings/storefront.tsx` (for Claude to pin down).
3. **HIGH — Maintenance watchdog can never act (RLS).** Scheduled a window (+3 min → +5 min): the worker's `maintenance.watchdog_sweep` ran every minute with `startedCount: 0` while the window was due, and the window silently lapsed; the storefront never went 503 and never auto-restored. `packages/domain/src/storefront/lifecycle.ts:1025` (`maintenanceWatchdogSweep`) selects `storeStatus` (a tenant table with forced RLS) **without** a tenant context; the worker connects as `app_rw`, so both the "expired" and "due" queries always return zero rows. Direct mode changes via the API do work (503 + `Retry-After` observed).
4. **HIGH — Settings → Activity shows "No activity recorded" although audit rows exist.** `audit_logs` for the tenant contains 15 rows from this session (store_status.update, domain.add/remove, payment_methods.cod_update, plan_change.requested, store_status.schedule_maintenance) but the Activity page renders the empty state — the page's query/filter does not match what is written.
5. **HIGH (data) — seeded `store_admin` role holds the same permission array as `store_owner`, including `payments.manage`.** Manager therefore **can** save COD fee/limits (`PUT /api/admin/payment-methods/cod` → 200, persisted) and only fails Razorpay on input validation — contradicting the owner-approved delegation matrix (payments owner-only) and checklist §6. Also explains defect 6. `store_admin` should be re-seeded without owner-only families.
6. **MEDIUM — Manager sees "Payments" in the settings nav** and gets a generic "Could not load payment methods / Something went wrong" there instead of a clear no-access state (direct-URL no-access state per checklist §1 is not met for this page).
7. **MEDIUM — guard errors surface as 500 "Internal server error" instead of clear refusals.** Two instances: publishing a starter policy draft that still contains the advice banner / placeholders → 500 (the domain rule message "Please remove the starter advice banner block…" exists but is unmapped); enabling Terms consent with no published Terms policy → 500 (rule message exists: "publish your Terms policy first"). Clients should get a 4xx with the rule message.
8. **LOW — worker 90-day prune fails:** `DELETE FROM platform_email_log …` → permission denied (`app_rw` has SELECT-only per `packages/db` grants; see `packages/domain/src/system/platform-mailer.ts:322`). Logs a warn and continues; retention never runs.
9. **LOW — validation-before-authz:** invalid payloads can get 400 before the 403 (e.g. analyst COD PUT). Valid payloads correctly get 403.
10. **LOW (cosmetic) —** branding tagline hint is inline text, not an (i) popup (owner preference); storefront transition log "Triggered by" shows generic "staff"; policy publish was also the only way to discover the advice-banner rule because the UI copy doesn't mention it.

## What passed (evidence)
- §1 Owner nav matches `settings-nav.ts`; analyst sees zero settings links; no native `<select>` on settings pages; 375 px: no horizontal overflow (branding page); dark mode renders (body bg #131815); settings pages survive reload.
- §2 Branding: contrast warning appears (1.00:1 for #fff on #fff); colours save and the header updates to "last published"; branding save publishes. Storefront: coming-soon holding page 200 with Opening Soon + notify ✓; maintenance 503 + `Retry-After: 86399` + maintenance screen ✓; password mode via API: wrong refused / right unlocks; `?password=` in URL does **not** unlock (replayable token gone ✓); `bs_store_password` cookie unlocks ✓. Domains: add (RPC 200) + DNS instructions + local "provider not configured" state ✓; remove via ConfirmDialog (not window.confirm) ✓.
- §4 Plan & billing: owner request-change → open; platform `plans/listRequests` sees it; `plans/decideRequest` declines; store view 200. No self-service payment UI.
- §5 Shipping: rates stored in paise (₹99); default zone present; admin preview matches storefront `/api/storefront/cart/estimate-shipping` (Standard ₹99, 3-7 days, KA/560001). Taxes: valid GSTIN (29…, Karnataka) saved; bad format → clear 400; state mismatch → clear 400 ("GSTIN state code 27 … does not match registered seller state 'Karnataka'"); default tax class delete refused (409).
- §6 Manager: maintenance schedule 403 "Only store owners can schedule maintenance" ✓; invite 403 ✓; plan request 403 ✓. Analyst: settings.read/branding/activity 403 with permission names, no secrets or stacks in bodies ✓.
- §8 Storage flag-off / quota page: NOT tested (see below). Platform audit log shows flag changes and the plan decision ✓ (`platform_audit_logs`).

## NOT tested / not covered
- Logo/favicon uploads (R2 not configured locally → uploads answer "not set up"; IAB file chooser also unsupported) — wrong-type/oversize refusals untested.
- Super Admin authenticated screens (see below), full §3 storefront checkout walkthrough incl. terms consent box and marketing checkbox, customer accounts flag-on/off matrix, notifications delivery-log behaviour, privacy request rate limit + export/erase queue, storage page usage/quota, focus-ring/focus-trap audit, two-tab stale-write conflict, throttled-network loading states — these need the UI fixes above and/or a working Super Admin; not run, not claimed.
- Manager storefront/checkout/shipping/taxes UI saves (allowed by matrix) were verified at API level only where noted.

## Environment note for Claude
Super Admin (5174-equivalent) rendered `/login` fine but the **authenticated layout commits nothing** (blank page, no console errors, healthy rAF/MessageChannel/session). Reproduced in fresh tabs and after a dev-server restart, while the admin SPA renders fine in the same browser — so it is app-specific, not only the known local pane wedge. Suspect the same browser-incompatible dependency chain as defect 1 in a different failure mode; worth a look when fixing defect 1. All Super Admin checks were done via its oRPC API instead.

## Verification
- Ran: everything listed above against the local stack; DB state checked directly via psql where noted (`audit_logs`, `roles`, `storeStatus`).
- Exercised by hand: admin UI as Owner and Manager (settings nav, branding, storefront, domains, activity, users screens), storefront via curl (mode gates, shipping estimate), platform API (flags, tenants, plan requests/decision, audit).
- NOT verified: the items in the previous section; no automated tests were added; no code changed (only the reverted temp polyfill).

## Docs updated
- [x] `progress.md` (In-flight note for this test round)
- [ ] ARCHITECTURE/ADR/DEPLOYMENT — not needed (no code change)

## Follow-ups and open questions
- There is no UI/API to create custom roles (checklist §0 step 3 assumes one exists in Settings → Users). Owner decision needed: is custom-role management deferred (phase 2 §3.2 delegation?) — until then the analytics-only role can only be created by SQL.
- Defect 5 fix needs a migration/seed change for `store_admin` (and possibly a re-grant step for existing installs) — owner call since it changes existing roles.

## Definition of done
Test round only: no code changed, nothing merged, no secrets committed; findings recorded above; honest about what was and was not run.
