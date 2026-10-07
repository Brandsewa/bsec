# Dependabot batch: checkout 7, pnpm/action-setup 6, setup-node 7

- **Date:** 2026-10-07
- **Agent:** claude
- **Branch:** `chore/deps-actions-runtime`
- **Area:** ci
- **Type:** chore
- **Supersedes:** Dependabot PRs #7, #8, #10

## Summary
Bumped the three actions used by every CI job in one reviewed change instead of three separate merges (each merge to `main` starts a full deploy pipeline, and a second merge would cancel the first run mid-flight via the workflow's concurrency group).
- `actions/checkout` 5 to 7: v6/v7 block checking out fork PRs for `pull_request_target` and `workflow_run`; this repo uses plain `pull_request`, so no effect. ESM migration only otherwise.
- `pnpm/action-setup` 4 to 6: Node 24 runtime (v5) and pnpm 11 support (v6); `packageManager` stays pinned to pnpm 10.34.5, which the action reads.
- `actions/setup-node` 5 to 7: ESM migration, new cache outputs, bug fixes; same inputs.
## Verification
All three are exercised by the pull-request run of the check jobs, which is the verification; the image build, smoke test and deploy jobs are exercised by the run on `main` after merge (not verified before merge).
