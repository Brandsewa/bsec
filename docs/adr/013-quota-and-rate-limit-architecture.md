# ADR-013: Platform-Scoped Quota and Rate Limit Architecture

- **Status:** Accepted
- **Date:** 2026-09-29
- **Plan reference:** PLAN §13, §14, §15 (Milestones M7, M8)

## Context
In a multi-tenant commerce platform, resource exhaustion and noisy neighbour interference represent existential threats to availability. A single tenant experiencing an aggressive traffic spike, running unconstrained background jobs, or suffering a credential stuffing attack must never saturate database connection pools, memory, or CPU at the expense of other stores.

Milestone M7 introduces five core tables to govern resource consumption across tenants:
1. `quota_definitions`: Standard quota tiers across tenant sizing (XS, S, M, L).
2. `tenant_size_tiers`: Mapping of each tenant to their assigned tier (default XS).
3. `tenant_quota_overrides`: Per-tenant custom overrides for specific quota keys.
4. `rate_limit_counters`: Fixed-window atomic counters tracking request volumes.
5. `tenant_active_jobs`: Tracking concurrent running background jobs per tenant.

Unlike commerce entities (orders, products, customers) which use `tenantTable()` and Row Level Security (`FORCE RLS`), these tables are architecturally designed as **platform-scoped tables without RLS**.

## Decision
1. **Platform Scoping Without RLS**:
   - Quota definition, tier assignment, global counters, and concurrency trackers operate across tenant boundaries.
   - For example, `rate_limit_counters` records IP-level counters (`otp:req:ip:<ip>`), provider-level webhook counters (`rate:webhook:<provider>:<ip>`), and cross-tenant noisy neighbour aggregations (`rate:storefront:tenant:<id>`).
   - If these tables had RLS enabled, a connection operating under `SET LOCAL app.tenant_id = 'tenant-A'` could never inspect or record IP-wide counters, compare traffic across stores, or update system-wide job concurrency.

2. **Security & Write Permission Boundary**:
   - Write operations to `quota_definitions`, `tenant_size_tiers`, and `tenant_quota_overrides` are strictly restricted to the `app_platform` role and internal platform services (`apps/platform`).
   - Tenant staff and merchant admins using `app_rw` have zero write privileges on quota configuration tables. Tenants cannot self-assign tiers or override their own rate limits.
   - Counter increments in `rate_limit_counters` and job slot leasing in `tenant_active_jobs` execute via atomic SQL statements executed by application runtime services, but the tables themselves are shielded from direct tenant manipulation.

3. **Rate Limiting Policies & Defaults**:
   - **Storefront Starting Quota**: 3,000 req/min default (Tier XS, seeded by migration 0009 and covered by a test on a store with no tier row). Every storefront call, including page views passing the middleware status check, counts. Avoids false-positive 429s during launch campaigns or crawler traffic.
   - **Admin Starting Quota**: 600 req/min default (Tier XS). Generous limit for administrative bulk workflows.
   - **Webhooks**: 300 req/min per provider + IP. Crucially, a webhook bearing a valid cryptographic signature **bypasses or avoids rate-limiting into failure**, ensuring genuine payment captures and fulfillments are never dropped due to attacker spoofing floods.
   - **OTP Protection**: Multi-layered defense with a mandatory 60-second cooldown per phone number across all IPs, combined with per-phone (3/10min), per-IP (5/10min), and per-tenant (50/10min) limits.

4. **Failure Modes**:
   - **Storefront Read Requests**: Fail open with a warning log if database rate limit checks fail. A database glitch must not bring down store browsing.
   - **Security Endpoints (Login, OTP, Checkout, Webhook verification)**: Fail closed. Brute-force and spoofing defenses must hold even during degraded database states.

5. **Pruning & Slot Reaping**:
   - `cleanExpiredRateLimits`: Periodic scheduled task pruning rows where `expires_at < now() - INTERVAL '1 hour'` to prevent unbounded disk growth.
   - `reapStaleTenantJobSlots`: Automatic reset of active job slots with a 30-minute stale threshold to prevent worker crashes from permanently locking tenant concurrency. Both run from the worker's existing 15-minute maintenance job (`idempotency.cleanup`), and the worker also releases any slots left over from the previous process on boot (every deploy restarts it).

## Consequences
- **Positive**: Complete defense against noisy neighbours and single-store runaway traffic without degrading overall platform availability.
- **Positive**: Legitimate payment captures are protected from being dropped during DDoS or webhook floods.
- **Positive**: Clean separation of privilege: platform operators control quotas, tenants operate within them.
- **Negative / Operational Requirement**: Requires running periodic maintenance tasks (`cleanExpiredRateLimits` and `reapStaleTenantJobSlots`) to maintain table hygiene.
