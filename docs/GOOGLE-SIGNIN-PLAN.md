# Google Sign-In: platform login for staff and store owners (Tier A) + One Tap for store customers (Tier B)

- **Status:** Plan, not started. Nothing here is built.
- **Author:** Claude Code, 2026-10-23. Revised after owner decisions of the same day (section 2).
- **Extends:** ADR-019 (customer auth), ADR-014 (admin auth), `docs/AUTH-OVERHAUL-PLAN.md`
- **Needs a new ADR** (next free number) before phase 1: "Social sign-in: platform client for staff, store-owned client for customers".

## 1. What exists today (verified in code)

| Area | Fact | Where |
|---|---|---|
| Staff, store owners and Super Admin use **Better Auth** | v1.7.10. Tables `users`, `sessions`, `accounts`, `verifications`, `two_factors`. No social provider configured anywhere. | `packages/auth/src/{staff,platform}.ts`, `packages/db/src/schema/identity.ts` |
| Customer auth is **not Better Auth** | ADR-019 deprecated `createCustomerAuth`. Email + password or phone OTP against `customers`, opaque sessions in `customer_sessions`. | `packages/domain/src/customers/{auth,session,otp}.ts` |
| Per-store customer sign-in toggles | `customer_account_settings`: `emailPasswordEnabled`, `phoneOtpEnabled`; at least one stays on; `isSignInMethodBlocked()`. UI: Settings > Customer accounts. | `packages/domain/src/admin/customer-account-settings.ts`, `apps/admin/src/routes/_store/settings/customer-accounts.tsx` |
| Platform switch pattern | `platform_payment_providers` (no secrets), per-store keys in `tenant_secrets` (AES-256-GCM), `writePlatformAudit`, Super Admin page `PaymentsIntegrations.tsx`. | `packages/db/src/schema/platform-payments.ts`, `packages/domain/src/platform/payment-providers.ts` |
| Super Admin Integrations hub | 3 cards (Notifications, Storage, Payments), sub-routes under `/integrations/*`. | `apps/superadmin/src/pages/integrations/IntegrationsHub.tsx`, `router.tsx` |
| Store hosts | `<slug>.bcom.si` or a custom domain; custom rows are `type = 'custom'`, usable at `status = 'active'` with SSL. | `packages/db/src/schema/platform.ts`, `packages/domain/src/domains/service.ts` |

## 2. Owner decisions (2026-10-23) and why they are sound

1. **Tier A = platform Google client, for the platform's own users only:** Super Admin staff, platform staff and store owners/staff who sign up to bcom. It signs them in to the admin dashboards. **It is never offered to a store's customers.**
2. **Tier B = the store's own Google app, for that store's customers only,** and only after the store has a verified custom domain.

Why this is right:
- **Data protection.** If customers signed in through the platform's Google client, the platform would sit in the middle of every shopper's Google identity across all stores: one client, one consent screen, one set of logs. That looks like collecting merchants' customer data and muddies who is the data controller under DPDP. With Tier B each store owns its Google client, so Google's consent and the sign-in belong to the store and the platform only verifies a token.
- **Technical fit.** The platform client needs only a handful of fixed origins (`admin.bcom.si`, `superadmin.bcom.si`, `bcom.si` signup, local dev), which Google supports. That removes the hardest problem from the earlier draft (no wildcard origins, per-store broker popup). The broker idea is dropped.
- **Better Auth does the work for Tier A.** Staff already run on Better Auth, which has `socialProviders.google` and a `oneTap` plugin. No custom flow needed there.
- **Tier B gate.** A store's own app can only get its logo and name verified on Google's consent screen if the store owns the domain; it cannot do that for our `bcom.si`. (From my knowledge of Google, to be re-verified in phase 0.)

Consequence to accept: a store without a custom domain has **no** Google sign-in for its customers. They still have email + password and phone OTP.

## 3. Tier A: Google sign-in for Super Admin, platform staff and store owners (Better Auth)

**Surfaces:** `apps/admin` login and `/signup` (store owners and store staff), `apps/superadmin` login. Both are single, fixed origins registered once on the platform Google client.

**Rules**
- Configure `socialProviders.google` and the `oneTap` plugin in `packages/auth/src/staff.ts` and `platform.ts`, with the Client ID/secret read from the platform settings (encrypted, written by Super Admin, shown only as set/not-set; hard rule 7). The `socialProviders.google` option can be a function, so credentials come from the database, not env.
- **No auto-provisioning of privileged users.**
  - Super Admin: Google works only for an **existing** `platform_staff` row (`disableSignUp: true`, plus a domain check that the user is staff). A Google account cannot become platform staff by signing in.
  - Store admin sign-in: only for an existing user/membership (invited staff, existing owner). Sign-up through Google is allowed **only** on the `/signup` flow, which creates a user and the owner's new store exactly as email signup does today.
