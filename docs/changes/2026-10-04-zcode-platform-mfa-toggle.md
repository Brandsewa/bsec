# Super Admin toggle: platform staff TOTP can be turned off (local-friendly)

- **Date:** 2026-10-04
- **Agent:** zcode
- **Branch:** `feat/superadmin-themes` (not merged yet; worktree `C:\dev\bsec-themes`)
- **Area:** db, domain, contracts, platform, superadmin, docs
- **Type:** feature
- **Supersedes:** none

## Summary
Platform staff always had to enrol a TOTP authenticator and confirm a code at every sign-in — right for production, painful for local stacks and quick support logins. There is now a Super Admin toggle (Platform Staff → "Two-factor authentication (TOTP)") that a platform owner can use to make TOTP optional platform-wide. Locally (`APP_ENV=local`) it is optional by default whenever no explicit choice was saved, so fresh dev stacks never force the authenticator dance; production keeps requiring it unless the owner explicitly turns it off. The setting is an audited, owner-only change.

## What changed
- **Migration `0031_platform_settings.sql`** (expand-only): single-row `platform_settings` table (`id='default'`, `require_staff_mfa boolean default true`, `updated_by`/`updated_at`), SELECT for `app_rw`, ALL for `app_platform`, journal entry idx 29 (`when` 1791000000000). The row is deliberately **not** inserted by the migration.
- **Domain** (`packages/domain/src/platform-services.ts`): new `isStaffMfaRequired(db)` — an explicit row wins; absence means `APP_ENV !== "local"`. `assertPlatformStaff` consults it: with MFA optional, only the active-staff check remains (role checks unchanged). `getPlatformLoginStatus` now also returns `mfaRequired` and reports `mfaComplete: true, sessionValid: true` for active staff when MFA is off.
- **Domain service** (`packages/domain/src/platform/settings.ts`): `getPlatformSettings` (view incl. `explicit` flag + last-changed email) and `updatePlatformSettings` (platform_owner only, transactional, audited `platform_settings.update` with `{requireStaffMfa: {from, to}}`). Disabling sets `users.two_factor_enabled = false` for all active staff so Better Auth stops challenging at sign-in; enabling re-arms it **only** for users with a verified authenticator (secrets/verified records are never touched), and `assertPlatformStaff` refuses sessions created while MFA was off once it is on again.
- **Contracts + platform**: `platformSettingsContract` (`GET/POST /platform/settings`) wired as `settings` in `platformContract`; handlers in `apps/platform/src/app.ts` (get: any staff, update: `requireStaff("platform_owner")`).
- **Super Admin**: `Login.tsx` only forces authenticator enrolment when `mfaRequired` is not false; the Platform Staff page gained the toggle card (state pill, last-changed info, owner-only action with a confirmation dialog explaining the direction).
- Docs: ARCHITECTURE.md §Hard-rules item 7 updated.

## Decisions and trade-offs
- **No env override**: the environment decides only the *absence* default; the row (the toggle) is the single source of truth once written. Keeps production behaviour unchanged (default required) while local stacks start optional.
- **Flag flip instead of a Better Auth hook**: Better Auth challenges every user with `two_factor_enabled`; clearing the flag is the supported way to stop the challenge. TOTP secrets and `two_factors.verified` survive both directions, so re-enabling restores the same authenticators with no re-enrolment. Sessions created while MFA was off are refused after re-enabling (they predate `mfa_verified_at`), so re-enabling always costs one fresh password + code sign-in.
- Owner-only updates: security posture is the owner's call (per the roles agreement), stricter than email settings' `platform_admin`.

## Verification
- Ran: `pnpm typecheck` 15/15, `pnpm lint` 15/15, `pnpm build` 6/6. Tests added: `packages/domain/test/platform-settings.int.test.ts` (5 cases: env defaults incl. `APP_ENV=local`, explicit row wins, owner-only, flag flips + audit, re-arm semantics), `apps/platform/test/http-mfa.int.test.ts` new end-to-end case (password-only sign-in works while off, enrolled user skips the challenge, re-enable refuses password-era sessions, 2 audit rows), `rbac.int.test.ts` MIN_ROLE entries (`settings.get` support, `settings.update` owner), `audit-coverage.int.test.ts` case (`settings.update` → `platform_settings.update`).
- NOT yet run at the time of writing: `pnpm --filter @bs/domain test:heavy` and the platform suite (run right after this record; results land in the PR description). Browser check of the toggle + password-only login on the local Docker stack happens after the image rebuild.
- Deployed locally by rebuilding the platform + superadmin images of the `bsecvmm` stack from this worktree (see the VMM change record for the stack).

## Docs updated
- [x] `docs/ARCHITECTURE.md` (hard rules item 7)
- [x] `progress.md` (In-flight claim already covers this branch; goal line updated)
- [ ] ADR — not needed (small feature, documented here + ARCHITECTURE)
- [ ] `DEPLOYMENT.md` / RUNBOOK — not needed

## Follow-ups and open questions
- Consider per-staff MFA exemptions later (`platform_staff.mfa_required` exists but is currently only set at invite time).
- The enrolment screen is skipped entirely while MFA is optional; staff who want an authenticator can still enrol from their profile later (no UI for that yet — follow-up).

## Definition of done
Gates listed above; no generated or secret-bearing files in the diff (the migration/schema/service/contract/UI/tests/docs only). Local-only credentials unchanged.
