# Backups and restore drill (pgBackRest → R2)

Targets (PLAN §14): **RPO ≤ 15 min**, **RTO ≤ 2 h**. A backup counts as valid only after a restore test. Status: **draft, not yet executed** (needs the production VPS and an R2 bucket).

## Layout
- Repository: Cloudflare R2 bucket `bsec-pgbackrest-<env>` (S3 API), encrypted with `repo1-cipher-type=aes-256-cbc`.
- Schedule: full weekly (Sun 02:30 IST), differential daily (02:30 IST), WAL archived continuously with `archive_timeout=60`.
- Retention: 30 days (`repo1-retention-full-type=time`, `repo1-retention-full=30`).
- Media: R2 bucket versioning on. Coolify config, env templates, migration state and image tags exported with each release.

## pgBackRest config (`/etc/pgbackrest/pgbackrest.conf` inside a sidecar that shares the PG data volume)
See `pgbackrest.conf` in this folder. Secrets come from env (`PGBACKREST_REPO1_S3_KEY`, `PGBACKREST_REPO1_S3_KEY_SECRET`, `PGBACKREST_REPO1_CIPHER_PASS`).

Postgres settings:
```
archive_mode = on
archive_command = 'pgbackrest --stanza=bsec archive-push %p'
archive_timeout = 60
wal_level = replica
max_wal_senders = 3
```

One-time:
```bash
pgbackrest --stanza=bsec stanza-create
pgbackrest --stanza=bsec check
pgbackrest --stanza=bsec --type=full backup
```

## Monthly restore drill (on staging)
1. Provision a scratch Postgres 18 container on staging with an empty data volume.
2. `pgbackrest --stanza=bsec --delta --type=time --target="<timestamp 10 min ago>" restore` into it.
3. Start it; run `select count(*)` on key tables and compare with production at that timestamp. Run `pnpm --filter @bs/db migrate` against it as `app_owner` (must be a no-op).
4. Record: backup label, restore start/end (RTO), newest restored transaction time vs target (RPO), row-count diff. Log it in progress.md now, and in Super Admin → System from M9.
5. Destroy the scratch database.

M0 exit criterion "a backup is restored into a scratch database" is met only after step 4 is logged for real.