- **Account linking:** link a Google account to an existing Better Auth user only when Google reports `email_verified` and the app's own email is verified (Better Auth `accountLinking` with `trustedProviders: ["google"]`, and review the default for unverified local emails to avoid pre-registration takeover). Match on `accounts(providerId = 'google', accountId = sub)`.
- **Second factor stays.** Platform staff and owners with `two_factors` enabled must still pass it after Google sign-in. Better Auth's 2FA hooks may not cover social sign-in in every version, so phase 1 includes a test and, if needed, a hook that enforces it. Google must never be a way around 2FA.
- **Break-glass:** Super Admin keeps an email + password (and 2FA) login that Google cannot disable.
- Session, cookies, rate limits and audit are Better Auth/Platform as today; log a `platform_audit_logs` row when Google is linked or unlinked on a platform account.
- Store owners get a "Connected accounts" panel in their profile to link or unlink Google, but cannot unlink the last working method.

**Super Admin controls** (section 5): platform Google client, on/off, "allow store owners to sign up with Google" switch.

## 4. Tier B: One Tap and Google sign-in for a store's customers (store-owned client)

### 4.1 Gate: verified custom domain
The option is hidden until the store has at least one domain with `type = 'custom'`, `status = 'active'` and a good SSL status.
- **Server-enforced.** `admin.socialAuth.setClientId`, `.verify` and enabling call `assertHasVerifiedCustomDomain(tenantId)` inside the tenant context. UI hiding is cosmetic.
- **Origins come only from active custom domains.** The `*.bcom.si` subdomain is never offered or registered.
- **Lifecycle.** If the last active custom domain is removed or goes inactive, Google customer sign-in stops (`verified_at` cleared). No fallback to the platform client: customers fall back to email + password and phone OTP. Adding or changing a custom domain requires re-verification.
- **Empty state.** Without a verified domain the card says so and links to Settings > Domains.

