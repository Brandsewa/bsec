## What changed and why

<Plain words. Link the ADR or plan doc if one drives it.>

## Verification (what actually ran)

- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm build` · `pnpm docs:check`
- [ ] Tests for the packages touched (`test:fast`; `test:heavy` for tenancy, money, auth, permissions: real database, not mocks)
- [ ] UI changes: ran the app and used the screen (say which), or state that you could not
- [ ] Not verified: <what you only read or could not run>

## Risk

- [ ] Tenancy: new tenant table uses `tenantTable()` + `forceRlsSql`, cache tags are tenant-prefixed
- [ ] Auth, permissions, money or secrets touched (permission checked in the domain service, no secret in code or logs)
- [ ] Migration added (append-only, expand/migrate/contract, journal updated)
- [ ] New or changed env var (`.env.example`, `DEPLOYMENT.md`, Coolify)
- [ ] New dependency (pinned exact, reason in the change record)

**Rollback:** <revert the PR, or the migration recovery steps>

Merging to `main` deploys to production.

## Definition of done (`AGENTS.md` section 7)

- [ ] Change record in `docs/changes/` and `progress.md` updated
- [ ] `docs/ARCHITECTURE.md` updated if structure, routes, tables, jobs, auth, blocks, env vars or gates changed
- [ ] ADR written or updated if an architectural decision changed
- [ ] No secrets, generated files or unrelated edits in the diff
