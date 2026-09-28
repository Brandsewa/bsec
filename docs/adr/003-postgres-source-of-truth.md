# ADR-003: PostgreSQL as the source of truth

- **Status:** Accepted
- **Date:** 2026-09-28
- **Plan reference:** PLAN §2, §5, §11, §14

## Context
We need transactional commerce (orders, stock, payments, numbering), jobs, search, rate limits and caching on a single small server, with a clear backup and restore story.

## Decision
PostgreSQL 18 holds all state: business data, the job queue (pg-boss), idempotency keys, webhook inbox, rate-limit buckets (unlogged table) and search (FTS + `pg_trgm`). Drizzle ORM + drizzle-kit manage the schema; `uuidv7()` keys, `citext`, `pg_trgm`. Money is `bigint` paise + `char(3)` currency. Other stores (Typesense, Valkey) are later **projections**, never the source of truth.

Migrations run only as `app_owner` and follow **expand → migrate → contract** (`docs/migrations.md`). Backups: pgBackRest full weekly, differential daily, WAL archived to R2 with `archive_timeout = 60s`; RPO ≤ 15 min, RTO ≤ 2 h; a backup counts only after a restore test.

## Consequences
- One transaction covers order + reservation + number sequence + job enqueue (transactional outbox).
- Postgres is a single point of failure until the upgrade stage in PLAN §14; mitigated by PITR and a tested restore runbook.
- Postgres is never exposed publicly (private Docker network only).

## Alternatives considered
- **Redis for queue/cache on day 1:** extra moving part and a second durability story; deferred until a trigger is hit.
- **Elasticsearch/Typesense on day 1:** unnecessary for small catalogs; deferred.
