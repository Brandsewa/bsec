# ADR-049: Account and sign-in security model (profile, sessions, authenticator, security trail)

- **Status:** Proposed
- **Date:** 2026-11-21
- **Plan reference:** `docs/ACCOUNTS-PROFILE-PLAN.md`

## Context
Store staff, platform staff and shoppers each had only a password dialog or a thin profile form. Industry practice (OWASP session and MFA guidance, NIST 800-63B) wants: visible and revocable sessions, authenticator-app MFA with backup codes, a trail of security changes, re-confirmation of the password for sensitive changes, and no account enumeration. Our hard rules also keep the Super Admin authenticator seeds away from the tenant runtime (migration 0014: `app_rw` has no access to `two_factors`).

## Decision
1. **Three audiences, three session stores, unchanged.** Store staff and platform staff share `users` and `sessions` but use different cookie prefixes; shoppers use `customer_sessions` (tenant table). Sessions are listed and revoked **by id** in our own domain services; tokens are never returned.
2. **Store-staff authenticator lives in its own table.** Better Auth's `twoFactor` plugin on the store instance is mapped to `staff_two_factors` and the flag `users.store_two_factor_enabled` (migration 0118). The platform's `two_factors` and `users.two_factor_enabled` stay platform-only and unreachable by `app_rw`. A person who is both store and platform staff has two independent authenticators.
3. **Optional for merchants, mandatory for platform staff.** Owner decision 2026-11-21: store staff see a dismissible nudge; Super Admin keeps `requireStaffMfa`.
4. **Password re-entry is the step-up.** Turning the authenticator on, off, or regenerating backup codes requires the account password (Better Auth enforces it); changing the password requires the current one and signs other devices out. A separate generic "recent login" helper was not added: nothing in phase 1 needs one beyond the password.
5. **Security trail.** `security_events` (global, append-only for `app_rw`, migration 0116) for staff and platform users; `customer_security_events` (tenant table, forced RLS, migration 0117) for shoppers. Recording never throws and never changes the response it describes. Platform changes also write `platform_audit_logs` (rule 6); the mutations that go through our own procedures write it in the same transaction.
6. **Profile preferences are stored on the user** (`job_title`, `timezone`, `date_format`, `time_format`, `default_landing`, `ui_density`). Only the default landing page is applied by the admin today; the rest are stored for the screens to adopt.
7. **A person can mute a store alert for themselves, never add one** (`user_notification_mutes`, applied by the dispatcher). Locked (security) alerts cannot be muted.
8. **Shopper data requests reuse the existing privacy request workflow** (`/privacy-request`, merchant-handled within the SLA) instead of a new export or erasure pipeline.

## Consequences
- `app_rw` can now write `staff_two_factors` (listed in the b2 grants test). Its secrets are encrypted by Better Auth with the auth secret; the web process already holds both the role and the secret, so the practical exposure is the same as for password hashes in `accounts`.
- Turning the authenticator on ends the user's other sessions (same as Super Admin).
- Email-change is not built: it needs live email (not live yet) and the verified-change flow; it stays out of the profile on purpose so a profile edit can never move a login or a membership.

## Alternatives considered
- Grant `app_rw` access to the platform `two_factors` table: rejected, widens the platform boundary (rule 9).
- A second Better Auth instance only for MFA: rejected, more moving parts than a table mapping.
- Re-authentication helper with a freshness window for every sensitive call: deferred until a feature needs one.
