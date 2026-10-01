# Auth overhaul and platform transactional email (Zoho ZeptoMail)

Hand-off plan for Antigravity. Verifier: Claude (checks every item against the acceptance criteria in section 9 before it is called done).

## 0. Goal

Today all three sign-in surfaces have only a bare "log in" form. Make each complete and safe:

| Surface | App | Who | Needs |
|---|---|---|---|
| Super admin | `apps/superadmin` (Vite SPA) on `superadmin.gobs.cloud`, API `apps/platform` | Platform staff | Forgot / reset password, change password, MFA kept, invite acceptance kept |
| Store admin | `apps/admin` (Vite SPA) on `admin.gobs.cloud`, API in `apps/web` (`/api/auth`) | Store staff and owners | Forgot / reset password, change password, invite acceptance kept |
| Customer | `apps/web` storefront, per store domain | Shoppers | Register, sign in (password), forgot / reset password, change password, keep the existing phone-OTP sign-in |

In parallel: one platform-wide **SMTP transactional email service**, configured by the super admin in the superadmin app. **Zoho ZeptoMail** is the provider. Stores do not configure email; every store's mail (auth mail and order mail) goes through this one platform setting. Replaces Resend for auth mail now; order mail moves to it too (section 3.5).

## 1. Ground rules (apply to every phase)

1. Read `AGENTS.md` first: this is not the Next.js you know; check `node_modules/next/dist/docs/` before writing Next code.
2. Multi-tenancy: every customer query filters by `tenantId` inside `withTenant`. Platform-level tables (settings, staff) have no tenant and are only touched by the `app_platform` role.
3. **Secrets never appear in code, logs, API responses, test snapshots or the browser.** The SMTP password is stored encrypted at rest (AES-256-GCM, same approach as `tenant_secrets` and `payments-settings.ts`; reuse that crypto helper), returned to the UI only as "set / not set" plus last four characters at most.
4. Every new mutation writes an audit row (superadmin actions through the existing platform audit mechanism; check `apps/platform/test/audit-coverage.int.test.ts` for the required pattern).
5. Real-database integration tests for all domain logic (pattern: `packages/domain/test/*.int.test.ts`, `startTestDb`). No mock-only tests for security behaviour.
6. Gate before any push: `pnpm typecheck`, `pnpm lint`, `pnpm build`, then vitest in each touched package **one package at a time** (parallel turbo runs cause DB contention flakes). Push only if all pass.
7. Do not touch Razorpay or Shiprocket.

## 2. Current state (verified by reading the code)

- `packages/auth/src/staff.ts` and `platform.ts`: Better Auth, `emailAndPassword.enabled`, `disableSignUp: true`, min password 10, **no `sendResetPassword`, no email verification**, no mail sender wired. Platform has `twoFactor` plugin and an in-memory rate limit (5 attempts / 5 min on sign-in and 2FA endpoints). Staff uses our own Postgres limiter (`checkAdminLoginLimit`).
- `packages/auth/src/customer.ts`: Better Auth customer instance exists with `emailAndPassword.enabled` but is **not used by the storefront**. The storefront currently signs shoppers in with **phone OTP** (`packages/domain/src/customers/otp.ts`, session in `customer_sessions`, cookie set by `apps/web/src/app/api/storefront/customer/otp/verify`). The `customers` table already has a `passwordHash` column (unused).
- Login screens: `apps/admin/src/routes/login.tsx`, `apps/superadmin/src/pages/Login.tsx`, storefront `/account` shows the OTP form. Invite acceptance exists for staff (`accept-invite.tsx`) and platform staff (`AcceptInvitation.tsx`).
- Mail: `packages/domain/src/system/email.ts` posts to the Resend HTTP API using a per-tenant key from `tenant_secrets`. No SMTP code. No `nodemailer` dependency. Templates are pure functions in `system/email-templates.ts`; the context loader is `system/email-context.ts`.
- The base URLs: customer reset links must use the store's own domain (`email-context.ts` already derives `baseUrl`); staff links use `admin.gobs.cloud`; platform links use `superadmin.gobs.cloud`.

## 3. Phase A: Platform email service (build first; everything else depends on it)

### 3.1 Data
New migration (follow `docs/migrations.md`; platform-level, **no tenant column**, writable only by `app_platform`, readable by the web/platform runtimes only through the sender function, never by tenant roles via RLS-protected tables):

`platform_email_settings` (single row, enforced with a constant key column):
- `provider` text default `'zoho_zeptomail'` (keep the column so another SMTP can be used later)
- `host`, `port` int, `secure_mode` text (`'starttls' | 'ssl'`)
- `username` text
- `password_ciphertext`, `password_iv`, `key_version` (encrypted)
- `from_email`, `from_name`
- `reply_to` nullable
- `enabled` boolean default false
- `last_test_at`, `last_test_status`, `last_test_error` (sanitised, no secrets)
- `updated_by`, `updated_at`

