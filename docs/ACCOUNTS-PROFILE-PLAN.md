# Accounts and Profile plan (staff, platform staff, customer)

Status: **phases 1 to 3 merged in #305 (7dabf0b2) and deployed** (see section 11 for what was built and what changed from this plan) · Author: Claude · 2026-11-21 · Section 9: Q1 decided by the owner, Q2 to Q6 defaulted to Claude's recommendations (owner may override before a phase starts).

Goal: replace today's thin "Password / Theme / Sign out" menus with one dedicated, tabbed **Account** page per audience, covering the essentials only. Not a full identity product: no SSO, API tokens, saved payment methods or owner transfer in this plan (section 8).

## 1. What exists today (verified in code, 2026-11-21)

| Audience | Today | Gap |
|---|---|---|
| Store owner/staff (`apps/admin`) | Avatar menu in `routes/_store.tsx` with Password (dialog), Theme, Sign out. Auth: `packages/auth/src/staff.ts` (Better Auth, no `twoFactor` plugin, min password 10, sessions revoked on reset). `users` has `name, phone, image, locale, twoFactorEnabled`. | No profile page, no avatar upload, no MFA for staff, no sessions list, no security activity, no notification prefs, no role/access summary. |
| Platform staff (`apps/superadmin`) | Layout menu + change password. Auth `platform.ts` has `twoFactor` plugin; `platform_staff.mfaRequired/mfaVerifiedAt`; setting `requireStaffMfa` default true; enrol flow in `lib/auth.ts` (`startMfaSetup`/`finishMfaSetup`); rate limits; 7-day sessions; `support_sessions`; `platform_audit_logs`. | MFA enrolment exists but no self-service manage page (regenerate backup codes, disable), no sessions list, no own-audit view, no role summary. |
| Customer (`apps/web`) | `/account` with Dashboard, Orders, Returns, Reviews, Address, Profile, Notifications (`AccountNav.tsx`). Profile form edits name, email, marketing opt-in; phone (OTP login) read-only. `customers` has verified flags and marketing consent fields; `customer_sessions` table. | No security tab (sessions, sign out other devices), no phone change, no per-channel consent (email/SMS/WhatsApp), no data export or delete request, address nickname exists (`type`) but check UI. |

Three separate auth systems and cookie prefixes already exist (`bs-staff`, `bs-platform`, customer). Keep them separate (cross-cutting rule 1).

## 2. Best-practice research (brief, from standards and common SaaS practice)

Sources relied on: OWASP Authentication, Session Management and MFA cheat sheets; NIST SP 800-63B (password length over complexity rules, no forced rotation); the Shopify, Stripe and GitHub account/security page conventions. Web search was not run for this plan; the owner's pasted brief already cites the same OWASP and Shopify pages.

What good profile and security settings have in common:
1. **Profile and security are separate concerns.** Identity details (name, avatar, contact, locale) change freely. Credentials, MFA, sessions and email change are "sensitive" and sit on their own tab.
2. **Step-up re-authentication** for sensitive actions (password, email, MFA, role/ownership), using the current password or a fresh login, not just an existing cookie.
3. **Sessions are server-enforced and visible**: device, approximate location, last active, revoke one, "sign out everywhere else". Idle plus absolute expiry. Invalidate on password or MFA change.
4. **MFA**: authenticator app (TOTP) first, one-time backup codes shown once, regenerate on demand. SMS is a weak fallback, defer. Mandatory for privileged users, optional but encouraged for merchants.
5. **Security activity feed and alerts** (password changed, MFA changed, new sign-in) so the user can spot compromise. Email notice on each.
6. **No account enumeration**: generic responses on login and recovery (already done in `lib/auth.ts`).
7. **Changing the contact email never silently changes the login identity or ownership.** Verify the new address, then switch, audit it.
8. **Customers want self-service, not security theatre**: addresses, orders, returns, consent, and (India, DPDP Act) the ability to view consent, withdraw it, and request export or erasure.
9. **Show access, don't edit it, on the profile**: role, permissions, stores. Editing stays in Settings → Users.
10. **Defaults that save support tickets**: timezone, language, date format, landing page, notification toggles.

## 3. Target shape

One shared pattern, three skins. A tabbed page (`@bs/ui` tabs, admin UI standards apply: no native select, no `window.confirm`, no bare borders), reachable from the avatar menu ("Account") instead of the current one-off dialog.

### 3.1 Store owner and staff: `/account` in `apps/admin`

Two tabs, plus a read-only summary block. Access management stays under Settings → Users.

