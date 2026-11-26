# Point-in-time restore drill from the real pgBackRest repository: PASS

- **Date:** 2026-11-26
- **Agent:** claude
- **Branch:** `feat/pitr-drill-script`  (not merged yet)
- **Area:** infra, docs
- **Type:** test
- **Supersedes:** none

## Summary
First restore from the real production backups (R2 bucket `bsec-pgbackrest`) into a throwaway Postgres on the owner's PC: **PASS**, usable after 3 minutes. The script that ran it is now in the repo as `infra/backups/pitr-drill.ps1` so the drill can be repeated monthly.

## What was run
- 2026-11-26, about 04:09 to 04:12 UTC (09:39 IST), owner's Windows PC, Docker Desktop, image `bsec-postgres:sha-877bdeb4...` (the one production runs).
- A new **read-only** Cloudflare token (Object Read only, `bsec-pgbackrest` only) and the cipher passphrase, typed by the owner at hidden prompts.
- Restore to the latest point; the scratch copy started through the stock entrypoint with `-c archive_mode=off`.

## Results
| Check | Result |
|---|---|
| Repository with the read-only token | `status: ok`; full `20261125-040117F`, diff `20261125-040117F_20261125-220002D`; WAL continuous |
| Restore (download, decrypt, write) | 52 s (with `process-max=8`; about 5 minutes with 2 on the first attempt) |
| WAL replay from R2 | 373 segments in 128 s (about 3 per second) |
| Time to a usable database | 180 s |
| `archive_mode` on the copy | off |
| Migrations recorded | 116 |
| Rows | tenants 10, products 440, variants 610, customers 963, orders 10, audit_logs 4793, platform_audit_logs 522 |

Recorded in Super Admin > Backups as "Point In Time, Pass, RTO 3 min, RPO 1 min". The data-loss window is one WAL segment (about a minute): replay reached the newest archived segment.

## Defects found and fixed
- The first attempt failed after a successful restore: the script treated Postgres's normal "the database system is starting up" reply as fatal (Windows PowerShell 5.1 turns native stderr into a terminating error under `ErrorActionPreference = 'Stop'`). Fixed: `Continue` plus explicit exit-code checks, a 15-minute replay wait with progress, and `PGBACKREST_PROCESS_MAX=8`.

## Observation
- WAL is generated at about one segment a minute (around 1,440 a day), because the database has activity every minute. Replay of a full day takes roughly 8 minutes at the measured speed and differential backups run daily, so `archive_timeout=60` (data-loss window about a minute) stays. Repository size to be measured after a week.

## Verification
- Ran: the drill itself (results above, owner watched it in the Terminal panel and recorded it in Super Admin); `infra/backups/pitr-drill.ps1` parses in Windows PowerShell 5.1; `pnpm docs:check`.
- The committed script is the one that passed, with only the header comment and an `-Image` parameter added.

## Not tested
- A restore onto a real server (the rebuild test), decrypting a stored tenant credential with `TENANT_SECRETS_KEY` on the restored copy, a restore to an earlier target time (only the latest point).

## Definition of done
Script parses, docs check passes, no secrets in the diff. Open: PR, CI, merge cleanup.
