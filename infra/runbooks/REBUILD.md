# Rebuild runbook: the server is gone or unusable

**Status: written from the repo and the live setup on 2026-11-25. Not yet exercised on a throwaway server.** Every step below is built from things that were verified separately (backups, restore rehearsal, Coolify setup), but nobody has timed a full rebuild yet. Do the rebuild test in section 6 and replace the time estimates with the measured ones. Plan: `docs/BACKUP-DR-PLAN.md` G5 and G7.

Production is one shared Hostinger VPS (`server.brandsewa.com`) running Coolify. The repo and GHCR images are not on it, so they survive its loss. What does **not** survive without this runbook: the Coolify configuration (resources, environment variables, Traefik labels, S3 destination, API tokens), the database, and the secrets.

## 1. Which situation are you in?

| Situation | Go to |
|---|---|
| The database is damaged or wrong data was written, but the server is fine | `infra/backups/PGBACKREST.md` (point-in-time restore); one store only: `infra/runbooks/TENANT-RESTORE.md` |
| The server is up but broken or slow | `infra/runbooks/INCIDENT.md`, `ROLLBACK.md` |
| The server is lost, corrupted or compromised and a **Hostinger snapshot** is usable | section 4 |
| The server and its snapshots are gone, or the snapshot is unusable | section 5 |

Backups that exist (state on 2026-11-25): pgBackRest in R2 bucket `bsec-pgbackrest` (continuous WAL, full weekly, differential daily, data-loss window about a minute); the daily Coolify `pg_dump` in R2 bucket `bsec-backups` (kept 35 days, locked 14); Hostinger's weekly server snapshot (two kept, whole disk). Media and images live in R2 (`bsec-media` and the private return-photo bucket) and are not on the server.

## 2. What you need before you start (names only, never values)

Keep every value in the owner's password manager, **outside Coolify and the VPS**. Tick each one off now, not during an outage. If a value in the "irreplaceable" column is missing, say so before doing anything else.

