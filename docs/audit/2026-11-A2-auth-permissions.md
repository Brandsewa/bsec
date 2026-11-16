# Audit A2: authentication, sessions and permissions

- **Date:** 2026-11-15
- **Auditor:** claude
- **Plan:** `docs/PLATFORM-AUDIT-PLAN.md` section A2
- **Code audited:** `main` e152e4b plus the dependency bumps of PR #274
- **How:** code read, plus `scripts/audit-api-guards.mjs`. No probe test was written for this section; every finding below is from reading, with the path. Nothing was run against production.

## Result

No permission bypass was found. Every admin and platform procedure is behind a sign-in guard, and role changes are guarded correctly. The findings are places where a rule is met only at the route, or where a safeguard depends on deployment settings that are not written down. This section is only partly covered: see "Not checked".

| ID | Severity | Title | Status |
|---|---|---|---|
| A2-01 | Low | 15 platform mutations check the role level only at the route | open |
| A2-02 | Low | Onboarding dismiss checked no permission | fixed in `fix/payment-on-cancelled-order` |
| A2-03 | Low | Accepting a staff invitation writes no audit log | fixed in `fix/payment-on-cancelled-order` |
| A2-04 | Low | "Keep at least one owner" can be raced | fixed by a row lock in `fix/payment-on-cancelled-order`; race not reproduced |
| A2-05 | Unconfirmed (Medium if wrong) | Rate limits key on an IP whose meaning depends on `TRUST_CLOUDFLARE`, which is undocumented | open, needs a live check |
| A2-06 | Low | Sign-in codes are stored as plain SHA-256; phone-only customers get an email at a real domain | open |

## Findings

### A2-01 Platform mutations check the role level only at the route (Low)

- **Rule:** rule 4 ("platform mutations check `assertRoleAtLeast`" in the domain service).
- **Where:** `apps/platform/src/app.ts`; listed by `node scripts/audit-api-guards.mjs --platform`.
- **Actual:** these services call `assertPlatformStaff` (any active staff, MFA verified) or nothing, and rely on `requireStaff("platform_admin")` in the route for the level: `tenants.create`, `tenants.resendOwnerInvite`, `tenants.export`, `plans.updatePlan`, `plans.saveCompare`, `quotas.createTier`, `quotas.updateTier`, `quotas.deactivateTier`, `quotas.updateLimits`, `quotas.updateDefinition`, `features.update`, `features.retire`, `features.restore`, `audit.archive`, `audit.unarchive`. Not exploitable today: the route guard is present on all 196 procedures.
- **Suggested fix (S):** `assertRoleAtLeast` at the top of each service; add them to the script's baseline so the count stays at zero.

### A2-02 Store procedures with a route-only permission (Low)

- **Rule:** rule 4.
- **Where:** `apps/web/src/server/api.ts:648-690` (`admin.support.*`, 5 procedures, `settings.write` at the route; `packages/domain/src/admin/support-access.ts` asserts nothing), `:815` (`admin.apps.states`), `:3252` (`admin.billing.getSubscription`, passes a bare tenant id). `admin.onboarding.dismiss` (`:3244`) has the sign-in guard and no permission at all, so any staff member can dismiss the onboarding card for the store.
- **Suggested fix (S):** move the checks into the services.

### A2-03 Accepting a staff invitation writes no audit log (Low)

- **Rule:** rule 6 (store mutations that change access write `audit_logs`).
- **Where:** `packages/domain/src/admin/team.ts:266` `acceptInvitation`. Invite, role change, removal and revoke all call `auditAccess`; the moment a person actually gains access does not.
- **Suggested fix (S):** one `auditAccess` row with the new member and role.

### A2-04 "Keep at least one owner" can be raced (Low, not reproduced)

- **Where:** `packages/domain/src/admin/team.ts:147` and `:182`: `activeOwnerCount(tx) <= 1` is read without a lock.
- **Steps (theory):** a store with two owners; each demotes the other in the same instant; both transactions see two owners and both commit. The store has no owner.
- **Suggested fix (S):** lock the owner membership rows (`for update`) before counting.

### A2-05 Rate-limit IP depends on an undocumented setting (Unconfirmed)

