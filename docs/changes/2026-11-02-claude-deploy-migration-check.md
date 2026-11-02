# Deploy stops when a migration does not finish, and dependency security updates

- **Date:** 2026-11-02
- **Agent:** claude
- **Branch:** `chore/deploy-migration-check` (not merged yet)
- **Area:** CI, dependencies, docs
- **Type:** chore
- **Supersedes:** none

## Summary
Follow-up to `docs/changes/2026-11-02-claude-migration-lock-outage.md`. The deploy job can now check that `bsec-migrate` logged `migrations ok` before it redeploys the apps. Three of the four open Dependabot alerts are addressed.

## What changed
- `deploy-production`: when the secret `COOLIFY_LOGS_TOKEN` is set, the job waits 30 seconds and then reads the migrate log every 10 seconds, for up to about 2 minutes. If `migrations ok` never appears, the job fails and the apps are not deployed. Without the secret it warns and behaves as before.
- Overrides: `follow-redirects` 1.16.2, `glob` 14.0.2, `minimatch` 11.0.1.
- Records the merge of #203 in its change record.

## Decisions and trade-offs
- The check reads the log because Coolify showed Success for the stuck migration, so deployment status proves nothing. Coolify's logs endpoint needs a token with `read:sensitive`, more than the Deploy-only token holds, so it is a separate secret.
- The log is not printed in CI: the repository is public.
- With a token set, a Coolify API failure also stops the deploy. Blocking is safer than deploying code without its schema. Re-run the job to retry.
- `:main` images are promoted before this step, so a blocked deploy still leaves `:main` ahead of production. The running containers are unaffected, but a redeploy from Coolify would pull those images.

## Verification
Typecheck, lint, `docs:check` and the admin and Super Admin builds passed, and the web build passed with `DATABASE_URL_RW` blank, as in CI. Tests: admin 109, web 235, domain fast 585, db 50, platform heavy 157, all passing when run one package at a time. A Testcontainers suite (8) confirms the test tooling still works with the upgraded `glob`. Two local `gate:quick` runs failed (one on platform, shipping and worker, one on admin test timeouts); each package passed alone, and the machine is known to time out under that parallel load.

NOT verified: the full domain real-database suite locally (CI runs it). And the new CI branch. It only runs on `main` and needs the token, so this PR cannot prove it, and the exact shape of the logs API response has not been seen. Watch the first deploy after the secret is added.

## Follow-ups and open questions
- Owner: create a Coolify token with `read:sensitive` and add it as the `COOLIFY_LOGS_TOKEN` secret on the GitHub `production` environment. `read:sensitive` can read secrets, so it is a stronger token than the current one.
- `minimatch` 5.1.9 stays, through `readdir-glob`, which needs its old API. It is dev-only (Testcontainers). Its alert stays open.
- `deepmerge` 4.3.1 has no patched release. It comes in through the `shadcn` CLI on `apps/admin`, which is not in the shipped app as far as read; its alert stays open.

## Docs updated
- [x] `infra/coolify/RUNBOOK.md`

## Definition of done
Not done until merged: see `AGENTS.md` section 7.
