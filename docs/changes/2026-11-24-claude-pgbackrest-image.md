# bsec-postgres image with pgBackRest, point-in-time restore rehearsal and cutover runbook

- **Date:** 2026-11-24
- **Agent:** claude
- **Branch:** `feat/pgbackrest-image` (merged in #324, c35f170d)
- **Area:** infra, ci, docs
- **Type:** infra
- **Supersedes:** none

## Summary
Step 4 of `docs/BACKUP-DR-PLAN.md` (G1): the Postgres image that will archive WAL continuously to R2, a script that proves a point-in-time restore end to end, and the written cutover procedure. **Nothing in production changed**: no image swap, no bucket, no token. The production cutover (03:00 local) still needs the owner's explicit go-ahead.

## What changed
- `infra/docker/postgres.Dockerfile`: `postgres:18` plus pgBackRest 2.60.1 (exact package version). `infra/docker/postgres-entrypoint.sh` switches archiving on only when all five `PGBACKREST_REPO1_*` variables are set; without them the image is plain Postgres, so a half-configured server never fills its disk with unarchived WAL.
- `infra/backups/pgbackrest.conf` rewritten: no account id or bucket in the file (they come from env), baked into the image.
- `infra/backups/pitr-rehearsal.mjs`: throwaway containers on a private network, a local TLS S3 server standing in for R2. Checks archiving off without credentials, on with them, stanza create and check, full and differential backups, restore to a chosen moment (rows before it back, rows after it absent), archiver failure count, and measures restore time and how long a committed row waits before it is archived.
- CI: `postgres` added to the image build and promote matrices (same `sha-` then `:main` flow); the staging smoke test now runs the real `bsec-postgres` image (no env, so plain Postgres behaviour, which also proves the migrate job works on it); new job "pgBackRest restore rehearsal" runs the script when the image, the config or the script change.
- Docs: `infra/backups/PGBACKREST.md` (bucket and token, env, cutover, rollback, restore), README, plan G1, ARCHITECTURE, progress.md. Merge cleanup for #323 (Branch line of its record, its In flight line).

## Decisions and trade-offs
- **No bucket lock or lifecycle rule on `bsec-pgbackrest`.** pgBackRest overwrites `backup.info`/`archive.info` after every backup and deletes expired files itself; an R2 lock or expiry would break backups or remove live WAL. Protection is a bucket-scoped token plus the second-account copy (still to build). This corrects the plan's "own lock and token" wording; the plan now says so.
- Archiving is gated on env rather than always on, accepting that "image swapped but env forgotten" means no archiving; the Super Admin WAL card and the `backup.check` job (once "WAL archiving is live" is ticked) flag exactly that.
- `archive-async=y` with a spool on the container filesystem: WAL waits there if R2 is unreachable. The spool is small (one segment queue) and is covered by the disk-space alert (plan G4).
- Local S3 stand-in is SeaweedFS (MinIO's images are no longer pullable). Only the stand-in uses `repo1-storage-verify-tls=n`; production uses R2's real certificate.

## Verification
- Ran locally (Docker 29, Windows): image build OK (`pgbackrest version` 2.60.1); `node infra/backups/pitr-rehearsal.mjs`: PASS, 12 of 12 checks. Restore to the chosen moment and promotion in 5 s (tiny database); committed row archived about 56 s after commit (`archive_timeout=60`); `failed_count=0`. First runs failed on two real issues, now fixed: the S3 bucket must exist before `stanza-create`, and the restore target must be written `HH:MM:SS.mmm+00` without a space before the zone.
- A fresh data directory with credentials set initialises and starts correctly (the rehearsal does this).
- Not run: the CI changes (YAML parses; they only run for real on this PR and on `main`), the staging smoke test with the new image (CI only), a real R2 bucket, Coolify's handling of the image (does its Postgres resource keep the image's entrypoint? checked at cutover step 3, with a rollback ready), a production-sized restore, WAL volume and disk headroom on the VPS, `pnpm gate:quick`.
- The first `main` run after merge builds and promotes the new image; watch it (this PR changes the CI image matrix, which cannot be proven by the PR alone).

## Docs updated
- [x] `docs/ARCHITECTURE.md`, `docs/BACKUP-DR-PLAN.md`, `infra/backups/README.md`, `infra/backups/PGBACKREST.md`, `progress.md`
- [x] ADR: not needed (implements the plan; the bucket-lock correction is recorded in the plan)
- [ ] `DEPLOYMENT.md`: no change yet; the new env vars are documented in `PGBACKREST.md` and become live only at cutover

## Follow-ups and open questions
- Owner: create bucket `bsec-pgbackrest` and a scoped token, generate and escrow the cipher passphrase, then give the go-ahead and a date for the 03:00 cutover.
- Claude after merge: a rehearsal against a real R2 test bucket if the owner supplies a throwaway token; weekly second-copy job; `REBUILD.md`.
- Decide with the owner whether the first cutover step 3 check (entrypoint kept by Coolify) should be tried on a throwaway Coolify Postgres resource first.

## Definition of done
Gate for the touched paths passes, rehearsal passes, docs updated, no secrets in the diff. Open: commit, PR and CI, merge cleanup.
