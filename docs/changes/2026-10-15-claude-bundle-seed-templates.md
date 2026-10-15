# Bundle the Modern Commerce seed tool into the platform image

- **Date:** 2026-10-15
- **Agent:** claude
- **Branch:** `fix/bundle-seed-templates` (not merged yet)
- **Area:** platform, infra
- **Type:** fix
- **Supersedes:** none

## Summary
The tool that creates the hidden "Modern Commerce" theme draft (`seed-templates-cli.ts`) was never bundled, so it could not be run on production. It is now built to `dist/seed-templates.js`.

## What changed
- `apps/platform/build.js`: one more bundle entry. `DEPLOYMENT.md` operator tools: how to run it.
- It only creates or refreshes a draft theme (`is_active=false`); it publishes nothing and touches no store.

## Verification
- Ran: `pnpm --filter @bs/platform build` (see PR for the gate).
- NOT verified: the command on production.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed
- [ ] ADR: not needed
- [x] `DEPLOYMENT.md`
- [ ] `progress.md`: not needed