- **Where:** `packages/domain/src/system/rate-limit.ts:101` `getClientIp`: uses `CF-Connecting-IP` only when `TRUST_CLOUDFLARE=true`, otherwise the last `X-Forwarded-For` hop.
- **Risk either way:** production sits behind Cloudflare. If the variable is not set, the "client IP" is a Cloudflare edge address, so many shoppers share one counter and per-IP limits (sign-in codes 15 per 10 minutes, password sign-in, order tracking 10 per 10 minutes) can lock out real people while doing little against an attacker. If it is set and the server also accepts traffic that did not come through Cloudflare, the header can be forged and per-IP limits bypassed.
- **Not confirmed:** `TRUST_CLOUDFLARE` does not appear in `DEPLOYMENT.md`, `infra/` or any `.env.example`, so the production value is unknown from the repo.
- **Owner check:** the value in Coolify for web and platform, and whether the firewall only admits Cloudflare ranges on 80 and 443.
- **Suggested fix (S):** document the variable; add it to the env examples.

### A2-06 Sign-in code storage and placeholder emails (Low)

- **Where:** `packages/domain/src/customers/otp.ts:28` (`sha256(code)`, 6 digits, no salt or secret) and `:124` (`${phone}@customer.store` as the email of a phone-only customer).
- **Actual:** anyone who can read `customer_otps` can recover a live code by trying 900,000 hashes. `customer.store` is a real, registrable domain: any mail sent to that address would leave the platform. `customers/orders.ts` and `profile.ts` treat the suffix as "no email"; the mail senders were not checked for the same guard.
- **Suggested fix (S):** HMAC the code with a server secret; use a reserved name such as `<phone>@phone.invalid` (RFC 2606) and skip it in one place, the mail sender. Phone sign-in is not live yet (SMS delivery is not wired), so this can be fixed before it matters.

## Checks that passed

| Check | How | Result |
|---|---|---|
| Every `admin.*` procedure has the sign-in guard | `scripts/audit-api-guards.mjs` | 2 exceptions, both by design |
| Every platform procedure has a staff guard | same, `--platform` | 196 of 196 |
| Admin context: customer sessions refused, membership must be active, read-only stores lose write permissions | read `context.ts` | pass |
| Built-in permissions keyed on role name cannot be gained through a custom role | read `team.ts`, `permissions.ts`: stores cannot create roles | pass |
| Only an owner can grant, change or remove owner and admin roles; finance role limited to owner and admin | read `team.ts` | pass |
| Staff invitation: random 32-byte token, only the hash stored, expiry, single use | read `team.ts` | pass |
| Platform support access: token hashed, bound to one store, expiry, owner approval, every request audited, settings and money permissions excluded | read `support-sessions.ts`, `context.ts` | pass |
| Customer session cookie: `HttpOnly`, `Secure` in production, `SameSite=Lax`, host-only | read `customer-session.ts` | pass |
| Customer writes require the same origin | read `sameOrigin` | pass |
| Staff API: cross-origin state changes with the staff cookie refused; CORS allowlist exact | read `csrf.ts`, `auth.ts` | pass |
| Platform API: exact-origin CORS, every state change needs an allowed `Origin` | read `apps/platform/src/app.ts:1056-1090` | pass |
| Sign-in codes: 10 minute expiry, 5 wrong tries, single use, atomic rate limits per phone and IP, code never in the response | read `otp.ts`, routes, `rate-limit.ts` | pass |
| Customer orders and addresses filtered by the signed-in customer; unverified accounts see no past orders | read `customers/orders.ts`, `addresses.ts` | pass |
| Order tracking lookup reveals nothing on a miss and is rate limited | read `lookupOrderForTracking` | pass |

## Not checked

- Better Auth configuration: session lifetime, rotation on sign-in, revoke on password change, cookie flags of the staff cookie in a running browser.
- Password reset and email verification flows (staff and customer); user enumeration on register, sign-in and forgot-password.
- Google sign-in: state, nonce, redirect allowlist, account linking.
- Platform MFA: that it cannot be skipped, backup codes single use (the assert exists; not tested).
- Merchant MFA (not enabled; hardening plan item 2.2).
- Whether mail senders skip `@customer.store` addresses.

## Correction (2026-11-16)

A2-02 was overstated. `scripts/audit-api-guards.mjs` did not recognise `assertStoreOwner` (used by all five `admin.support.*` services), so they were reported as "route only". They do check inside the service. The script now knows it. The one real gap was `dismissOnboardingProgress`, which checked no permission; it now needs `settings.write`. `admin.apps.states` (a static list of Indian states) and `admin.billing.getSubscription` (reads the caller's own subscription by tenant id) were left as they are.
