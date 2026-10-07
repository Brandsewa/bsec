# Summary record: design-system overhaul, CI and public repo (2026-10-05 to 2026-10-07)

- **Date:** 2026-10-07
- **Agent:** claude
- **Branch:** `docs/overhaul-and-ci-summary`
- **Area:** docs
- **Type:** docs

## Summary
One place to find what happened across about forty pull requests and three days: the design-system overhaul (Parts 1 to 8; Part 4 on hold), the CI billing block and its resolution, making the repository public, security settings, Dependabot batches and the VPS firewall. Added a handoff section to `progress.md`, updated the CI/CD and known-gaps sections of `docs/ARCHITECTURE.md`, put the lessons into `AGENTS.md` (serial CI tests, isolation-suite mapping, e2e selectors, public-repo hygiene, no second merge during a main run), marked the implementation guide and `docs/design-system.md` with their final status, and removed a stale "In flight" line. No code changed.

## Verification
- `pnpm docs:check` passes. Every factual claim comes from this session's own checks: the green `main` run at `e029ec2` (all jobs including the smoke test and deploy), the port probe after the firewall change, and the individual change records in `docs/changes/2026-10-05-*` to `2026-10-07-*`. The items listed as not done were checked to be not done, not assumed.