**My profile**: name, avatar (existing media upload path), job title, phone, contact email (display; change via verified flow), language, timezone, date/time format, default landing page, display (theme already exists; add table density), notification preferences (new order, payment exception, return/dispute, low stock, fulfilment issue, security alert; feeds the existing notification manager, ADR-039).

**Security**: change password (current-password confirm, revokes other sessions: already supported by Better Auth), authenticator MFA setup with backup codes (optional, "recommended" banner; required if the store owner turns on "require MFA for staff" later), active sessions list with revoke one/all, recent sign-ins, recent security events.

**Access summary** (read-only block on My profile): role, permission list, stores, invite date and inviter, "request more access" mailto/contact to the owner.

### 3.2 Customer: extend `/account` in `apps/web`

Keep the existing nav. Changes:
- **Profile**: add email and mobile **verified badges**, separate consent switches for email, SMS and WhatsApp with last-changed date (uses `marketing*` fields; add per-channel columns), "Download my data" and "Delete my account" request (queued job, pg-boss, ADR-006; erasure keeps order records the store must retain, anonymising the personal fields).
- **Security** (new page `/account/security`): sessions on `customer_sessions` with sign out other devices, change phone number (OTP to the new number, then switch), recent sign-in activity, optional email-and-password only if the store enables it. No admin concepts shown.
- **Addresses**: verify nickname (Home/Work/Other), default flag, PIN and state validation already enforced server-side.
- **Account home**: active order status and quick actions (track, return, reorder, contact). Orders/returns pages already exist; only wire the quick actions.

### 3.3 Platform staff: `/account` in `apps/superadmin`

Tabs: **Profile** (name, avatar, title, work email, phone), **Security** (password, MFA manage: regenerate backup codes, view enrolment status, sessions with revoke, sign out others), **Role and access** (read-only role and permission summary, support-session indicator: "normal staff" vs "in a support session for store X until HH:MM"), **Activity** (own recent `platform_audit_logs`, privileged actions). Notifications: platform operational, support-request and security alerts via the Super Admin events matrix.

Rules: MFA stays mandatory (`requireStaffMfa`), step-up before password, MFA, role or support-elevation changes.

## 4. Data model (expand/migrate/contract, ADR rules, rule 10)

Additive migrations only; all new columns nullable or defaulted.

1. `users`: add `job_title text`, `timezone text`, `date_format text`, `time_format text`, `default_landing text`, `ui_density text`. (`phone`, `image`, `locale` exist.)
2. `user_notification_preferences` (global per user, keyed by `user_id` + `event_key` + `channel`, boolean `enabled`). Not a tenant table because a user spans stores; or tenant-scoped if per-store prefs are wanted (decision 9.3). If tenant-scoped, `tenantTable()` + `forceRlsSql`.
3. `security_events` (global, no RLS, for staff and platform users): `user_id, type, ip, user_agent, created_at, meta`. Types: `password_changed, mfa_enabled, mfa_disabled, backup_codes_regenerated, session_revoked, email_changed, sign_in`. Customers get the same as a **tenant table** `customer_security_events` (rule 1).
4. `sessions`: add `last_active_at`, `device_label`, `approx_location` (derived at write time from IP, coarse only, nullable). Mirror on `customer_sessions`.
5. `customers`: per-channel consent `consent_email`, `consent_sms`, `consent_whatsapp` plus `consent_updated_at` (keep `accepts_marketing` as a computed legacy mirror until contract phase). New `customer_data_requests` tenant table (`type: export|erasure`, `status`, timestamps).
6. Platform audit coverage: every new platform mutation writes `platform_audit_logs` (rule 6); store mutations that change access/settings write `audit_logs`.

## 5. API and domain (rules 2, 3, 4)

