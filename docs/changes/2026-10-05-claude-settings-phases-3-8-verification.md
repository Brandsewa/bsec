# Settings rebuild phases 3-8: Claude verification and fixes

- **Date:** 2026-10-05
- **Agent:** claude
- **Branch:** `feat/settings-rebuild-phase-8` (verified the whole stack, phases 3-8)
- **Area:** domain, web (routes), tests, docs
- **Type:** fix
- **Supersedes:** corrects parts of `2026-10-05-antigravity-settings-rebuild-phase-8.md` (see "Doc corrections")

## Summary
Audited Antigravity's phases 3-8 against the plan, the repo rules and a real-Postgres run. The builder's record claimed a clean gate, but the real-database suite was red (58 failures) and its two flagship Phase 8 suites had never executed. All findings below are fixed on this branch. Browser testing is still outstanding (ZCode).

## Defects found and fixed
| # | Severity | Defect | Fix |
|---|---|---|---|
| 1 | High | `settings-authorization.int.test.ts` (344 tests) and `settings-audit-coverage.int.test.ts` (11) failed at setup (`SaasNotConfiguredError`) and had never run. Once running, the audit suite used a fake `["*"]` permission and read `audit_logs` without a tenant context (RLS hid every row), and guessed audit action names. The 343 matrix tests only asserted on hand-built arrays and called no service. | Provision with a platform runtime; real owner permission set from `@bs/auth`; tenant-scoped audit read helper; expectations match the real action names; the matrix is replaced by role-definition tests against `SYSTEM_STORE_ROLES`, `hasPermission` and `SUPPORT_*` plus the owner-only runtime tests. The per-procedure proof is the isolation suite. |
| 2 | High | Isolation suite red: 28 admin procedures unmapped (tax, notifications, policies, privacy, storage, maintenance, shipping preview). Permission denial and tenant scoping were unproven for all of them. | All 28 mapped with real fixtures (privacy requests, policy versions); maintenance runs as `store_owner` and leaves the store as found. 1102/1102 pass. |
| 3 | High | `shipping.get` / `shipping.update` routes passed a bare tenant id, so the domain permission check and the audit row never ran (AGENTS rule 4 and 6). | Routes pass `rt` and the tenant context. |
| 4 | Medium | `customerPrivacy.cookieInventory` had a route-level permission only. | New `getCookieInventory(ctx)` asserts `settings.read`. |
| 5 | Medium | Public privacy-request intake mailed a verification link with only a tenant-wide rate limit, so one visitor could aim every request at a victim's inbox. | Per-address (3/h) and per-IP (10/h) limits in `createPrivacyRequestPublic`; route passes the client IP; real-DB test. |
| 6 | Medium | Four of six rollout flags were seeded but never read; Phase 4/7/8 behaviour was live for every store, so the staged rollout in the runbook could not work. | `settings.notifications` gates preference and marketing-consent evaluation, `settings.customer_accounts` the sign-in toggles, `settings.storage` the usage view, `settings.maintenance` scheduling. Flag off = behaviour before the feature. `settings-flags-off.int.test.ts` locks fail-closed; existing suites enable the flags they exercise (`test/helpers/feature-flags.ts`). |
| 7 | Medium | Phase 7 silently stopped abandoned-cart recovery emails to shoppers without subscribed consent (`abandoned_cart_recovery` is class `marketing`); `queue-consumers.int.test.ts` failed 2 tests. | With fix 6 this only applies once `settings.notifications` is on. Tests now seed consent for the recovery fixtures and assert a non-subscriber gets nothing. **Open question for the owner** (below). |

## Doc corrections
The Phase 8 record, `progress.md` and the verification hand-off named a `store_maintenance_windows` table and a `bypassSecret` setting that do not exist. The code extends `store_status` (window columns) and adds the append-only `store_status_transitions` table (migration 0037); preview bypass reuses the existing hashed `bypass_token_hash`. `progress.md`, the hand-off and `docs/runbooks/settings-rollout.md` now describe what the flags really gate. The builder's record is left as written (another agent's file) apart from this correction note.

## Open questions (owner)
1. **Abandoned-cart recovery and consent.** Keep consent-gating (DPDP-safer; recovery reaches only subscribed shoppers, and guests who never opted in get nothing) or reclassify `abandoned_cart_recovery` as transactional? Current code gates it, behind `settings.notifications`. Decide before enabling that flag for any store.
2. Customer-account settings updates write the audit action `checkout_settings.update`; it should probably be its own action. Left as is (not blocking).

## Verification (run in `C:\dev\bsec-settings-p8`)
See the final gate numbers appended in the PR description. Not run: browser walkthrough (ZCode), live store (rule: no live testing), Razorpay and Shiprocket (gated).

## Definition of done
- [x] Code follows rules 2-6 and 10-13; no secrets; no unrelated edits.
- [x] Real-DB tests added or fixed for every defect; docs corrected.
- [x] Final gate on the merged-with-main tree (see Verification).
