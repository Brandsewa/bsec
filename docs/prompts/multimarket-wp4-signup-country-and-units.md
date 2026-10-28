# Prompt for Antigravity: WP-4: Signup by country and the unit-system setting (Phases 1B and 1d)

Make signup and provisioning country-driven (IN, US, CA from platform_countries) and add the metric/imperial setting with weight inputs that convert at the edge.

Your package is **WP-4** in section 3 of `docs/MULTIMARKET-HANDOFF.md`. Build exactly that package and its acceptance criteria, nothing from other packages. If something you need belongs to another package, write it under "Open questions" in your change record instead of building it.

You are building one work package of the multi-market feature for bsec (a multi-tenant commerce SaaS for Indian D2C stores). Claude built the foundation and most of the server side and verifies your work against the package's acceptance criteria before the next package starts, so "done" means "ready to verify".

Read first, in this order:
1. `AGENTS.md` (hard rules in section 2 are not negotiable; stage files by explicit path, never `git add -A`).
2. `docs/MULTIMARKET-HANDOFF.md` (what is built, the design rules, the work packages, known gaps). Your package and its acceptance criteria are in its section 3.
3. `docs/MULTIMARKET-PLAN.md` and `docs/adr/040-markets.md` (decisions already made by the owner; do not re-open them).
4. `docs/ARCHITECTURE.md`, `docs/admin-ui-standards.md` (for admin UI), `docs/changes/` (newest files).
5. Next.js and Turborepo here are newer than your training data: read `node_modules/next/dist/docs/` before writing Next code.

Ground rules for this feature:
- **Everything stays local.** Work in your own git worktree, branched from the local branch `docs/multimarket-phase0` (or from the previous package's branch if the owner says so). Commit locally. Do NOT push, open or merge a PR, or touch production, Coolify or Cloudflare. No live payment keys: sandbox and test mode only. Do not touch Shiprocket or any shipping integration (only shipping rate configuration).
- Contracts first (`packages/contracts`), then handler (`apps/web/src/server/api.ts`), then the domain service, then the UI. New `admin.*` procedures go into `packages/domain/test/isolation.int.test.ts`.
- Apps never import `@bs/db`, `drizzle-orm`, `pg`. Business logic lives in `packages/domain`.
- Money: integer minor units plus an ISO currency code. Never write a currency sign by hand (`formatMoney` from `@bs/contracts/money`, `useMoney()` in storefront client components, `Money` from `@bs/ui`).
- Migrations are expand-only. Next free migration number is 0090 (check `packages/db/migrations`). Next ADR number is 041.
- Test with a real database for anything touching tenancy, money, auth or permissions. Fast local Postgres: `docker compose -f docker-compose.test-db.yml up -d` then set `TEST_PG_ADMIN_URL=postgres://postgres:postgres@localhost:55432/postgres`; run one package at a time with `--no-file-parallelism`.
- UI changes must be run and looked at (375 px and desktop). Say plainly what you could not run. Never claim "verified" for something you did not run.

Before you say done:
- Run the gate for the packages you touched (`pnpm typecheck`, `pnpm lint`, `pnpm docs:check`, the relevant tests) and paste real counts.
- Write `docs/changes/YYYY-MM-DD-antigravity-multimarket-<slug>.md` (template: `docs/changes/TEMPLATE.md`) with the package's acceptance criteria copied in as a checklist (tick only what you verified), what you did not verify, and open questions for the owner.
- Update `docs/ARCHITECTURE.md`, the handoff doc's section 1 table, and `progress.md` "In flight" as the package requires.

Branch name: `feat/multimarket-wp4`. Claim it with one line in `progress.md` "In flight" (local only).