| Name | Used for | If lost |
|---|---|---|
| `PGBACKREST_REPO1_CIPHER_PASS` | decrypts every pgBackRest backup | **irreplaceable**: backups unreadable; fall back to the daily dump |
| `TENANT_SECRETS_KEY` | decrypts every store's saved payment, shipping and email credentials | **irreplaceable**: each store must re-enter its credentials |
| `PGBACKREST_REPO1_S3_KEY` / `_S3_KEY_SECRET` (and a read-only token for drills) | reading and writing the pgBackRest bucket | replaceable: create a new token in Cloudflare |
| `BETTER_AUTH_SECRET` (web) and a different one for platform | session signing | replaceable: everyone is signed out |
| `APP_OWNER_PASSWORD`, `APP_RW_PASSWORD`, `APP_SAAS_PASSWORD`, `APP_PLATFORM_PASSWORD` | database role passwords | replaceable: reset with `ALTER ROLE` (section 5, step 7) |
| `R2_*` (media keys), `BACKUP_R2_*` (read-only dump token), `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `TURNSTILE_*` | media, monitoring, custom domains, signup form | replaceable: create new ones |
| `COOLIFY_TOKEN`, `COOLIFY_LOGS_TOKEN` (GitHub `production` environment) | CI deploys | replaceable: create new ones in the new Coolify |
| Accounts: Hostinger, Cloudflare (also the second account once it exists), GitHub, domain registrar | everything | recover through each provider's own process |

The full list of application variables is in `DEPLOYMENT.md`; the resource table, ports and domains are in `infra/coolify/RUNBOOK.md` section 5.

## 3. First decisions (both paths)
1. **Stop the damage.** If the cause is a compromise, assume every secret that lived on the server is exposed: plan to rotate them after recovery (database role passwords, `BETTER_AUTH_SECRET`s, R2 and Cloudflare tokens, `COOLIFY_*`). `TENANT_SECRETS_KEY` cannot be rotated without every store re-entering credentials: decide that with the owner.
2. **Tell the stores** if checkout is down (the storefront serves from the same server).
3. **Note the time you start.** The elapsed time at the end is the real RTO; put it in the change record.

## 4. Path 1: restore a Hostinger snapshot (the fast path for the server, not for the data)

A snapshot brings back the whole disk as of its date (up to 7 days old): Docker, Coolify, its settings and the database files. It also brings back **the other projects on the shared box** at that date. Time to restore is about 30 minutes (Hostinger's figure). Two warnings:

- **The restored server starts its containers on boot, including the database and the apps, in the state of the snapshot.** The old database will accept traffic and write data that the live history in R2 does not have. As soon as Coolify answers, **stop `bsec-web`, `bsec-platform` and `bsec-worker` first, then `bsec-postgres`**.
- **If the snapshot is from after pgBackRest went live (2026-11-25), the restored database also tries to archive WAL into the live R2 repository.** pgBackRest is expected to refuse to overwrite a WAL segment that already exists with different content (a duplicate-segment error), so archiving would stall rather than corrupt the repository, but the two histories must not be mixed and this behaviour has not been tested here: confirm it in the rebuild test. An older snapshot has no pgBackRest settings and no archiving; the same rule is still safe to follow.

Steps:
1. In Hostinger (hPanel > VPS > Snapshots & Backups), restore the newest snapshot. Wait for the server to boot and for Coolify to answer.
2. Stop the three app resources, then `bsec-postgres` (Coolify > resource > Stop). Check the Hostinger firewall still shows 22, 80 and 443 only.
3. **Replace the database with the live history from R2**, using a one-off container with the same image and the repository variables, writing into the existing data volume. In Coolify > Terminal > `localhost` (a `root@server` prompt):
   ```bash
   IMAGE=ghcr.io/brandsewa/bsec-postgres:sha-<pinned commit>   # the tag from the newest PGBACKREST.md
   VOL=$(docker volume ls -q | grep postgres-data)               # one match: the bsec-postgres volume
   docker run --rm -v "$VOL":/var/lib/postgresql \
     -e PGBACKREST_REPO1_S3_ENDPOINT=... -e PGBACKREST_REPO1_S3_BUCKET=bsec-pgbackrest \
     -e PGBACKREST_REPO1_S3_KEY=... -e PGBACKREST_REPO1_S3_KEY_SECRET=... -e PGBACKREST_REPO1_CIPHER_PASS=... \
     --entrypoint sh "$IMAGE" -c 'gosu postgres pgbackrest --stanza=bsec --delta restore'
   ```
   Type the values from the password manager; do not paste them into a ticket or chat. `--delta` rewrites only the files that differ. Leave out `--type` to restore to the latest point; add `--type=time "--target=<UTC time>" --target-action=promote` to stop earlier (format `YYYY-MM-DD HH:MM:SS.mmm+00`, no space before the zone).
4. In Coolify, check `bsec-postgres` has the pinned image and the five `PGBACKREST_REPO1_*` variables (an older snapshot will not), then start it. It replays WAL from R2, promotes, and archives onward on a new timeline. Look for `database system is ready to accept connections` and `WAL archiving ON` in the log.
5. Run `docker exec -u postgres jpukpasrsnmzzt6w2gshxktd pgbackrest --stanza=bsec check` and then a full backup (`backup --type=full`); confirm `info` shows `status: ok`.
6. Re-create the two cron lines if the snapshot predates them (`PGBACKREST.md`, "Live setup" step 5), and check the Coolify daily dump schedule exists.
7. Start `bsec-migrate` (a no-op unless a release is newer than the data), then the three apps. Verify (section 7).

If the snapshot's Coolify settings are older than a release (resource list, env vars, image tags, manual Traefik labels), compare them against `infra/coolify/RUNBOOK.md` and `DEPLOYMENT.md` and fix what differs.

## 5. Path 2: build from scratch

Use this when there is no usable snapshot. Expected time: not measured (aim 2 to 3 hours; replace after the rebuild test).

1. **New VPS** (Ubuntu 24.04, same size or larger than today's). Harden it as in `infra/coolify/RUNBOOK.md` section 1 (key-only SSH, firewall to 22/80/443 only, never publish the database port). Note the new address; keep it out of the repo.
2. **Install Coolify** (the official installer) and sign in. Set the instance domain, enable API access (Settings > Advanced). Create an API token with Deploy scope for CI and, if you want the migrate-log check, one with `read:sensitive` (GitHub secrets `COOLIFY_TOKEN`, `COOLIFY_LOGS_TOKEN`).
3. **Project**: "Bs Commerce Platform", environment `production`, server `localhost`.
4. **S3 Storage** destination for the daily dump (`bsec-backups-r2`, endpoint `https://<account>.r2.cloudflarestorage.com`, region `auto`, the dump bucket's token).
5. **`bsec-postgres`**: image the pinned `bsec-postgres:sha-<commit>`, database `bsec`, no public port, data volume at `/var/lib/postgresql` (the default). Add the five `PGBACKREST_REPO1_*` variables. **Deploy once** so Coolify creates the volume and the empty cluster, then **stop it**.
6. **Restore the data.** Run the one-off restore from section 4 step 3 (`--delta`, into the new `postgres-data-…` volume), then start `bsec-postgres`. If the pgBackRest repository or its passphrase is unusable, restore the newest daily dump instead (`infra/backups/RESTORE-DRILL.md` steps 4.1 to 4.4, then `bsec-migrate` with `DATABASE_URL_SUPERUSER` once to recreate the roles, as in `infra/coolify/RUNBOOK.md` section 4).
7. **Align passwords.** A physical restore brings back the old cluster's roles, including the old `postgres` superuser password, while the new Coolify resource knows a new one. In a shell inside the container: `psql -U postgres -c "ALTER ROLE postgres PASSWORD '<Coolify value>'"` (the local socket normally does not ask for a password in the official image), and `ALTER ROLE app_rw|app_saas|app_platform|app_owner PASSWORD '<value>'` for any role password you no longer have. Then save the resource's credentials in Coolify to match.
8. **Create the apps** exactly as `infra/coolify/RUNBOOK.md` section 5 describes: `bsec-migrate`, `bsec-web`, `bsec-platform`, `bsec-worker`, `bsec-admin`, `bsec-superadmin`, images `ghcr.io/brandsewa/bsec-*:main`, the ports and domains in its table, the variables in `DEPLOYMENT.md`, healthcheck disabled, `PORT` set explicitly. `DATABASE_URL_PLATFORM` only on platform; owner and password variables only on migrate. Give `bsec-web` the manual Traefik labels from `DEPLOYMENT.md` ("Wildcard store routing" and the custom-hostname catch-all), or every store subdomain answers 503.
9. **CI**: new resources have new UUIDs. Open a PR that updates `MIGRATE_UUID`, `APP_UUIDS` and `COOLIFY_URL` in `.github/workflows/ci.yml`, update the two `COOLIFY_*` GitHub secrets, and only then merge anything.
10. **Cloudflare**: point the records at the new server (`@`, `www`, `*`, `admin`, `platform`, `superadmin`, `server`, `stores`; `media` is the R2 bucket and does not move), keep SSL mode "Full", re-check Custom Hostnames fallback origin, any Access policy and the MCP bypass rule (`infra/coolify/RUNBOOK.md`).
11. **Backups again**: the Coolify daily dump schedule on `bsec-postgres`, the two cron lines (`PGBACKREST.md`), `pgbackrest check`, a fresh full backup. Run the **Hostinger snapshot** schedule check too. In Super Admin > Backups the policy and drill log came back with the database; record this rebuild as a drill.
12. Verify (section 7).

