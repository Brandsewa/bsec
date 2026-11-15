# Close the open Dependabot alerts and add the platform audit plan

- **Date:** 2026-11-15
- **Agent:** claude
- **Branch:** `fix/security-alerts-2026-11-15` (not merged yet)
- **Area:** platform, web, admin (dependencies), docs
- **Type:** fix
- **Supersedes:** none

## Summary
The GitHub "Security and quality" tab showed 20 open alerts, all from Dependabot: 15 for `hono`, 4 for `@hono/node-server`, 1 for `deepmerge`. This change bumps the two Hono packages to their patched releases, which closes 19 alerts, and narrows the last one to a dev dependency. It also adds a plan for a full audit of the platform, which the owner asked for.

## What changed
- `hono` 4.13.14 to 4.13.16 in `apps/platform` and `apps/web` (alerts 44 to 58: RegExpRouter can skip wildcard middleware, `csrf()` and hyperlink auditing, `mount()` path forwarding, `validator('form')` on multipart, `css` helper escaping).
- `@hono/node-server` 2.1.5 to 2.1.6 in `apps/platform` (alerts 40 to 43: backslash in the request path treated as a separator, unhandled `ECONNRESET` on a WebSocket upgrade).
- `shadcn` moved from `dependencies` to `devDependencies` in `apps/admin`. It is a CLI plus the `shadcn/tailwind.css` file imported at build time; nothing from it runs in a server or ships in the browser bundle. It is the only path to `deepmerge` 4.3.1 (alert 31, low, no patched release exists).
- `pnpm-workspace.yaml`: the comment on `deepmerge` now says where it comes from.
- New `docs/PLATFORM-AUDIT-PLAN.md`: 15 sections (tenant isolation, auth, money, payments in test mode, platform API, secrets, attack surface, blocks, jobs, database, supply chain, privacy, performance, UI quality, tests and docs), method, finding format, severity scale, phases, acceptance criteria and the owner decisions needed.
- `progress.md`: in-flight line.

## Decisions and trade-offs
- Which Hono advisories applied to us: the apps do not call `csrf()`, `mount()`, `validator('form')` or the `css` helper (grep, 2026-11-15). The RegExpRouter advisory is the relevant one, because `apps/platform/src/app.ts` relies on `app.use("*", ...)` middleware and RegExpRouter is part of Hono's default router. No sign it was exploited; this was not investigated in production.
- `deepmerge` was not overridden: no fixed version exists. Moving `shadcn` to dev dependencies does not close the alert by itself; it changes its scope to development. Closing it needs the owner: dismiss as "vulnerable code is not used", or copy the stylesheet into the repo and drop the package (audit plan section 7, item 3).
- Code scanning has never run on this repository (the API returns "no analysis found"), so the tab only reflects Dependabot. Enabling CodeQL is a repository setting and an owner decision (audit plan section 7, item 2).
- Dependabot PRs 251, 252, 254, 255 and 256 carry the same bumps one manifest at a time; they should close by themselves once this merges. PR 262 (45 grouped minor and patch updates) and 242 (`@types/node` major) are not part of this change.

## Verification
- Ran in the `bsec-security` worktree on `main` e152e4b:
  - `pnpm typecheck` pass
  - `pnpm lint` pass
  - `pnpm build` pass (includes the admin build, which resolves `shadcn/tailwind.css` from dev dependencies)
  - `pnpm docs:check` ok
  - `pnpm --filter @bs/platform test:fast` 2 files, 5 tests pass
  - `pnpm --filter @bs/platform test:heavy` (real Postgres, local test container) 8 files, 172 tests pass
  - `pnpm --filter @bs/web test:fast` 36 files, 265 tests pass
- `pnpm-lock.yaml` holds one `hono` (4.13.16) and one `@hono/node-server` (2.1.6).
- NOT verified: the apps were not run and clicked through in a browser (patch-level bumps, covered by the tests above); `@bs/domain` and `@bs/web` heavy suites were not run locally because neither package's dependencies changed apart from `hono` in web, CI runs them; the alerts closing on GitHub can only be seen after the merge to `main`; the admin Docker image build was not run locally.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed, no structure, route, table, job or env var changed
- [ ] ADR: not needed
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md` (in-flight)

## Follow-ups and open questions
- Owner: the seven decisions in `docs/PLATFORM-AUDIT-PLAN.md` section 7 (go-ahead and order, CodeQL, the `deepmerge` alert, live checks, who walks the UI, retention periods, extra CI steps).
- `progress.md` "In flight" still lists branches that look merged (for example `feat/stripe-payment-element`, `feat/seo-phase2b`); left alone here, covered by audit section A15.
- After merge: confirm alerts 40 to 58 are closed and Dependabot PRs 251 to 256 closed themselves.

## Definition of done
- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests: no behaviour of ours changed; existing real-database platform suite re-run.
- [x] `docs/ARCHITECTURE.md`: no trigger applies.
- [x] ADR: none needed.
- [x] `DEPLOYMENT.md` / RUNBOOK: no change.
- [x] Change record and `progress.md` in-flight.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: see Verification.
- [ ] After merge: record updated, in-flight line removed, branch and worktree removed.