`platform_email_log` (platform-level, for delivery diagnostics; includes `tenant_id` nullable for store mail, `to_email`, `template`, `status`, `provider_message_id`, `error` truncated, `created_at`). Cap retention (a prune job, 90 days). Never store message bodies containing reset links.

### 3.2 Sender
New `packages/domain/src/system/platform-mailer.ts`:
- `sendPlatformEmail({ tenantId?, to, subject, html, text, replyTo?, template })`. Loads and decrypts settings, builds an SMTP transport with **`nodemailer`** (add dependency to `packages/domain`), sends, writes `platform_email_log`.
- If settings are missing or `enabled=false`: do **not** throw to the caller for order mail (log `skipped: not configured`); for auth mail return a typed result so the UI can show "email isn't set up" without leaking whether an account exists (see 4.1).
- Timeouts (connect 10 s, send 20 s), pooled connection, one retry on transient 4xx. Surface provider errors sanitised.
- Per-recipient and global rate limits (reuse `checkStorefrontRateLimit`-style Postgres limiter) to stop mail bombing: e.g. max 5 reset mails per recipient per hour, max 20 per IP per hour.

### 3.3 Zoho ZeptoMail values (for the super admin to enter in the UI)
ZeptoMail is Zoho's transactional service. SMTP settings come from its "Mail Agent" > SMTP tab:
- Host: region specific, India is `smtp.zeptomail.in`; others `smtp.zeptomail.com`, `smtp.zeptomail.eu`. Use whichever the account region shows.
- Port: `587` with STARTTLS (preferred) or `465` with SSL.
- Username: the value shown in the SMTP tab (typically `emailapikey`).
- Password: the "Send Mail Token" generated for that Mail Agent (long string). **Entered by the owner in the UI only; never in chat, code or env files.**
- From address must be on a domain verified in ZeptoMail (SPF and DKIM records added in Cloudflare DNS). The owner does the DNS step; Antigravity documents the exact records to add in the UI help text and `DEPLOYMENT.md`.

### 3.4 Superadmin UI
New page `apps/superadmin/src/pages/EmailSettings.tsx`, nav entry "Email" under System (permission: owner / `platform.settings.write`; check `apps/platform` roles and add a permission if none fits):
- Form: provider (fixed Zoho ZeptoMail with preset hosts), host, port, security mode, username, password (write-only field, shows "saved" state), from name, from email, reply-to, enabled toggle.
- Presets button: "Zoho ZeptoMail (India)" fills host/port/mode/username, leaves password blank.
- **Send test email** button: sends to an address typed in (default: the signed-in staff email), shows success or the sanitised error; stores `last_test_*`.
- Recent deliveries table from `platform_email_log` (to, template, status, time) with a failed filter.
- API: new oRPC procedures in `packages/contracts/src/platform.ts` and handlers in `apps/platform` (`emailSettings.get`, `emailSettings.update`, `emailSettings.sendTest`, `emailSettings.recentDeliveries`). `get` never returns the password. Update the platform RBAC and isolation/audit test suites for the new procedures.

### 3.5 Switch existing order mail to the platform mailer
`system/email.ts` (`sendEmail`) currently needs a per-tenant Resend key. Change it to render as today, then call `sendPlatformEmail` with the store name as the display name and the store's support email as reply-to; `from` stays the platform address (e.g. `"Taste of Hills" <orders@gobs.cloud>`). Keep the `email_log` table behaviour (dedupe by `eventRef`), keep the "no provider configured, skip quietly" behaviour. Remove the Resend call and per-tenant Resend secret usage; update `jobs.ts` tests and `email.test.ts` / `order-emails.int.test.ts` (they mock `fetch` for Resend; replace with a fake SMTP transport injected via the mailer's transport factory).

## 4. Phase B: Password reset and change for staff and platform staff

