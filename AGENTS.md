<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

# bsec: the rule book for every coding agent

**One rule book.** This file is the single source of rules for every AI coding agent working in this repo (Claude Code, Google Antigravity, OpenAI Codex, Cursor, Copilot, any other). Tool-specific files (`CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursor/rules/`) only point here. **Do not copy rules into them; edit this file.** If you are a human, the same rules apply to you.

bsec is a multi-tenant commerce SaaS for Indian D2C stores (pnpm + Turborepo monorepo). A mistake here can leak one store's data to another or break a live production store, so the rules below are not optional.

## 1. Before you write any code (read order)

1. This file.
2. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): what the system is and where everything lives. Use it to find files instead of grepping blindly.
3. [`docs/changes/`](docs/changes/README.md): the most recent change records (newest file names sort last). Another agent may have touched your area, or be mid-change on another branch.
4. [`progress.md`](progress.md): milestone status, known gaps, the "In flight" list.
5. The ADR(s) for your area ([`docs/adr/`](docs/adr/README.md)). If your work contradicts an ADR, stop and write a new ADR first.
6. The framework docs for what you are touching. **Next.js, Turborepo and other tools here are newer than your training data** (see the managed blocks in this file and `apps/web/AGENTS.md`): read `node_modules/next/dist/docs/` before writing Next code.

If the task mentions stores, tenants, admin or Super Admin, you are in the right repo. `AI Projects/bsecom 2026` is a different, older project; do not build platform features there.

## 2. Hard rules (security and correctness)

These are enforced by lint, tests or code review. Breaking one is a bug even if tests pass.

| # | Rule | Why / where |
|---|---|---|
| 1 | **Every tenant table uses `tenantTable()`** and its migration also runs `forceRlsSql(name)`. References between tenant tables use `tenantForeignKey` (composite). | ADR-002, `packages/db/src/tenant-table.ts`. Isolation suite fails otherwise |
| 2 | **Only `packages/db` and `packages/domain` import `@bs/db`, `drizzle-orm`, `pg`, `postgres`.** Apps call domain services. | ESLint `no-restricted-imports` |
| 3 | **All business logic lives in `packages/domain`.** Route handlers and UI stay thin: parse input, call a service, shape output. | ADR-001 |
| 4 | **Check permissions in the domain service** (`assertPermission`), not only in the route. Platform mutations check `assertRoleAtLeast`. | `packages/domain/src/context.ts` |
| 5 | **Cache tags are tenant-prefixed**: `tenantTag(ctx, kind, id?)`. New invalidations go through `cache-invalidation.ts`. Never add a second hand-rolled cache over `"use cache"`. | `bs/tenant-cache-tag`, ADR-004 |
| 6 | **Every platform mutation writes a `platform_audit_logs` row.** Store mutations that change settings, money, access or content write `audit_logs` too. | `apps/platform/test/audit-coverage.int.test.ts` |
| 7 | **Secrets never appear in code, logs, API responses, test snapshots, commits or the browser.** Tenant credentials are encrypted (`TENANT_SECRETS_KEY`) and shown to the UI only as set/not-set. Never commit `.env*` except `.env.example`. | `packages/payments/src/crypto.ts` |
| 8 | **No merchant-controlled code on our servers.** Pages and themes are validated JSON blocks with enumerated props. No custom JS, CSS, templates, raw HTML. | ADR-010 |
| 9 | **Runtime DB roles stay separate.** Migrations only as `app_owner`; web/worker use `app_rw` (+ `app_saas` for self-service paths); only `apps/platform` uses `app_platform` (BYPASSRLS). Do not widen grants casually. | ADR-002, `DEPLOYMENT.md` |
| 10 | **Migrations are append-only and expand/migrate/contract.** Never edit an applied migration; never drop or rename a column in the same release that stops using it. | `docs/migrations.md` |
| 11 | **Every admin route declares `pendingComponent`; every storefront `page.tsx` has a sibling `loading.tsx`.** | `bs/route-pending` |
| 12 | **Money and shipping are per store.** Shipping rates are store configuration, never hardcoded. Prices and totals are recomputed on the server at checkout, never trusted from the client. | decision 2026-09-29, `orders/checkout.ts` |
| 13 | **Side effects happen after commit, via pg-boss.** Enqueue jobs inside the business transaction; do not send email or call providers inline in a request. | ADR-006 |
| 14 | **Do not touch Razorpay or Shiprocket integrations, or add provider keys,** unless the task is explicitly about them. Credentials are deferred by the owner. | `progress.md` "Decisions on record" |

