# M6 Platform Security Review & Audit

**Date:** 2026-09-29  
**Scope:** Store #1 Production Readiness (PLAN §4, §5, §11, §13, §14, §15; ADR-008, ADR-011)  
**Audited Subsystems:** Authentication & Authorization, Storefront Checkout & Inventory, Payment & Shipping Webhooks (Razorpay, COD, Shiprocket), Credential Encryption & Key Management.  

---

## Executive Summary

This comprehensive security review audits the core security boundaries protecting Store #1 on the commerce platform. The evaluation verified that:
1. **Tenant Isolation & Authentication:** Strict separation exists between staff sessions (global users + memberships) and customer sessions (`__Host-cust` secure cookies). RBAC enforces 14 granular permissions across admin RPC routes.
2. **Checkout & Order Placement:** Zero client trust is maintained for product pricing and totals. Inventory reservation is protected against race conditions using atomic conditional SQL updates. Duplicate order placements are mitigated via database-backed idempotency keys.
3. **Webhook Ingestion & Verification:** All inbound webhooks (Razorpay, Shiprocket, COD) require cryptographic signature or token verification using decrypted per-tenant secrets. Sensitive payload properties (card numbers, CVVs, tokens, passwords) are scrubbed before persistence or logging. Webhooks are ingested into a decoupled inbox with database-level uniqueness constraints preventing replay attacks.
4. **Key Management & Fallback Hardening:** Production environments fail closed if `TENANT_SECRETS_KEY` or `ENCRYPTION_KEY` is missing. No hardcoded encryption keys are permitted in production execution paths.

---

## 1. Authentication & Authorization

