# The migration-log check blocked a deploy that had nothing to migrate

- **Date:** 2026-11-03
- **Agent:** claude
- **Branch:** `fix/deploy-log-check` (not merged yet)
- **Area:** CI
- **Type:** fix
- **Supersedes:** none

## Summary
The check added in #204 (`COOLIFY_LOGS_TOKEN`) stopped the deploy of #205: Coolify's logs endpoint answered HTTP 400 on all 8 attempts, so the job reported "did not log migrations ok" and skipped the app deploy. Production was untouched and healthy on the previous version (`f61f976`), and the `:main` images had already been promoted. The migration itself was triggered normally ("deployment queued"), and #205 contains no migration.

## Cause
The check assumed the logs endpoint works for `bsec-migrate`. It almost certainly answers 400 because that resource restarts in a loop after each run (a Docker Image resource whose process exits; `infra/coolify/RUNBOOK.md` section 10) and has no running container to read. This was not confirmed: the Coolify session in the browser pane had expired, and the token is not usable from a local shell.

## What changed
- An unreadable log (any non-200 on two tries in a row) no longer blocks: the job prints a warning and continues, as it did before the token existed.
- A log that is readable and lacks `migrations ok` after the retries still fails the deploy before the apps.

## Decisions and trade-offs
- This makes the check advisory for as long as the endpoint answers 400. It protects nothing until the log is readable.
- Even when readable, a restart loop keeps printing old `migrations ok` lines, so a stuck new migration could still pass. Stopping the loop in Coolify (restart policy `no`) is what makes the check sound. That is the owner's change in Coolify.
- A sounder check would not use Coolify at all: the health endpoint could report the applied migration count and the deploy job could compare it with the repository's journal. Not built; it needs a read grant on the `drizzle` schema for the runtime roles.
- The 30 second wait is kept so the check does not read the old container.

## Verification
The workflow YAML parses and the step's shell passes `bash -n`. The script was run against a fake Coolify for the three outcomes: log unreadable (400) gives a warning and exit 0; log with `migrations ok` gives exit 0; readable log without it gives exit 1. The real Coolify endpoint was not called: it needs the secret token, which is not available locally. The step only runs on `main`, so this PR cannot prove it against real Coolify.

## Docs updated
- [x] Records of #204 and #205 marked merged.

## Follow-ups and open questions
- Owner: set `bsec-migrate` to not restart (custom Docker option `--restart no` or Coolify's restart policy), then the log check can be trusted.
- Production still needs the #205 images deployed: redeploy the five resources in Coolify, or merge this PR (the run redeploys them).

## Definition of done
Not done until merged: see `AGENTS.md` section 7.