### 4.2 Store owner experience (as simple as it can get)
Settings > Customer accounts > **Sign in with Google** card:
1. **Unavailable** (Super Admin turned customer Google off): greyed "Not available yet".
2. **Needs a domain:** explanation + button to Domains.
3. **Ready to set up:** wizard.
   - Step 1 **Open Google Cloud** deep link, with copy buttons for the exact **Authorized JavaScript origins** (computed from the store's active custom domains, updates when domains change). Short checklist: create project, consent screen External, **publish to Production** (Testing mode limits sign-in to listed test users; the wizard asks and warns), scopes `openid email profile` only (no Google review needed for these).
   - Step 2 paste the **Client ID** (format check `*.apps.googleusercontent.com`). One Tap needs only the Client ID: **no client secret is requested or stored**, which also keeps the store's Google credentials out of our database.
   - Step 3 **Test sign-in:** runs the real One Tap on the store's own custom domain, sends the ID token through the same server verifier, confirms `aud` equals the pasted ID. Success sets `verified_at`. Failures map Google's errors (`origin_mismatch`, unpublished app, FedCM blocked) to a plain-English fix beside the failing value.
   - **Enable cannot be switched on until verified.**
4. **Active:** last verified time, sign-ins in the last 7 days, One Tap placement (login pages only), Disconnect.

What stays manual: Google offers no supported API to create the client (to be checked in phase 0), so steps 1 and 2 stay human. Everything else is automatic. If phase 0 finds a creation API, step 1 becomes a "Connect with Google" button with no change to the verification core.

Hints go behind (i) hover pop-ups, not inline text. Admin UI kit only, border tokens, drawers ~40% wide, `pendingComponent` on new admin routes (rule 11).

### 4.3 Security model (server-side, one function `verifyGoogleCredential()` in `packages/domain/src/customers/social/google.ts`)
1. Signature against Google's JWKS (cached), RS256, `iss` is `https://accounts.google.com` or `accounts.google.com`. Reuse Better Auth's `verifyGoogleIdToken` via a thin `@bs/auth` re-export; no new dependency.
2. `aud` equals **this store's** Client ID. A token for any other client is rejected.
3. `exp`/`iat` valid with small skew.
4. **Nonce** matches a server-issued single-use 5-minute value stored hashed in `action_tokens` (purpose `google_nonce`), consumed with the existing `usedAt IS NULL` guarded update (ADR-019). Blocks replay.
5. **`email_verified` must be true.**
6. Identity key is **`sub`**, never email.
7. Rate limit per `(tenant, IP)` with the existing PostgreSQL limiter; generic errors (no enumeration, ADR-019).

**Account linking (where social login usually gets hacked):**
- Match `(tenant, google, sub)` first, then verified email.
- Existing customer with that email and Google-verified email: link, set `emailVerified = true`, adopt guest orders now (ADR-019: only after email is verified).
- Existing row with a `passwordHash` but `emailVerified = false`: clear the hash and revoke sessions during linking, so an attacker's pre-set password cannot survive.
- Never across tenants. Same `sub` in two stores = two independent customers.
- Blocked or soft-deleted customers cannot sign in via Google.
- New customer: `emailVerified = true`, no password, no phone (phone is mandatory only at checkout).
- Google is additive and never a customer's only method; email recovery remains.

**Privacy (DPDP):** `accounts.google.com/gsi/client` loads only on pages that need it, only when the store enabled it, respecting the cookie banner. Add Google to `customerPrivacy.cookieInventory`. Erasure and export must cover `customer_identities`. The store is the controller of its Google client; the platform stores only the public Client ID.

## 5. Super Admin: "Authentication" card and section
- **IntegrationsHub:** 4th card **Authentication** (icon `ShieldCheck`) next to Notifications, Storage, Payments; grid `md:grid-cols-2 xl:grid-cols-4`. Badge "N methods active". Rows: Email & password, Phone OTP, Social (Google). Button **Manage Authentication** to `/integrations/auth`.
- **Route `/integrations/auth`** (`AuthHub.tsx`, pattern of `NotificationsHub.tsx`), built from a list of `AuthMethodSection` entries so later items (2FA policy, passkeys, session length) are added by adding an entry. Sections:
  - **Email:** stores using email+password; link to the mailer (Notifications > Email); shows "Mailer not configured" as a blocker.
  - **Phone:** stores using phone OTP; SMS channel status (currently "Not enrolled", shown as a warning).
  - **Social, Google**, two clearly separate panels:
    - *Platform sign-in (Tier A):* Client ID + write-only Client Secret, enable, "allow store owners to sign up with Google", "Test platform client" button, count of platform users with Google linked.
    - *Customer sign-in (Tier B):* master switch "Allow stores to offer Google sign-in to their customers", One Tap allowed, counts: stores eligible (verified custom domain), connected, active, sign-ins 7d. **No platform Client ID is involved; the panel states that each store uses its own Google app.**
    - Facebook/Apple rows "Coming later".
- Mutations: `assertRoleAtLeast("platform_admin")` in the domain service (rule 4), `platform_audit_logs` row (rule 6), added to `apps/platform/test/audit-coverage.int.test.ts`. Turning a switch off shows a `ConfirmDialog` with the affected count.

## 6. Data model (expand-only, rule 10)

```
customer_identities   (tenantTable + forceRlsSql)          -- Tier B
  id uuid v7 pk; customer_id -> customers (tenantForeignKey)
  provider text 'google'; subject text (Google sub); email text; created_at; last_login_at
  unique (tenant_id, provider, subject); index (tenant_id, customer_id)

store_social_auth     (tenantTable + forceRlsSql)          -- Tier B, one row per store
  provider 'google' unique (tenant_id, provider)
  enabled bool; client_id text
  verified_at timestamptz; verified_client_id text; updated_at

platform_auth_providers (platform table, no RLS; mirrors platform_payment_providers)
  provider pk ('email'|'phone'|'google'); kind; display_name; enabled; sort; updated_by; updated_at
  google only: customer_signin_allowed bool, one_tap_allowed bool, staff_signup_allowed bool

platform_google_client (single row, platform; mirrors platform_email_settings)  -- Tier A
  client_id text; client_secret_enc, iv; updated_by; updated_at
```

Staff Google identities need no new table: they use Better Auth's existing `accounts` (`providerId = 'google'`). Grants keep the role split (rule 9); add `b2-grants` rows. `customer_account_settings` invariant unchanged.

## 7. API and code layout
Contracts first (`packages/contracts`):
- Platform: `integrations.authOverview`, `.authProviders`, `.updateAuthProvider`, `.setPlatformGoogleClient`, `.testPlatformGoogleClient`.
- Admin (store): `admin.socialAuth.get`, `.update`, `.setClientId`, `.verify`, `.disconnect` (permission `settings.write`, confirm exact key; `assertPermission` in the service). Map each in `isolation.int.test.ts`.
- Storefront: `storefront.auth.googleConfig` (`{enabled, clientId, oneTap}` only), `.googleNonce`, `.googleSignIn({credential, nonce})`.

Domain (all logic, rule 3): `customers/social/google.ts`, `admin/social-auth.ts`, `platform/auth-providers.ts`. The verifier is injected through `Runtime` so tests stub Google's JWKS and run on the real database. Tenant-prefixed cache tags via `cache-invalidation.ts` (rule 5) for `googleConfig`.

Apps: `apps/web` customer login/register (Tier B button + One Tap, script lazy-loaded; use FedCM options per current GIS docs; `google.accounts.id.disableAutoSelect()` on logout) and `/signup` (Tier A); `apps/admin` login + Settings card + wizard + connected accounts; `apps/superadmin` login + hub. Check CSP for `accounts.google.com` only where needed. No merchant code runs on our servers (rule 8).

## 8. Phases and acceptance criteria

**Phase 0: spike (Claude, no merge).** Verify against current Google docs: no wildcard origins; FedCM requirements; publish-to-production and scope review rules; any API to create OAuth clients; consent-screen branding verification needs a domain the store owns. Verify Better Auth 1.7.10 `oneTap` + `accountLinking` behaviour and whether 2FA applies to social sign-in. Output: change record + ADR draft.
- AC: written verdicts; ADR drafted.

**Phase 1: Tier A (staff, owners, Super Admin) + Super Admin Authentication hub.** Platform Google client settings, Better Auth google + oneTap, link rules, 2FA enforcement, `/signup` with Google, `AuthHub` with Email/Phone/Social sections, audit.
- AC: unknown Google user cannot sign in to Super Admin; non-staff Google account cannot create platform staff; invited staff can link and sign in; unverified-email linking refused; 2FA still required after Google; owner signup via Google creates user + store exactly like email signup; platform switch off blocks it; every mutation audited; `pnpm gate` + `test:heavy` counts pasted.

**Phase 2: Tier B (customers).** Migration, `verifyGoogleCredential`, `signInWithGoogle`, custom-domain gate, wizard, test-sign-in verification, One Tap, cookie inventory, erasure/export.
- AC: subdomain-only store cannot read, set or verify a Client ID (API rejects); active custom domain can; removing the domain disables Google and falls back to email/phone; origins list never contains `*.bcom.si`; new / linked / unverified-with-password / blocked customer cases; two stores same `sub` stay separate; wrong `aud`, expired, replayed nonce, `email_verified=false`, forged signature rejected; tenant isolation test for both tables; **no code path lets a customer sign in with the platform client** (test asserts a platform-client token is rejected on the storefront).

**Phase 3: hardening.** Rate limits, store "connected accounts" for customers (unlink if another method exists), Super Admin metrics, runbook for the platform Google Cloud project, `DEPLOYMENT.md`/ARCHITECTURE updates, change record, `progress.md`.

Roles per `AGENTS.md`: Claude writes the ADR and verifies each phase; a builder takes one phase at a time. UI is walked locally at 375 px and desktop. Use a dedicated Google test project and test users; never a live store or production Google client without the owner's explicit yes.

## 9. Out of scope
Facebook, Apple, passkeys, 2FA policy UI, Shiprocket or any shipping work (rule 14), Google sign-in for customers on subdomain-only stores.

## 10. Owner decisions (all closed, 2026-10-23)
1. **Tier A Google project:** owned by one of the owner's own Google accounts. Configured from Super Admin (Authentication > Social > Google > Platform sign-in): Client ID, write-only Client Secret, enable, test button, plus an in-page setup guide that shows the exact origins and redirect URIs to paste (`admin.bcom.si`, `superadmin.bcom.si`, signup host, local dev) the same way the Payments page guides provider setup. Risks of a personal account, mitigated in phase 1: (a) keep a **break-glass email + password path for Super Admin** that Google can never disable, so a locked or lost Google account cannot lock us out; (b) record the account owner in the runbook; (c) consent screen set to External and **published to Production** with only `openid email profile`, using our legal pages from `docs/legal`.
2. **Store owner signup with Google: yes, from day one,** the moment Super Admin enables the platform client. The `staff_signup_allowed` switch defaults to on once the client is verified; it stays as a kill switch.
3. **No Workspace `hd` lock:** the team is not on Google Workspace. Super Admin Google sign-in is limited instead by "must already be a `platform_staff` row" (section 3). The `staff_hd` column is dropped from the data model.
4. **One Tap only on login pages** for customers. The "all pages" option is removed (`one_tap_scope` column dropped); One Tap renders on the customer login/register pages only.
5. **Google is never a customer's only method.** Email + password stays the baseline for every store. Mobile (phone OTP) login stays as is and is planned later as a premium-customer feature (a plan/feature-flag gate on `phoneOtpEnabled`); this plan changes nothing there, but the Authentication hub's Phone section is the place it will be gated.

## 11. Sources checked
Better Auth 1.7.10 source in this repo (`dist/plugins/one-tap`, token verifier, account linking). No network docs fetched. Google behaviours cited above are from my knowledge of Google Identity Services and **must be re-verified in phase 0** before becoming ADR text.
