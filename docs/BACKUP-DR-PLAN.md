# Backup and disaster recovery plan

Status: **draft for owner approval** (2026-11-23). Author: Claude. Builds on `docs/FAILOVER-PLAN.md` (phase A) and `infra/backups/`.
Nothing here is applied. Every Cloudflare, Coolify or production change needs the owner's yes in the session (AGENTS.md section 5).

**Relation to `docs/FAILOVER-PLAN.md`:** this plan implements that plan's phase A items **A1** (database timeouts), **A2** (restore drill), **A3** (R2 hygiene), **A4** (origin and admin lockdown) and **A5** (observability), and prepares phase B (the standby server): pgBackRest WAL (G1 phase 3) is the base the standby would be fed from. Phase B itself (second VPS, load balancer, `FAILOVER.md`) stays parked until real order volume justifies it. If the two plans disagree, update both in the same change.

## 1. Starting point (read from the repo, not checked live)

Daily Coolify `pg_dump` at 02:30 UTC, 14 local copies, plus R2 bucket `bsec-backups`. No restore has ever been proven, no WAL archiving, no R2 expiry, no failure alert, one server.

## 2. Targets

| | Now | After phase 1 | After phase 3 |
|---|---|---|---|
| RPO (data you can lose) | 24 h | 1 h | about 1 min |
| RTO (time to recover) | unknown | measured, target 2 h | measured, target 1 h |
| A backup counts only if | | a restore drill passed in the last 35 days | same, plus a PITR drill |

## 3. Gaps and designed fixes

