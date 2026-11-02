# Outage from a stuck migration: lock limit on migrations, and two queues that were never created

- **Date:** 2026-11-02
- **Agent:** claude
- **Branch:** `fix/migration-lock-timeout` (merged in #203, f80aa91)
- **Area:** db, superadmin, docs
- **Type:** fix
- **Supersedes:** none

## Summary
On 2026-11-02 production went down after the deploy of #198. Migration 0095 waited forever for a lock on `tenants`, and every later query on that table queued behind it. Web and platform ran out of connections and all sites returned 503 "no available server" for about 20 minutes. This change makes a blocked migration give up in seconds. It also creates two queues the worker has needed for weeks.

## What happened (UTC)
- 13:15 `bsec-migrate` started. Its log stopped at `roles ok`, with no `migrations ok`.
- 13:16 the deploy job redeployed the apps anyway, because it has no way to read migrate's result, and reported success.
- About 13:20 the owner reported every site down and Super Admin login failing.
- 13:37 `bsec-postgres` was restarted, with the owner's yes. Postgres had shut down cleanly and the apps recovered within a minute.
- 13:40 `bsec-migrate` was redeployed and printed `migrations ok`. `bcom.si` did not answer for about 30 seconds around this time.

The session holding the lock was never identified: `pg_stat_activity` could not be read during the outage. Staging did not catch this because it has no live traffic.

## What changed
- `runMigrations` sets `lock_timeout` to 3 seconds and tries up to 5 times, 3 seconds apart, about 27 seconds in all, which is under the 45 seconds the deploy job waits. Any other error fails at once.
- `blog.publish_due` and `domains.sweep` are added to `QUEUES`. They were in `QUEUE_NAMES` and used by the worker but never created, so the worker logged "Queue does not exist" every two seconds. `boss.schedule` also threw at `domains.sweep`, which skipped every schedule after it in that block, and the failure was only a warning.
- The Marketing page no longer says Pages is coming.
- Records the merge of #198 (the content of #202, which this replaces).

## Decisions and trade-offs
- A blocked migration can still stall queries on that table for up to 3 seconds per attempt. That is the price of trying at all.
- If all attempts fail, migrate exits with an error, but the deploy job still redeploys the apps. New code could then run without its column. Fixing this needs a Coolify token that can read deployment status, which is the owner's call.
- Scheduled blog posts have not published on any store since blog scheduling shipped, unless something else published them. Posts already due will publish on the first run after this deploys.

## Verification
Gate: typecheck, lint, Super Admin build and `docs:check` passed. Tests: db 50, db real-database suites on one shared database as in CI 22, platform heavy 157, domain jobs and blog 29, all passing. New real-database test `packages/db/test/migrate-lock.int.test.ts`: a held lock makes the migration fail in under 5 seconds with the table still readable, and a lock released during retries lets it succeed. New unit test `queues.test.ts`: every named queue is created.

NOT verified: the fix against production traffic, and that the skipped schedules register on the live worker; that needs a look at the worker log after deploy. The test was not run against the old code to watch it hang.

## Docs updated
- [x] `docs/migrations.md`
- [x] `infra/coolify/RUNBOOK.md`

## Follow-ups and open questions
- Owner: change the `app_rw` password, which was pasted into a chat session during the incident.
- Owner: stop `bsec-migrate` after each deploy, or fix the restart policy so it does not loop.
- Owner: Coolify token that can read deployment status, so the deploy job can stop when a migration fails.
- `DATABASE_URL_SUPERUSER` still appears to be set on `bsec-migrate`: the log prints `roles ok`, and the runbook says to remove it after the first run. Owner's call.

## Definition of done
Merged and deployed 2026-11-02. Migrate logged `migrations ok`, the worker has no queue errors and logged its recurring jobs as registered.
