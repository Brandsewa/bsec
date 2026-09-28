# Database migrations

Source: PLAN §13 (M0), §14 "Database migration safety", ADR-002, ADR-003.

## Who runs them
- Only **`app_owner`** runs migrations (`packages/db/src/scripts/migrate.ts` refuses any other role).
- Runtime roles (`app_rw`, `app_platform`) have DML only and can never change schema.
- Roles are created by `bootstrap-roles` with a **superuser** connection: once per environment, re-runnable.
- In deploys the `bsec-migrate` image runs **before** the new app images start (RUNBOOK §6).

The migrate step does three things, in order:
1. Drizzle migrations from `packages/db/migrations`.
2. pg-boss schema install/upgrade and queue creation (`packages/db/src/queues.ts`).
3. Grants on the `pgboss` schema for `app_rw` / `app_platform`.

## Writing a migration
```bash
# schema change → edit packages/db/src/schema/*.ts, then
pnpm --filter @bs/db generate --name <what_changed>
# SQL drizzle-kit cannot express (FORCE RLS, functions, backfills):
pnpm --filter @bs/db exec drizzle-kit generate --custom --name <what>
```
Every migration that creates a tenant table **must** include `forceRlsSql('<table>')` output (drizzle-kit only emits `ENABLE`). From M1 the isolation suite fails if any table in `tenantTableNames` lacks `relforcerowsecurity`.

## Expand → migrate → contract
No destructive change while an older app version may still be running (Coolify rolls containers one by one, and rollback must stay possible).

| Release | Step | Example: rename `products.name` → `title` |
|---|---|---|
| N | **Expand**: add new column/table, nullable or with default | `ADD COLUMN title text` |
| N | Code writes both, reads old | app writes `name` and `title` |
| N (job) | **Backfill** in batches | `UPDATE … SET title = name WHERE title IS NULL LIMIT 5000` loop |
| N+1 | Switch reads to new; still write both | |
| N+2 | Switch writes to new only; add `NOT NULL` via `CHECK … NOT VALID` then `VALIDATE` | |
| N+3 | **Contract**: drop old column | `DROP COLUMN name` |

Rules:
- Never `ALTER TABLE … ADD COLUMN … NOT NULL` without a default on a big table in one step.
- Indexes on existing tables: `CREATE INDEX CONCURRENTLY` in a custom migration (one statement per file, no transaction).
- Never rename or drop in the same release that stops using the thing.
- Rollback = redeploy the previous image tag; the schema is still compatible because contract steps lag by ≥1 release.
- Rehearse non-trivial migrations on staging against a restored production snapshot first.
