# ADR-006: pg-boss instead of a workflow engine

- **Status:** Accepted
- **Date:** 2026-09-28
- **Plan reference:** PLAN §2, §11

## Context
Side effects (email, search, analytics, shipment prep, reservation expiry, domain polling, tenant deletion) must happen reliably after a business transaction commits, and never before. We have one Postgres and no appetite for another durable system.

## Decision
**pg-boss** on the same Postgres. Jobs are enqueued inside the business transaction (transactional outbox), so an event exists if and only if the change committed. Consumers run in the `worker` container as `app_rw` and are idempotent (effect table keyed by `event_id`, or upserts). Retries: 5 with exponential backoff; dead letters surface in Super Admin → System. Long workflows (tenant deletion) are modelled as a state table plus steps, not an engine.

The pg-boss schema and queues are created by the migration step as `app_owner`; runtime processes start with `migrate: false` and hold only DML grants.

## Consequences
- No extra infrastructure; jobs are covered by the same backups.
- Queue load competes with OLTP on the same server; monitored via job lag (PLAN §14 thresholds).
- Per-tenant fairness uses pg-boss group concurrency keys.

## Amendment 2026-10-14: the web service enqueues
The web runtime previously had no job client, so order confirmation, finance posting, customer metrics, webhook processing, notifications and media jobs sent from web requests were silently skipped (`if (rt._jobs)`). The web service now has a send-only pg-boss client (`createLazyJobSender`: `app_rw`, no migrate/schedule/supervise, 2 connections, created on first use). Sends are best effort (logged, never thrown) and start 2 s after sending. `maintenance.start` / `maintenance.end` are no longer queued: those handlers act immediately without checking the schedule, so a queued job would fire early or survive a cancellation; the minute watchdog is authoritative. `plan.change_requested` has no consumer and expires unprocessed. Customer CSV imports over 500 rows now run as a queued job.

## Alternatives considered
- **Temporal / Inngest:** powerful but another system to run or pay for.
- **BullMQ + Redis:** a second durable store and no transactional enqueue.
