# Settings rebuild: fixes for ZCode's browser test round

- **Date:** 2026-10-05
- **Agent:** claude
- **Branch:** `feat/settings-rebuild-phase-8` (PR #38)
- **Area:** admin, auth, domain, db, docs
- **Type:** fix
- **Supersedes:** none (answers `2026-10-05-zcode-settings-browser-test.md`)

## Summary
ZCode's browser round found defects that the 1688-test code gate could not: the Settings pages crashed in a real browser, the maintenance worker could never act, and the Activity page was empty. Each defect was checked against the code first. Seven are fixed with a test that fails without the fix; one is not a defect, one is not reproduced, and the rest are listed under "Not fixed".

## ZCode defect -> result
| ZCode # | Verdict | What was wrong and what changed |
|---|---|---|
| 1 HIGH `/settings/*` "Buffer is not defined" | **Fixed** | `settings-nav.ts` imported `hasPermission` from `@bs/auth`, whose root also exports the Better Auth modules (pg, drizzle, postgres-bytea) into the browser bundle. New browser-safe `packages/auth/src/permissions.ts` (exported as `@bs/auth/permissions`); the root re-exports it. Admin imports the subpath. Verified: admin and Super Admin production bundles contain no pg or drizzle code. Test: `permissions-pure.test.ts` fails if that module ever gains an import. (The admin unit tests run in Node, which is why they never caught this.) |
| 3 HIGH maintenance watchdog never acts | **Fixed** | `executeMaintenanceWatchdogSweep` read `store_status` (forced RLS) with no tenant context as `app_rw`, so both queries returned nothing. It now visits each tenant under its own context, like the other sweeps. Test `maintenance-watchdog.int.test.ts` runs the sweep as the worker role: start a due window, restore after it passes, leave a future one alone. |
| 4 HIGH Activity page empty | **Fixed** | The page filtered on a hand-written list of action names that nothing writes (`tax_settings.update`, `custom_domain.add`...). Replaced by a prefix table (`SETTINGS_ACTION_AREAS`) matching the names the services really write, with new areas (Checkout, Customer accounts, Notifications, Policies, Customer privacy, Plan and billing). Test: every non-tenant audit action written in the audit suite must be listed under a named area, and the Payments filter works. |
| 5 HIGH `store_admin` seeded with owner permissions | **Fixed** | Provisioning and `create-owner` seeded `store_admin` with the full list including `payments.manage`, contradicting the owner's decision and ADR-020. Both now use `SYSTEM_STORE_ROLES`. Migration `0039` removes `payments.manage` from every existing `store_admin` role (per tenant, because `roles` is under forced RLS). Test provisions a store, checks the seed, restores the old seed, runs the migration as `app_owner` and checks again. **Existing stores' Managers lose COD/credential edit rights when this migrates; that is the owner-approved intent.** |
| 6 MEDIUM Manager sees Payments / generic error | **Fixed** | Follows from 5 for the nav. A pasted URL to a section the role may not use now shows "You do not have access to this section" (`canOpenSettingsPath` in the Settings layout). |
| 7 MEDIUM guard errors surface as 500 | **Fixed** | Domain messages without a status prefix map to HTTP 500. The policy, privacy, plan, domain and Terms rules now carry `Bad Request:` / `Not Found:` / `Conflict:` / `Precondition:` prefixes, so clients get a 4xx with the rule's message. |
| 8 LOW worker 90-day prune denied | **Fixed** | Migration `0040`: `app_rw` gets DELETE and column-level SELECT on `id` and `created_at` of `platform_email_log` only (still cannot read recipients). Test runs the prune as the worker role. The grants suite comment is updated. |
| 2 HIGH storefront "Save changes" no-op for non-live modes | **Not reproduced, needs ZCode to re-check** | In `storefront.tsx`, saving from a *live* store to any other mode opens a confirmation dialog ("Take store offline?") and only the dialog's "Take offline" button sends the request. That is intentional and looks like what was observed (no request, no toast). If the dialog really did not appear, send a screenshot and the console output. |
| 9 LOW validation before authorization | Not fixed | Framework behaviour (oRPC validates input before middleware). Valid payloads get the correct 403. |
| 10 LOW inline hint, generic "Triggered by" | Not fixed | Cosmetic; the inline hint comes from the shared `Field` component, so moving hints behind an (i) icon is a UI-kit change for its own PR. |

## Found while fixing (not in ZCode's report)
- **Access and credential changes were never audited** (AGENTS.md rule 6): inviting, revoking, changing a role and removing a member, and saving or clearing Razorpay credentials wrote no `audit_logs` row, so the Users and Payments history could never appear in Activity. Now audited: `staff_invitation.create/revoke`, `staff_membership.role_change/remove`, `razorpay_credentials.saved/cleared` (mode and "webhook configured" only, never a value, email or token). Test asserts no secret or address in the diff. Role change and removal share the same helper but are not exercised by a test (the suite has a single member); the invitation and credential paths are.

## Super Admin blank page after sign-in (ZCode environment note)
Not reproduced and not fixed. Super Admin never imported `@bs/auth` and its bundle is clean, so it is not the same cause as defect 1. `apps/superadmin/src/main.tsx` builds a new router on every render of `App`, which is worth a look but I could not confirm it as the cause without a browser. ZCode: re-test on this branch; if still blank, send the dev-server console, the failing network call and whether `/rpc/...me` returns 200.

## Open questions (owner)
1. ~~Custom roles~~ **Decided (owner, 2026-10-05): deferred.** There is no UI or API to create them; the Analytics-only role ZCode tested exists only by SQL. Future browser rounds should test with Owner and Manager only, plus that SQL role if wanted.
2. ~~Per-store flag overrides~~ **Decided (owner, 2026-10-05): instead of a Super Admin override screen, give the store owner an "Update available" prompt (Update now / Don't update).** See "Follow-up" below.

## Verification (merged tree, `C:\dev\bsec-settings-p8`)
- `pnpm typecheck` 15/15, `pnpm lint` 15/15, `pnpm build` ok, `pnpm docs:check` ok.
- `pnpm test:heavy:local`: 77 files, 1695 tests; 1688 passed on the first run and the one file killed by the known Windows worker crash (`3221226505`, `settings-authorization.int.test.ts`) passed 7/7 alone.
- Domain fast 320, admin 70, web 166, auth 7, db 41, contracts 20, platform 80 (`--no-file-parallelism`) all pass.
- Not run: the browser. ZCode should re-walk checklist sections 1, 2, 6, 8 and 9 (Settings load, Storefront save, Manager and Analytics-only, Maintenance with the worker, Activity).

## Definition of done
- [x] Rules 2-7, 9-10 respected; migrations append-only (0039, 0040), journal entries increasing.
- [x] A real-DB or unit test for each fix; docs (ARCHITECTURE migrations and auth notes) updated.
- [ ] Browser re-test by ZCode (checklist sections above).

## Follow-up: owner "Update available" prompt (owner decision 2026-10-05)
- New flag `settings.update_offer` (migration 0041, default off). While it is on for a store, the **owner only** sees an **Update available** banner at the top of Settings. The dialog lists the six features and offers **Update now** or **Don't update**. Don't update only closes it (the banner stays). Update now writes per-store overrides for all six `settings.*` flags as one bundle, in one transaction with a `settings.update_applied` audit row; other stores are untouched. No undo in the UI; rollback is the Super Admin kill switch.
- Domain `admin/settings-update.ts` (`getSettingsUpdate`, `applySettingsUpdate`), contract `admin.settingsUpdate.get/apply`, handlers in `api.ts`, UI `components/settings/settings-update.tsx` mounted in the Settings layout. `apply` needs `settings.manage` and the `store_owner` role in the domain service, and is refused (503) until the platform opens the offer.
- Tests: `settings-update.int.test.ts` (offer off refuses; owner-only; bundle applied for this store only; audited; idempotent), isolation mappings for both procedures, admin banner rendering tests.
- Runbook section 4 rewritten: it described a Super Admin "Features & Overrides" tab that does not exist. Pilot: insert the offer override for one store by SQL; later open `settings.update_offer` globally.
- Known edge: if the platform's kill switch is on for one of the six flags, Update now cannot turn that feature on, and the banner keeps showing for it.
- Added section 10 to the ZCode checklist for this prompt.
- **Incident:** uncommitted edits in this worktree were wiped once by a `git reset --hard` (reflog `reset: moving to HEAD`) while ZCode was also using it; I redid them. AGENTS.md rule: each agent has its own worktree.

## Review of Antigravity's browser round (`2026-10-05-antigravity-settings-browser-test.md`, tested tip 225acd2)
Antigravity ran sections 1-10 in headed Chrome and found 3 defects; I checked each against the code.
- **Defect 3 (HIGH), confirmed and fixed: no admin toggle for "Require agreement to Terms".** The setting, the server check and the storefront box all existed, but a merchant could not switch it on. Added the switch to Settings -> Checkout (section renamed "Consent at checkout"). The admin test asserts it renders.
- **Defect 1 (Medium), confirmed and fixed: native `<select>` store switcher** in `routes/_store.tsx` (older than this rebuild). Now `SimpleSelect`; `e2e/admin.spec.ts` switches store by clicking the trigger and the option (e2e runs only on `main`, so that spec has not been run).
- **Defect 2 (Low), cause found and fixed:** the 375 px overflow is the page header (store name wrapping, switcher, "Password" and "Sign out"), not the Settings index. Brand now truncates, the switcher has a fixed narrow width, and "Password" is icon-only below `sm`. Not re-measured in a browser: Antigravity should re-check `scrollWidth <= clientWidth` on `/settings`.
- **What the report does not prove:** the Terms-box path (box shown, Place Order refused without it, acceptance stored) was impossible to test without the toggle, and the report marks only the plain notice. The report's quoted no-access text ("You don't have permission to view this page") is a paraphrase; the screenshot shows the real text, "You do not have access to this section". Everything else is backed by screenshots or behaviour I could cross-check, but no query output is attached for the privacy export/erasure and credit-note claims.
- **Still to re-test in a browser:** Terms ON end to end (publish Terms, turn the switch on, checkout with and without the box, replay without `termsConsent`, check the order row), the mobile header at 375 px, the store switcher.
