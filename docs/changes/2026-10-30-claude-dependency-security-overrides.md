# Patch vulnerable transitive dependencies with pnpm overrides

- **Date:** 2026-10-30
- **Agent:** claude
- **Branch:** `fix/dependency-security-overrides`
- **Area:** deps
- **Type:** fix
- **Supersedes:** none

## Summary
GitHub listed 23 open Dependabot alerts. Dependabot's own security jobs failed because the vulnerable packages are transitive (not in any `package.json`), so it could not propose fixes. This change forces the patched versions through `pnpm-workspace.yaml` `overrides`, and bumps the one direct dependency, `nodemailer`.

## What changed
- `pnpm-workspace.yaml`: overrides for `fast-uri` 3.1.9, `seroval` 1.6.11, `systeminformation` 5.33.16, `happy-dom` 21.0.4, `body-parser` 2.4.0, `follow-redirects` 1.16.1, `source-map-js` 1.2.2, `zod` 4.x to 4.6.7. Each applies only where an older version would otherwise be installed.
- `packages/domain/package.json`: `nodemailer` 10.1.1 to 10.1.4 (same bump as Dependabot PR #125, which can be closed).
- `pnpm-lock.yaml` regenerated.

## Decisions and trade-offs
- Not overridden: `esbuild` 0.18 (comes from drizzle-kit tooling, dev-only, and forcing 0.25 could break migration generation) and `deepmerge` (no patched release exists). Both stay as open alerts.
- `happy-dom` moves from 20 to 21 (a major). It is test-only (vitest and the block editor's jsdom needs); all tests that use it pass.
- Remove an override once its parent package depends on the patched version.

## Verification
Ran locally: `pnpm typecheck`, `pnpm lint`, `pnpm build` (all green), `pnpm test:fast` (all packages passed, including admin 19 files, web 31, block-editor 4). Heavy suites run in CI.

## Definition of done
- [x] Change record
- [ ] After merge: confirm the open alert count drops on GitHub; delete this branch and the `bsec-deps` worktree
