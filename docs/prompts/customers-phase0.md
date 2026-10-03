# Antigravity prompt: Customers Phase 0 (foundations)

You are building Phase 0 of the Customers upgrade in bsec. Read, in order: `AGENTS.md` (the rule book; sections 2, 4, 5, 6 are binding), `docs/CUSTOMERS-IMPLEMENTATION-PLAN.md` (Phase 0 is your scope), `docs/CUSTOMERS-SECTION-FINDINGS.md`, and `docs/prompts/catalog-revision.md` (lessons from your last round: they apply to you now).

**Scope: Phase 0 only, three steps, three commits: 0a truthful customer metrics, 0b guest customers, 0c one consent record with history.** The plan gives the build steps and the tests. Do not start Phase 1 or segments. **Store credit and loyalty points are out of scope: build nothing for them.**

Branch `feat/customers-phase-0` from the latest `origin/main` (in your own worktree). Claim it in `progress.md` "In flight".

Hard requirements, each learned the hard way:
1. Run `pnpm --filter @bs/domain test:heavy` (real Postgres) before you say done, and paste the file and test counts. The fast tests use mocks and prove nothing about the database. A single Windows worker crash (exit code 3221226505) is a known flake: rerun that file alone and say so.
2. Never call a getter inside the transaction that wrote the row (it opens its own transaction and cannot see uncommitted rows). Commit, then read. Invalidate caches after commit.
3. Customer metrics (orders, spend, last order) come from one SQL fragment over `orders` (`customers/metrics.ts`), counted by the rule in the plan; the cached columns are only a sorting copy kept by a pg-boss job. Read `packages/domain/src/orders/state-machine.ts` before writing the rule and write the exact rule in the file header.
4. Guest checkout must not mix stores, must not overwrite an existing account's name or phone, and registration must attach to the guest row without leaking its orders to an unverified claimant.
5. `setMarketingConsent` is the only writer of consent. The checkout marketing tick-box is unticked by default. `accepts_marketing` must never disagree with `marketing_state`.
6. New tenant tables use `tenantTable()` plus `forceRlsSql`, composite tenant foreign keys, a `_journal.json` entry, grants like the other tables. Backfills are idempotent and reported.
7. Every mutation writes `audit_logs`. Any new admin procedure is mapped in `packages/domain/test/isolation.int.test.ts`.
8. Real-database tests for every case listed under each step in the plan, plus cross-store isolation.
9. Do not touch Razorpay or Shiprocket code. Do not add email sending.

Gate before done: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`, `pnpm --filter @bs/domain test:fast`, `pnpm --filter @bs/domain test:heavy`, `@bs/web` and `@bs/admin` tests. Update `docs/ARCHITECTURE.md` (tables, jobs) and write `docs/changes/2026-10-xx-antigravity-customers-phase-0.md` stating exactly what you ran and what you did not. Open a PR; Claude verifies against the plan's acceptance criteria before Phase 1 starts. Do not merge it yourself.
