# Dependabot batch: docker/setup-buildx-action 4 and docker/metadata-action 6

- **Date:** 2026-10-07
- **Agent:** claude
- **Branch:** `chore/deps-docker-actions`
- **Area:** ci
- **Type:** chore
- **Supersedes:** Dependabot PRs #9 and #11

## Summary
Both actions are used only by the `images` job (build and push to GHCR). Release notes reviewed: v4 of `setup-buildx-action` and v6 of `metadata-action` move to a Node 24 runtime (needs Actions Runner 2.327.1 or newer, which GitHub-hosted runners have), switch to ESM and bump dependencies; `setup-buildx-action` v4 also removes deprecated inputs/outputs, and this workflow passes no inputs. Merged together because they touch one job, and a pull-request run does not execute that job.

## Verification
- Not verifiable on the pull request: the `images`, smoke-test and deploy jobs only run on pushes to `main`. The run on `main` after merge is the test; a failure there blocks the production deploy (it does not break production).
