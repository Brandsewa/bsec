# Add the system diagram to the repo and the rule to keep it current

- **Date:** 2026-11-25
- **Agent:** claude
- **Branch:** `feat/builder-copy-paste-delete` (not merged yet; files are uncommitted, move them to a `docs/...` branch before committing)
- **Area:** docs
- **Type:** docs
- **Supersedes:** none

## Summary
Added a one-page system diagram (Mermaid) covering users and edge, the five apps on the VPS, Postgres and R2, pgBackRest backups, Better Stack monitoring, the CI/CD pipeline and the language and tool stack. A snapshot of the styled whiteboard it mirrors is stored next to it, so anyone can read it offline. `ARCHITECTURE.md` now says when to update it.

## What changed
- `docs/SYSTEM-DIAGRAM.md`: the diagram, the stack table, and the "keeping it current" steps.
- `docs/diagrams/system-board.json`: export of the whiteboard (boxes, arrows, labels) taken 2026-11-25.
- `docs/ARCHITECTURE.md`: one row in the section 0 trigger table and a pointer under section 2.

## Decisions and trade-offs
- Mermaid is the reviewed copy (diffs cleanly, renders on GitHub). The whiteboard is the presentation copy and can drift, so the snapshot records its state.
- Planned and not-live items (second backup copy, Sentry, Cloudflare Access) are drawn dashed so the picture never claims more than is live.
- No secrets, IPs or credentials are on the diagram (public repo, AGENTS.md section 5).

## Verification
- Ran: `node scripts/check-docs.mjs`. My files raise no errors; it fails on one thing that is not mine: `ARCHITECTURE.md` lacks the uncommitted migration `0096_platform_login_panel.sql`.
- Exercised by hand: no. The Mermaid block was written but not rendered.
- NOT verified: Mermaid syntax rendering; backup schedule and Better Stack details were taken from `infra/backups/README.md`, `infra/uptime/README.md` and the owner's notes, not re-checked on the live servers.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (section 0 table, section 2 pointer)
- [x] ADR: not needed, no decision changed
- [x] `DEPLOYMENT.md` / RUNBOOK: not needed
- [ ] `progress.md`: not touched

## Follow-ups and open questions
- Render the Mermaid block (GitHub preview or an editor) and fix any syntax error.
- Re-export `system-board.json` whenever the whiteboard changes.

## Definition of done
Docs-only change; no code, no secrets, no generated files. Gate not run.
