# Audit A1: tenant isolation and row-level security

- **Date:** 2026-11-15
- **Auditor:** claude
- **Plan:** `docs/PLATFORM-AUDIT-PLAN.md` section A1
- **Code audited:** `main` e152e4b plus the dependency bumps of PR #274
- **Database:** local test Postgres 18, migrated template (migrations up to 0113). Nothing was run against production.

## Result

No way for one store to read or change another store's data was found. The database layer is in good shape. Four items need attention, none above Medium, one of them needs a live check by the owner.

| ID | Severity | Title | Status |
|---|---|---|---|
| A1-01 | Low | The store runtime role can read and write shared tables that have no row-level security | open |
| A1-02 | Unconfirmed (Medium if true) | Store is chosen from `X-Forwarded-Host` before `Host` | open, needs a live check |
| A1-03 | Low | A pending custom domain blocks the hostname for every other store | open, partly checked |
| A1-04 | Low | `TenantContext or string` overloads skip the permission check when given a string | open |

## Findings

### A1-01 The store runtime role can use shared tables that have no row-level security (Low)

- **Rule or ADR:** ADR-002, rule 9 ("do not widen grants casually").
- **Where:** grants in the migrations; listed by `scripts/audit-rls.sql` block 7.
- **Facts:** 125 tables have a `tenant_id`. 108 have forced row-level security. 17 do not, on purpose (platform tables). Of those, `app_rw` (web and worker) holds: all rights on `domains`, `webhook_inbox`, `tenant_active_jobs`; INSERT and SELECT on `platform_audit_logs`; SELECT on `platform_invoices`, `subscriptions`, `tenant_owner_invites`, `quota_events`, `tenant_quota_overrides`, `tenant_size_tiers`. It also holds all rights on the global identity tables `users`, `sessions`, `accounts`, `verifications`, and SELECT on `tenants` and `signup_leads`.
- **Expected:** a bug or injection in store code cannot reach other stores' rows.
- **Actual:** for these tables only the `where tenant_id = ...` in application code stands between stores. The custom domains service was read end to end and filters by tenant in every query. The other call sites (about 90, mostly `saas/billing.ts`, `admin/plan-and-billing.ts`, `system/webhooks.ts`) were listed but not all read.
- **Suggested fix (M):** add a tenant policy to the tables the store runtime only ever uses for its own store (`platform_invoices`, `subscriptions`, `tenant_size_tiers`, `tenant_quota_overrides`, `quota_events`, `tenant_active_jobs`), keeping `app_platform` on BYPASSRLS; revoke SELECT on `platform_audit_logs` and `signup_leads` from `app_rw` if nothing reads them (check first); leave `domains` readable for host lookup but restrict writes with a policy.

### A1-02 Store is chosen from `X-Forwarded-Host` before `Host` (Unconfirmed)

- **Where:** `packages/domain/src/context.ts:260`, `apps/web/src/server/customer-session.ts:52`, and about 45 route handlers under `apps/web/src/app/api/storefront/`.
- **Risk:** if the proxy chain (Cloudflare, then Traefik) forwards a client-supplied `X-Forwarded-Host`, a request sent to store A's hostname is answered as store B. Sessions and carts are tenant-scoped, so this does not expose private data by itself, but it allows a page of store B to be served, and possibly cached, under store A's address.
- **Not confirmed:** Traefik normally overwrites this header with the real host. That depends on its `forwardedHeaders` settings, which are not in the repo (`infra/` has no Traefik config).
- **Live check needed (owner's yes):** `curl -H "X-Forwarded-Host: <other-store-host>" https://<store-host>/` and compare the page with the real store.
- **Suggested fix (S):** one helper `requestHost(headers)` used everywhere, and the proxy setting written down in `DEPLOYMENT.md`.

### A1-03 A pending custom domain blocks the hostname for every other store (Low)

- **Where:** `packages/domain/src/domains/service.ts:189` (uniqueness check on any status except `removed`), unique index `domains_hostname_unique`.
- **Steps:** store A adds `shop.example.com` without owning it; store B, the real owner, gets "already registered or connected to a store".
- **Partly checked:** the sweep (`sweepPendingCustomDomains`) retries pending domains; whether it ever expires one that never verifies was not read to the end.
- **Suggested fix (S):** expire unverified domains after a fixed time, or let a second store claim a hostname that is not verified.

### A1-04 `TenantContext or string` overloads skip the permission check (Low)

- **Rule:** rule 4.
- **Where:** `packages/domain/src/domains/service.ts` (6 functions), `packages/domain/src/orders/shipping-rates.ts` (4 functions): `if (typeof ctxOrTenantId !== "string") assertPermission(...)`.
- **Actual:** every current caller in `apps/web/src/server/api.ts` passes a context, so nothing is exposed today. A future caller that passes a bare tenant id gets no permission check and no error.
- **Suggested fix (S):** keep only the `...Internal` variants for trusted callers and make the public ones take a context.

## Checks that passed

| Check | How | Result |
|---|---|---|
| Every store table has ENABLE and FORCE row-level security and a policy | `scripts/audit-rls.sql` block 1 | 108 of 108 |
| Policy predicate is the standard one, for all commands, with a WITH CHECK | block 3 | 2 extra policies, both reviewed: `memberships_self_read` (a user reads their own memberships, SELECT only) and `products.market_visibility` (restrictive, narrows only) |
| References between store tables carry the tenant | block 4 | 1 hit, `platform_invoices.subscription_id`, both platform tables |
| Unique indexes on store tables include the tenant | block 5 | 2 hits, both fine: session token, policy version |
| Role attributes | block 6 | only `app_platform` bypasses row-level security, none is superuser |
| SECURITY DEFINER functions | block 8 | 1, with a fixed `search_path` |
| Admin requests: store from `X-Store-Id` plus an active membership read under that store's RLS | read `packages/domain/src/context.ts` | pass |
| Admin API procedures carry the sign-in guard | `scripts/audit-api-guards.mjs` | 371 parsed; 2 without it, both by design (`admin.me.get`, `admin.memberships.acceptInvite`) |
| In-memory caches are keyed by store | read the 6 `Map` caches in `packages/domain/src` | pass |
| Cache tags carry the tenant | `pnpm lint` (`bs/tenant-cache-tag`) | pass |
| Another store cannot settle this store's payment | existing `razorpay-checkout.int.test.ts` | pass (existing test, not re-run here) |

## Not checked

- Diff of the contract router against the isolation suite map (CI already fails when an `admin.*` procedure is unmapped; not re-verified by hand).
- Whether every `app_platform` query in `packages/domain/src/platform*` and `saas/` filters by tenant (only the role guards were checked, see A2).
- The `app_saas` call sites and whether its grants are wider than they need.
- Worker consumers setting the tenant before querying.
- Media and R2 key scoping, import and export file scoping.
