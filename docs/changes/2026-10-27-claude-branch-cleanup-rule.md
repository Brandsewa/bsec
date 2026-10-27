# Rule: document and delete the feature branch after merge

- **Date:** 2026-10-27
- **Agent:** claude
- **Branch:** `docs/branch-cleanup-rule`
- **Area:** docs
- **Type:** docs
- **Supersedes:** none

## Summary
Owner request: once a feature branch is merged to `main`, document the merge and remove the branch. `AGENTS.md` section 5 now has a "Clean up after merge" rule and section 7 a matching Definition of done item. It is the only standing permission to delete branches, and it covers only branches the agent created whose PR is merged.

## What changed
- `AGENTS.md`: new rule (document the merge in the change record and `progress.md`, delete the remote and local branch, remove any worktree, `git fetch --prune`; never delete `main`, unmerged or another agent's branches) and a Definition of done item. The older line about deleting branches needing the owner's yes now carves out this case.
- The five Google sign-in change records now say which PR merged them and that the branch is deleted.

## Verification
- Ran: `pnpm docs:check`. Checked each of my six branches is `MERGED` on GitHub before deleting the local copies; GitHub had already deleted them on the remote.
- NOT verified: nothing else to run (docs only).

## Docs updated
- [x] `AGENTS.md` (sections 5 and 7)
