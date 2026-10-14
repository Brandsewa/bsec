# Web job queue, safe media error messages, confirmation dialogs that close

- **Date:** 2026-10-14
- **Agent:** claude
- **Branch:** `fix/jobs-errors-confirm`
- **Area:** domain, web, admin, e2e, docs
- **Type:** fix
- **Supersedes:** the `Runtime._mediaJobs` part of the Phase 4 verification record

## Summary
1. **Web job queue.** The web service had no job client, so everything it enqueues was skipped: order confirmation and new-order emails, finance posting, customer metrics, webhooks, fulfilment/return/refund/preorder notifications. `Runtime._jobs` in web is now a send-only pg-boss client (`createLazyJobSender`), best effort, starting 2 s after send. `_mediaJobs` is removed. `scheduleMaintenance` no longer queues `maintenance.start/end` (they act immediately; the watchdog already handles the schedule).
2. **Upload errors.** `merchantMediaError` hides paths, bucket names, SQL and stack frames; the merchant sees one plain sentence, the details are logged. Applied to every `admin.media` procedure and the proxy upload route.
3. **Confirmation dialogs** (single and bulk trash / permanent delete) now close as soon as the merchant confirms.

## Behaviour changes to know
- Order confirmation and staff new-order emails are now attempted (nothing leaves if email is not configured).
- Finance posts, customer metrics and webhooks run promptly; customer CSV imports over 500 rows are asynchronous.
- `plan.change_requested` jobs have no consumer and expire unprocessed.
- A queue outage is logged, not fatal.

## Tests
- `packages/domain/test/web-job-queue.int.test.ts` (real Postgres): job lands in `pgboss.job` with a ~2 s delay as `app_rw`; unreachable queue returns null and logs; scheduling maintenance queues nothing.
- `packages/domain/test/media-errors.test.ts`.
- `e2e/media-library.spec.ts`: confirmation closes after single trash; new bulk trash and bulk permanent delete test. Real stack: 10 of 10 pass.

## Verification
- `pnpm typecheck`, `pnpm lint`: pass. `@bs/domain test:fast`: 51 files, 425 tests. Admin tests pass on rerun (cold-cache flake on first run).
- New real-Postgres test: 3 of 3. Real-stack e2e (images rebuilt from this tree): media spec 10 of 10.

## Docs updated
- [x] ADR-006 amendment, ADR-031, `docs/ARCHITECTURE.md`.

## Not verified
- Order emails and webhooks on a real provider (none configured).
