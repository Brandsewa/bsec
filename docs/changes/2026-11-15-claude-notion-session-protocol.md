# Rule: every agent keeps the BCOM Platform OS in Notion current

- **Date:** 2026-11-15
- **Agent:** claude
- **Branch:** `docs/notion-session-protocol` (not merged yet)
- **Area:** docs
- **Type:** docs
- **Supersedes:** none

## Summary
The owner made the BCOM Platform OS workspace in Notion the coordination layer for all agents (roadmap, feature status, work items, change log index, decisions, risks, docs index). Notion has no automation on the plan in use, so nothing keeps it in step with GitHub. This adds the rule to the one rule book so every agent (Claude Code, Antigravity, ZCode, Codex, Cursor, Copilot) reads it, and ties it into the definition of done.

## What changed
- `AGENTS.md` section 6: new rule 7 (keep the Notion workspace current; follow its Session protocol page at the start and end of every session; list the Notion rows touched in the final message; never put secrets, IPs, personal or customer data in Notion; never copy specs there; say so if Notion could not be reached).
- `AGENTS.md` section 7: one new line in the Definition of done.
- `progress.md`: In flight line for this branch.
- No code, no migration, no env var, no pointer-file change (`CLAUDE.md`, `GEMINI.md`, copilot and cursor files already point to `AGENTS.md`).

## Decisions and trade-offs
- The rule lives in `AGENTS.md` only (one rule book). The step-by-step checklists live on the Notion page "Session protocol", because they name Notion databases and tool tips that change more often than this file. The repo carries the obligation, Notion carries the how.
- No Notion URLs or ids are committed (the repository is public). The page is referred to by name.
- Enforcement beyond the rule (a script that lists `docs/changes` and `docs/adr` files with no Notion row, or a Claude Code Stop hook) is tracked as a Notion Work Item, not built here.

## Verification
- Ran: `node scripts/check-docs.mjs` (the `docs:check` script): "docs:check ok". Typecheck, lint, build and tests were not run: docs-only change, pushed with `SKIP_GATE=1` as AGENTS.md section 4 allows for docs-only pushes.
- Exercised by hand: the Notion pages this rule points to (Session protocol, Technical Architecture, Database Schema, personas page, Features database) were opened in the browser pane and checked for rendering and links on 2026-11-15.
- NOT verified: that other agents (Antigravity, ZCode, Codex) will follow the rule; that is observed over later sessions.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed (no structure change)
- [ ] ADR: not needed (process rule, not architecture)
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md` (in flight)

## Follow-ups and open questions
- Remove the In flight line and record the PR and commit after merge.
- Optional second layer of enforcement (repo script or hook): see the Notion Work Item "Add a repo check that lists docs/changes and docs/adr files with no Notion row".

## Definition of done
Docs-only change: no code touched, no secrets, no generated files, no unrelated edits.