### G1. RPO of 24 hours
- **Owner decision 2026-11-24: go straight to pgBackRest; no hourly-dump interim.** The daily Coolify dump (02:30 UTC) stays as is, as the independent logical copy. Until pgBackRest is live, RPO stays 24 h, which is why the build is prioritised.
- **pgBackRest continuous WAL to R2.** Cutover window: **03:00 local time** (owner), announced beforehand.
  - Build `ghcr.io/<owner>/bsec-postgres:18` from `postgres:18` plus `pgbackrest` (new file `infra/backups/Dockerfile`, built by CI like the app images, exact version pinned).
  - Set `archive_mode=on`, `archive_command='pgbackrest --stanza=bsec archive-push %p'`, `archive_timeout=60`, `wal_level=replica`. `pgbackrest.conf` is mounted from Coolify env, cipher on (`aes-256-cbc`).
  - Own prefix `/pgbackrest` in a **separate bucket** `bsec-pgbackrest` (the draft shares `bsec-backups`; separate buckets let each have its own lock and token).
  - Schedule: full weekly, differential daily, retention 30 days. The daily `pg_dump` stays as a second, independent path (logical dumps survive a corrupt physical backup and are what the tenant-restore runbook uses).
  - Cutover = swap the image on `bsec-postgres`, same data volume. This is a restart of about a minute, so schedule it off-peak and announce it. **Rehearse on staging first** (`docker-compose.staging.yml`).
  - **Built 2026-11-24 (branch `feat/pgbackrest-image`):** `infra/docker/postgres.Dockerfile`, `postgres-entrypoint.sh`, `infra/backups/pgbackrest.conf`, `pitr-rehearsal.mjs`, CI job; procedure in `infra/backups/PGBACKREST.md`. **Correction to the bucket line above:** no bucket lock and no lifecycle rule on `bsec-pgbackrest`: pgBackRest rewrites `backup.info` and `archive.info` after every backup and expires its own files, so a lock or an expiry rule would break backups or delete live WAL. That bucket is protected by a scoped token and, later, the second-account copy.
  - **Live 2026-11-25.** Image `ghcr.io/brandsewa/bsec-postgres:sha-877bdeb418db0589df16130e289e0d6a27f121e3`; stanza `bsec`; first full backup `20261125-040117F`; host cron for full (Sun) and differential (Mon-Sat) at 03:30 UTC. Corrections found in production: the postgres base image had no CA certificates (fixed, #326); Coolify databases have no Scheduled Tasks tab, so scheduling is host cron. Details: `infra/backups/PGBACKREST.md`, `docs/changes/2026-11-25-claude-pgbackrest-cutover.md`.
  - Risk: the box is shared with other projects. WAL archiving adds disk and CPU; check disk headroom before enabling and set an alert (G4).

### G2. Restore never proven
- New script `infra/backups/drill.ps1` and `drill.sh` (Windows host and VPS): download newest dump with a **read-only** R2 token, start scratch `postgres:18` on a random port, `pg_restore`, run `pnpm --filter @bs/db migrate` (must be a no-op), compare row counts and newest `orders.placed_at`, print RTO and RPO, destroy the scratch container. Output goes into a change record in `docs/changes/` (type: test), never only into chat.
- Rewrite `RESTORE-DRILL.md` to match the script and delete the unmeasured numbers in `RESTORE-DRILL-M7.md` (keep the file, mark superseded).
- **Cadence:** monthly drill, and one after every backup-config change. The drill has to be run by someone with R2 read access (owner or Claude with a token the owner pastes into a local env var; never committed).
- Also rehearse `infra/runbooks/TENANT-RESTORE.md` once for one store, and a "server is gone" rebuild (G5).

### G3. R2 grows forever, one token can delete everything
- Lifecycle rule on `bsec-backups`: expire objects after **35 days** (covers 4 weekly checks plus margin).
- **Bucket Lock** (R2 retention rule) of 14 days on `data/`: even a stolen write token cannot delete or overwrite a backup younger than 14 days. Verify in the Cloudflare dashboard that Coolify's uploads still succeed after enabling it.
- Separate tokens: write-only (Object Write) for Coolify, read-only for drills and the freshness check. No token has delete.
- **DEFERRED (owner decision 2026-11-24, revisit when real orders start or monthly drills are routine): second copy in a second Cloudflare account.** Until then: the 14-day bucket lock, write-only Coolify token, a monthly manual download of the newest dump to the owner's own drive, and Cloudflare login on authenticator or hardware-key 2FA with offline recovery codes. Design kept for later:, weekly, so losing or locking one account cannot lose every backup. **No domain or DNS is needed in that account**: R2 buckets are reached by the S3 API endpoint (`<account-id>.r2.cloudflarestorage.com`), not by a website hostname. Setup: (1) create the account with a different email and strong 2FA, add a payment method (R2 requires it, free tier applies); (2) enable R2, create bucket `bsec-backups-copy` with the same lifecycle (35 d) and a 14 d bucket lock; (3) create a write-only token scoped to that bucket; (4) a scheduled GitHub Actions job runs `rclone copy` from the primary bucket (read-only token) to the copy bucket (write-only token, `--no-check-dest`), storing both tokens as GitHub secrets. Scope: `bsec-backups` dumps and the `bsec-pgbackrest` repo, later `bsec-media`. Tokens are never committed or pasted in chat.

### G4. A failed backup goes unnoticed
Two independent signals:
1. Coolify notifications by **email to the admin address** (owner decision 2026-11-24; Telegram or Slack can be added later) for scheduled-backup failure. Configuration only, no code. Better Stack heartbeat alerts go to the same address.
2. **Freshness check in `apps/worker`:** a pg-boss job every 30 min lists the newest object under `data/` with the read-only token; if older than 26 h (daily dump), or once pgBackRest is live if the newest archived WAL is older than 10 min (from `pgbackrest info`/`pg_stat_archiver`), it logs an error, sends Sentry, and **stops pinging a Better Stack heartbeat**. A missing ping pages you. Same job also pings only when object size is at least 50% of the median of the last 7 (catches empty dumps). Domain code, unit-tested; env: `BACKUP_R2_*` (read-only), documented in `DEPLOYMENT.md`.
3. Plus Better Stack uptime monitors for `/api/health` (RUNBOOK section 9, not set up yet) and a disk-space alert on the VPS (needed for G1 phase 3).

### G5. Single server
Backups are the answer to "server is gone". Add `infra/runbooks/REBUILD.md`: new VPS, Coolify install, restore Coolify config, create `bsec-postgres`, restore dump or PITR, run `bsec-migrate`, point Cloudflare. Test it once on a throwaway VPS and record the time; that is the true RTO. Hot standby stays in `FAILOVER-PLAN.md` phase B.
Also export the Coolify config (env templates, resource list, image tags) after each release; Coolify's own database backup should be enabled too.

### G6. Media bucket (`bsec-media`)
R2 does not offer S3-style object versioning as far as I know, so the "versioning on" statement in `infra/backups/README.md` is probably wrong. Verify in the dashboard; if confirmed, fix the doc and replace it with a Bucket Lock plus, once the deferred second copy exists (G3), that job covering `bsec-media` too. Image uploads are the only customer files, so loss is recoverable but visible.

### G7. Secrets needed to make a restore usable
A restored database is useless without `TENANT_SECRETS_KEY` (tenant credentials are encrypted with it), the three DB role passwords, `APP_*` env, and the pgBackRest cipher passphrase. Owner keeps these in a password manager **outside** Coolify and the VPS, written down in a checklist (`REBUILD.md` lists names only, never values). The drill must include "decrypt one tenant secret on the restored copy" to prove the key matches.

### G8. Database timeouts (FAILOVER-PLAN A1)
One runaway query or stuck migration can stall every store (it did on 2026-11-02). Per-role defaults in `packages/db/src/sql/roles.ts`: `app_rw` `statement_timeout=30s` (tighten later from logs), `idle_in_transaction_session_timeout=30s`, `lock_timeout=5s`; longer for `app_platform`; none for `app_owner`. Long jobs (bulk import, exports, worker sweeps) opt out with `SET LOCAL statement_timeout`. Real-database test: `pg_sleep` over the limit is cancelled for `app_rw` and not for `app_owner`. Run the heavy suite and import tests before merging. Roles are changed by migration, so this follows `docs/migrations.md`.

### G9. Origin and admin lockdown (FAILOVER-PLAN A4)
Owner work in dashboards, Claude supplies exact steps and an outside probe:
- Hostinger firewall: allow 80/443 only from Cloudflare IP ranges; SSH key-only plus fail2ban.
- Put `platform.bcom.si` and `superadmin.bcom.si` behind Cloudflare Access. First settle whether it is already on (`RUNBOOK.md` section 5 and `INCIDENT.md` section 2 disagree) and fix the wrong doc.
- Sentry DSNs and the Better Stack log drain (A5), so logs outlive the server.

### G10. Super Admin > Backups page (owner request 2026-11-24)
Where it lives: Super Admin sidebar, Operations & Support > **Backups** (`/backups`). The old "Disaster Recovery & Backup SLA" panel on System & Queues claimed "Continuous WAL active" and a "15 minute" RPO that were not true; it is replaced by a short status line that links here.

What it shows (all read from real data, nothing hardcoded):
- **Three status cards:** daily dump (age, size, copies kept), WAL archiving (last archived, failures; "not enabled yet" until pgBackRest is live), restore drill (age of the last passing drill). Written by the worker `backup.check` job every 30 minutes.
- **Best-practice check:** `archive_mode`, archive command, `archive_timeout`, `wal_level`, and the policy values, each with current value, recommended value and a status, read live from `pg_settings` and the policy row.
- **Restore drill log** with a "Record drill" form (type, result, RTO, RPO, notes).

What staff can change here (platform_admin and above, audited as `backup.settings_updated`): the alert thresholds (dump age, WAL lag), drill cadence, a "WAL archiving is live" switch, and up to 5 alert emails.

What is deliberately **not** editable here, and why: the backup schedule, retention and the WAL settings (`archive_mode`, `archive_timeout`, `archive_command`). They live in Coolify and Postgres. Editing them from the web app would need either a Coolify API token (Coolify tokens are not scoped to one resource, so it could deploy or delete anything) or a Postgres superuser (`ALTER SYSTEM`; `archive_mode` needs a restart). Both break AGENTS.md rule 9 and enlarge the blast radius of one stolen Super Admin session. For settings that decide whether you can recover from a disaster, best practice is the opposite: change them rarely, through a reviewed change, and verify afterwards. The page therefore shows them with the recommended value and points to the runbook, and the drill proves a change did not break recovery. If you want one-click schedule changes later, the safe way is a tiny separate executor with an allowlist of three actions and its own audit trail: a new design decision for the owner.

Data: migration `0121_platform_backups`. Contract `backups.*` in `packages/contracts/src/platform.ts`. Domain `packages/domain/src/platform/backups.ts`.

## 4. Order of work

| Step | What | Who | Needs owner yes |
|---|---|---|---|
| 0 | **Baseline drill** of the current daily dump (G2) | Claude writes script, owner supplies read-only R2 token | token only |
| 1 | Coolify failure email notifications (admin address), R2 lifecycle, write-only and read-only tokens, Bucket Lock | Owner in Coolify and Cloudflare, Claude gives exact clicks | yes (prod config) |
| 2 | Freshness job in worker plus heartbeat, docs | Claude, branch `feat/backup-monitoring` | merge |
| 3 | Drill again after step 1 and 2; tenant restore rehearsal | Claude and owner | |
| 4 | pgBackRest image, staging rehearsal, PITR drill on staging | Claude | |
| 5 | Production cutover to the new image, first full backup, PITR drill on production data copy | Owner approves window | yes |
| 6 | `REBUILD.md`, rebuild test on throwaway VPS | Claude, owner | yes (new VPS cost) |
| parallel | G8 database timeouts (branch `feat/db-timeouts`) | Claude | merge |
| parallel | G9 origin lockdown, Cloudflare Access, Sentry and log drain | Owner in dashboards, Claude supplies steps and probe | yes (prod config) |

## 5. Drill pass criteria (the test)

All must hold, and are recorded with real numbers in a `docs/changes/` test record:
- Newest dump is younger than 26 h and larger than 50% of the previous.
- `pg_restore` completes without errors; `migrate` reports nothing to apply.
- Row counts for `tenants, orders, order_items, products, variants, invoices, customers, audit_logs` equal the source at dump time (or within the orders placed after it).
- One tenant secret decrypts with the production `TENANT_SECRETS_KEY`.
- Store isolation holds on the copy: as `app_rw` with tenant A set, tenant B's rows are invisible.
- Measured RTO below 2 h, measured RPO below the phase target.
- Scratch container and dump file removed afterwards.

## 6. Decisions (owner, 2026-11-24)

1. Straight to pgBackRest, no hourly interim. Daily dump stays.
2. Custom `bsec-postgres` image approved; restart window 03:00 local time.
3. Second copy in a second Cloudflare account: **deferred** (no domain is needed there when it is built).
4. Bucket Lock 14 days, R2 expiry 35 days.
5. Alerts by email to the admin address.
