# ADR-038: Google sign-in: platform client for our team and store owners, store-owned client for customers

- **Status:** Accepted
- **Date:** 2026-10-23
- **Plan reference:** `docs/GOOGLE-SIGNIN-PLAN.md` (extends ADR-014 and ADR-019)

## Context
Staff, store owners and Super Admin sign in through Better Auth. Shoppers sign in through our own customer auth (ADR-019). Neither had social sign-in. Google does not allow wildcard Authorized JavaScript origins and, to our knowledge, offers no supported API to create OAuth clients, so One Tap only works on origins registered by hand on a Google client. Each store has its own origin (a `bcom.si` subdomain or a custom domain).

## Decisions

### 1. Two tiers with different owners
- **Tier A, platform Google client, for our own users only:** Super Admin staff, platform staff, store owners and store staff. One client owned by an owner's Google account, configured in Super Admin (Authentication hub). Its origins are a small fixed set (`admin.`, `superadmin.`, signup host, local dev).
- **Tier B, a store's own Google app, for that store's customers only.** The platform Google client is never used for customers. If it were, the platform would sit between every shopper and Google across all stores, which looks like collecting merchants' customer data and blurs who controls it under DPDP.

### 2. Tier B is gated on a live custom domain
Tier B (Client ID, test, enable) requires Super Admin's customer switch and at least one domain with `type = custom` and `status = active`. This is enforced in the domain service, not only in the UI. Origins offered to the owner come from live custom domains only; the platform subdomain is never offered. A store's own consent screen can only be branded and verified against a domain the store owns. If the last live custom domain goes away, Google customer sign-in stops (customers keep email and phone); there is no fallback to the platform client.

### 3. Tier A on Better Auth, existing accounts only
`socialProviders.google` (as a function reading the encrypted platform settings) and the `oneTap` plugin on the staff and platform instances, with implicit sign-up off. Account linking needs Google to confirm the email. If the existing user never verified their own email (every owner who signed up with email and password), `googleAccountLinkGuard` first removes that user's password login and all sessions and marks the email verified, so a password set by someone who pre-registered the address cannot survive the link; the real owner sets a new one with "Forgot password". A verified account is linked untouched. (Amended 2026-10-24: the first version refused to link unverified owners, so they could not use Google.) Store-owner signup with Google uses our own signup flow: a server-verified ID token (audience = platform client, bound to a signed stateless nonce) yields a signed ticket that replaces the password, so the store is always created for the email Google verified. Better Auth's two-factor hook only covers email, username and phone sign-in, so a Google sign-in would skip the second factor; `googleSessionGuard` refuses Google for any account with two-factor enabled, and for Super Admin for anyone who is not active platform staff. Super Admin also keeps its email, password and authenticator login, which Google can never disable.

### 4. Tier B on our customer auth, not Better Auth
ADR-019 keeps customer identity in `customers` with opaque sessions. Tier B reimplements the short, well-defined One Tap flow in `packages/domain`: verify the ID token (signature, issuer, audience = the store's Client ID, expiry, `email_verified`), a server nonce bound to tenant and host and consumed once, identity key = Google `sub` in `customer_identities` (unique per tenant). Linking by verified email only; a row with a password but an unverified email has that password cleared and its sessions revoked so a pre-registered attacker password cannot survive; blocked customers cannot sign in; the same `sub` in two stores is two customers. Only the public Client ID is stored: One Tap needs no secret.

### 5. Setup test runs on the store's own domain
Google runs the prompt only on registered origins, so the admin app (another origin) cannot test the store's client. The owner is sent to `/account/google-verify` on the store's custom domain with a short-lived signed ticket; a successful real sign-in there sets `verified_at`, `verified_client_id` and `verified_host`. Enabling needs a valid verification; changing the Client ID or losing that domain voids it.

### 6. Rate limits and privacy
Customer Google sign-in is limited per (tenant, IP) only; a shared per-email bucket would let one visitor lock every shopper out. Google's script loads only where it is used (the sign-in page, the sign-up form, and, for One Tap, the store home page and content pages; amended 2026-10-27 by the owner), only when the store enabled it, and never for a signed-in visitor, and Google is mentioned in the admin card for the store's privacy policy. Erasure and export cover `customer_identities`.

## Consequences
- New tables: `platform_auth_providers`, `platform_google_client` (migration 0076), `store_social_auth`, `customer_identities` (migration 0077).
- Super Admin Integrations gains an Authentication card and `/integrations/auth`.
- A store without a custom domain has no Google sign-in for its customers.
- Super Admin accounts that use an authenticator cannot use Google. Platform MFA is on by default, so in practice Google is for store owners and staff, and for Super Admin only while a platform member has no authenticator.
- Verifying the pasted Client ID still needs the owner to create the Google app by hand; Google offers no supported way to automate it.