- Contracts first in `packages/contracts`: `admin.account.*` (profile get/update, preferences, sessions list/revoke, security events, mfa status), `platform.account.*`, and storefront customer routes under the existing `/api/storefront/customer/*`.
- Business logic in `packages/domain/src/account/` (`profile.ts`, `sessions.ts`, `security-events.ts`, `mfa.ts`, `customer-privacy.ts`). Routes stay thin. Permission checks in the service (`assertPermission` / `assertRoleAtLeast`).
- **MFA for staff**: add the `twoFactor` plugin to `createStaffAuth` (already used by platform auth); the `twoFactors` table exists. Enforcement for merchants is opt-in; the enrol/verify UI can be shared with Super Admin.
- **Step-up**: one helper `requireRecentAuth(ctx, {maxAgeSec})` that demands either a session created within the window or a password re-entry; used by password, email, MFA and (platform) role/support changes. Uses Better Auth's session `freshAge` where it fits.
- **Session invalidation** on password change, MFA change and role change (permission change = revoke target's other sessions). Add a domain test per case.
- **Email change**: verification link to the new address, old address notified, audited; never touches memberships or ownership.
- **Rate limiting** on all new auth-adjacent endpoints (platform already has this config; copy to staff and customer).
- Cache tags per rule 5 if any profile data is cached; notification prefs read by the dispatcher through the domain layer only.

## 6. Phases (in the owner's priority order)

Each phase is a separate branch and PR, with change record, real-DB tests, 375 px and desktop walkthrough.

**Phase 1: Store staff account** (largest value)
1. Migration 1, 2 (partial), 4; `security_events`.
2. Domain + contracts: profile, preferences, sessions, security events, step-up helper.
3. Add `twoFactor` plugin to staff auth; TOTP + backup codes endpoints; MFA UI.
4. Admin UI: `/account` route (`pendingComponent`, rule 11), avatar-menu "Account" entry, retire the standalone Password dialog into the Security tab.
5. Tests: isolation suite entry for every new `admin.*` procedure; sessions revoke; MFA enrol/verify; email change; password change revokes sessions.

**Phase 2: Customer account**
Security page, verified badges, per-channel consent, data export and erasure requests (job), session list, phone change via OTP. Storefront JS budget is tight (project memory: product page 50 KB gz): account pages are not the product page, but check the shared header/account menu before adding code to it.

**Phase 3: Platform staff account**
Account page with profile, MFA manage, sessions, role summary, support-session indicator, own activity. Mandatory MFA already exists; add step-up on password/MFA/role/support elevation and audit coverage test update (`apps/platform/test/audit-coverage.int.test.ts`).

**Phase 4 (not planned here)**: owner transfer, social/SSO linking, staff API tokens, saved payment methods. Each needs its own plan and ADR.

## 7. Acceptance criteria (verifier checks each)

1. Avatar menu on all three apps opens an Account page; no standalone password dialog remains in admin.
2. Profile edits persist and appear after reload; avatar uploads through the existing media path with size/type limits.
3. Changing password requires the current password, revokes all other sessions, writes a `security_events` row, and sends a notice email (queued, not inline).
4. MFA: enrol with TOTP, receive backup codes once, sign out and in with a code, regenerate codes (step-up required), disable (step-up required, audited).
5. Sessions list shows device, coarse location, last active; revoking one signs only that device out; "sign out others" leaves the current one.
6. Staff, platform and customer sessions never validate across audiences (test).
7. Email change needs verification of the new address and never alters role, membership or owner.
8. Customer: consent per channel with timestamp; export request produces a downloadable file via job; erasure request anonymises personal fields but keeps order financial records.
9. Access summary is read-only and matches the role in `memberships`.
10. Every new platform mutation has a `platform_audit_logs` row; store-affecting ones have `audit_logs`.
11. New tenant tables use `tenantTable()` + `forceRlsSql`; cross-tenant read test passes in `isolation.int.test.ts`.
12. Login and recovery responses stay generic (no account enumeration).
13. Gate passes: `pnpm typecheck`, `lint`, `build`, `docs:check`, affected tests, `pnpm --filter @bs/domain test:heavy` with counts pasted.
14. `docs/ARCHITECTURE.md` updated (routes, tables, auth plugins); ADR-043 written for "account security model" (step-up, MFA policy, session invalidation rules).

## 8. Out of scope here

Owner transfer, billing-contact designation, standing-consent control (exists under platform support settings, link only), SMS/WhatsApp MFA, passkeys, SSO/social linking beyond the existing Google sign-in card, API tokens, saved payment methods, live email delivery (email is not live in production; security notices queue and log until the mailer is, per ADR-019).

## 9. Decisions needed from the owner

1. **Merchant MFA policy**: DECIDED 2026-11-21 by the owner: optional with a nudge (banner on the Security tab and admin home until enrolled). Not required for any store role in Phase 1; a store-level "require MFA for staff" switch can come later.
2. **Customer erasure**: DEFAULTED 2026-11-21 (Claude recommendation, owner may override): 30-day grace window. On request the account is deactivated and signed out everywhere, the customer gets a confirmation and can cancel by signing in; after 30 days a job anonymises name, email, phone, addresses and sessions. Order and invoice records are kept with personal fields reduced to what tax law requires (GST invoices must be retained). Why: stops accidental or hijacked-account erasure, and still meets the DPDP Act duty to erase on withdrawal of consent within a reasonable time. Export requests are fulfilled within 7 days by job, link expires in 48 hours, download needs a signed-in session.
3. **Notification preferences scope**: DEFAULTED: one set per user across all stores. Security alerts are always on and cannot be switched off. Business alerts (orders, stock, returns) are per user per event with an email/in-app channel choice; the store owner sets the store's default recipients under Settings → Users, and a user's own preference can only mute, never add, an alert the store did not route to them. Why: a user with several stores gets one place to manage noise, and owners keep control of who is alerted.
4. **Email is not live**: DEFAULTED: build both, ship in-app first. Security events are written and shown in the Security tab and the in-app drawer now; the "email on change" notice is queued through the notification manager (ADR-039) and starts sending automatically when the mailer goes live. No feature waits on email. Exception: until email is live, email change and password reset by email cannot complete, so the staff email-change flow stays behind a flag and is not offered in Phase 1; password change (current password) and MFA do not need email.
5. **Location display**: DEFAULTED: skip IP-to-city in Phase 1. Show device and browser, IP address, first and last active time, and a "this device" marker. Revisit with a bundled offline GeoIP database (no third-party call, so no customer IP leaves our servers) only if support asks for it. Why: city lookups are often wrong and cause false alarms, and a provider call would send user IPs to a third party.
6. **Language**: DEFAULTED: English only in Phase 1, using the existing `locale` field and storing the preference so later translations need no migration. Date, time and timezone preferences are in scope. Hindi and other Indian languages are a separate localisation plan covering all three apps, not a profile feature.

## 10. Risks

- Adding `twoFactor` to staff auth changes sign-in flow responses (`twoFactorRedirect`); the admin sign-in screen needs the same second-step handling Super Admin already has.
- Enabling 2FA ends all sessions (Super Admin behaviour today); decide if merchants get the same or a gentler flow.
- Storefront bundle size: keep account pages server-rendered with small client islands.
- Parallel branches touch `apps/admin/src/routes/_store.tsx` and `packages/db` migrations (the working tree already has an unrelated migration `0096`); number migrations after the latest on `origin/main` at start.

## 11. What was built (2026-11-21, branch `feat/accounts-profile`) and deviations from this plan

Built (ADR-049, migrations 0116 to 0118, change record `docs/changes/2026-11-21-claude-accounts-profile.md`):
- **Store staff**: `/account` in the admin with My profile (details, preferences, mutable alerts, read-only access) and Security (password, optional authenticator with QR and backup codes, sessions, security activity); sign-in second step; MFA nudge on Home; "Open the admin on" applied once per tab; avatar menu now has My account and Password and security.
- **Customer**: `/account/security` (devices with sign-out, password, recent activity), verified badges, SMS and WhatsApp consent, link to the existing privacy request page.
- **Platform staff**: `/account` in Super Admin with Profile, Security (password, backup codes, sessions, activity), Role and access (read-only summary, support-session indicator) and Activity (own audit rows). Mutations are audited in the same transaction and covered by the audit coverage suite.

Deviations (all deliberate):
1. **Store-staff authenticator has its own table** (`staff_two_factors`, flag `users.store_two_factor_enabled`). The platform `two_factors` table is platform-only (migration 0014) and widening `app_rw` onto it was rejected (rule 9). Found while testing: with the existing table, enrolment fails with a permission error.
2. **No separate re-authentication helper** in phase 1: the password is required by Better Auth for authenticator on, off and new backup codes, and by the password change. Add one when a feature needs a freshness window.
3. **Customer export and erasure reuse the existing privacy request workflow** (`/privacy-request`, merchant handled within the SLA, `executePrivacyExport` / `executePrivacyErasure`), so the 30-day grace-window job in section 9 Q2 was not built. Revisit if the owner wants self-service.
4. **Avatar upload not built** (initials only; `users.image` is supported by the service). **Preferences stored but only "Open the admin on" is applied** today; timezone, date, time and density need each screen to adopt them.
5. **Location display skipped** (section 9 Q5), **security email notices not sent** (mailer not live; events are shown in the Security tab), **email change not built**.
6. **Customer phone change and the per-channel consent history were not built.** Consent stores only the latest choice and its date.
7. ~~Enabling the authenticator does not end other sessions~~ Done: turning it on now signs out every other session (like Super Admin).
8. ~~Duplicate sign-out block on the shopper Security page~~ Done: the old "sign out of all devices" block (which only ended the current session) is removed; the devices list is the one place.

Still deferred, each blocked on something outside this change: avatar upload (needs a user-level storage path, not the tenant media library), email change and security emails (mailer not live), shopper phone change (needs live SMS OTP), applying timezone, date, time and density to every screen (a per-screen job, best done as its own change), and the freshness-window re-authentication helper (no feature needs it yet).
