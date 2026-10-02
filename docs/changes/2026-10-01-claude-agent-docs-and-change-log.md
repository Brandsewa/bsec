# Architecture map, one agent rule book and a per-change log

- **Date:** 2026-10-01
- **Agent:** claude
- **Branch:** `docs/agent-rulebook-and-architecture-map` (not merged yet)
- **Area:** docs, ci
- **Type:** docs
- **Supersedes:** none

## Summary
Any new coding agent can now index the repo from three entry points: `AGENTS.md` (rules), `docs/ARCHITECTURE.md` (what exists and where) and `docs/changes/` (what each agent changed and why). Before this, rules were split across `README.md`, `progress.md` and a Next/Turbo managed block, and parallel agents (Claude, Antigravity) had no shared change log.

## What changed
- `docs/ARCHITECTURE.md`: new living map (apps, packages, roles, flows, tenancy rules, table inventory, migrations, API surface, routes, blocks, jobs, auth, caching, config, tests, ADR summary, known doc gaps).
- `AGENTS.md`: one rule book for all agents (hard rules, conventions, verification gate, git safety, multi-agent protocol, definition of done). The Turborepo managed block is kept at the top.
- Pointer files: `CLAUDE.md` (`@AGENTS.md`), `GEMINI.md` (Antigravity), `.github/copilot-instructions.md`, `.cursor/rules/bsec.mdc`.
- `docs/changes/` (README, TEMPLATE, this record): one file per change set, so parallel branches never conflict.
- `scripts/check-docs.mjs` + `pnpm docs:check` + a CI step in `check-fast`: fails when an app/package, migration, queue, ADR, block type or permission exists on disk but is missing from the docs, or a change record is malformed.
- `docs/adr/README.md`: index now lists ADR 011 to 017 (it stopped at 010 plus 018) and notes the duplicate 014 and next number 019.
- `progress.md`: pointer to the three docs and a new "In flight" list.

## Decisions and trade-offs
- **`progress.md` stays** as the status board; the detailed log moved to per-file records because one shared append-only file conflicts across worktrees (this repo already runs three).
- **One rule book, thin pointers.** Copies of rules in per-tool files drift; `docs:check` verifies the pointers exist and reference `AGENTS.md`.
- **The docs check is a CI gate** in `check-fast`, so a push to `main` that adds an app/migration/queue/etc. without updating `ARCHITECTURE.md` will not deploy. It checks names only, not prose. Remove the CI line if that is too strict.
- Duplicate ADR-014 was not renumbered (inbound links); documented instead.

## Verification
- Ran: `pnpm docs:check` (see below), reading each referenced path from the working tree.
- Facts in `ARCHITECTURE.md` were read from code and docs, not exercised live. Row/route lists reflect `036b148`.
- NOT verified: that the Antigravity/Codex/Cursor/Copilot tools actually load their pointer files (their config conventions were taken from their public docs, not tested here); the "In flight" entry for `feat/auth-email-overhaul` is inferred from `git worktree list` and the plan doc.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (created)
- [x] ADR index fixed
- [x] `progress.md`
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed (no deploy change besides one CI step)

## Follow-ups and open questions
- Owner: confirm the CI docs gate is wanted.
- Backfill change records for the last milestones (M8, M9, M10) from `progress.md` if a full history is wanted; not done.
- `apps/web/AGENTS.md` and `apps/web/CLAUDE.md` are untracked files written by `next dev`; commit them (the file asks for it).
- Consider generating the oRPC procedure list into the docs automatically instead of the hand-written summary in section 8.

## Definition of done
Gate for this change: `pnpm docs:check` passes. No code behaviour changed, so typecheck/lint/tests are unaffected.
