# Register ZCode as the testing and QA agent

- **Date:** 2026-10-03
- **Agent:** claude
- **Branch:** `docs/register-zcode`
- **Area:** docs
- **Type:** docs
- **Supersedes:** none

## Summary
The owner added a fourth coding agent, ZCode, to help with testing. This records it in the rule book so every agent knows its role and the rules it works under.

## What changed
- `AGENTS.md` section 6: ZCode row in the per-agent table and a new **Roles** table (Owner decides; Claude plans and verifies; Antigravity builds; ZCode tests and QA) with five ZCode rules: own worktree and explicit-path staging, local or ephemeral data only (never the live store without the owner's yes), findings recorded in `docs/changes/`, test-only changes on `test/...` branches, and plan docs for it like the others.
- `scripts/check-docs.mjs` and `docs/changes/README.md`: `zcode` is an accepted change-record agent name. ZCode's own first record (`2026-10-03-zcode-finance-plan.md`) was failing `docs:check` on this.

## Decisions and trade-offs
- ZCode tests and reports; it does not build features. A defect it finds goes to the owning builder or to Claude, unless the fix is a test-only change. This keeps one author per area and keeps the verifier independent of the builder.
- The "own worktree, explicit paths" rule is there because a shared checkout let one agent's untracked files be swept into another agent's commit (it failed secret-scan and `docs:check` on PR #17).

## Verification
- `docs:check` passes. No code changed.

## Docs updated
- [x] `AGENTS.md`, `docs/changes/README.md`

## Follow-ups and open questions
- ZCode has uncommitted edits to `AGENTS.md`, `scripts/check-docs.mjs` and `progress.md` in the shared checkout that overlap this change; it should discard them in favour of main after this merges, and commit its finance plan from its own worktree.
