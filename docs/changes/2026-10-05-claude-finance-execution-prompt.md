# Finance phases 0 to 4 consolidated execution prompt

- **Date:** 2026-10-05
- **Agent:** claude
- **Branch:** `docs/finance-execution-prompt` (not merged yet)
- **Area:** docs
- **Type:** docs
- **Supersedes:** none

## Summary
One builder prompt, `docs/prompts/finance-phases-0-4.md`, drives all five Finance phases step by step against `docs/FINANCE-PLAN.md`. It replaces `docs/prompts/finance-phase-0.md` (removed; its content is folded into the new file).

## What changed
- Added `docs/prompts/finance-phases-0-4.md`: shared working rules, then per phase the scope, exclusions, tests and done criteria; each phase is its own branch and PR, sequential, verified by Claude before the next.
- Removed `docs/prompts/finance-phase-0.md`.

## Decisions and trade-offs
Phase 1 owns the `order_items.cost_price` writes and all queue changes so Phase 0 stays free of hot files. Open owner questions D10, D13, D14 keep the plan defaults.

## Verification
- Ran: `pnpm docs:check`.
- NOT verified: nothing was built; file references were read, not executed.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed
- [ ] ADR: not needed
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [ ] `progress.md`: not needed
