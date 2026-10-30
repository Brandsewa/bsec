# Multi-market: push and merge checklist

> **Done 2026-10-30:** pushed and merged (#150, then the CI fixes #155 and #156); production deploy succeeded. The browser walkthrough and sandbox runs below were not done before merging: the owner chose to test on the live server. Kept as the record of what was skipped.

Branch: `docs/multimarket-phase0` (local only). Owner rule (2026-10-28): nothing is pushed or merged until the owner says so. PRs 149 and 150 are open and stay untouched until then.

## Before pushing (all must be true)

- [ ] **Browser walkthrough with screenshots** (local stack, test data only): add a US market in Settings -> Markets; prices, catalog and payments tabs; storefront `/us` product, collection, cart and checkout; market bar and suggestion banner; signup country picker; shipping zones per market; order shows policy text and base-currency total; Brand Sewa Billing screens. Record in a `docs/changes/` test record.
- [ ] **Sandbox runs** with the owner's PayPal sandbox and Stripe test keys: store checkout for each, refund, webhook; platform PayPal billing link. Never live keys (AGENTS.md rule 14).
- [ ] `e2e/markets.spec.ts` run locally against the stack.
- [ ] Product page JS budget: `pnpm --filter @bs/web build` then the perf-budget test (limit 50 KB gzip).
- [ ] `git fetch`; merge latest `origin/main` into the branch (migration numbers: check 0087 to 0090 are still free; journal `when` values stay increasing); re-run the full gate in AGENTS.md section 4, including `pnpm test:heavy:local` and the `isolation` suite.
- [ ] Cloudflare: IP Geolocation on for the zone (see `DEPLOYMENT.md`).

## Push and merge (owner's yes needed for each step)

1. Push the branch; close or fold PRs 149 and 150 (docs only) as the owner prefers.
2. Open one PR; wait for CI green (`check-fast`, `heavy integration tests (real postgres)`, secret scan, staging smoke test).
3. Migrations 0087 to 0090 run on deploy and backfill every existing store with one base market. Check on staging first: one existing store still shows the same prices and checkout.
4. Merge only when no `main` run is in progress; watch the deploy job.
5. After merge: set the change record `Branch` lines, remove the "In flight" line in `progress.md`, delete the branch (remote and local) and the worktrees, `git fetch --prune`.

## Owner to-dos (not code)

- PayPal purpose code and PAN for withdrawals in India.
- Ask the CA about GST LUT for invoices to foreign merchants.
- Lawyer review of the merchant terms (merchant is seller of record, owns tax and policies; own gateway accounts, no pooled funds).
- Do not enable a second market on a real store until the browser pass is done.
