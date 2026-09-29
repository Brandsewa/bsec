# ADR-012: Customer Session Architecture and Documented Authentication Gap

- **Status:** Accepted (Documented Gap & Planned Design)
- **Date:** 2026-09-29
- **Plan reference:** PLAN §4, §5.3, §9, §13 (M4, M6, M7, M8)

## Context
During the M6 security review and audit of Store #1 readiness, an architectural gap was identified in the storefront customer authentication flow:
1. When a customer verifies an OTP via `/api/storefront/customer/otp/verify`, the response sets a cookie named `bs_customer_token`.
2. The current cookie payload contains an unsigned, base64-encoded JSON object (`{ tenantId, customerId, phone, ts }`).
3. No server-side route or middleware currently reads, verifies, or establishes a session from this cookie.
4. While a Better Auth customer instance (`createCustomerAuth`) and customer session schema (`customerSessions`) exist in `packages/auth/src/customer.ts`, they are not wired into the storefront Next.js routing pipeline.
5. In accordance with PLAN §9 and India commerce benchmarks, Store #1 operates with **guest checkout** as the primary purchasing flow: phone numbers, shipping addresses, and order lookups are tracked via session-neutral cart tokens, sequential order IDs, and cryptographically random single-use action tokens (`/o/[token]`, `/cod/[token]`).

Per M7 milestone directives, **no merchant-facing or customer-facing features are to be built** during M7 (which is strictly scoped to production hardening). Consequently, customer sessions remain an intentional, documented gap until M8.

## Decision
1. **Document Current State as a Gap**: Formalize that authenticated customer accounts are not currently active in Store #1 production paths. Guest checkout is the only active checkout mechanism.
2. **Prevent Client Trust**: Storefront endpoints must not trust or read `bs_customer_token` for authorization decisions until cryptographic signing and session validation are implemented.
3. **Target Session Architecture (M8 Implementation Specification)**:
   - **Session Store**: Server-side session records in the `customer_sessions` table, strictly foreign-keyed and isolated by `tenant_id`.
   - **Cookie Specification**:
     - Name: `__Host-cust` (enforced by modern browsers to require HTTPS, host-only domain, and root path `/`).
     - Flags: `HttpOnly = true`, `Secure = true`, `SameSite = "lax"`, `Path = "/"`.
     - Value: Cryptographically random 32-byte opaque session token (or HMAC-SHA256 signed JWT if stateless).
   - **Validation Boundary**:
     - Storefront requests will pass the session cookie to `buildTenantContext({ entryPath: "storefront", ... })`.
     - The resolver validates `session.tenant_id === context.tenant_id` and ensures `expires_at > now()`.
     - Expired or mismatched sessions will be cleared automatically.
   - **Authentication Handshake**:
     - OTP verification (`/api/storefront/customer/otp/verify`) will write an active session row in PostgreSQL and set the signed `__Host-cust` cookie.
     - Logout endpoint (`/api/storefront/customer/logout`) will revoke the session row and clear the cookie.

## Consequences
- **Security**: The unsigned `bs_customer_token` cannot be exploited for privilege escalation because no backend endpoint relies on it for authorization or data isolation.
- **Scope Discipline**: Preserves M7 focus on load testing, rate limiting, and infrastructure hardening without expanding into customer dashboard feature work.
- **Clarity**: Operators and auditors have a single source of truth explaining why customer login is inactive and how it will be activated in M8.

## Alternatives Considered
- **Rush Better Auth Customer wiring into M7**: Rejected because building customer profile, address management, and order history screens violates the M7 non-negotiable rule ("This milestone is pure hardening. Do not build any merchant-facing feature").
- **Stateless HMAC cookie without database sessions**: Rejected because revocation (e.g. customer logout across devices or suspicious activity lockout) requires server-side session tracking.
