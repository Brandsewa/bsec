# Backup schedule moved to 03:30 IST, and strict production and backup rules in AGENTS.md

- **Date:** 2026-11-25
- **Agent:** claude
- **Branch:** `docs/backup-ist-schedule-and-rules`  (not merged yet)
- **Area:** infra, docs
- **Type:** infra
- **Supersedes:** none

## Summary
The owner works in IST, so the pgBackRest backup schedule was moved from 03:30 UTC (09:00 IST) to **03:30 IST**, which is 22:00 UTC the day before. The server's root crontab was changed on 2026-11-25 (about 07:11 UTC) at the owner's request. The owner also asked for strict rules so every session follows the same production and backup practice: they are now section 9 of `AGENTS.md` plus hard rule 15.

## What changed
- **Server (done by hand, not by this PR):** root's crontab now runs `pgbackrest backup --type=full` at `0 22 * * 6` (Saturday 22:00 UTC = Sunday 03:30 IST) and `--type=diff` at `0 22 * * 0-5` (Sunday to Friday 22:00 UTC = Monday to Saturday 03:30 IST). Verified with `crontab -l`; the server clock read 07:11 UTC = 12:41 IST. The next run is Wednesday 22:00 UTC = Thursday 03:30 IST (a differential backup).
- `infra/backups/PGBACKREST.md`, `docs/BACKUP-DR-PLAN.md`, `progress.md` and the cutover change record now state the IST schedule.
- `AGENTS.md`: new hard rule 15 and section 9, "Production database and backups: strict rules for every session" (owner's yes per action, pinned image tag, no TLS verification off, secrets handling including browser-driving rules, IST and UTC, differential backup before risky changes, restore safety, honesty about verification, Coolify terminal rules, CI merge discipline, keep the docs and the Notion guide true, ask when unsure).
- The Notion "Backup Restore Guide" was updated to the IST schedule (not part of this diff).

## Verification
- Ran: `pnpm docs:check`. Read the new lines on the server back with `crontab -l`.
- Not verified: the first run at the new time (Thursday 2026-11-26 03:30 IST). Check `pgbackrest info` and `/var/log/bsec-pgbackrest-cron.log` after about 03:45 IST.

## Docs updated
- [x] `AGENTS.md`, `infra/backups/PGBACKREST.md`, `docs/BACKUP-DR-PLAN.md`, `progress.md`, the cutover record
- [x] ARCHITECTURE and ADR: not needed

## Follow-ups and open questions
- The Coolify daily dump still runs at 02:30 UTC (08:00 IST). Move it only if the owner wants that.

## Definition of done
Docs check passes, no secrets in the diff. Open: PR, CI, merge cleanup.