When a rule blocks you, do not work around it (no `eslint-disable`, no bypass role, no skipping `forceRlsSql`). Raise it in your change record under "Open questions" and ask the owner.

## 3. Conventions

- **TypeScript strict**, `consistent-type-imports`, no unused vars (prefix `_`). Match the surrounding code's style, naming and comment density; do not reformat files you are not changing.
- **Contracts first for APIs:** add or change the Zod/oRPC contract in `packages/contracts`, then the handler (`apps/web/src/server/api.ts` or `apps/platform/src/app.ts`), then the domain service, then the UI. The admin client types come from the contract.
- **Admin UI** follows [`docs/admin-ui-standards.md`](docs/admin-ui-standards.md): shared kit (`@bs/ui`, `components/data-table`, `simple-select`, `confirm-dialog`...), no native `<select>`, no `window.confirm`, no hand-rolled tables.
- **Blocks:** new block = schema + view + registration + editor config + tests; schema shape changes bump the block version (ADR-009).
- **New dependency:** prefer what is already in the monorepo. Pin exact versions as the existing `package.json` files do. Say why in the change record.
- **Naming:** `@bs/*` packages; tests as `*.test.ts` (unit) and `*.int.test.ts` (real Postgres).
- **Comments** explain why, not what. Reference the ADR or PLAN section when a rule drives the code.
- **Windows host:** the owner develops on Windows (Git Bash / PowerShell). Use the `pnpm` scripts, forward slashes in committed files, no bash-only assumptions in committed scripts.