### 4.1 Forgot / reset flow (both staff apps)
Use Better Auth's built-in reset flow rather than building our own:
- `staff.ts`, `platform.ts`: add `emailAndPassword.sendResetPassword: async ({ user, url, token }) => ...` that calls `sendPlatformEmail` with new templates (4.3), `resetPasswordTokenExpiresIn: 3600` (1 hour), and `revokeSessionsOnPasswordReset: true`.
- The `url` Better Auth builds must point at the right SPA: staff `https://admin.gobs.cloud/reset-password?token=…`, platform `https://superadmin.gobs.cloud/reset-password?token=…` (config via `redirectTo` / base URL options; read the Better Auth version in `node_modules` for exact option names).
- **No account enumeration:** the "forgot password" endpoint always answers the same success message and takes the same time whether or not the email exists. Test this explicitly.
- The send must not run inside the request critical path timing difference: enqueue through pg-boss (existing queue pattern) or fire after responding; either way identical response time.
- Platform staff with MFA: after reset the next login still requires the second factor. A reset never disables MFA.
- Rate limits: platform keeps its in-memory rule; add `/request-password-reset` (3 per 15 min per IP) and `/reset-password`. Staff: extend our Postgres limiter to the forgot endpoint.

### 4.2 Screens
- Admin SPA (`apps/admin`): `/forgot-password`, `/reset-password` routes (outside the auth guard like `login.tsx`/`accept-invite.tsx`), "Forgot password?" link on `login.tsx`. Show password rules (min 10, max 128), confirm field, strength hint, generic errors, expired-token screen with "request a new link".
- Superadmin SPA: same three pieces in `Login.tsx` and new `ForgotPassword.tsx`, `ResetPassword.tsx`; wire into the router.
- Signed-in **Change password** form (current + new) in both apps (admin: account / profile settings page; superadmin: header menu). Better Auth `changePassword` with `revokeOtherSessions: true`.
- Use the existing admin UI component kit (`docs/admin-ui-standards.md`); superadmin follows its own existing style.

### 4.3 Templates
Add to `system/email-templates.ts` (pure, HTML + text, escaped, covered by `email-templates.test.ts`): `password_reset` (staff / platform wording, 1-hour expiry, "if you didn't ask, ignore this"), `password_changed` (security notice sent after any reset or change), `customer_welcome` and `customer_password_reset` (store-branded, section 5). Brand block for staff and platform mail is the platform name; for customers it is the store.

## 5. Phase C: Customer authentication (storefront)

