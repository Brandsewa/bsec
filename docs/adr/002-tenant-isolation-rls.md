# ADR-002: Tenant isolation via Postgres RLS

- **Status:** Accepted
- **Date:** 2026-09-28
- **Plan reference:** PLAN §4, §5

## Context
All stores share one database and schema. A missing `WHERE tenant_id = …` in any query would leak one store's data to another. Application-level filtering alone is one bug away from a breach.

## Decision
Three layers:
1. **Context:** tenant resolved from the host (storefront) or session membership + `X-Store-Id` (admin), never from client input. Every domain service takes `ctx`.
2. **RLS:** every tenant table has `tenant_id uuid not null`, `ENABLE` and `FORCE ROW LEVEL SECURITY`, and the policy
   `tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid` for `USING` and `WITH CHECK`.
   Queries run inside `withTenant(ctx, tx => …)` which does `SET LOCAL app.tenant_id`.
3. **Composite FKs:** `(tenant_id, x_id)` so a row can never reference another store's row.

Roles:
- `app_owner` owns tables, runs migrations only. `FORCE` makes RLS apply to it too.
- `app_rw` (NOBYPASSRLS, DML only) for `web` and `worker`.
- `app_platform` (BYPASSRLS, DML only) **only** in the `platform` container, exposing named platform functions that write `platform_audit_logs`.

`nullif` is required: after a `SET LOCAL` transaction ends, the setting reads back as `''` on the same pooled connection and `''::uuid` raises an error. With `nullif` the result is zero rows, not an error.

Tables are declared through `tenantTable()` (`packages/db/src/tenant-table.ts`; stub in M0, full in M1). drizzle-kit cannot emit `FORCE`, so each tenant-table migration includes `forceRlsSql(name)`.

## Consequences
- Verified in M0 on PG 18 (`packages/db/test/roles.int.test.ts`): owner sees 0 rows under FORCE, cross-tenant insert rejected, empty setting returns 0 rows, BYPASSRLS reads all.
- M1 exit adds the generated isolation suite across every procedure.
- Every query pays a small policy-evaluation cost; indexes start with `tenant_id`.
- BYPASSRLS credentials must never reach the web or worker containers (deployment checklist item).

## Alternatives considered
- **Schema per tenant / database per tenant:** migrations × N, connection explosion, poor fit for 50–150 small stores.
- **App-level filtering only:** single point of failure; rejected.
