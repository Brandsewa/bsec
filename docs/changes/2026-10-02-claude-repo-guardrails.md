# Repo guardrails: agent permissions, Dependabot, PR template, CODEOWNERS, secret scan

- **Date:** 2026-10-02
- **Agent:** claude
- **Branch:** `chore/repo-guardrails` (not merged yet)
- **Area:** ci, infra, docs
- **Type:** infra
- **Supersedes:** none

## Summary
Cherry-picked the useful pieces of the owner's AI starter kit (`Brandsewa/ai-project-starter-kit`) and adapted them to bsec. The kit's own `.ai/` state files and `docs/` templates were deliberately NOT adopted: `AGENTS.md`, `progress.md`, `docs/changes/` and `docs/adr/` already do that job and a second system would duplicate them.

## What changed
- `.claude/settings.json`: deny reading `.env*` (not `.env.example`), keys and credentials; ask before force-push, `reset --hard`, `branch -D`, `git clean`, `--no-verify`, `rm -rf`. Backs up AGENTS.md rule 7 and section 5.
- `.github/dependabot.yml`: weekly GitHub Actions, npm (minor/patch grouped, majors separate) and Docker (`infra/docker`) updates.
- `.github/PULL_REQUEST_TEMPLATE.md`: bsec-specific risk checklist and definition of done.
- `.github/CODEOWNERS`: owner on agent rules, ADRs, `.github/`, `infra/`, db, auth, payments.
- `secret-scan` job in `ci.yml` (Gitleaks CLI image `v8.28.0`, full history) plus `.gitleaks.toml`. `images` now `needs` it, so a leak blocks a production deploy.

## Decisions and trade-offs
- Gitleaks CLI via Docker instead of `gitleaks-action`: the action needs a paid license on organization repos.
- The default ruleset flagged 12 generic-api-key hits in the history; all are test fixtures or identifiers (reviewed with values truncated), so `.gitleaks.toml` allowlists `test/`, `e2e/` and `*.test.ts(x)` paths.
- Kit `rebase` / `commit --amend` ask-rules dropped: AGENTS.md section 5 tells agents to rebase on `origin/main`.

## Verification
- Ran: Gitleaks `v8.28.0` over the full history with `.gitleaks.toml` locally: 150 commits, no leaks. Without the config: 12 findings, all in test files.
- NOT verified: the new CI job on GitHub (first run is on this PR); Dependabot (starts after merge); CODEOWNERS is only enforced if branch protection requires code-owner review (not enabled by the agent).

## Docs updated
- [x] `docs/ARCHITECTURE.md` (file table, CI/CD block, last verified)
- [x] ADR not needed
- [ ] `DEPLOYMENT.md` / RUNBOOK not needed
- [ ] `progress.md` not needed (no milestone state change)

## Follow-ups and open questions
- Owner: consider requiring `secret-scan` and code-owner review in branch protection for `main`.
- Optional, not adopted: the kit's context-budget script and review/bugfix/feature skills.

## Definition of done
Gate to be confirmed by this PR's CI; no secrets or generated files in the diff.
