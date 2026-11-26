# Backups follow-up: first scheduled run verified, Coolify email alerts, WAL alert switched on

- **Date:** 2026-11-26
- **Agent:** claude
- **Branch:** `docs/backup-alerts-followup`  (not merged yet)
- **Area:** infra, docs
- **Type:** docs
- **Supersedes:** none

## Summary
Records what was verified and configured after the pgBackRest cutover. No code change.

## What changed (outside the repo)
- First scheduled pgBackRest run verified on the server (read-only): differential `20261125-040117F_20261125-220002D` at 22:00 UTC (Thursday 03:30 IST), 42 s, `status: ok`, expire ran; WAL archive range still growing.
- Coolify email, set up with the owner: team Notifications > Email and instance Settings > Email both use Zoho ZeptoMail SMTP (`smtp.zeptomail.in:587`, StartTLS, user `emailapikey`, from `no-reply@bcom.si`; the owner typed the token). Events: backup failure (not success), deploy failure, restart limit, scheduled task failure, server alerts including disk usage. Coolify sends to the account email, which the owner changed so alerts reach a monitored inbox. Two test emails arrived; ZeptoMail's log showed an earlier one as delivered to a mailbox that never surfaced it.
- Owner: switched on "WAL archiving is live" in Super Admin > Backups and recorded the baseline drill.

## Docs updated
- `progress.md`, `infra/backups/PGBACKREST.md` (alerts and the verified run), `docs/BACKUP-DR-PLAN.md` (G4 item 1 done), `infra/runbooks/REBUILD.md` (re-enter Coolify email settings and turn on 2FA on a rebuild).

## Verification
- Read the cron log and `pgbackrest info` on the server; read the saved Coolify settings after a full reload; ZeptoMail sent log; the owner confirmed the test emails and the Backups page changes. `pnpm docs:check`.
- Not verified: a real alert email from Coolify (only tests), a restore from the real repository.

## Follow-ups and open questions
- Owner: two-factor authentication on the Coolify account (it was off on 2026-11-26), a read-only token for `bsec-pgbackrest`, rotating the Coolify database password.
- Claude: restore drill from real R2, rebuild test, second-copy job, WAL growth after a week.

## Definition of done
Docs check passes, no secrets or personal addresses in the diff. Open: PR, CI, merge cleanup.
