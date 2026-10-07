# Self-hosted GitHub Actions runner

- **Date:** 2026-10-07
- **Agent:** claude
- **Branch:** `ci/self-hosted-runner`
- **Area:** ci, infra
- **Type:** infra
- **Supersedes:** none

## Summary
GitHub-hosted jobs stopped starting on 2026-10-07 ("recent account payments have failed or your spending limit needs to be increased"), so CI and the production deploy could not run. Added a self-hosted runner that runs on the owner's Windows PC under Docker Desktop (`infra/ci-runner/`: official runner image + docker CLI, with a `docker:dind` sidecar sharing its network namespace and work volume so service containers, `localhost` Postgres and bind mounts behave as on a hosted runner). `ci.yml` now uses `runs-on: ${{ vars.CI_RUNNER || 'ubuntu-24.04' }}`; repo variable `CI_RUNNER=bsec-local` selects the runner and deleting it restores GitHub-hosted runners with no other change.

## Verification
- Runner registered and reported `online` via the GitHub API (label `bsec-local`).
- First real proof is the CI run on the pull request for this branch (see the PR checks); results are recorded below once it finishes.
- Not tested: image build and deploy jobs on the runner (they only run on pushes to `main`).

## Notes and risks
- While the PC is off or Docker Desktop is stopped, CI and deploys queue.
- `dind` is privileged and the runner can read CI secrets (GHCR, Coolify token): private repo only, no untrusted PRs.
- Runbook: `infra/ci-runner/README.md` (start, stop, re-register, cleanup).
