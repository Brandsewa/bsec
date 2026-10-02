# ADR-017: Custom Domain Provider Adapter & Verification State Machine

- **Status:** Accepted
- **Date:** 2026-09-30
- **Plan reference:** PLAN §8, ADR-007, ADR-008

## Context
Custom domains allow merchants to serve storefront traffic on their own branded domain (e.g. `mystore.com`) rather than a platform subdomain (`{slug}.bcom.si`). Domain verification, TLS certificate issuance, and edge routing require integration with Cloudflare for SaaS custom hostnames.

Live credentials for third-party providers (Cloudflare API token, Zone ID) will be configured at the end of the project. Per project rules, third-party integrations must use real SDK/HTTP code behind a provider adapter (ADR-008 pattern), testable at the network edge, and report an honest disabled/unverified status when credentials are missing without fabricating live external success.

## Decision
1. **Domain Lifecycle State Machine:**
   The `domains.status` column tracks the domain connection state machine:
   ```
   requested → awaiting_dns → verifying → ssl_pending → active
       │              │ (48h)          │              │
       └──────────────┴─────► failed ◄─┴──────────────┘
                               active → removing → removed
   ```
   - Standard CNAME path: Merchant points CNAME to `stores.bcom.si`.
   - `prevalidate_txt` path: Merchant creates TXT verification records first so SSL is active before switching traffic, allowing zero-downtime cutover.
   - Primary domain rule: A domain can only become `is_primary = true` when its status is `active`.
2. **Provider Adapter Interface:**
   Defined in `packages/domain/src/domains/provider.ts`:
   - `createCustomHostname(hostname, opts)`
   - `getCustomHostnameStatus(hostnameId)`
   - `deleteCustomHostname(hostnameId)`
3. **Cloudflare SaaS Provider Implementation:**
   Real HTTP client calling Cloudflare v4 Custom Hostnames API:
   `https://api.cloudflare.com/client/v4/zones/{zone_id}/custom_hostnames`.
   When `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ZONE_ID` is unset:
   Returns `{ status: "unverified_needs_credentials", message: "Cloudflare credentials not configured" }`.
4. **Polling & Verification Worker:**
   A pg-boss background worker periodically polls Cloudflare status for non-terminal domains (`awaiting_dns`, `verifying`, `ssl_pending`), advancing them to `active` or `failed` (after 48 hours).

## Consequences
- Clean separation between internal domain state management and Cloudflare edge infrastructure.
- Zero downtime migrations for existing live stores.
