# pgBackRest: continuous WAL archiving, backups and point-in-time restore

Status: **live in production since 2026-11-25** (cutover by hand, 09:00 IST). `bsec-postgres` runs `ghcr.io/brandsewa/bsec-postgres:sha-877bdeb418db0589df16130e289e0d6a27f121e3`, WAL archives continuously to R2 bucket `bsec-pgbackrest`, first full backup `20261125-040117F` (database 227 MB, 31 MB stored), differential and full backups scheduled by host cron (below). Plan: `docs/BACKUP-DR-PLAN.md` G1. The daily Coolify `pg_dump` to `bsec-backups` stays: it is the independent logical copy, and Hostinger's weekly server snapshot is a third, whole-server layer.

## What was built
- `infra/docker/postgres.Dockerfile`: `postgres:18` + pgBackRest (pinned package version, PGDG repo already in the base image). Built by CI as `ghcr.io/<owner>/bsec-postgres` (`sha-<commit>`, then `:main` after the checks pass), same as the app images.
- `infra/docker/postgres-entrypoint.sh`: archiving turns on **only when all five `PGBACKREST_REPO1_*` variables are set**; otherwise the image behaves exactly like `postgres:18` (no failing archive command, no WAL piling up on disk). Same major version and data volume, so swapping the image is a restart, not a migration.
- `infra/backups/pgbackrest.conf`: non-secret settings baked into the image (zstd, aes-256-cbc, async archive, retention 30 days full / 7 differential).
- `infra/backups/pitr-rehearsal.mjs`: end-to-end rehearsal in throwaway containers with a local TLS S3 server standing in for R2. CI runs it on any change to the files above (job "pgBackRest restore rehearsal"). Result (2026-11-24, local): PASS. Restore to a chosen moment took 5 s, rows before the moment came back, rows after it did not, a committed row was archived within about 56 s (`archive_timeout=60`), archiver `failed_count=0`.

**First production cutover (2026-11-25) found one gap:** the `postgres` base image has no CA certificates, so pgBackRest could not verify R2's TLS certificate (`unable to get local issuer certificate`) and `stanza-create` failed. The first rehearsal missed it because it ran with certificate verification off. Fixed by installing `ca-certificates` in the image (the build now fails without the bundle) and by making the rehearsal verify real certificates against a throwaway CA. Never set `repo1-storage-verify-tls=n` for R2 as a workaround.

## Bucket and token (owner, Cloudflare)
- New bucket **`bsec-pgbackrest`** in the same account, **no lifecycle rule and no bucket lock**. pgBackRest manages its own retention and rewrites `backup.info`, `archive.info` and manifests after every backup; a lock or an expiry rule on this bucket would break backups or delete live WAL. (The 14-day lock and 35-day expiry belong to the dump bucket only.)
- Token: Object Read & Write, scoped to `bsec-pgbackrest` only. A copy of this bucket in the second Cloudflare account is the protection against a stolen token (plan G3, still to build).
- Cipher passphrase: generate a long random one and keep it in the password manager **outside Coolify and the VPS**. Without it every backup is unreadable.

## Environment on the `bsec-postgres` resource (Coolify)
| Variable | Value |
|---|---|
| `PGBACKREST_REPO1_S3_ENDPOINT` | `<account-id>.r2.cloudflarestorage.com` (no `https://`) |
| `PGBACKREST_REPO1_S3_BUCKET` | `bsec-pgbackrest` |
| `PGBACKREST_REPO1_S3_KEY` and `PGBACKREST_REPO1_S3_KEY_SECRET` | the token above |
| `PGBACKREST_REPO1_CIPHER_PASS` | the passphrase |

