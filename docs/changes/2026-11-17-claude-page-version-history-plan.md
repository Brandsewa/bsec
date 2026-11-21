# Plan: page version history and restore in the editor

- **Date:** 2026-11-17
- **Agent:** claude
- **Branch:** `docs/page-version-history-plan` (not merged yet)
- **Area:** admin, domain, contracts
- **Type:** docs
- **Supersedes:** none

## Summary
After a stale-editor bug overwrote a store's Header and Home pages (fixed in #282), recovery needed raw API calls because the editor has no history screen. This adds `docs/PAGE-VERSION-HISTORY-PLAN.md`: what exists, server gaps found (rollback does not check the version belongs to the page, no audit log, no way to read an old version), industry notes, the proposed design, cost, acceptance criteria and open questions. It also marks the #282 change record as merged.

## What changed
- New `docs/PAGE-VERSION-HISTORY-PLAN.md`.
- `docs/changes/2026-11-17-claude-editor-page-switch-fix.md`: Branch line now says merged in #282 (b6018b9).

## Decisions and trade-offs
No code or schema changes. The plan proposes shipping the server hardening first because it removes a live cross-page risk on its own.

## Verification
- Ran: `pnpm docs:check`.
- Code claims were read from `packages/domain/src/content-services.ts` and the contract, not run against a database. Store size figures came from read-only calls to the live admin API.
- NOT verified: vendor behaviour (search summaries only).

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed, plan only
- [ ] ADR: not needed yet
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [ ] `progress.md`: not needed

## Follow-ups and open questions
Owner answers to section 7 of the plan before any build.

## Definition of done
Docs only; no secrets, no generated files.
