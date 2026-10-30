# Patch the last fixable Dependabot alerts (esbuild, zod 3)

- **Date:** 2026-10-30
- **Agent:** claude
- **Branch:** `fix/deps-esbuild-zod-overrides` (not merged yet)
- **Area:** deps
- **Type:** fix
- **Supersedes:** none

## Summary
The overrides from #158 already put every other flagged package on a patched version in `pnpm-lock.yaml`. The open alerts that remained were `esbuild` 0.18.20 (alert 1) and `zod` 3.25.76 (alert 21). Both are dev-tooling transitives, so they are now overridden too.

## What changed
- `pnpm-workspace.yaml`: `zod@<4.6.6` -> 4.6.7 (was `>=4.0.0 <4.6.6`), `esbuild@<0.25.0` -> 0.25.12.
- `pnpm-lock.yaml` regenerated. esbuild 0.18.20 came from `@esbuild-kit` (drizzle-kit); zod 3.25.76 came from the shadcn CLI's MCP SDK, whose zod peer range accepts 4.

## Decisions and trade-offs
- deepmerge (alert 31, low) has no patched release and stays open; GitHub alerts for packages already patched by #158 close on the next dependency scan.

## Verification
- Ran: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check` pass; `pnpm --filter @bs/domain test:fast` 529 pass.
- `drizzle-kit generate` still loads `drizzle.config.ts` and the schema under esbuild 0.25 (it then stops at an interactive rename prompt that needs a TTY).
- NOT verified: heavy real-database tests; the alert list itself (it updates after merge).
