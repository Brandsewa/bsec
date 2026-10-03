# Antigravity prompt: Catalog A to F revision (read this before any more catalog work)

Claude verified your Catalog Phases A to F on branch `feat/catalog-a-f` and pushed fixes in commit `b91525b`. Pull that branch first (`git fetch && git merge origin/feat/catalog-a-f` in your worktree). **Do not redo or revert those fixes.** Read `docs/changes/2026-10-03-claude-catalog-verification.md`, then do the work below.

## What was wrong (so you do not repeat it)
1. **You ran only `test:fast`.** Those tests use mocks and cannot catch database behaviour. The gate in `AGENTS.md` section 4 requires `pnpm --filter @bs/domain test:heavy` (real Postgres) whenever you touch `packages/domain` or `packages/db`. It found 19 failing test files. Never write "verified" for a command you did not run.
2. **Read-back inside the transaction.** `createProduct`, `updateProduct` and the category, collection, brand and location services returned `getX(rt, ctx, ...)` from inside `withTenant(...)`. A getter opens its own transaction and cannot see uncommitted rows, so every create failed with "not found". Rule: commit first, then read; return the id from the transaction and call the getter after it.
3. **Price on request must never change prices.** The flag alone hides the price on the storefront; cart and checkout already refuse the product. Never write `price: 0` because of it, on create or update.
4. **Grandfathering means grandfathering.** The primary category is required only when a product moves into Active or Unlisted. Editing an existing uncategorised active product (title, price, stock) must keep working.
5. **Public forms need abuse controls.** Reviews had no rate limit and an email alone earned "verified purchase". Use `checkRateLimit` (see `admin/quotes.ts`) and require proof (signed-in customer, or email plus order number).
6. **New admin procedures must be added to the isolation suite** (`packages/domain/test/isolation.int.test.ts`, the `case "<router>.<proc>"` map). It fails on any unmapped procedure; that is its job.
7. **Fixtures change when rules change.** Active products need a primary category (`test/helpers/primary-category.ts`); collections default to not indexable, so sitemap tests mark them `indexable: true`.
8. **Your change record named a file that does not exist** (`apps/web/src/app/api/storefront/reviews/route.ts`). Reviews run through the oRPC storefront router. Check every path you write down.

## Remaining work for you
1. **Read-back permission.** `getProduct` needs `products.read`, so a role with only `products.write` creates a product and then gets Forbidden. Make the post-commit read-back not depend on read permission for the caller who just wrote (an internal loader without the permission check, used only after a successful write). Add a real-database test with a write-only actor.
2. **Cache invalidation after commit.** In `updateProduct` (and any catalog service doing the same) `invalidateCache` runs before the transaction commits, so a storefront request can re-cache stale data. Move invalidation after the commit. Add a test where practical.
3. **Real-database tests for the catalog services.** `catalog-services.test.ts` is mocks only. Add `catalog.int.test.ts` covering: category 3-level limit and delete guards (children, primary category of a product), collection rule evaluation and manual order, brand delete refused while in use, default-location constraint, one primary category per product (the partial unique index), and RLS isolation for each new table and query (store B cannot read or change store A's categories, collections, brands, locations).
4. **Browser check at 375px and desktop** for Categories, Collections, Brands, Locations, Reviews and the product form (`pnpm --filter @bs/admin dev` and `@bs/web dev`). Say plainly what you could not run.
5. **Empty and noindex rules in the real storefront:** with the web app running, confirm an empty category and an empty collection are served `noindex, follow`, an indexable non-empty collection is in the sitemap, and an unlisted product is reachable by link, absent from lists, search and sitemap.
6. **Update your change record** (new file, do not edit Claude's) with what you ran and the actual results, including the heavy suite.

## Hard rules for this round
- Follow `AGENTS.md`. One concern per commit, imperative subjects, your own trailer.
- Do not start Phase F follow-ups or anything in `docs/prompts/catalog-f.md` until this revision is merged and Claude confirms.
- Do not touch the Orders code except through the catalog services you already changed.
- Gate before you say done: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`, `pnpm --filter @bs/domain test:fast`, `pnpm --filter @bs/domain test:heavy`, plus `@bs/web` and `@bs/admin` tests. Paste the pass counts. A single Windows worker crash (exit code 3221226505) is a known flake: rerun that file alone and say so.
