# REBUILD.md: runbook for a lost or unusable server

- **Date:** 2026-11-25
- **Agent:** claude
- **Branch:** `docs/rebuild-runbook`  (not merged yet)
- **Area:** docs, infra
- **Type:** docs
- **Supersedes:** none

## Summary
`infra/runbooks/REBUILD.md` closes plan item G5 (and the checklist side of G7). It covers two recovery paths (restore a Hostinger snapshot, or build a new server from scratch with Coolify), the inventory of secrets and what happens if each is lost, a rebuild-test procedure that cannot touch production, and a verification checklist. It is built from the live setup and the existing runbooks; it has **not** been rehearsed end to end.

## What changed
- New `infra/runbooks/REBUILD.md`.
- `infra/backups/PGBACKREST.md`: the snapshot-restore section now points to REBUILD.md and states the archive-conflict behaviour accurately (pgBackRest is expected to refuse to overwrite a different WAL segment, so archiving stalls rather than corrupts; the earlier wording said it "can damage the archive", which overstated it; untested, to be confirmed in the rebuild test).
- `infra/coolify/RUNBOOK.md` section 8 notes pgBackRest and links REBUILD.md; `docs/BACKUP-DR-PLAN.md` G5, `progress.md` updated.

## Decisions and trade-offs
- One restore recipe for both paths: a one-off container with the same image and the repository variables running `pgbackrest --delta restore` into the database volume, before the database starts. It works regardless of the snapshot's age or Coolify state, and the same recipe serves the from-scratch path.
- Rebuild tests and drills use a **read-only** token and never start archiving, so a test cannot write into the live repository.
- The runbook says plainly which values are irreplaceable (`PGBACKREST_REPO1_CIPHER_PASS`, `TENANT_SECRETS_KEY`) and which are not.
- CI hardcodes Coolify resource UUIDs and the URL (`ci.yml`): a from-scratch rebuild needs a PR for those before merging anything; the runbook says so.

## Verification
- Ran: `pnpm docs:check`. Read against `infra/coolify/RUNBOOK.md`, `DEPLOYMENT.md`, `infra/backups/PGBACKREST.md`, `docs/BACKUP-DR-PLAN.md` and `ci.yml` for consistency.
- Not verified: any step of the rebuild on a throwaway server; the duplicate-WAL-segment refusal; that the official image's local socket allows `ALTER ROLE postgres` without a password in this Coolify setup; the time estimates (the 30-minute snapshot figure is Hostinger's).

## Docs updated
- [x] `docs/BACKUP-DR-PLAN.md`, `infra/coolify/RUNBOOK.md`, `infra/backups/PGBACKREST.md`, `progress.md`
- [x] ARCHITECTURE: no structural change; ADR not needed

## Follow-ups and open questions
- Owner: confirm every item in REBUILD.md section 2 is in the password manager (especially the cipher passphrase and `TENANT_SECRETS_KEY`); create a read-only token for `bsec-pgbackrest`; agree a date and a throwaway VPS for the rebuild test.
- Claude: run the rebuild test with the owner and replace the estimates with measured times; build the weekly second-copy job.

## Definition of done
Docs check passes, no secrets in the diff. Open: PR, CI, merge cleanup.
