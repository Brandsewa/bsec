# ADR-019: Customer Authentication and Platform Transactional Mailer

- **Status:** Accepted
- **Date:** 2026-10-02
- **Plan reference:** `docs/AUTH-OVERHAUL-PLAN.md` (extends ADR-012)

## Context
Prior to this overhaul:
1. Storefront authentication relied exclusively on mobile SMS/OTP, leaving customer email/password unhandled and creating risk of identity splits.
2. A separate Better Auth customer instance existed in `packages/auth/src/customer.ts` but was unwired to storefront routing and used separate schemas (`users`, `accounts`, `verifications`), risking table fragmentation.
3. Transactional emails (e.g. order confirmations) relied on per-tenant Resend credentials, which posed operational friction and prevented centralized deliverability management.
4. Staff invitations and password reset flows lacked unified rate limiting, anti-enumeration protections, and automated session revocation.

## Decisions

### 1. Unified Customer Identity on `customers` Table
- Rather than maintaining parallel user tables, storefront customer identity resides directly in the existing `customers` table with an argon2id `passwordHash`, `emailVerified` (boolean), and `phoneVerified` (boolean).
- Mobile phone (`customers.phone`) is now optional at account registration and in customer profiles, but remains mandatory at checkout.
- Customers can log in using either email + password or phone OTP. Both authenticate into the same customer record.
- Unused customer Better Auth instance (`createCustomerAuth` in `packages/auth/src/customer.ts`) is deprecated in favor of direct domain operations in `packages/domain/src/customers/auth.ts`.

### 2. Opaque Customer Sessions with Cross-Tenant Isolation
- Sessions are managed via `customer_sessions` table (`packages/domain/src/customers/session.ts`) using 32-byte cryptographically secure random tokens stored as SHA-256 hashes at rest.
- Customer session cookies are host-only, httpOnly, secure in production, with `SameSite=Lax`.
- All customer queries and session validations enforce strict tenant scoping inside `withTenant`. A session token minted on Store A is immediately rejected on Store B.
- Password reset and password change operations revoke existing sessions: password resets invalidate all active sessions for the customer, while change-password supports selective revocation of other sessions.

### 3. Action Tokens for Verification & Password Reset
- Verification and password reset tokens use the `action_tokens` table with single-use consumption (`usedAt IS NULL` guarded update) and short lifetimes (24 hours for email verification, 1 hour for password reset).
- Tokens are bound to `tenant_id` and hashed with SHA-256 at rest.
- Guest orders placed with an email are adopted by the customer account only after that email address is successfully verified.

### 4. Anti-Enumeration & Defensive Rate Limiting
- Registration, login, and forgot-password endpoints return generic responses to prevent account enumeration.
- Submitting an already-registered email on registration returns success without disclosing account existence or creating a session.
- Submitting an unknown email on password reset returns the same generic confirmation message.
- Multi-tier rate limiting is enforced in PostgreSQL per `(tenant, IP)` and per `(tenant, email)` for login, registration, and reset requests.

### 5. Centralized Platform Transactional Mailer (Zoho ZeptoMail)
- Platform-wide transactional emails are routed through a dedicated platform mailer (`packages/domain/src/system/platform-mailer.ts`) backed by `nodemailer` over SMTP (Zoho ZeptoMail).
- SMTP credentials (including Send Mail Tokens) are configured by Super Admin at `/email` in the Superadmin UI, stored with AES-256-GCM symmetric encryption in `platform_email_settings`, and never displayed in plain text or returned across API boundaries.
- All transactional emails originate from `no-reply@gobs.cloud`, using the specific store's name as the display name and the store's support email as the `reply-to` address.
- Per-tenant Resend API keys are decommissioned and removed from order email workflows.

## Consequences
- Single source of truth for customer identity, eliminating synchronization bugs between Better Auth tables and the commerce `customers` table.
- Consistent transactional email deliverability and centralized auditing via `platform_email_log`.
- Storefront routes and account UI now support full self-service password and email workflows alongside phone OTP.
- All pre-push checks (`pnpm typecheck`, `pnpm lint`, `pnpm build`, vitest integration suites) pass across all monorepo packages.
