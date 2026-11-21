# Account and Profile pages for store staff, platform staff and shoppers (phases 1 to 3)

- **Date:** 2026-11-21
- **Agent:** claude
- **Branch:** `feat/accounts-profile` (not merged)
- **Area:** db, domain, contracts, auth, admin, superadmin, platform, web, docs
- **Type:** feature
- **Supersedes:** none (builds the plan in `2026-11-21-claude-accounts-profile-plan.md`)

## Summary
A dedicated, tabbed Account page for each audience, replacing the password-only menus. Design, decisions and deviations: `docs/ACCOUNTS-PROFILE-PLAN.md` (section 11) and ADR-049 (Proposed).

- **Store staff** (`apps/admin` `/account`): My profile (name, job title, phone, timezone, date and time format, landing page, density, mute-able alerts, read-only access) and Security (password, optional authenticator with QR and backup codes, sessions, security activity). Login gets the second step. Home shows a dismissible nudge to turn the authenticator on.
- **Shopper** (`apps/web`): `/account/security` (devices with sign-out, password, activity), verified badges, SMS and WhatsApp consent, link to the existing privacy request page.
- **Platform staff** (`apps/superadmin` `/account`): Profile, Security (password, backup codes, sessions, activity), Role and access (read-only, support-session indicator), Activity (own audit rows).

## What changed
- Migrations 0116 (user preferences, `security_events`, `user_notification_mutes`), 0117 (`customer_security_events`, SMS/WhatsApp consent), 0118 (`staff_two_factors`, `users.store_two_factor_enabled`). All expand-only; checksums recorded.
- Domain: `account/{profile,security,notification-prefs,device}.ts`, `customers/security.ts`, `platform/account.ts`; dispatcher drops people who muted a non-locked alert.
- Contracts: `admin.account.*`, `platform.account.*`. Web handlers in `apps/web/src/server/api.ts`; platform in `apps/platform/src/app.ts` (session id added to the platform context).
- Store auth instance now uses the Better Auth `twoFactor` plugin mapped to `staff_two_factors`; rate limit on the second-factor endpoints.
- New dependency: `qrcode@1.5.4` (+ `@types/qrcode`) in `apps/admin`, pinned; no QR library existed in the monorepo and a desktop user cannot scan a link.

## Decisions and trade-offs
- **Needs the owner's eye (rule 9):** `app_rw` may now write the new `staff_two_factors` table (added to the b2 grants test list). The platform `two_factors` table was NOT opened to `app_rw`; a first attempt using it failed with a permission error, which is how this surfaced.
- Password re-entry is the step-up; no separate freshness helper.
- Customer export and erasure were not rebuilt: the existing privacy request workflow is linked.
- Preferences other than "Open the admin on" are stored but not yet applied by other screens.

## Verification
Run in the worktree against local Postgres (Docker, port 55432) and the local dev stack:
- `pnpm typecheck`, `pnpm lint` (0 errors; 6 warnings that were already there), `pnpm build`, `pnpm docs:check`: pass.
- Real-database tests: full `@bs/domain` heavy suite 3153 tests in 168 files; two files (`analytics-phase2`, `invoices`) were killed by a Windows worker crash (exit 3221226505) under load and pass when rerun alone (16 tests). New suites: `account.int.test.ts`, `customer-account-security.int.test.ts`, `platform-account.int.test.ts`. `@bs/db` heavy (22), `@bs/platform` heavy incl. audit coverage with the 3 new mutations, RBAC and read-endpoint maps, and the `@bs/web` bundle-size tests (after a production build): pass. Isolation suite: pass.
- Fast tests: admin 136 (8 new in `auth-mfa.test.ts`), web 298, plus the other packages: pass. (Running every package at once made the admin render tests hit their 30 s timeout; they pass when admin runs alone.)
- Used in a browser on the local dev stack: store admin profile save and reload; authenticator on with a real TOTP code, backup codes, sign out, sign in through the two-step screen (wrong code refused, right code accepted), device sign-out, security activity; 375 px layout of the Security tab (fixed an overflow found there); shopper `/account/security`, verified badges and an SMS consent toggle; Super Admin Account tabs and the sign-in trail after a real two-factor login.
- Bugs found only by using it, now fixed: the store-staff authenticator hit a permission error on the platform-only table (own table added, see Decisions), Better Auth's built-in limiter would have throttled normal sign-in (replaced with a Postgres-backed limiter on the second-factor routes), zero-padded IPv6 addresses, a server/client date mismatch on the shopper page, the Super Admin tab layout, mobile overflow on the admin page.
- NOT verified: the Super Admin password change and new backup codes buttons in a browser (covered by tests only); Account pages in a light theme; CI; any live email (not live). A Next dev warning about uncached data in `generateMetadata()` on `/account/*` was already there.

## Docs updated
- [x] `docs/ACCOUNTS-PROFILE-PLAN.md` (section 11), ADR-049 and the ADR index, `docs/ARCHITECTURE.md` (identity tables, migrations 0116 to 0118, API, routes, auth, "Last verified"). `DEPLOYMENT.md` unchanged: no new env vars or services.
- [ ] `progress.md` In flight line is added on this branch and must be removed after merge.

## Follow-ups and open questions
- Owner: accept ADR-049 and the `staff_two_factors` grant, or ask for another design.
- Apply timezone, date, time and density preferences in the screens; avatar upload; email change once the mailer is live; merge the two "sign out" blocks on the shopper Security page.
- Done in the same branch: turning the authenticator on now ends other sessions; the duplicate shopper sign-out block is removed.
