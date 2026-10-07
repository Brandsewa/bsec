# Remove the self-hosted runner files

- **Date:** 2026-10-07
- **Agent:** claude
- **Branch:** `chore/remove-runner-files`
- **Area:** ci, infra
- **Type:** chore
- **Supersedes:** `2026-10-07-claude-self-hosted-ci-runner.md`

## Summary
The repository is public now, so GitHub-hosted runners are free and the self-hosted runner added earlier the same day is no longer needed. Removed `infra/ci-runner/`, restored `runs-on: ubuntu-24.04` on every job in `.github/workflows/ci.yml` (dropping the `vars.CI_RUNNER` switch), and, outside git, deleted the runner's GitHub registration and its local Docker containers, volumes and image. The repo variable `CI_RUNNER` was already deleted.

## Verification
- The CI run on this PR and the following run on `main` are the proof that jobs start on hosted runners (`docs:check` ok locally).
- Keeping a self-hosted runner on a public repo would let outside pull requests reach the owner's PC; this removes that possibility entirely.
