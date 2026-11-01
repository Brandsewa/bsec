# Cleanup after the 2026-11-01 widget and storefront batch

- **Date:** 2026-11-01
- **Agent:** claude
- **Branch:** `docs/record-widget-batch-merges` (not merged yet)
- **Area:** docs
- **Type:** docs
- **Supersedes:** none

## Summary
Records the merges of PRs 175 to 182 in their change records and lists what was cleaned up. All eight PRs were merged to `main` and their production runs passed.

## What changed
- `Branch` lines of the 2026-11-01 change records now carry the PR number and merge commit: #175 `2439f8e`, #176 `2469798`, #177 `0678c6b`, #178 `6fc8777`, #179 `f943fe6`, #180 `be66459`, #181 `15463f3`, #182 `4a3d641`.
- Branches deleted (remote and local), all created by this agent with a merged PR: `feat/collection-showcase-categories`, `feat/storefront-polish-batch`, `feat/storefront-width-batch2`, `feat/trust-strip-category-archive`, `fix/trust-strip-bcom-group`, `fix/trust-strip-picker`, `chore/remove-old-widgets`, `feat/trust-strip-colours-align`.
- No "In flight" line needed removing: this batch never claimed one.

## Verification
- Ran: `pnpm docs:check`. Docs only; no code changed.

## Docs updated
- [x] change records (Branch lines)
- [ ] ARCHITECTURE.md, ADR, DEPLOYMENT.md, progress.md: not needed