### 5.1 Decision to record (ADR)
Keep **both** methods: password accounts (new) and phone-OTP (existing, from `customers/otp.ts`). One customer identity: the `customers` row. Passwords go in `customers.passwordHash` (argon2id; use `@node-rs/argon2` or Better Auth's hash helper if it works on the `customers` table; **do not** introduce a second user table). Sessions keep using `customer_sessions` through `packages/domain/src/customers/session.ts` (opaque token, hashed at rest, httpOnly SameSite=Lax cookie). Do not revive the unused Better Auth customer instance unless it is wired fully; if it is not used, delete `packages/auth/src/customer.ts` to avoid a misleading second path. Write the ADR into `docs/`.

### 5.2 Domain functions (`packages/domain/src/customers/`)
- `registerCustomer(rt, ctx, { name, email, phone?, password, acceptsMarketing })`: normalises email, rejects an email that already has a password account (generic message, no enumeration beyond the register form itself: for an existing email send a "you already have an account" mail and respond identically), min length 10 and a common-password check, hashes, creates or upgrades an existing guest customer row for that email (adopting past guest orders only after the email is verified), sends a verification email.
- `verifyCustomerEmail(token)` using `action_tokens` (new purpose `email_verification`, 24 h, hashed).
- `loginCustomer(rt, ctx, { email, password })` constant-time compare, per-account lockout/backoff plus the storefront rate limit, generic "wrong email or password", creates a `customer_sessions` row. Unverified email can sign in but cannot see guest-order history until verified.
- `requestCustomerPasswordReset(rt, ctx, { email })`: always the same response; if a password or guest account exists, mint a hashed one-hour `action_tokens` row (purpose `password_reset`), mail the link built from the **store's own domain** (`/account/reset-password/[token]`).
- `resetCustomerPassword(rt, ctx, { token, password })`: single use, atomic (guarded UPDATE as in `confirmCodOrder`), invalidates all that customer's sessions, sends `password_changed`.
- `changeCustomerPassword(rt, ctx, { customerId, current, next })`, revoking other sessions.
- `logoutCustomer` exists; keep.

### 5.3 Storefront routes and screens (`apps/web/src/app/…`)
- `/account/login` (email + password, link to "Use phone code instead", link to register and forgot).
- `/account/register` (name, email, phone optional, password, marketing consent checkbox unticked by default, terms/privacy links if the store has those pages).
- `/account/forgot-password`, `/account/reset-password/[token]`, `/account/verify-email/[token]`.
- Account profile page: add Change password and "Sign out of all devices".
- `/account` (signed out) shows the combined sign-in: tabs "Email and password" / "Phone code".
- Checkout: for guests offer "Create an account to track orders" after purchase on the thank-you page (optional, sets password with the order email), not blocking checkout.
- API routes under `apps/web/src/app/api/storefront/customer/{register,login,logout,forgot-password,reset-password,change-password,verify-email}` with: same-origin check (reuse the helper from the unsubscribe/address routes), `checkStorefrontRateLimit`, zod validation, no codes or tokens in responses, `Cache-Control: no-store`, store resolved from host with `evaluateStorefrontAccess`.
- All account pages `noindex`, dynamic (not cached).

### 5.4 Security requirements specific to customers
- Cookies per tenant host (host-only), `Secure`, `HttpOnly`, `SameSite=Lax`. A session from store A must be rejected on store B (test).
- Reset and verification tokens: 32 random bytes, stored sha256, single use, expiry enforced in SQL, bound to tenant (a token minted in store A fails on store B).
- Password hashing parameters recorded; rehash-on-login if parameters change.
- Brute force: per (tenant, email) and per (tenant, IP) limits in Postgres; delay not lockout for the owner of the account (no permanent lock).

## 6. Phase D: Remaining auth screens and hygiene

- Login pages: consistent error states, "caps lock on" hint, show/hide password, autofill attributes (`autocomplete="username|current-password|new-password"`), disabled submit while pending, accessible labels and focus management.
- Session lists: staff and platform "Active sessions" with revoke (Better Auth `listSessions` / `revokeSession`), optional; do after the above.
- Staff invite emails (`owner-invites.ts`, platform staff invitations) currently only return links or use Resend; send them through the platform mailer too, with the new template style. Verify by test.
- Remove dead code: `Resend` references in `domain` once 3.5 is done; the unused customer Better Auth instance if the ADR says so.
- `DEPLOYMENT.md`: remove the Resend steps, add ZeptoMail steps (verify domain, SPF/DKIM DNS records in Cloudflare, create the Mail Agent, copy SMTP values into Superadmin > Email, send test).

## 7. Order of work and commits

1. A (migration, mailer, templates, superadmin Email page, order-mail switch) as one reviewable commit series; **stop and report** so the owner can enter the real ZeptoMail values and run the test email.
2. B (staff and platform reset, change password, screens).
3. C (customer register / login / reset), ADR.
4. D (hygiene, docs).
Each phase ends with the gate in section 1.6 and a short report listing what is verified vs not.

## 8. Test plan (all must exist)

Real database:
- Mailer: settings stored encrypted (ciphertext not equal to the password, decrypt round-trip), disabled/missing config skips without throwing for order mail, log rows written, error text sanitised (password never appears), injected fake transport receives correct headers (from, reply-to, html, text).
- Superadmin procedures: RBAC (non-owner staff refused), audit rows, `get` never returns the secret, isolation suite updated.
- Staff and platform reset: request for unknown and known email give identical responses; token single use; expired token refused; all sessions revoked after reset; MFA still required after reset (platform); rate limit trips; `password_changed` mail sent.
- Customer: register, duplicate email, login success and failure (generic message), lockout/backoff, verify email, reset single use and expiry, cross-tenant token and session rejection, old sessions revoked after reset, guest orders adopted only after verification, OTP login still works.
- Templates: escaping, plain-text twin, links on the right host (store domain vs admin vs superadmin).
Web/SPA component tests: each new screen renders, validates, shows generic errors, and calls the right endpoint.

## 9. Acceptance criteria (Claude verifies each, with evidence)

1. Superadmin can save ZeptoMail SMTP settings; the password is never returned or logged; the test email arrives at a real inbox (owner confirms).
2. A store admin and a platform staff member can each request a reset, receive an email with a link to the right app, set a new password, and sign in; old sessions die; the same link cannot be used twice; unknown emails behave identically to known ones.
3. A shopper can register, receive a verification email, sign in with email and password, reset a forgotten password via an email link on their own store's domain, change the password, and still use phone-OTP.
4. Order confirmation and other order emails are sent through the platform mailer with the store's name and reply-to; no Resend code or per-store email secret remains.
5. Cross-tenant checks pass: a customer token or session from one store never works on another.
6. `pnpm typecheck`, `pnpm lint`, `pnpm build` and each package's vitest pass; `progress.md` updated; ADR and `DEPLOYMENT.md` updated.

## 10. Open questions for the owner (answer before phase C)

1. Sender address: confirm the verified ZeptoMail domain and from address (suggest `no-reply@gobs.cloud` for auth, `orders@gobs.cloud` for orders).
2. Should unverified customers be allowed to check out as guests with that email? (Plan says yes; guest checkout is unchanged.)
3. Customer phone is required today for checkout; keep optional at registration?
4. Staff self-registration stays disabled (invite only). Confirm.
