# Development speed tooling, fast local test DB, CI docs-only path, and transaction guards

- **Date:** 2026-10-03
- **Agent:** antigravity
- **Branch:** `chore/dev-speed` (not merged yet)
- **Area:** tooling, ci, domain, config, docs
- **Type:** refactor
- **Supersedes:** none

## Summary
Implements development speed improvements, fast local testing infrastructure, CI fast path optimizations for docs-only PRs, and architectural guards to prevent transaction race conditions and domain service errors.

## What changed
1. **Fast Local Testing Infrastructure & Teardown 57P01 Resolution:**
   - Attached an unhandled `'error'` event listener (`pool.on("error", () => {})`) on database connection pools in `packages/db/src/index.ts` to prevent uncaught exceptions when test databases are dropped.
   - Updated `packages/db/test-support/shared-pg.ts` to cleanly disconnect backend connections prior to `DROP DATABASE ... WITH (FORCE)`.
   - Created `scripts/test-heavy-local.mjs` and added `pnpm test:heavy:local`, running the full domain heavy integration suite cleanly in ~235 seconds against in-memory PostgreSQL (`docker-compose.test-db.yml`).
   - Created `scripts/test-affected.mjs` and added `pnpm test:affected` and `pnpm test:affected --heavy`, which detects modified files against `origin/main` and runs only the relevant Vitest tests (falling back to the full suite on core changes).
2. **CI Optimization (`.github/workflows/ci.yml`):**
   - Added a `changes` detection job calculating `docs_only` PR status.
   - Fast-pathed `check-fast` and `check-heavy` to skip expensive builds and integration tests on docs-only PRs while keeping required check names reporting green.
   - Reordered `check-fast` steps to run `docs:check` and `lint` before `build` for fail-fast feedback.
3. **Architecture Guard: ESLint Rule `bs/no-service-call-in-tx`:**
   - Implemented ESLint rule in `packages/config/eslint/rules/no-service-call-in-tx.js` with comprehensive RuleTester tests in `packages/config/test/rules.test.ts`.
   - Flags service calls receiving `rt` and `invalidateCache`/`revalidateTags` inside `withTenant` or `db.transaction`, enforcing commit-before-read/invalidate.
   - Fixed all 40 repo violations across domain mutation handlers.
4. **Integration Test Factories (`packages/domain/test/helpers/factories.ts`):**
   - Implemented `createActiveProduct`, `createGuestCheckout`, `createDeliveredCodOrder`, and `primaryCategory`.
   - Converted 6 integration test files (`return-photos.int.test.ts`, `reviews.int.test.ts`, `returns.int.test.ts`, `abandoned-checkouts.int.test.ts`, `product-images.int.test.ts`, `storefront-featured.int.test.ts`, `storefront-customer-pages.int.test.ts`, `order-emails.int.test.ts`).
5. **Procedure Scaffolding & Quick Gate:**
   - Created `scripts/scaffold-admin-procedure.mjs` (`pnpm scaffold:admin-procedure <router> <name> [--write]`) with unit tests in `packages/domain/test/scaffold.test.ts`.
   - Added `scripts/gate-quick.mjs` (`pnpm gate:quick`).

## Decisions and trade-offs
- **Windows Worker Crash 3221226505 / 0xC0000409:** Investigation showed crashes occur during thread pool exit when active connection handles are forcibly severed. Stabilizing database connection teardown resolved worker exit failures. Documented in `docs/FAST-LOCAL-TESTS.md`.
- **Owner Action:** The repository owner can enable "Allow auto-merge" in GitHub repository settings for pull requests passing required CI checks.

## Verification
- **Timings Measured:**
  - `pnpm --filter @bs/domain test:heavy` (Testcontainers mode): ~10–12 minutes.
  - `pnpm test:heavy:local` (shared Postgres): **235.43s** (63/63 test files, 1192/1192 tests passed, exit code 0, 0 unhandled errors).
  - `pnpm test:affected`: <10s on single-file change.
- `pnpm typecheck`: passed cleanly across all packages.
- `pnpm lint`: passed cleanly across all workspace packages (0 errors).
- `pnpm build`: passed cleanly.
- `pnpm docs:check`: passed cleanly.
- `pnpm --filter @bs/domain test:fast`: 28 files passed, 241 tests passed.
- `pnpm scaffold:admin-procedure orders archive-order`: dry run verified and unit test passed.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (section 15 updated with test commands)
- [x] `docs/FAST-LOCAL-TESTS.md` (updated with local workflow, commands, and Windows troubleshooting)
- [x] `AGENTS.md` (section 4 command list updated)
- [x] `progress.md` (in-flight claimed)

## Definition of done
- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (real-DB test for anything touching tenancy, money, auth or permissions).
- [x] `docs/ARCHITECTURE.md` updated if you changed structure, routes, tables, jobs, auth, blocks, env vars or gates; "Last verified" commit bumped.
- [x] ADR written or updated if you made or changed an architectural decision.
- [x] `DEPLOYMENT.md` / `infra/coolify/RUNBOOK.md` updated if env vars, services, ports or the deploy pipeline changed.
- [x] A change record in `docs/changes/` (required) and `progress.md` status/known-gaps/in-flight updated if a milestone item changed state.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: what you verified live, what you only read, what you did not do.
