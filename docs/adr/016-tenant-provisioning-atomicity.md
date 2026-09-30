# ADR-016: Tenant Provisioning Atomicity, Idempotency & Unified Service Architecture

- **Status:** Accepted
- **Date:** 2026-09-30
- **Plan reference:** PLAN §6, §7 (step 5), §13 (M8)

## Context
A merchant store is an interconnected aggregate of 12+ foundational database records: tenant record, domain mapping, owner membership, system roles, store settings, tax defaults, legal policies, theme configuration, home page block document, navigation menus, default warehouse location, shipping zones and rates, payment methods configuration, onboarding checklist state, and trialing subscription.

If provisioning logic were split between self-signup and platform-side store creation, discrepancies would inevitably emerge. If provisioning were multi-transactional, any network error or database constraint violation midway through setup would leave orphan tenant rows, occupied subdomains, or missing default records.

## Decision
1. **Single Unified Domain Service:**
   Both self-service signup (`/api/signup`) and platform-side agency creation (`platform.tenants.create`) invoke the exact same core domain service: `provisionTenant(db, input)`.
2. **Single Transaction Boundary:**
   All 12+ tables are populated within one PostgreSQL transaction (`withTenant` / `db.transaction`). If any insert or constraint fails, the entire transaction rolls back cleanly with zero orphaned rows.
3. **Idempotency & Race Condition Prevention:**
   - Subdomain reservation (`slug_reservations`) enforces uniqueness at the database layer.
   - Concurrent double submissions are guarded by a unique constraint on `domains.hostname` and `tenants.slug`.
   - A re-attempted request with an active reservation or identical slug cannot create duplicate stores.
4. **Post-Commit Asynchronous Jobs:**
   Async jobs (welcome emails, sample catalog population, platform audit notifications) are enqueued only after the database transaction successfully commits.
5. **Strict Server Timing SLA:**
   Provisioning to first successful storefront render must execute in under 60 seconds of server time on a realistic stack, verified by real automated tests.

## Consequences
- Guaranteed structural consistency across self-signup and platform-created stores.
- Clean recovery and zero leaked state on provisioning aborts.
