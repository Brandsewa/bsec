# pgBackRest: continuous WAL archiving, backups and point-in-time restore

Status: image and rehearsal built and passing locally and in CI; **not yet in production**. Cutover planned for Wednesday 2026-11-25, 09:00 IST, done by hand by the owner following the steps below (moved from the original 03:00 plan). Plan: `docs/BACKUP-DR-PLAN.md` G1. The daily Coolify `pg_dump` to `bsec-backups` stays: it is the independent logical copy.

## What was built
- `infra/docker/postgres.Dockerfile`: `postgres:18` + pgBackRest (pinned package version, PGDG repo already in the base image). Built by CI as `ghcr.io/<owner>/bsec-postgres` (`sha-<commit>`, then `:main` after the checks pass), same as the app images.
- `infra/docker/postgres-entrypoint.sh`: archiving turns on **only when all five `PGBACKREST_REPO1_*` variables are set**; otherwise the image behaves exactly like `postgres:18` (no failing archive command, no WAL piling up on disk). Same major version and data volume, so swapping the image is a restart, not a migration.
- `infra/backups/pgbackrest.conf`: non-secret settings baked into the image (zstd, aes-256-cbc, async archive, retention 30 days full / 7 differential).
- `infra/backups/pitr-rehearsal.mjs`: end-to-end rehearsal in throwaway containers with a local TLS S3 server standing in for R2. CI runs it on any change to the files above (job "pgBackRest restore rehearsal"). Result (2026-11-24, local): PASS. Restore to a chosen moment took 5 s, rows before the moment came back, rows after it did not, a committed row was archived within about 56 s (`archive_timeout=60`), archiver `failed_count=0`.

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

## Cutover (09:00 IST, by hand; about a minute of database restart)
1. Check disk headroom on the VPS (WAL archiving adds some local disk use) and note the current `bsec-postgres` image tag for rollback.
2. The five variables are set on `bsec-postgres` already (check they are still there). Change its image to the **pinned** tag `ghcr.io/brandsewa/bsec-postgres:sha-<commit>` (the exact tag is in the change record for the first publish), **not** `:main`: `:main` moves with every merge, so a later restart could quietly pull a newer image under the live database. Restart.
3. In the container log find `bsec-postgres: pgBackRest configured, WAL archiving ON (stanza bsec)`. In a shell, `SHOW archive_mode;` must say `on`. **Unverified until this step:** whether Coolify's Postgres resource keeps the image's entrypoint. If the log line is missing, roll back (below) and tell Claude.
4. In the `bsec-postgres` container (Coolify terminal):
   ```bash
   gosu postgres pgbackrest --stanza=bsec stanza-create
   gosu postgres pgbackrest --stanza=bsec check
   gosu postgres pgbackrest --stanza=bsec backup --type=full
   gosu postgres pgbackrest --stanza=bsec info
   ```
5. Coolify scheduled tasks on the resource: Sunday 03:30 `gosu postgres pgbackrest --stanza=bsec backup --type=full`; Monday to Saturday 03:30 `gosu postgres pgbackrest --stanza=bsec backup --type=diff`.
6. Super Admin > Backups: the WAL card should show segments archived within a minute or two. Then turn on "WAL archiving is live, so alert when it goes quiet".
7. The app services reconnect on their own after the restart. `bsec-migrate` is not needed.

Rollback: remove the five variables (or set the image back to `postgres:18`) and restart. The data directory is untouched; archiving simply stops. WAL already in R2 stays.

## Restore (point in time)
The target time format matters: `YYYY-MM-DD HH:MM:SS.mmm+00`, **no space before the zone** (pgBackRest 2.60 rejects `... +00`). `pitr-rehearsal.mjs` is the tested version of these steps.
1. Stop the apps, then `bsec-postgres`. Keep the old data volume until the restore is verified (rename or snapshot it, never delete first).
2. Restore into an empty data directory with the same image and env: `gosu postgres pgbackrest --stanza=bsec restore --type=time "--target=<UTC time>" --target-action=promote` (leave out `--type` and `--target` to restore to the latest point).
3. Start `bsec-postgres`; it replays WAL to the target and promotes. Check `SELECT pg_is_in_recovery();` is `f`, then compare row counts on the key tables.
4. Start the apps. Run the `bsec-migrate` job only if the restored data is behind the deployed code.
5. Record the drill in Super Admin > Backups (type "Point-in-time restore") and in `docs/changes/`.

For one store's data use `infra/runbooks/TENANT-RESTORE.md` with the daily dump; point-in-time restore covers the whole cluster.
