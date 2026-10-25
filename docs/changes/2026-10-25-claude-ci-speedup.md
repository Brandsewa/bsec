# Faster CI: parallel images, sharded heavy tests, pre-push gate

- **Date:** 2026-10-25
- **Agent:** claude
- **Branch:** `ci/speedup` (not merged yet)
- **Area:** ci, infra
- **Type:** ci
- **Supersedes:** none

## Summary
A push to `main` took about 11 minutes (up to 30 cold) because image builds waited for all tests, the heavy suite ran as one serial job, and the Docker cache was `mode=min`. Images now build alongside the tests, heavy tests are sharded, and a pre-push hook runs the quick gate locally.

## What changed
- `images` needs only `changes`, so it overlaps the checks, and pushes the `sha-` tag only. A new `promote-images` job retags to `:main` after `staging-smoke-test` (which now also needs `check-fast`, `check-heavy`, `secret-scan`) passes. `deploy-production` needs `promote-images`. Coolify pulls `:main`, so a red run never changes it.
- Docker layer cache moved from the GitHub Actions cache (`mode=min`, capped at 10 GB) to a registry cache `ghcr.io/<owner>/bsec-cache:<app>` with `mode=max`.
- `check-heavy` split into `check-heavy-shard` (domain 1/2, domain 2/2, db+platform+web, each with its own Postgres) and a roll-up job that keeps the name `heavy integration tests (real postgres)` so branch protection is unaffected. The web build now only runs in the shard that needs `.next`.
- `.turbo` cached with `actions/cache` in `check-fast` and the heavy shards; Playwright browsers cached.
- `.githooks/pre-push` runs `pnpm gate:quick`; enable with `pnpm hooks:install`. `SKIP_GATE=1` skips it.
- `package.json` `prepare` enables the hook on every `pnpm install` (inline and error-swallowing: Docker install stages have no `scripts/` and no `.git`). `AGENTS.md` gains "CI pipeline rules" so every agent follows the new layout.
- `docs/ARCHITECTURE.md` and `infra/coolify/RUNBOOK.md` updated to match.

## Decisions and trade-offs
- `:main` is only moved after the gates, not at build time, because production redeploys pull that tag.
- Shards use `turbo --only` so `@bs/db` heavy tests do not repeat in each domain shard.
- Not done: splitting `check-fast` into parallel jobs, and Turborepo remote cache (needs `TURBO_TOKEN`/`TURBO_TEAM`).

## Verification
- Ran: workflow YAML parses (`python yaml.safe_load`), all job names listed.
- NOT verified: the workflow has not run on GitHub; actionlint was not available locally. First run on the branch is the real test, and the `main` push path (images, promote, deploy) only runs on `main`.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (CI/CD)
- [x] ADR not needed (pipeline change, no architectural decision)
- [x] RUNBOOK section 6
- [ ] `progress.md` in-flight line

## Follow-ups and open questions
- Confirm the GHCR `bsec-cache` package is created private under the same owner; the first build is cold.
- Optional: Turborepo remote cache secrets.

## Definition of done
Gate not run in full; see Verification.