### 1.1 Staff Authentication & Session Management
- **Implementation:** [`packages/auth/src/staff.ts:17-39`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/auth/src/staff.ts#L17-L39)
- **Mechanism:** Powered by Better Auth with Drizzle adapter over `users`, `sessions`, `accounts`, and `verifications` tables. Session cookies use prefix `bs-staff` (`STAFF_COOKIE_PREFIX`). Signing key sourced from `process.env.BETTER_AUTH_SECRET`.
- **Verdict:** `ok`
- **Notes:** Session tokens are stored in the database and validated on each admin request. In production, HTTPS enforcement ensures session cookies cannot leak in transit.

### 1.2 Customer Authentication & Cookie Security
- **Implementation:** [`packages/auth/src/customer.ts:19-60`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/auth/src/customer.ts#L19-L60)
- **Mechanism:** Better Auth customer instance backed by `customerSessions` table, isolated per tenant via `session.tenantId`. Cookie name is `__Host-cust` (`CUSTOMER_COOKIE`) with attributes `secure: true`, `httpOnly: true`, `sameSite: "lax"`, `path: "/"`.
- **Verdict:** `ok`
- **Notes:** Using the `__Host-` cookie prefix ensures modern browsers enforce that the cookie was set via HTTPS, originates from the exact host (no domain wildcards), and has path `/`. `useSecureCookies: false` prevents Better Auth from redundantly prepending `__Secure-`.

### 1.3 Role-Based Access Control (RBAC) & Middleware Enforcers
- **Implementation:** [`packages/auth/src/index.ts:9-38`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/auth/src/index.ts#L9-L38), [`apps/web/src/server/api.ts:24-58`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/apps/web/src/server/api.ts#L24-L58)
- **Mechanism:** 14 atomic permissions (`products.read`, `products.write`, `orders.read`, `orders.write`, `orders.refund`, `staff.manage`, etc.). `requireAdmin` resolves tenant context and user memberships. `requirePermission(perm)` validates permissions before invoking RPC/OpenAPI handlers.
- **Verdict:** `ok`
- **Notes:** Missing tenant context or missing permissions immediately rejects requests with 401 or 403 status codes.

### 1.4 Customer OTP Flow & Verification
- **Implementation:** [`packages/domain/src/customers/otp.ts:29-136`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/domain/src/customers/otp.ts#L29-L136)
- **Mechanism:**
  - OTP generation uses cryptographically secure integers (`randomInt(100000, 999999)`).
  - Raw OTP is never persisted: only SHA-256 hash (`hashOtp`) is stored in `customer_otps` table with 10-minute expiration (`expiresAt`).
  - Rate limiting enforces a maximum of 5 attempts (`record.attempts >= 5`).
  - Single-use consumption is enforced by updating `consumed_at = now()`.
- **Verdict:** `gap`
- **Findings & Remediations:**
  1. [`packages/domain/src/customers/otp.ts:85`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/domain/src/customers/otp.ts#L85): Hash comparison uses standard string inequality (`record.otpHash !== providedHash`) instead of `crypto.timingSafeEqual`. While SHA-256 hashes are fixed-length strings, constant-time comparison is recommended for defense-in-depth.
  2. [`packages/domain/src/customers/otp.ts:127-130`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/domain/src/customers/otp.ts#L127-L130): `verifyCustomerOtp` constructs an unsigned base64url JSON token string (`{ tenantId, customerId, phone, ts }`). For production storefront customer sessions, the platform uses Better Auth session cookies (`__Host-cust`), but this helper token should be cryptographically signed with HMAC if ever exchanged across network boundaries.

---

## 2. Storefront Checkout & Order Placement

### 2.1 Feature-Flagged Rollout & Dynamic Kill Switch
- **Implementation:** [`packages/domain/src/features.ts:24-87`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/domain/src/features.ts#L24-L87), [`packages/domain/src/orders/checkout.ts:83-86`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/domain/src/orders/checkout.ts#L83-L86)
- **Mechanism:** `isFeatureEnabled(db, tenantId, "checkout")` evaluates global kill switch, tenant override, and global default. When disabled, throws `FeatureDisabledError` which maps to HTTP 503 (`Service Unavailable`) at the storefront API boundary ([`apps/web/src/app/api/storefront/checkout/place-order/route.ts:100-106`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/apps/web/src/app/api/storefront/checkout/place-order/route.ts#L100-L106)).
- **Verdict:** `ok`
- **Notes:** Fail-open bypasses have been removed. Database errors or disabled flags fail safely and informatively.

### 2.2 Server-Side Price Calculation & Zero-Trust Pricing
- **Implementation:** [`packages/domain/src/orders/checkout.ts:88-100`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/domain/src/orders/checkout.ts#L88-L100)
- **Mechanism:** The order grand total is computed strictly on the server:
  - `subtotal` is aggregated from validated cart line items and database product variant snapshots.
  - Shipping fees (`15000` paise for express, `0` for standard) and COD fees (`5000` paise for COD) are added by server business logic.
  - Client-supplied prices, totals, or discounts in request bodies are ignored.
- **Verdict:** `ok`
- **Notes:** Prevents client-side price tampering or negative quantity exploits.

### 2.3 Atomic Inventory Reservation & Concurrency Safety
- **Implementation:** [`packages/domain/src/catalog/inventory-reservations.ts:31-70`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/domain/src/catalog/inventory-reservations.ts#L31-L70), [`packages/domain/src/orders/checkout.ts:102-126`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/domain/src/orders/checkout.ts#L102-L126)
- **Mechanism:** Atomic conditional update:
  ```sql
  UPDATE inventory_levels
     SET reserved = reserved + :qty, updated_at = now()
   WHERE tenant_id = :tenantId
     AND variant_id = :variantId
     AND location_id = :locationId
     AND (on_hand - reserved) >= :qty
  RETURNING id;
  ```
  If any item in the order lacks sufficient unreserved stock (`on_hand - reserved < qty`), the transaction aborts and all reservations in the batch are rolled back.
- **Verdict:** `ok`
- **Notes:** Protects against stock overselling under concurrent high-concurrency checkouts.

### 2.4 Sequential Order Number Allocation
- **Implementation:** [`packages/domain/src/orders/sequences.ts:16-56`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/domain/src/orders/sequences.ts#L16-L56), [`packages/domain/src/orders/checkout.ts:128-142`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/domain/src/orders/checkout.ts#L128-L142)
- **Mechanism:** Allocates gapless sequential order numbers using row locks (`SELECT ... FOR UPDATE` on `sequence_counters` table within the tenant transaction).
- **Verdict:** `ok`
- **Notes:** Compliant with Indian GST sequential invoicing and audit requirements.

### 2.5 Idempotency Key Handling & Replay Prevention
- **Implementation:** [`packages/domain/src/system/idempotency.ts:40-182`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/domain/src/system/idempotency.ts#L40-L182), [`packages/domain/src/orders/checkout.ts:88`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/domain/src/orders/checkout.ts#L88)
- **Mechanism:**
  - Idempotency key scoped per `(tenant_id, key, route)`.
  - Request payload SHA-256 hash verified: matching request returns cached status and response body.
  - Divergent request payload with same key throws `IdempotencyConflictError`.
  - Concurrent requests with same key acquire distributed lock (`locked_until`); concurrent contenders block or fail with `IdempotencyInFlightError`.
  - Shopping cart is cleared immediately upon order placement ([`packages/domain/src/orders/checkout.ts:240-244`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/domain/src/orders/checkout.ts#L240-L244)), preventing reuse of the same cart token.
- **Verdict:** `ok`

---

## 3. Webhook Ingestion & Provider Verification

### 3.1 Razorpay Webhooks
- **Route Handler:** [`apps/web/src/app/api/webhooks/[provider]/route.ts:59-63`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/apps/web/src/app/api/webhooks/%5Bprovider%5D/route.ts#L59-L63)
- **Provider Verification:** [`packages/payments/src/providers/razorpay.ts:231-256`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/payments/src/providers/razorpay.ts#L231-L256)
- **Mechanism:**
  - Fetches decrypted credentials from `tenant_secrets` using `getTenantPaymentSecrets`.
  - Computes HMAC-SHA256 signature over raw request body buffer using tenant's decrypted `webhookSecret`.
  - Compares computed signature with `x-razorpay-signature` header via `timingSafeEqual`.
  - Fails closed: if secret or signature is absent, `isValid` is `false`.
  - Cleanses sensitive parameters via `sanitizePaymentPayload` before persisting to `webhook_inbox`.
  - Decoupled ingest: returns HTTP 200 immediately to gateway; processing happens asynchronously via `processWebhookInboxItem`.
  - Replay prevention: unique index on `(provider, event_id)` prevents duplicate processing.
  - Inbox processing rejects unverified signatures before business logic runs ([`packages/domain/src/system/webhooks.ts:144-156`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/domain/src/system/webhooks.ts#L144-L156)).
- **Verdict:** `ok`

### 3.2 Cash on Delivery (COD) Confirmation & Action Tokens
- **Route Handler:** [`apps/web/src/app/api/webhooks/[provider]/route.ts:64-73`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/apps/web/src/app/api/webhooks/%5Bprovider%5D/route.ts#L64-L73)
- **Action Token Flow:** [`packages/domain/src/orders/actions.ts:17-65`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/domain/src/orders/actions.ts#L17-L65)
- **Mechanism:**
  - COD webhook route serves as a fail-closed safety net using HMAC-SHA256 verification (`CODProvider.verifyWebhook` at [`packages/payments/src/providers/cod.ts:95-133`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/payments/src/providers/cod.ts#L95-L133)).
  - Primary customer confirmation flow is executed via action tokens:
    - Random 16-byte cryptographic action token is generated upon checkout.
    - Only SHA-256 hash of token is stored in `action_tokens` with purpose `cod_confirmation` and 48-hour expiration.
    - Confirming via customer link updates `used_at = now()` atomically; duplicate visits fail with `"Invalid, expired, or already used COD confirmation link"`.
    - Successful confirmation transitions order status and commits inventory reservations.
- **Verdict:** `ok`

### 3.3 Shiprocket Tracking Webhooks
- **Route Handler:** [`apps/web/src/app/api/webhooks/[provider]/route.ts:74-78`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/apps/web/src/app/api/webhooks/%5Bprovider%5D/route.ts#L74-L78)
- **Provider Verification:** [`packages/shipping/src/providers/shiprocket.ts:350-422`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/shipping/src/providers/shiprocket.ts#L350-L422)
- **Mechanism:**
  - Receives status updates (`shipped`, `in_transit`, `out_for_delivery`, `delivered`, `rto`).
  - Supports HMAC-SHA256 signature in `x-shiprocket-signature` header or shared webhook token in `x-api-key`.
  - Both HMAC comparison and shared token comparison use `crypto.timingSafeEqual` over UTF-8 byte buffers.
  - Fails closed if store hasn't configured a webhook secret (`isValid = false`).
  - Decoupled ingest: raw payload ingested into `webhook_inbox` and processed idempotently via `handleFulfillmentDeliveredJob` / `handleFulfillmentShippedJob` in `jobs.ts`.
- **Verdict:** `ok`

---

## 4. Secret Storage & Cryptographic Encryption

### 4.1 Tenant Secret Storage & Encryption Fallbacks
- **Implementation:** [`packages/payments/src/crypto.ts:7-38`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/payments/src/crypto.ts#L7-L38)
- **Mechanism:**
  - AES-256-GCM authenticated encryption with random 12-byte initialization vectors (`iv`) and 16-byte authentication tags.
  - Master key read from `TENANT_SECRETS_KEY` or `ENCRYPTION_KEY`.
  - **Production Hardening:** When `NODE_ENV === "production"` or `APP_ENV === "production"`, `normalizeKey()` strictly throws if no master key is supplied. Hardcoded fallback keys are only permitted in local dev/test environments.
  - **Startup Verification:** `assertProductionEncryptionKeySet()` executes during service boot in `platform` (`apps/platform/src/main.ts`), `worker` (`apps/worker/src/main.ts`), and `web` (`apps/web/src/instrumentation.ts` / `apps/web/src/server/runtime.ts`). Services fail loudly on startup if the key is missing.
- **Verdict:** `ok`

---

## 5. Summary Findings & Action Items

| Subsystem | Area / File:Line | Severity | Verdict | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Auth** | [`packages/auth/src/staff.ts:17`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/auth/src/staff.ts#L17) Staff Better Auth | High | `ok` | Active & Enforced |
| **Auth** | [`packages/auth/src/customer.ts:19`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/auth/src/customer.ts#L19) `__Host-cust` Cookie | High | `ok` | Active & Enforced |
| **Auth** | [`packages/domain/src/customers/otp.ts:85`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/domain/src/customers/otp.ts#L85) OTP Hash Equality | Low | `gap` | Recommend `timingSafeEqual` |
| **Auth** | [`packages/domain/src/customers/otp.ts:127`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/domain/src/customers/otp.ts#L127) OTP Unsigned Helper Token | Low | `gap` | Storefront uses Better Auth; deprecate or sign helper token |
| **Checkout** | [`packages/domain/src/orders/checkout.ts:83`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/domain/src/orders/checkout.ts#L83) Feature Flag 503 Rejection | High | `ok` | Active & Verified |
| **Checkout** | [`packages/domain/src/orders/checkout.ts:95`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/domain/src/orders/checkout.ts#L95) Server-Side Price Totals | High | `ok` | Active & Verified |
| **Checkout** | [`packages/domain/src/catalog/inventory-reservations.ts:31`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/domain/src/catalog/inventory-reservations.ts#L31) Atomic Stock Reservation | Critical | `ok` | Active & Verified |
| **Checkout** | [`packages/domain/src/system/idempotency.ts:40`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/domain/src/system/idempotency.ts#L40) Idempotency Key Engine | High | `ok` | Active & Verified |
| **Webhooks** | [`apps/web/src/app/api/webhooks/[provider]/route.ts:59`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/apps/web/src/app/api/webhooks/%5Bprovider%5D/route.ts#L59) Razorpay HMAC Verification | Critical | `ok` | Active & Verified |
| **Webhooks** | [`packages/payments/src/providers/razorpay.ts:22`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/payments/src/providers/razorpay.ts#L22) Payment Payload Scrubbing | High | `ok` | Active & Verified |
| **Webhooks** | [`packages/domain/src/orders/actions.ts:17`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/domain/src/orders/actions.ts#L17) COD Single-Use Action Token | High | `ok` | Active & Verified |
| **Webhooks** | [`packages/shipping/src/providers/shiprocket.ts:370`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/shipping/src/providers/shiprocket.ts#L370) Shiprocket Webhook Signature | High | `ok` | Hardened with `timingSafeEqual` |
| **Crypto** | [`packages/payments/src/crypto.ts:7`](file:///c:/Users/razzd/OneDrive/Desktop/AI%20Projects/bs-commerce-platform/bsec/packages/payments/src/crypto.ts#L7) AES-GCM Key Fallback Hardening | Critical | `ok` | Verified & Loud Crash in Prod |

---

## 6. Audit Verdict

**Overall Readiness Status:** **APPROVED for Store #1 Production Soak**  
The platform's authentication, authorization, transactional checkout, and webhook ingestion mechanisms meet the architectural, compliance, and security criteria defined in PLAN §4, §11, and §13.
