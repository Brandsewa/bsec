# pgBackRest live on bsec-postgres: cutover record, findings and live state

- **Date:** 2026-11-25
- **Agent:** claude
- **Branch:** `docs/pgbackrest-live-state`  (not merged yet)
- **Area:** infra, docs
- **Type:** infra
- **Supersedes:** none

## Summary
Production cutover of `bsec-postgres` to the pgBackRest image, done on 2026-11-25 (planned 09:00 IST, by hand, with Claude driving the Coolify browser terminal on the owner's go-ahead). WAL now archives continuously to R2 and a first full backup exists. This record is the production-side change log; the code changes are #324, #325 and #326.

## What was done in production
- Bucket `bsec-pgbackrest` and an Object Read & Write token scoped to it were created in Cloudflare (no lock, no lifecycle rule: pgBackRest rewrites its index files and expires its own files). Five `PGBACKREST_REPO1_*` variables were set on `bsec-postgres` in Coolify by the owner; the key, secret and cipher passphrase are in the owner's password manager.
- Image on `bsec-postgres` changed twice, each followed by a Coolify restart (about a minute of downtime): first to `sha-b16cac3d...` (cutover), then to `" + IMG + "` after the CA-certificate fix. Both were pre-pulled on the host.
- On the host: `stanza-create`, `check` and a full backup (`20261125-040117F`, database 227 MB, 31.1 MB in R2, about 6.6 minutes, 04:01 to 04:08 UTC).
- Root's crontab on the VPS: Sunday 03:30 UTC full, Monday to Saturday 03:30 UTC differential, log `/var/log/bsec-pgbackrest-cron.log`.

## Findings
- **The postgres base image has no CA certificates**, so the first `stanza-create` failed (`unable to get local issuer certificate`). The first rehearsal had verification off and missed it. Fixed in #326 (package installed, build fails without the bundle, rehearsal verifies a real CA chain).
- **Coolify databases have no Scheduled Tasks tab** (the plan assumed one). Scheduling is host cron.
- Coolify keeps the image's entrypoint when no custom start command is set: the log line `WAL archiving ON` appeared after the swap.
- The push-to-main CI run for #324 never started (no GitHub outage); #325's merge started the run, so the first image publish came a little later than planned.

## Verification
- Ran in production: `docker ps` shows the pinned image healthy; log line `WAL archiving ON (stanza bsec)`; `stanza-create` and `check` completed successfully; `pgbackrest info` shows `status: ok`, the full backup, and a growing WAL archive range; `crontab -l` shows the two lines; `docker exec` resolves under a minimal cron PATH.
- Not verified: the first scheduled cron run (Thursday 2026-11-26 03:30 UTC), a restore from the real repository into a scratch container, the Super Admin "WAL archiving is live" alert path, repository growth over a week, Hostinger snapshot restore interaction (documented as a rule, not tested).

## Docs updated
- [x] `infra/backups/PGBACKREST.md` (live setup, day-to-day checks, snapshot-restore rule), `docs/BACKUP-DR-PLAN.md`, `progress.md`, `DEPLOYMENT.md`, `docs/ARCHITECTURE.md`
- [x] ADR: not needed (implements the plan)

## Follow-ups and open questions
- Owner: tick "WAL archiving is live" in Super Admin > Backups, record the baseline restore drill, set the Better Stack heartbeat URL, then the deferred Sentry, Cloudflare Access and firewall items.
- Claude: check the Thursday cron run, a restore drill from real R2, `infra/runbooks/REBUILD.md` (including the snapshot rule), weekly copy to a second Cloudflare account, VPS disk-space alert, measure WAL growth after a week.

## Definition of done
Docs check passes, no secrets in the diff. Open: PR, CI, merge cleanup.
