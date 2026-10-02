# <One-line title of the change>

- **Date:** YYYY-MM-DD
- **Agent:** claude | antigravity | codex | cursor | copilot | human
- **Branch:** `feat/...`  (merged in `<commit or PR>` / not merged yet)
- **Area:** db, domain, web ...
- **Type:** feature | fix | refactor | docs | test | ci | infra | removal
- **Supersedes:** none

## Summary
Two to five sentences: what is different now, and why it was needed (user problem, bug, decision).

## What changed
- Behaviour a user or another developer will notice.
- New or changed files that matter, as paths (`packages/domain/src/...`), not a file dump.
- Migrations added (`00NN_name`), env vars added, queues or routes added, flags added.

## Decisions and trade-offs
Anything non-obvious a later reader would otherwise have to rediscover. Link the ADR if one exists or was written.

## Verification
- Ran: exact commands and results (`pnpm typecheck` pass, `pnpm --filter @bs/domain test:heavy` 930 pass ...).
- Exercised by hand: what screen or flow you drove, in which environment.
- NOT verified: what you only read, or could not run.

## Docs updated
- [ ] `docs/ARCHITECTURE.md` (sections: ...)
- [ ] ADR (number ...) / not needed because ...
- [ ] `DEPLOYMENT.md` / RUNBOOK / not needed
- [ ] `progress.md` (status, known gaps, in-flight)

## Follow-ups and open questions
- Known gaps you left, and questions for the owner.

## Definition of done
Confirm each item in `AGENTS.md` section 7: gate passes, tests added, docs updated, no secrets or generated files in the diff.
