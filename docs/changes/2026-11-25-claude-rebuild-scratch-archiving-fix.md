# REBUILD.md: scratch database must start with archiving off, not without the variables

- **Date:** 2026-11-25
- **Agent:** claude
- **Branch:** `docs/rebuild-scratch-archiving`  (not merged yet)
- **Area:** docs, infra
- **Type:** docs
- **Supersedes:** none

## Summary
Section 6 of `infra/runbooks/REBUILD.md` told the reader to leave the five `PGBACKREST_REPO1_*` variables off on a scratch or rebuild-test database. That cannot work for a point-in-time restore: replaying WAL needs those variables (the restore command reads WAL from R2). The image's own entrypoint turns archiving on when all five are set, so the safe way is to supply them with a **read-only** token and start the scratch database through the stock Postgres entrypoint with `-c archive_mode=off`.

## What changed
- `infra/runbooks/REBUILD.md` section 6: corrected wording and added the exact `docker run` form.

## Verification
- Ran: `pnpm docs:check`. Checked against `infra/docker/postgres-entrypoint.sh` (archiving is switched on only by that wrapper, and the stock `docker-entrypoint.sh` is on the image's PATH).
- Not verified: the scratch start against the real R2 repository; the first rebuild test will confirm it.

## Docs updated
- [x] `infra/runbooks/REBUILD.md`
- [x] ARCHITECTURE and ADR: not needed

## Follow-ups and open questions
- None beyond the rebuild test and the read-only token (see `REBUILD.md` section 8).

## Definition of done
Docs check passes, no secrets in the diff. Open: PR, CI, merge cleanup.
