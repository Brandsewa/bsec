# bsec-postgres image: install ca-certificates so pgBackRest can verify R2

- **Date:** 2026-11-25
- **Agent:** claude
- **Branch:** `fix/pgbackrest-ca-certificates`  (not merged yet)
- **Area:** infra, docs
- **Type:** fix
- **Supersedes:** none

## Summary
At the first production cutover (image swapped to `sha-b16cac3d`, 2026-11-25 09:00 IST) `pgbackrest stanza-create` failed with `unable to verify certificate presented by '<account>.r2.cloudflarestorage.com:443': [20] unable to get local issuer certificate`. The `postgres:18` base image ships no CA certificates (`/etc/ssl/certs/ca-certificates.crt` does not exist), so pgBackRest could not trust R2. The image now installs `ca-certificates`, and the rehearsal verifies real certificates so this cannot slip through again.

## What changed
- `infra/docker/postgres.Dockerfile`: installs `ca-certificates` next to pgBackRest; the build fails if `/etc/ssl/certs/ca-certificates.crt` is missing.
- `infra/backups/pitr-rehearsal.mjs`: the S3 stand-in's certificate is now signed by a throwaway CA that is installed into the containers' system trust store (via `update-ca-certificates`, which needs the package), and `repo1-storage-verify-tls=n` is gone. New checks: the image has a CA bundle, and no verify-tls override is set.
- `infra/backups/PGBACKREST.md`: records the finding.

## Decisions and trade-offs
- Fix the image, not the server: no hand-patched production container and no `verify-tls=n`. Disabling verification would leave the connection open to interception (backups are encrypted, but verification is the right default for credentials in transit).
- The live container keeps running the old pinned image (archiving on, failing, WAL retained locally, nothing lost) until the new tag is pulled and the database restarted once more.

## Verification
- Ran locally (Docker 29): image builds; the bundle exists; `node infra/backups/pitr-rehearsal.mjs` PASS, 14 checks, with real certificate verification on: restore to a chosen moment 6 s, archive delay 57 s, archiver `failed_count=0`.
- Production evidence of the bug: `docker exec ... ls /etc/ssl/certs/ca-certificates.crt` returned no such file; `dpkg -l ca-certificates` showed it not installed.
- Not yet verified: CI for this PR, the new image on the VPS, `stanza-create` against real R2.

## Docs updated
- [x] `infra/backups/PGBACKREST.md`, `progress.md`
- [x] ARCHITECTURE: no structural change; ADR not needed

## Follow-ups and open questions
- Pull the new `sha-` tag onto the VPS, restart `bsec-postgres`, then `stanza-create`, `check`, first full backup, scheduled tasks, tick "WAL archiving is live".
- Owner: consider rotating the Coolify database superuser password (it appeared in the working transcript during cutover).

## Definition of done
Gate passes, rehearsal passes, no secrets in the diff. Open: PR, CI, merge cleanup.
