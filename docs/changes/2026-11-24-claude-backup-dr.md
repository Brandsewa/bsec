# Backup monitoring, database timeouts, Super Admin Backups page and restore drill script

- **Date:** 2026-11-24
- **Agent:** claude
- **Branch:** `feat/backup-dr`  (not merged yet, not committed yet)
- **Area:** db, domain, contracts, platform, worker, superadmin, infra, docs
- **Type:** feature
- **Supersedes:** none

## Summary
First slice of `docs/BACKUP-DR-PLAN.md` (owner decisions 2026-11-24): the parts that need code. Runtime database roles now have statement, idle-in-transaction and lock timeouts. A worker job checks the backup bucket and the WAL archiver every 30 minutes and records the result, a new Super Admin page (Operations > Backups) shows status, a best-practice comparison, the alert policy and the restore drill log, and a script restores a dump into a scratch Postgres and reports PASS or FAIL. Nothing in production or Cloudflare was changed.

## What changed
- **Timeouts (plan G8):** `packages/db/src/sql/roles.ts` sets `ALTER ROLE ... SET` for `app_rw` and `app_saas` (30 s statement, 30 s idle in transaction, 5 s lock) and `app_platform` (1 min, 1 min, 5 s); `app_owner` is untouched. Applied by `bootstrap-roles` on every deploy. Long jobs opt out with `SET LOCAL statement_timeout`.
- **Migration `0121_platform_backups`:** `platform_backup_settings` (single row), `platform_backup_checks`, `platform_restore_drills`. Grants: `app_rw` can only SELECT the policy and drill tables, and SELECT/INSERT/DELETE the check table, so a compromised storefront cannot silence alerts or forge a passing drill.
- **Worker job `backup.check`** (every 30 min, `packages/domain/src/platform/backups.ts`, `backup-storage.ts`): lists the bucket with a read-only token, flags a stale, empty or suspiciously small dump, a quiet or failing WAL archiver (only once WAL alerts are switched on), and a missing or overdue restore drill. Emails the policy recipients on a new failure and again after 24 h, pings the Better Stack heartbeat only when everything passes.
- **API:** `backups.overview`, `backups.updateSettings`, `backups.recordDrill` (contract in `packages/contracts/src/platform.ts`, handlers in `apps/platform/src/app.ts`; writes need `platform_admin`, audited as `backup.settings_updated` and `backup.drill_recorded`).
- **Super Admin:** `apps/superadmin/src/pages/Backups.tsx`, sidebar entry and command palette entry. The old "Disaster Recovery & Backup SLA" panel on System & Queues claimed "Continuous WAL active" and a 15 minute RPO that were not true; it is replaced by a status line linking to the new page.
- **Drill script:** `infra/backups/drill.mjs` (Node and Docker, cross-platform). `RESTORE-DRILL.md` points to it. The unmeasured numbers in `RESTORE-DRILL-M7.md` are still marked unverified there.
- **Env vars (worker, all optional):** `BACKUP_R2_ENDPOINT`, `BACKUP_R2_BUCKET`, `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`, `BACKUP_R2_PREFIX`, `BACKUP_HEARTBEAT_URL` (documented in `DEPLOYMENT.md`). Without them the job logs a warning and the page says monitoring has not reported.

## Decisions and trade-offs
- **Backup schedule, retention and WAL settings are not editable from Super Admin.** They live in Coolify and Postgres. Editing them from the web app needs a Coolify token (not scoped to one resource) or a Postgres superuser, which breaks AGENTS.md rule 9 and widens the blast radius of one stolen session. The page shows current values against recommended ones and links the runbook; reasoning in the plan, G10. A one-click executor with an allowlist is an owner decision.
- Alert thresholds, drill cadence, the "WAL archiving is live" switch and recipients are editable (alerts only).
- The check table is writable by `app_rw` because web and worker share the role. A forged "ok" row would only affect the display; the Better Stack heartbeat is pinged from the worker only after a real check passes, so the missing-ping alert is not forgeable from the database.
- Email delivery is not live yet (progress.md), so the heartbeat is the dependable alert until it is.
- Migration 0121 was written by hand: `drizzle-kit generate` stopped on an interactive rename prompt (the snapshot is out of step with the schema), which cannot run unattended. The journal entry and checksum were added.

