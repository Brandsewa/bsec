# Performance audit: per-request overhead, listing price function, and the shared server

- **Date:** 2026-11-04
- **Agent:** claude
- **Branch:** `perf/request-overhead` (not merged yet)
- **Area:** domain, db, web
- **Type:** fix
- **Supersedes:** none

## Summary
The owner reported every store on the platform feeling slow after the multi-currency launch. This is the audit and the safe fixes. Multi-currency added little per request; most of the cost is in code every store pays on every request, on a shared server that is itself slow.

## What was measured (live, read-only GETs, 2026-11-04)
- Store home page: time to first byte 1.2 s to 4.4 s, category page 0.7 to 0.9 s, the evaluation call alone 0.46 s to 7.5 s.
- The platform's own marketing site (which skips the store evaluation) 1.3 to 1.8 s, so the slowness is not specific to stores or to markets.
- `/api/health`, a trivial route, took 1.1 s, 4.9 s, and once timed out at 25 s; a static file missing from Cloudflare's cache took 7.6 s to start from the origin (then 0.3 s from cache). That points at the server being short of CPU, memory or database capacity, whatever the app does. `infra/coolify/RUNBOOK.md` says the VPS is shared with four other projects and Postgres runs on default memory settings.

## What costs time on every request (read from the code)
1. The middleware calls the store evaluation over HTTP on every request, including link prefetches; that call and the layout and page each run `evaluateStorefrontAccess`, which opened two database transactions (store status, SEO switch) per call.
2. The evaluation then counted the request against the tenant's rate limit: three quota lookups plus one write to a single shared counter row per request.
3. **The media derivatives backfill looped on its own.** Super Admin showed `media.backfill_derivatives` with 219,840 runs and 59 failures (every other job was in the hundreds or low thousands). It runs every minute for every store, and `processMediaDerive` returned without marking a picture whose storage connection could not be resolved or whose original file was missing or empty, so the same rows were selected again each pass (up to 50 downloads) and, with more than a batch left, the job re-queued itself every 30 s indefinitely. That is constant CPU, network and database work on the shared server. The failed runs the owner pasted from pg-boss are all `timeout exceeded when trying to connect` (the worker could not get a database connection; `idempotency.cleanup` failed the same way), and the cause is in the same function: `processMediaDerive` ran the download, image decode, re-encodes and uploads inside one database transaction, so each picture held a pooled connection (and an open transaction on the shared Postgres) for seconds, 50 at a time, endlessly.
4. `market_variant_price` (SQL function used inside listing filters, sorting and price facets) ran three lookups per variant even when no market or state applied.

## What changed
- `storefront/access-cache.ts` + `lifecycle.ts`: the two per-tenant access reads are kept in memory for 3 seconds (cleared at once in-process by `invalidateCache`, so a status change made in the admin shows immediately; other processes within 3 s). Off under test.
- `system/rate-limit.ts`: tenant quotas cached for 60 s (the three lookups per request are gone).
- `media/derivatives.ts`: `processMediaDerive` now uses short transactions only (read the row, write the result); no connection is held during the download, decode, re-encode and upload.
- `media/derivatives.ts`: a picture that cannot be derived (no storage driver, missing or empty original) is recorded as "no derivatives", like undecodable ones already were, so it is not selected again and the self re-queue ends. New real-database test `derivative backfill ends when the original files are missing` (fails without the change: `hasMore` stays true).
- Migration `0098_market_price_fast_path`: `market_variant_price` returns the variant's own price at once when no market or state scopes the request. Same results; the scoped path is unchanged.

## Decisions and trade-offs
- Rate counting is unchanged: skipping it for prefetches would let anyone avoid the tenant limit with one request header.
- A mode change (maintenance, password) can take up to 3 s to show in another process; same-process changes are immediate.

## Verification
- `pnpm typecheck`, `pnpm lint`, `@bs/domain` 597 and `@bs/web` 237 fast tests pass.
- Real-database domain suite run locally before the backfill change: 138 files, 2,877 tests pass (includes migration 0098); the media tests were re-run after it (14 pass).
- NOT measured: the effect on the live server. A local before/after of database transactions was too noisy (the job queue writes to the same database), so the saving is counted from the code (about 9 fewer transactions and 3 fewer lookups per page render), not timed.

## Not done, needs the owner or a larger change
- **Connection limits:** check the worker's `DB_POOL_MAX` (the runbook sets it only for web) and Postgres `max_connections` against the total pools of web, platform, worker and the four other projects on the shared server. "timeout exceeded when trying to connect" means the pool or the server ran out.
- **Other failed jobs** seen in Super Admin (`media.backfill_hashes` 4, `idempotency.cleanup` 2, `cart.recovery_sweep` 1, `media.backfill_usages` 1, and the 59 `media.backfill_derivatives`): the error text is needed (`select name, state, left(output::text, 300) from pgboss.job where state = 'failed'`).
- **Which store and images were stuck** is unknown without production data.
- **Server capacity** (biggest factor): check CPU, memory and swap on the shared VPS (`docker stats`, `free -m`, `uptime`), and what the other four projects use; give Postgres a real memory setting; consider a dedicated server or at least a bigger one.
- **Middleware HTTP hop:** `proxy.ts` (Node runtime in Next 16) could call the domain directly and drop the self-request (about half a second under load). It needs care: a second bundle may mean a second database pool.
- **Base market is scoped when a store has two markets,** so base-market requests take the slower price path; passing no market for the base would help but touches carts and orders, so it needs its own change.
- **Pages are not cached at the edge** (`private, no-store`); a per-market, anonymous-visitor HTML cache at Cloudflare would remove most origin work but needs a careful cache key.

## Docs updated
- [x] ARCHITECTURE migration table (0098)
- [x] ADR / DEPLOYMENT: not needed
- [x] `progress.md`

## Definition of done
- [ ] After merge: record PR and commit, remove in-flight line, delete branch and worktree
