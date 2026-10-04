# Settings rebuild Phase 0/1 builder prompt

- **Date:** 2026-10-04
- **Agent:** codex
- **Branch:** `codex/settings-rebuild-plan` (not merged yet)
- **Area:** docs, admin, domain, contracts, db
- **Type:** docs
- **Supersedes:** none

## Summary
Added an execution prompt for a separate coding agent to build the first safe Settings rebuild slice: the grouped settings shell, server-backed Overview, and Store Details migration. The prompt anchors the builder to the approved plan/schema while explicitly excluding features that require unresolved product or provider decisions.

## What changed
- Added `docs/prompts/settings-rebuild-phase-0-1.md` with required reading, branch protocol, scoped implementation steps, data/API constraints, tests, browser verification and hand-off format.

## Decisions and trade-offs
- The work is split at Phase 0/1 because permissions, payment providers, tax/shipping depth, notifications and policy/privacy controls require decisions or separate safety-focused plans.
- The prompt prohibits visible placeholder settings and enforces real-database isolation coverage for the new Overview procedure.

## Verification
- Ran: `node scripts/check-docs.mjs` (`docs:check ok`); `git diff --check` (pass).
- Read: existing builder prompts, Settings rebuild plan/schema, Settings/UI patterns and repository rules.
- NOT verified: documentation-only change; no application code, migrations, providers or UI were run.

## Docs updated
- [ ] `docs/ARCHITECTURE.md` — not needed; no structure changed.
- [ ] ADR — not needed for the prompt itself; the builder must write the permission ADR before a granular permission implementation.
- [ ] `DEPLOYMENT.md` / RUNBOOK — not needed.
- [x] `progress.md` — existing Settings planning claim remains active.

## Follow-ups and open questions
- Give this prompt to the chosen builder only after the documentation branch is available to that builder.
- Resolve the owner decisions in `docs/SETTINGS-REBUILD-PLAN.md` section 7 before a later-phase prompt is issued.

## Definition of done
Docs only: no production, secrets, generated files or application code changed.
