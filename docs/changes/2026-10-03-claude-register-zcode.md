# Register ZCode; define agent roles

- **Date:** 2026-10-03
- **Agent:** claude
- **Branch:** `docs/register-zcode`
- **Area:** docs
- **Type:** docs
- **Supersedes:** none

## Summary
The owner added a fourth coding agent, ZCode, and decided Claude is the primary coding agent while Antigravity and ZCode both build and test. This records the roles and the rules every agent works under.

## What changed
- `AGENTS.md` section 6: ZCode row in the per-agent table and a new **Roles** table (Owner decides; Claude is the primary coding agent and verifier; Antigravity and ZCode are builders and testers who never merge their own PRs), how work is shared (one plan, one owner; Claude verifies every other agent's build), and six rules for every agent: own worktree and explicit-path staging, local or ephemeral data only, findings recorded in `docs/changes/`, real-database tests in the gate, commit before read-back, plans in `docs/`.
- `scripts/check-docs.mjs` and `docs/changes/README.md`: `zcode` is an accepted change-record agent name. ZCode's own first record (`2026-10-03-zcode-finance-plan.md`) was failing `docs:check` on this.

## Decisions and trade-offs
- Builders never merge their own work and Claude verifies before the next phase: it keeps the verifier independent of the builder, which caught real defects in every Antigravity phase so far.
- The "own worktree, explicit paths" rule is there because a shared checkout let one agent's untracked files be swept into another agent's commit (it failed secret-scan and `docs:check` on PR #17).

## Verification
- `docs:check` passes. No code changed.

## Docs updated
- [x] `AGENTS.md`, `docs/changes/README.md`

## Follow-ups and open questions
- ZCode has uncommitted edits to `AGENTS.md`, `scripts/check-docs.mjs` and `progress.md` in the shared checkout that overlap this change; it should discard them in favour of main after this merges, and commit its finance plan from its own worktree.