## 6. Rebuild test (do this once, then repeat after big changes)
Goal: prove this runbook and measure the real recovery time, without touching production.
- Use a short-lived throwaway VPS and **never point production DNS at it** (test with a hosts-file entry or a scratch subdomain).
- Create a **read-only** token for `bsec-pgbackrest` (Object Read only) and use it for the restore. A drill must **not** have write access and must **not** archive. The restored scratch database still needs the five `PGBACKREST_REPO1_*` variables (with the read-only key), because replaying WAL reads it from R2 (`restore_command`). So start it through the **stock Postgres entrypoint with archiving switched off**, not through the image's own entrypoint (which turns archiving on whenever all five variables are set):
  ```bash
  docker run -d --name scratch -v <scratch volume>:/var/lib/postgresql -e POSTGRES_PASSWORD=scratch \
    -e PGBACKREST_REPO1_S3_ENDPOINT=... -e PGBACKREST_REPO1_S3_BUCKET=bsec-pgbackrest \
    -e PGBACKREST_REPO1_S3_KEY=<read-only key> -e PGBACKREST_REPO1_S3_KEY_SECRET=<its secret> \
    -e PGBACKREST_REPO1_CIPHER_PASS=<passphrase> \
    --entrypoint docker-entrypoint.sh "$IMAGE" postgres -c archive_mode=off
  ```
  (Not yet run against the real repository: confirm it in the first rebuild test.)
- Follow section 5 through step 8, then check: a store page renders on its subdomain, an admin sign-in works, and **one stored store credential decrypts** with `TENANT_SECRETS_KEY` (the proof that the key matches the data).
- Write the measured times and every deviation into a `docs/changes/` record (type: test) and fix this file.
- Delete the throwaway VPS and its volumes afterwards.

## 7. Verification checklist (after any recovery)
- `curl https://bcom.si/api/health`, `https://platform.bcom.si/health`, `https://admin.bcom.si/health`: `status: ok`, and the database `role` is `app_rw` for web, `app_platform` for platform. Worker log shows `worker started`.
- A store subdomain loads; admin and Super Admin sign in; one store credential decrypts.
- `pgbackrest info`: `status: ok`, newest backup recent, WAL archive growing; the Super Admin > Backups page shows a fresh dump and WAL, and the worker's `backup.check` heartbeat is up.
- Newest order or audit-log row in the restored database against what you expect (how much did the recovery lose?).
- Write the change record: start time, finish time, data lost, secrets rotated, what to fix in this runbook.

## 8. Known gaps (as of 2026-11-25)
- Not rehearsed end to end; times are estimates.
- No read-only token for pgBackRest drills yet (create it before the first rebuild test).
- The second copy of the backups in another Cloudflare account does not exist yet: if the Cloudflare account is locked or compromised, the R2 buckets go with it. `bsec-media` also has no second copy.
- The Coolify configuration is not exported anywhere outside the server and the weekly snapshot. After each release that changes resources or variables, record the change in `infra/coolify/RUNBOOK.md` so section 5 stays true.
- Origin lockdown (Cloudflare-only 80/443), Cloudflare Access for the admin hosts, Sentry and the log drain are still to do (`docs/BACKUP-DR-PLAN.md` G9).
