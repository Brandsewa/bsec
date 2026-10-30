# Multi-market stores: build, release and lessons (the record to read first)

- **Date:** 2026-10-30
- **Agent:** claude (planning, Phase 1, verification, release), Antigravity (work packages WP-1a to WP-7)
- **Branch:** `docs/multimarket-phase0` (merged in #150, a23f5a7); fixes in #155 (19c5e8a) and #156 (e975098)
- **Area:** db, domain, contracts, payments, web, admin, superadmin, ci, docs
- **Type:** feature (release record)
- **Supersedes:** none (it indexes the per-package records below)

## Summary
Stores can now sell in several markets: one base market plus extra markets (India, USA, Canada first). A market is a set of countries sharing one currency, with its own prices, catalog, payment gateways, shipping zones, returns text and merchant-entered tax, and a metric or imperial unit setting per store. The shopper's market comes from the URL prefix (`/us`), then a cookie, then the base market; location only suggests. Brand Sewa bills Indian merchants in INR (Razorpay, unchanged) and global merchants in USD (PayPal). The merchant is the seller of record; Brand Sewa never holds funds or takes a fee from orders (ADR-040 section 4). It went live on 2026-10-30.

## Where everything is
| What | Where |
|---|---|
| Plan, research, decisions on record | `docs/MULTIMARKET-PLAN.md` (section 12) |
| Architecture decision | `docs/adr/040-markets.md` (with "as built" amendments) |
| How the system works now | `docs/ARCHITECTURE.md` section 19 |
| Hand-off, work packages, file ownership | `docs/MULTIMARKET-HANDOFF.md`, prompts in `docs/prompts/multimarket-wp*.md` |
| Deploy notes (PayPal webhooks, Cloudflare country header) | `DEPLOYMENT.md` |
| Open items | `progress.md` M15 |
| Per-package records | `docs/changes/2026-10-28-claude-multimarket-{plan,phase0,phase1}.md`, `...-antigravity-multimarket-wp{1a,1b,2,3,4,5,6}.md`, `2026-10-29-antigravity-multimarket-{wp1c,test-round}.md`, `2026-10-29-claude-multimarket-wp8-docs.md` |

## What changed (by area)
- **db:** migrations 0087 (markets, countries, `unit_system`, order/cart market columns, base-market backfill), 0088 (prices, FX history, per-market catalog, payment methods, policies, tax rules, `shipping_zones.market_id`, USD plan prices, `max_extra_markets`), 0089 (market-scope SQL functions and the restrictive `market_visibility` policy), 0090 (PayPal platform billing).
- **domain / contracts / payments:** `packages/domain/src/markets/*`, market-aware cart, checkout, shipping, catalog, search, SEO, emails; hosted Stripe and PayPal checkout, idempotent settlement with amount and currency checks, PayPal provider; `admin.markets.*` (14 procedures), permission `markets.manage`; `@bs/contracts/money` and `units`.
- **web:** middleware prefix rewrite, market resolution (`server/market.ts`), switcher and suggestion banner, hreflang and market sitemap, country-aware checkout, return and webhook routes.
- **admin / superadmin:** Settings > Markets (list, wizard, per-market tabs), PayPal card, units, currency-aware money across all admin screens; Super Admin plan USD prices and PayPal billing.
- **ci:** `e2e/markets.spec.ts`; staging seed creates a base market.

## Decisions and trade-offs
- Money is integer minor units plus an ISO code; `_paise` column names stay and mean minor units of the row's currency.
- Market scope is carried in SQL (transaction-local `app.market_id`), so no storefront query had to be rewritten; it is inert when empty.
- Prices of non-base markets are materialised and recomputed on every variant write path; fixed overrides are never overwritten.
- Exchange rates and tax rates are manual and merchant-entered; no pre-filled rates, no duty collection.
- Subfolder URLs only at launch; custom market domains later.
- Plan limits count extra markets on top of the base: Starter 1, Growth 2, Enterprise 5.
- PayPal billing for non-India merchants uses Orders v2 links per cycle (PayPal Subscriptions for an India-registered account was assumed unsuitable and never checked).
- Product page JS stays under 50 KB gzip (`money-client.ts`, lazy quote dialog); there is almost no headroom left.

## How it was built and shipped (timeline)
1. 2026-10-28: plan and ADR (#149 merged). Phase 1 and most server work by Claude. Owner rule: keep everything local until all done.
2. Antigravity built work packages in parallel lanes, each in its own worktree; Claude verified and merged each locally, fixing defects found (permission leak to support sessions, wrong provider enums, weak PayPal tests, a currency lookup that hid rupees from limited staff, product page JS over budget).
3. 2026-10-30: owner asked to push. Merged latest `main` into the branch (order pages had been redesigned on `main`; took main's layout and re-applied order currency and base total). #150 merged.
4. The `main` run for #150 failed at the staging smoke test on `e2e/markets.spec.ts`: first the sign-in helper raced the login redirect (#155), then the CI store had no base market because CI inserts it with raw SQL (#156). The pipeline skipped the production deploy both times, so no broken build reached production. The run for #156 passed and deployed.

## Verification
- Before merge: typecheck, lint, docs:check; web 244, domain fast 529; earlier real-Postgres suites (domain ~3,200, isolation, platform, db) passed on the branch; CI heavy shards passed on #150, #155 and #156.
- After merge: `main` run for #156 green end to end, including the smoke test with the markets e2e, then production deploy success.
- Not done: screenshot walkthrough of the storefront and admin, PayPal and Stripe sandbox runs (mocked HTTP only), e2e for the storefront market bar.

## Lessons for the next agent
- The staging smoke test only runs on `main`: a new e2e spec cannot be proven by its PR. Run it locally first (`E2E_CHROME=1 ADMIN_URL=... pnpm --filter @bs/e2e exec playwright test <file>`, web on a free port such as 3001 with `VITE_API_URL` set for the admin dev server; port 3000 may be another project).
- Stores made by raw SQL or scripts have no base market; create one (see the CI seed) or use provisioning.
- Migration test fixtures must drop every migration at or above the one under test (drizzle applies by journal time).
- Windows vitest workers crash intermittently (exit code 3221226505); re-run the file alone.
- Merging a branch that rewrote shared UI: take main's layout, then re-apply currency; typecheck finds the gaps.

## Open questions
- Owner: PayPal purpose code and PAN (India), CA view on GST LUT for invoices to foreign merchants, lawyer review of the merchant terms.
- Whether to add a "create base market" repair for stores made outside provisioning.

## Definition of done
- [x] Code and docs merged; production deployed
- [x] ARCHITECTURE section 19, ADR-040 amendments, DEPLOYMENT notes, progress M15
- [ ] Owner's live walkthrough (defects become new PRs)
