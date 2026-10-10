# Runbook: Coolify auto-update incident (2026-10-09) and the pinned-version policy

- **Date:** 2026-10-10
- **Agent:** claude
- **Branch:** `docs/coolify-4-4-5-incident`
- **Area:** docs, infra
- **Type:** docs
- **Supersedes:** none

## Summary
Coolify's nightly auto-update installed a broken 4.4.5 build on 2026-10-09, which took down the Coolify dashboard and API (502) and made the next CI deploy fail at the migration step. It was fixed on 2026-10-10 by pinning 4.4.3 and turning Auto Update off. This change records the cause, how to recognise it, the rollback, a manual-upgrade procedure and a way to check `TENANT_SECRETS_KEY` without showing it, in `infra/coolify/RUNBOOK.md` (new section 11, a gotcha in section 10, and the hardening checklist no longer says to keep Coolify auto-updated).

## What changed
- `infra/coolify/RUNBOOK.md` only. No code, schema, env var or pipeline change. No IP address, host credential or key appears in the text.

## Verification
- Everything described was observed on 2026-10-10 on the server: the upgrade log lines, the image creation time, the health-check output, the version history in the dated `.env` backups, the rollback commands and their result (`coolify` healthy on 4.4.3, dashboard 302, the re-run deploy job green).
- NOT verified: that Auto Update stays off across Coolify restarts (the owner switched it off in the dashboard); the exact upstream cause inside the 4.4.5 image (only its symptom was observed).
- `pnpm docs:check` run on this branch.

## Docs updated
- [x] `infra/coolify/RUNBOOK.md` (sections 9, 10, 11)
- [ ] ARCHITECTURE.md / ADR / DEPLOYMENT.md / progress.md: not needed
