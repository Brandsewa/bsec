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
| 14 | **Do not touch Shiprocket or any shipping integration. Payment providers (Razorpay, Stripe, PayPal) are in scope only through `docs/ADMIN-IMPROVEMENTS-PLAN.md` section 6.4 and `docs/MULTIMARKET-PLAN.md` (ADR-040), in test or sandbox mode; never add live provider keys.** Live credentials and online checkout are deferred by the owner. | `progress.md` "Decisions on record" |
| 15 | **The production database and its backups are owner-gated (section 9).** Never restart, reconfigure, restore, or run commands against `bsec-postgres`, its R2 buckets, the VPS crontab or Hostinger without the owner's explicit yes in this session, and follow section 9 exactly. | section 9, `infra/backups/PGBACKREST.md`, `infra/runbooks/REBUILD.md` |

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
pnpm test:affected                      # or pnpm gate:quick before push
pnpm --filter @bs/domain test:fast
pnpm test:heavy:local                   # fast shared local Postgres (or pnpm --filter @bs/domain test:heavy)
```

- CI runs `test:fast` and `test:heavy` serially (`--no-file-parallelism`, heavy also `--concurrency=1`). If you add an `admin.*` procedure, map it in `packages/domain/test/isolation.int.test.ts` and run that file; otherwise the heavy job fails. The e2e suite (`e2e/`) only runs in CI on pushes to `main`: when you change sidebar, menu or label text, update its selectors in the same change.
- Do **not** run the whole suite in parallel against one database: it causes collision and timeout flakes (`docs/FAST-LOCAL-TESTS.md`). Platform integration suites need `--no-file-parallelism`.
- Behaviour you change needs a test; security behaviour needs a **real-database** test, not a mock (pattern: `packages/domain/test/*.int.test.ts`, `startTestDb`).
- UI changes: run the app and use it (`pnpm --filter @bs/admin dev`, `@bs/web dev`). Type checks prove code compiles, not that the screen works. Say so plainly if you could not run it.
- Report results honestly: failing or skipped tests are stated, with output. Never claim "verified" for something you did not run.

### CI pipeline rules (`.github/workflows/ci.yml`)

Every agent changing CI, or anything CI runs, follows these (change record: `docs/changes/2026-10-25-claude-ci-speedup.md`):

- **Run the gate locally before every push.** `pnpm install` enables the pre-push hook (`.githooks/pre-push` runs `pnpm gate:quick`); if it is not active (`git config core.hooksPath` is empty), run `pnpm hooks:install`. Fix a red gate; do not use `--no-verify` or `SKIP_GATE=1` for code changes (`SKIP_GATE=1` is for docs-only pushes).
- **Images build in parallel with the checks and push only the `sha-` tag.** The moving `:main` tag (what Coolify pulls) is set only by `promote-images`, after `check-fast`, `check-heavy`, `secret-scan` and `staging-smoke-test` pass. Never push `:main` from the build job.
- **Heavy tests are sharded** (`check-heavy-shard`: domain 1/2, domain 2/2, db+platform+web), each with its own Postgres, rolled up by `check-heavy` named `heavy integration tests (real postgres)`. Keep that roll-up name stable (branch protection uses it). A new heavy suite goes into an existing shard; add a shard only if one exceeds about 4 minutes.
- **Tests must not depend on file order or on other tests' data.** Shard and file order change. Platform-role (`app_platform`) queries bypass RLS, so always filter by `tenantId`; never assert counts over a whole table.
- **Docker layer cache is the registry cache** `ghcr.io/<owner>/bsec-cache:<app>` (`mode=max`), not the GitHub Actions cache (10 GB cap). New heavy artifacts or caches must not use the Actions cache for large layers.
- **Do not rebuild what another job already built.** Reuse the Turborepo cache (`.turbo`) and prefer `turbo run ...` over raw package scripts so tasks are cacheable.
- A CI change that only runs on `main` (images, promote, deploy) cannot be proven by its PR: say so in the change record and watch the first `main` run. Never merge a second PR while a `main` run is in progress (section 5).

## 5. Git and release safety

- **The repository is public** (development period; the owner will make it private near launch). Never commit server IPs, internal hostnames you were not told to publish, personal emails, local paths, tokens or customer data. Secret scanning and push protection are on.
- **Never merge a second PR while a `main` run is in progress**: the workflow's concurrency group cancels the running one, possibly in the middle of a production deploy. Wait for the run to finish, then check the deploy job.

- **`main` is production.** A push to `main` that passes CI **deploys to production** (Coolify). Never push to `main` with a red gate, never force-push, never rewrite shared history, never `--no-verify`.
- Work on a **branch** (`feat/...`, `fix/...`, `docs/...`), named for the change. Parallel agents work in **separate git worktrees** (siblings under `bs-commerce-platform/`): do not edit another agent's worktree or branch.
- Before starting: `git fetch` and check `git log origin/main..` and `docs/changes/` for overlap. Before finishing: merge or rebase the latest `origin/main` and re-run the gate.
- Small, focused commits with an imperative subject (`feat(themes): ...`, `fix(web): ...`, `docs: ...`, `test(e2e): ...`, `ci: ...`). One concern per commit.
- Each agent signs its commits with its own trailer (below). Do not impersonate another agent.
- Do not commit generated or local files (`routeTree.gen.ts`, `.turbo`, `dist`, `.env*`, `tsbuildinfo`, test reports). Do not commit unrelated drive-by changes.
- **Clean up after merge (owner rule, 2026-10-27).** When your PR is merged to `main`, and the `main` run for it has passed its deploy job, finish the job: (1) document it: set the change record's `Branch` line to `... (merged in #<PR>, <short commit>)` and remove your line from "In flight" in `progress.md` (docs-only follow-ups go in one small PR, or into your next change); (2) delete the feature branch on the remote (`git push origin --delete <branch>`, only if GitHub did not already delete it) and locally (`git branch -D <branch>`; a squash merge is never "merged" to git, so check `gh pr view <n> --json state` says `MERGED` first); (3) remove any worktree you made for it (`git worktree remove`) and run `git fetch --prune`. Delete only branches **you created whose PR is merged**. Never delete `main`, an open or unmerged branch, or another agent's branch (leave a note to its owner instead). A closed-unmerged PR's branch is deleted only with the owner's yes. Deleting branches is otherwise still an owner decision, so this rule is the only standing permission.
- Destructive or outward-facing actions need the owner's explicit yes in this session: deleting data or branches (except merged branches of your own, as above), production database work, rotating secrets, changing Coolify or Cloudflare config, publishing anything externally.

## 6. Multi-agent protocol

Several agents and the owner work on this repo at the same time, in different worktrees, with no shared memory. The repo is the memory.

1. **Claim before you start** non-trivial work: add one line to "In flight" in `progress.md` (agent, branch, area, date). Remove it when merged or abandoned.
2. **Leave a change record for every change set** (`docs/changes/`, format in its README). It is how the next agent learns what you did and why. One new file per change, never edit another agent's record (except to mark it superseded).
3. **Do not edit the same files as a branch in flight** unless you have to; if you must, say so in your change record.
4. **Fix the docs you find wrong.** If `docs/ARCHITECTURE.md` disagrees with the code, the code wins: correct the doc in the same change and mention it.
5. **Hand-offs** (one agent plans, another builds, another verifies) go in a plan doc under `docs/` with explicit acceptance criteria, as `docs/AUTH-OVERHAUL-PLAN.md` does. The verifier checks each criterion against the code and runs the gate; "done" means verified, not written.
6. **Unknowns:** if a decision is the owner's (pricing, legal, providers, deleting data), ask in the session; do not guess and bury it in code.
7. **Keep the BCOM Platform OS in Notion current.** It is the coordination layer (roadmap, feature status, work items, change log index, decisions index, risks) on top of this repo; GitHub stays the source of truth for code, rules, ADRs and change records. Follow its "Session protocol" page at the start and the end of every session: claim your Work Item, then at the end add the Change Log row, update the Feature, Work Item and any Decision, Risk or Docs Library row, and list the Notion rows you touched in your final message. Notion has no automation here, so a session is not done until Notion matches GitHub (or you say what you could not update and why). Never put secrets, server IPs, personal data or customer data in Notion, and never copy a technical spec there: link the GitHub file. If you cannot reach Notion, say so; do not claim it was updated.

### Per-agent notes

| Agent | Reads | Commit trailer | Notes |
|---|---|---|---|
| Claude Code | `CLAUDE.md` (imports this file), `apps/web/CLAUDE.md` | `Co-Authored-By: Claude <noreply@anthropic.com>` (use the exact trailer your session is configured with) | Per-project memory lives outside the repo; anything another agent needs must be in the repo docs |
| Google Antigravity | `AGENTS.md`, `GEMINI.md` | `Co-Authored-By: Antigravity <noreply@google.com>` | Hand-off plans for it live in `docs/*-PLAN.md`; Claude verifies against acceptance criteria |
| OpenAI Codex | `AGENTS.md` | `Co-Authored-By: Codex <noreply@openai.com>` | |
| ZCode | `AGENTS.md` | `Co-Authored-By: ZCode` (use the exact trailer your session is configured with) | Builder and tester (owner decision 2026-10-03): see the roles table below |
| Cursor / Copilot | `.cursor/rules/bsec.mdc`, `.github/copilot-instructions.md` | own trailer | Pointer files only |

### Roles (owner decisions 2026-10-03)

| Who | Role | Does | Does not |
|---|---|---|---|
| Owner | Decides | Pricing, legal, providers, deleting data, priorities | |
| Claude Code | **Primary coding agent** | Plans, writes the plans and prompts, builds, reviews and fixes the other agents' work, runs the full gate, merges when CI is green | |
| Google Antigravity | Builder and tester | Implements assigned plans in `docs/*-PLAN.md` and `docs/prompts/`; writes and runs tests | Never merges its own PR; Claude verifies before the next phase starts |
| ZCode | Builder and tester | Same as Antigravity: implements assigned plans, writes tests, walks the admin and storefront locally (375 px and desktop), reports defects with steps and output | Never merges its own PR; Claude verifies before the next phase starts |

How the three agents share work:
1. **One plan, one owner.** A plan or phase is assigned to exactly one builder (Claude, Antigravity or ZCode) in the prompt the owner hands over. Nobody builds another agent's phase. Claim it in `progress.md` "In flight".
2. **Claude verifies every other agent's build** against the plan's acceptance criteria and the gate before the next phase starts, and fixes what fails or sends it back. A builder's "done" means "ready to verify".
3. **Testing is everyone's job and independent of the builder:** a builder tests its own work; a second agent may be asked to run a test round (gate, real-database tests, local walkthrough) and report in `docs/changes/`.

Rules for every agent, ZCode included (these came from real failures):
1. **Own worktree, always.** Never work in another agent's checkout or on another agent's branch. A stray `git add` in a shared checkout already swept one agent's files into another's commit and failed CI (secret-scan and `docs:check`). Stage files by explicit path; never `git add -A`, `git add .` or `git add <directory>`; read `git status` for files you did not write before every commit.
2. **Test only against local or ephemeral data.** Never drive the live production store, never create records there, never rotate secrets or touch Coolify or Cloudflare. A live check needs the owner's explicit yes in the session.
3. **Findings go in the repo.** One change record per change set or test round in `docs/changes/` (`YYYY-MM-DD-<agent>-<slug>.md`; "Type: test" for a test round): what was run, what passed, each defect (severity, steps, expected, actual, evidence), what was not tested. Never claim "verified" for something not run.
4. **Real-database tests are part of the gate** (`pnpm --filter @bs/domain test:heavy`); mock-only tests prove nothing about the database. Paste the counts.
5. **Commit before read-back.** A getter opens its own transaction; do not call one inside the transaction that wrote the row. Invalidate caches after commit.
6. Plan docs and prompts for any agent go in `docs/*-PLAN.md` or `docs/prompts/`.

## 7. Definition of done

A change is done only when **all** apply. Copy this list into your change record.

- [ ] Code follows section 2 and 3; the gate in section 4 passes.
- [ ] Tests added or updated (real-DB test for anything touching tenancy, money, auth or permissions).
- [ ] `docs/ARCHITECTURE.md` updated if you changed structure, routes, tables, jobs, auth, blocks, env vars or gates (the trigger table is in its section 0); "Last verified" commit bumped.
- [ ] ADR written or updated if you made or changed an architectural decision.
- [ ] `DEPLOYMENT.md` / `infra/coolify/RUNBOOK.md` updated if env vars, services, ports or the deploy pipeline changed.
- [ ] A change record in `docs/changes/` (required) and `progress.md` status/known-gaps/in-flight updated if a milestone item changed state.
- [ ] Notion updated per the Session protocol (Change Log row, Feature, Work Item, and Decisions, Risks or Docs Library rows if any), or the gap stated (section 6, rule 7).
- [ ] No secrets, no generated files, no unrelated edits in the diff.
- [ ] Honest status: what you verified live, what you only read, what you did not do.
- [ ] After merge: change record updated with the PR and commit, "In flight" line removed, your feature branch deleted (remote and local) and worktree removed (section 5).

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

## 9. Production database and backups: strict rules for every session

These apply to every agent and human. They exist because the platform's only database is on one shared server. Details and commands: `infra/backups/PGBACKREST.md`, `infra/runbooks/REBUILD.md`, `infra/runbooks/TENANT-RESTORE.md`. Plain-language version for people: the Notion page "Backup Restore Guide" (under BCOM Platform OS).

**What is covered:** the Coolify resource `bsec-postgres`, the R2 buckets `bsec-pgbackrest` and `bsec-backups`, root's crontab on the VPS, the Hostinger snapshots and firewall, and everything inside the production server.

1. **Owner's explicit yes first, every time, per action.** Do not restart, stop, redeploy, change the image or the variables of `bsec-postgres`; do not restore anything; do not edit the crontab; do not touch the buckets, tokens or snapshots; do not rotate database passwords; do not run commands on the production server. A yes for one action does not cover the next.
2. **The database image is always a pinned `sha-<commit>` tag, never `:main`.** Change it only through the procedure in `PGBACKREST.md` (pull request, CI rehearsal, pre-pull, change the Image field, restart, check the log line `WAL archiving ON`, run `pgbackrest check`). App deploys never restart the database, and nobody should rely on a deploy to change it.
3. **Never switch off TLS verification** (`repo1-storage-verify-tls=n` or similar) for R2, not even temporarily.
4. **Secrets never leave the password manager.** The pgBackRest cipher passphrase, `TENANT_SECRETS_KEY`, database passwords and R2 keys must not appear in the repo, Notion, chat, logs, screenshots, change records or PR text. When driving Coolify in a browser: read only the one field you need, never script a dump of all inputs (the database General page holds the connection string with the superuser password), never capture a screenshot of a token or secret page. If a secret ever appears anywhere it should not, tell the owner at once and say where.
5. **Time: the server runs on UTC, the owner works in IST (UTC+5:30).** State both whenever you give a time. The backup schedule is 03:30 IST, which is 22:00 UTC the previous day (`0 22 * * 6` full, `0 22 * * 0-5` differential). Cron lines are written in UTC with a comment. Do not merge between 03:15 and 04:00 IST.
6. **Before any risky database change** (large migration, bulk delete or import, a restore): take a differential backup with `--annotation=reason="..."` and write down the UTC time. A damaging change is recovered by point-in-time restore, so the time matters.
7. **Restores:** never restore a whole database to fix one store (use `TENANT-RESTORE.md`). Restore into a scratch copy first, keep the old data volume until the restore is verified, and never start a restored database or a restored server snapshot so that it archives into the live repository: scratch databases start through the stock entrypoint with `-c archive_mode=off` and a read-only token; after a snapshot restore, stop the apps and `bsec-postgres` first (`REBUILD.md` section 4).
8. **Never call a backup verified unless a restore was actually performed.** Record every drill (Super Admin > Backups > Record drill) and write a change record. State plainly what you did not test.
9. **Coolify browser terminal:** choose the `localhost` entry (`root@server`), never a container unless asked. No destructive commands (`rm -rf`, `docker volume rm`, `docker system prune`, deleting objects in the backup buckets) without the owner's yes naming that exact action.
10. **CI and deploys:** a merge to `main` deploys the apps. Never merge a second pull request while a `main` run is in progress, and after each merge confirm that a run actually started (once it did not). Keep every change small enough to roll back.
11. **Keep the docs true:** any change to the schedules, buckets, tokens, image procedure or recovery steps updates `infra/backups/PGBACKREST.md` (and `REBUILD.md` if relevant), `progress.md`, a change record, and the Notion "Backup Restore Guide" page, in the same piece of work.
12. **When unsure, stop and ask the owner.** Do not guess on anything in this section.
