# Dev-speed branch: integration, lint-rule fix, honest tooling

- **Date:** 2026-10-04
- **Agent:** claude
- **Branch:** `chore/dev-speed` (PR #22, built by Antigravity)
- **Area:** tooling, ci, lint, db, domain
- **Type:** fix | refactor
- **Supersedes:** none (adds to `2026-10-03-antigravity-dev-speed.md`)

## Summary
Merged current `main` (Customers, Segments, Settings 0-1 and 2 are in) into the dev-speed branch and fixed what the merged tree exposed.

## What changed
1. **Merge conflicts**: only `progress.md` (In flight list).
2. **Lint rule `bs/no-service-call-in-tx` false positive**: `setMarketingConsent(rt, ctx, input, tx)` (Customers Phase 1) deliberately joins the open transaction. The rule now allows a call that passes `tx`; RuleTester valid case added. (The rule still flags any `rt` call without `tx`.) Local note: ESLint's cache does not notice a changed local rule, so `rm -rf packages/*/node_modules/.cache/eslint` after changing one.
3. **Cherry-picked `claude-ds` 78b274c (ZCode, reviewed)**: `scripts/lib/run-command.mjs` (a command that cannot start or is killed is a failure; before, `status ?? 0` reported success for tests that never ran on Windows, so the earlier "heavy 63/63 in 235 s" and 1.5 s runs were not trustworthy), the scaffold test's wrong relative import, CI docs-only diff via the merge commit's first parent, idle-pool error logging instead of silence, and the deletion-sweep advisory lock taken and released on one connection with a real-DB regression test (a session lock through a pool leaked and silently stalled later sweeps).

## Verification
- `pnpm docs:check`, `pnpm typecheck` (15/15), `pnpm lint` (15/15), `@bs/config` rules 27/27, `@bs/domain test:fast` 268/268: pass.
- `pnpm test:heavy:local` (real Postgres 18): first run 219 s, exit 1 from the documented Windows worker crash 3221226505 in `concurrency-scale.int.test.ts` (no test failure); direct rerun of the whole heavy suite: **67/67 files, 1,421/1,421 tests**.
- Not run: CI's docs-only path on a real docs-only PR (will be exercised by the next one).

## Follow-ups
- Owner: enable "Allow auto-merge" in GitHub settings if wanted (Antigravity's note).

## Definition of done
- [x] Gate passes. [x] Tests added (rule case, deletion lock). [x] Docs/progress updated. [x] No secrets or generated files.

## Correction: `ci.yml` was invalid YAML
GitHub rejected the workflow ("workflow file issue", no jobs started) because the docs-only path added unquoted colons in `name:` and `run:` values (`Fast check: lint`, `echo "Docs-only PR: ..."`). Merged to `main` this would have stopped all CI and deploys. Quoted the four values and validated the file with the `yaml` parser (no errors). Lesson: parse any edited workflow locally (`yaml` is in the pnpm store) before pushing.