## Verification
- Ran: `pnpm typecheck` pass, `pnpm lint` pass, `pnpm build` pass (the Windows long-path warning at the end of the web build is old), `pnpm docs:check` ok.
- Ran on a real Postgres 18: `pnpm test:heavy:local` (domain) 173 files, 3302 tests pass, which includes the new `backups.int.test.ts` and ran against the new timeouts. After the grants were added to the migration: `backups.int.test.ts` 10 pass (includes a run as `app_rw`: can read the policy and write checks, cannot change the policy, forge a drill or edit a check), `packages/db` `b2-grants` and `role-timeouts` 12 pass, `apps/platform` `read-endpoints`, `rbac`, `audit-coverage` 148 pass. Unit test `backup-checks.test.ts` 8 pass.
- Ran: `infra/backups/drill.mjs --file` against a dump of a migrated, seeded database: PASS (116 of 116 migrations, restored in a few seconds); a garbage dump: FAIL, exit 2, scratch container removed.
- Exercised by hand in the browser (local dev stack, Super Admin on 5174 and the platform API on 4000): page renders live Postgres values (archive_mode off, WAL level replica); saving the alert policy and recording a drill both work and update the table; the System page shows the new status card. The test rows were removed afterwards. The browser's `/api/brand` connection errors come from the web app not running locally.
- Ran 2026-11-24 (baseline, owner's PC, read-only R2 token): `drill.mjs` against the newest real dump in `bsec-backups` (pg-dump, 9.5 MB, 11.4 h old): PASS. `pg_restore` clean in 3 s (5 s copy and restore on the scratch host); 115 of 116 migrations applied (the one missing is 0121 from this branch, expected); data present (10 tenants, 439 products, 638 variants, 963 customers, 10 orders, 4664 audit_logs, 517 platform_audit_logs). Data at risk with the daily dump alone: age of the dump, 11.4 h here, up to about 24 h. The first run printed a false FAIL on the migration check and measured RPO against the newest order; both fixed in the script. Not covered: provisioning a real server (rebuild test), decrypting a tenant secret, the store-isolation check on the restored copy.
- R2 changes made by the owner's session in Cloudflare (bucket `bsec-backups`): lifecycle rule `expire-dumps-35d` (prefix `data/`, 35 days), bucket lock `lock-dumps-14d` (prefix `data/`, 14 days), read-only token scoped to the bucket. R2 has no write-only permission, so Coolify's upload token stays Object Read & Write; the 14-day lock is what stops a stolen token deleting a dump.
- NOT verified: the worker job against a real R2 bucket (env vars set on the worker, but this branch is not deployed), the email path against a real SMTP provider, the full `packages/db` and `apps/platform` heavy suites after the final grants change (only the affected files were rerun), the web and admin heavy suites, mobile layout of the new page.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (migration 0121, `backup.check` queue; "Last verified" bumped)
- [x] ADR: not needed (no architectural decision beyond the plan)
- [x] `DEPLOYMENT.md` (worker env vars); `infra/backups/README.md`, `RESTORE-DRILL.md`
- [x] `progress.md` (in flight)

## Follow-ups and open questions
- Owner: create the read-only R2 token and the second Cloudflare account (plan G3), set `BACKUP_R2_*` and the heartbeat on the worker, then run the baseline drill with `drill.mjs`.
- Not built yet (plan): pgBackRest image, staging rehearsal and the 03:00 cutover, R2 lifecycle and bucket lock (owner, Cloudflare), the weekly second-copy job, `REBUILD.md`, origin lockdown and Cloudflare Access (G9), Sentry and log drain.
- Drill script does not yet decrypt a tenant secret or check store isolation on the restored copy; both are listed as manual steps.
- Timeouts start at 30 s; tighten from logs after a week. A job that needs longer must use `SET LOCAL statement_timeout`.

## Definition of done
Gate passes for the packages touched, tests added, docs updated, no secrets in the diff. Open: commit, PR and CI, and merge-time cleanup (record line, branch, worktree).