## Live setup (what was done on 2026-11-25, and how to repeat it)
Run host commands in Coolify > Terminal, choosing the **`localhost`** entry (a `root@server` prompt), not a container.
1. Disk headroom checked first (96 GB disk, 16% used). Note the current image tag for rollback.
2. Five `PGBACKREST_REPO1_*` variables on `bsec-postgres` (Environment Variables tab), then **General > Image** set to the **pinned** tag `ghcr.io/brandsewa/bsec-postgres:sha-<commit>`, not `:main` (`:main` moves with every merge; a later restart could quietly pull a newer image under the live database). Pre-pull on the host with `docker pull <image>`; Save, then Restart (about a minute of downtime; the apps reconnect on their own).
3. Container log shows `bsec-postgres: pgBackRest configured, WAL archiving ON (stanza bsec)`. Coolify keeps the image's own entrypoint when no custom start command is set (confirmed).
4. On the host, run these one at a time (`C` is the container name, `jpukpasrsnmzzt6w2gshxktd`):
   ```bash
   C=jpukpasrsnmzzt6w2gshxktd
   docker exec -u postgres $C pgbackrest --stanza=bsec stanza-create
   docker exec -u postgres $C pgbackrest --stanza=bsec check
   docker exec -u postgres $C pgbackrest --stanza=bsec backup --type=full   # about 7 minutes for 227 MB
   docker exec -u postgres $C pgbackrest --stanza=bsec info
   ```
5. **Schedule (host cron, not Coolify):** Coolify databases have no Scheduled Tasks tab. Root's crontab on the VPS (server time is UTC) holds: Sunday `30 3 * * 0` full, Monday to Saturday `30 3 * * 1-6` differential, each `docker exec -u postgres jpukpasrsnmzzt6w2gshxktd pgbackrest --stanza=bsec backup --type=<full|diff>` appending to `/var/log/bsec-pgbackrest-cron.log` (03:30 UTC = 09:00 IST). A rebuilt server must recreate these two lines.
6. Super Admin > Backups: the WAL card shows segments archived; turn on "WAL archiving is live, so alert when it goes quiet".

## Day-to-day checks
- `docker exec -u postgres $C pgbackrest --stanza=bsec info`: `status: ok`, the newest backup is under a day (diff) or a week (full) old, WAL archive max keeps growing.
- `tail /var/log/bsec-pgbackrest-cron.log` on the host: no `ERROR` lines. A failed cron run is not alerted by itself; the Backups page and `backup.check` watch WAL freshness, and a stalled differential shows up as an old backup in `info`.
- Repository size and growth: `info` (compare week to week).

## If a Hostinger server snapshot is ever restored
Follow `infra/runbooks/REBUILD.md` section 4. The short version: the restored server starts its containers on boot, including `bsec-postgres` with the snapshot's data directory. **Stop the apps and the database as soon as Coolify answers.** If the snapshot is from after 2026-11-25 the old data directory would try to archive WAL into the live R2 repository: pgBackRest should refuse to overwrite a segment with different content (archiving stalls with duplicate-segment errors), but the two histories must not be mixed. Replace the data directory from R2 with a one-off `pgbackrest restore --delta` (the Restore section below), then start the database and take a fresh full backup. Also recreate the cron lines above if the snapshot predates them.

## Restore (point in time)
Not yet exercised against the real repository (only the rehearsal and a scratch copy). Plan a restore drill from R2 into a scratch container before relying on it, and record it in Super Admin > Backups.
The target time format matters: `YYYY-MM-DD HH:MM:SS.mmm+00`, **no space before the zone** (pgBackRest 2.60 rejects `... +00`). `pitr-rehearsal.mjs` is the tested version of these steps.
1. Stop the apps, then `bsec-postgres`. Keep the old data volume until the restore is verified (rename or snapshot it, never delete first).
2. Restore into an empty data directory with the same image and env: `gosu postgres pgbackrest --stanza=bsec restore --type=time "--target=<UTC time>" --target-action=promote` (leave out `--type` and `--target` to restore to the latest point).
3. Start `bsec-postgres`; it replays WAL to the target and promotes. Check `SELECT pg_is_in_recovery();` is `f`, then compare row counts on the key tables.
4. Start the apps. Run the `bsec-migrate` job only if the restored data is behind the deployed code.
5. Record the drill in Super Admin > Backups (type "Point-in-time restore") and in `docs/changes/`.

For one store's data use `infra/runbooks/TENANT-RESTORE.md` with the daily dump; point-in-time restore covers the whole cluster.