## 4. Verification gate (run before you say "done" or push)

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm docs:check
# tests: one package at a time, only the packages you touched plus anything that depends on them
pnpm --filter @bs/domain test:fast
pnpm --filter @bs/domain test:heavy     # needs Docker (Testcontainers) or TEST_DATABASE_URL_SUPERUSER
```

- Do **not** run the whole suite in parallel against one database: it causes collision and timeout flakes (`docs/FAST-LOCAL-TESTS.md`). Platform integration suites need `--no-file-parallelism`.
- Behaviour you change needs a test; security behaviour needs a **real-database** test, not a mock (pattern: `packages/domain/test/*.int.test.ts`, `startTestDb`).
- UI changes: run the app and use it (`pnpm --filter @bs/admin dev`, `@bs/web dev`). Type checks prove code compiles, not that the screen works. Say so plainly if you could not run it.
- Report results honestly: failing or skipped tests are stated, with output. Never claim "verified" for something you did not run.

## 5. Git and release safety

- **`main` is production.** A push to `main` that passes CI **deploys to production** (Coolify). Never push to `main` with a red gate, never force-push, never rewrite shared history, never `--no-verify`.
- Work on a **branch** (`feat/...`, `fix/...`, `docs/...`), named for the change. Parallel agents work in **separate git worktrees** (siblings under `bs-commerce-platform/`): do not edit another agent's worktree or branch.
- Before starting: `git fetch` and check `git log origin/main..` and `docs/changes/` for overlap. Before finishing: merge or rebase the latest `origin/main` and re-run the gate.
- Small, focused commits with an imperative subject (`feat(themes): ...`, `fix(web): ...`, `docs: ...`, `test(e2e): ...`, `ci: ...`). One concern per commit.
- Each agent signs its commits with its own trailer (below). Do not impersonate another agent.
- Do not commit generated or local files (`routeTree.gen.ts`, `.turbo`, `dist`, `.env*`, `tsbuildinfo`, test reports). Do not commit unrelated drive-by changes.
- Destructive or outward-facing actions need the owner's explicit yes in this session: deleting data or branches, production database work, rotating secrets, changing Coolify or Cloudflare config, publishing anything externally.

## 6. Multi-agent protocol

Several agents and the owner work on this repo at the same time, in different worktrees, with no shared memory. The repo is the memory.

1. **Claim before you start** non-trivial work: add one line to "In flight" in `progress.md` (agent, branch, area, date). Remove it when merged or abandoned.
2. **Leave a change record for every change set** (`docs/changes/`, format in its README). It is how the next agent learns what you did and why. One new file per change, never edit another agent's record (except to mark it superseded).
3. **Do not edit the same files as a branch in flight** unless you have to; if you must, say so in your change record.
4. **Fix the docs you find wrong.** If `docs/ARCHITECTURE.md` disagrees with the code, the code wins: correct the doc in the same change and mention it.
5. **Hand-offs** (one agent plans, another builds, another verifies) go in a plan doc under `docs/` with explicit acceptance criteria, as `docs/AUTH-OVERHAUL-PLAN.md` does. The verifier checks each criterion against the code and runs the gate; "done" means verified, not written.
6. **Unknowns:** if a decision is the owner's (pricing, legal, providers, deleting data), ask in the session; do not guess and bury it in code.

### Per-agent notes

| Agent | Reads | Commit trailer | Notes |
|---|---|---|---|
| Claude Code | `CLAUDE.md` (imports this file), `apps/web/CLAUDE.md` | `Co-Authored-By: Claude <noreply@anthropic.com>` (use the exact trailer your session is configured with) | Per-project memory lives outside the repo; anything another agent needs must be in the repo docs |
| Google Antigravity | `AGENTS.md`, `GEMINI.md` | `Co-Authored-By: Antigravity <noreply@google.com>` | Hand-off plans for it live in `docs/*-PLAN.md`; Claude verifies against acceptance criteria |
| OpenAI Codex | `AGENTS.md` | `Co-Authored-By: Codex <noreply@openai.com>` | |
| ZCode | `AGENTS.md` | `Co-Authored-By: ZCode` (use the exact trailer your session is configured with) | **Testing and QA agent** (owner decision 2026-10-03): see the roles table below |
| Cursor / Copilot | `.cursor/rules/bsec.mdc`, `.github/copilot-instructions.md` | own trailer | Pointer files only |

### Roles (owner decision 2026-10-03)

| Who | Role | Does | Does not |
|---|---|---|---|
| Owner | Decides | Pricing, legal, providers, deleting data, priorities | |
| Claude Code | Plans and verifies | Writes plans and prompts, reviews and fixes builds, runs the gate, merges when CI is green | |
| Google Antigravity | Builds | Implements the plans in `docs/*-PLAN.md` | Does not merge its own PR |
| ZCode | Tests and QA | Runs the gate, writes and extends tests (real-database tests for tenancy, money, auth, permissions), walks the admin and storefront locally (375 px and desktop), reports defects with steps to reproduce and the failing output | Does not build features or change product behaviour; a fix for a defect it finds goes to the owning builder or to Claude unless it is a test-only change |

ZCode's rules:
1. **Own worktree, always.** Never work in another agent's checkout or on another agent's branch (a stray `git add` in a shared checkout already swept one agent's files into another's commit and failed CI). Stage files by explicit path; never `git add -A` or `git add .`.
2. **Test only against local or ephemeral data.** Never drive the live production store, never create records there, never rotate secrets or touch Coolify/Cloudflare. A live check needs the owner's explicit yes in the session.
3. **Findings go in the repo.** One record per test round in `docs/changes/` (`YYYY-MM-DD-zcode-<slug>.md`, "Type: test"): what was run, what passed, each defect (severity, steps, expected, actual, evidence), and what was not tested. Never claim "verified" for something not run.
4. **Test-only changes** (new tests, fixtures, test helpers) can be committed on a `test/...` branch and opened as a PR; production code changes are not part of its role.
5. Plan docs for it go in `docs/*-PLAN.md` or `docs/prompts/`, like the other agents.

## 7. Definition of done

A change is done only when **all** apply. Copy this list into your change record.

- [ ] Code follows section 2 and 3; the gate in section 4 passes.
- [ ] Tests added or updated (real-DB test for anything touching tenancy, money, auth or permissions).
- [ ] `docs/ARCHITECTURE.md` updated if you changed structure, routes, tables, jobs, auth, blocks, env vars or gates (the trigger table is in its section 0); "Last verified" commit bumped.
- [ ] ADR written or updated if you made or changed an architectural decision.
- [ ] `DEPLOYMENT.md` / `infra/coolify/RUNBOOK.md` updated if env vars, services, ports or the deploy pipeline changed.
- [ ] A change record in `docs/changes/` (required) and `progress.md` status/known-gaps/in-flight updated if a milestone item changed state.
- [ ] No secrets, no generated files, no unrelated edits in the diff.
- [ ] Honest status: what you verified live, what you only read, what you did not do.

## 8. Quick facts

```
apps/web        Next.js 16 storefront + Store API (/api)     app_rw
apps/platform   Hono + oRPC Platform API                      app_platform (BYPASSRLS)
apps/admin      Vite SPA: store admin                         http only
apps/superadmin Vite SPA: platform staff                      http only
apps/worker     pg-boss consumers                             app_rw
packages/       db domain contracts auth blocks block-editor payments shipping ui config
```

Dev ports: web 3000, platform 4000, worker health 4100, admin 5173 (dev) / 8080 (compose), superadmin 5174 (dev) / 8081. Node 24.15, pnpm 10.34.5. Production domain `bcom.si`. Live today: COD checkout, admin, Super Admin, themes. Not live: online payment, courier, email delivery.
