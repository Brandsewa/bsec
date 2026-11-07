# Discounts and offers upgrade (engine, new types, codes, reporting)

- **Date:** 2026-11-07
- **Agent:** claude
- **Branch:** `feat/discounts-engine` (not merged, not pushed)
- **Area:** `packages/domain` (discounts, orders, storefront, admin), `packages/db`, `packages/contracts`, `apps/web` (cart, checkout, `/discount/<code>`), `apps/admin` (discounts screens), docs
- **Type:** feat
- **Supersedes:** none (follows the plan record `2026-11-07-claude-discounts-plan.md`)

## Summary
The owner asked for the discount types Amount off products, Buy X get Y, Amount off order and Free shipping, plus the popular offer types of current platforms, and chose to build all phases of `docs/DISCOUNTS-PLAN.md`. Order discounts and free shipping already worked and were upgraded; product discounts and buy X get Y were stored but refused at checkout and are built now. Along the way the audit found and fixed seven defects (automatic discounts never applied, per-customer limit never checked, `combinable` ignored, no audit row on create, fixed amounts ignored the cart currency, no record of the applied discount on the order). One commit per phase.

## What changed
- **Engine (ADR-045).** `packages/domain/src/discounts/engine.ts` is a pure evaluator used by the cart (every read), checkout and admin; `bxgy.ts` (buy X get Y, bundle), `split.ts`, `scope.ts` (collection membership). `orders/discounts.ts` loads the facts and redeems. `orders/pricing.ts` takes a list of discounts (`toPricingDiscounts`); `allocateApplications` spreads the goods discount over order lines.
- **Types and options.** Percent and fixed on the order or on chosen products and collections (manual and automated), percent cap, leave out sale items, once per order, tiers by amount or quantity, free shipping with a cap and a market limit, buy X get Y (quantity or spend trigger, free / percent / fixed price), bundle price. A discount can be automatic or need a code.
- **Who and how.** New, tagged and chosen customers (codes only); up to five codes per cart; generated single-use codes with an admin panel (generate, search, CSV export); shareable link `/discount/<code>?to=/path`.
- **Storefront.** Code box lists every code with its own Remove, shows automatic offers, "Offer applied" per line, a server-side nudge to the next offer, product-page coupon cards filtered to the product.
- **Admin.** Five kind cards, scope pickers, tiers, shipping options, audience card, code-list panel, Performance card (`admin.discounts.stats`), applied discounts on the order detail, list label "CODE LIST".
- **Data.** Migrations 0101 (`order_discount_applications`), 0102 (`discounts.rules`), 0103 (`discounts.uses_code_list`, `discount_codes`); all expand-only, new tenant tables use `tenantTable()` and forced RLS. New admin procedures `discounts.stats`, `discounts.codes.generate`, `discounts.codes.list` (mapped in the isolation suite).
- **Docs.** `docs/ARCHITECTURE.md` section 22, migration rows, ADR index; `docs/DISCOUNTS-PLAN.md` section 9 (what differs from the plan).

## Decisions and trade-offs
- Owner decisions recorded in plan section 8: Shopify-style stacking, no plan gating yet, fixed amounts only in the base currency, sale items included by default, prepaid discount stays parked.
- A new code that cannot stack with the codes already on the cart replaces them when it works alone (keeps the old "swap the code" behaviour); one that cannot at all is refused with a reason.
- "New customer" is read from the orders (no order that was not cancelled), not from the cached `customers.orders_count`.
- A code for tagged or chosen customers is accepted while browsing and enforced at checkout against the customer found from email or phone; a guest who matches nobody is refused.
- Free shipping is limited by market, not zone (the cart knows its market, not its destination).
- Bundles group the cheapest items first, so left-over expensive items pay full price.
- Deliberate behaviour change: a buy-x-get-y offer without its settings is now refused when saved (the old test that created a bare one and expected a checkout refusal was rewritten).

## Verification
Local, on Windows, against the shared test Postgres (`docker-compose.test-db.yml`).
- `pnpm typecheck`: 17/17. `pnpm lint`: 17/17 (6 existing warnings, no errors). `pnpm build`: 6/6, the new `/discount/[code]` route is in the output. `pnpm docs:check`: ok.
- `@bs/domain test:fast`: 72 files, 689 tests passed. `@bs/web test`: 33 files, 243 passed. `@bs/contracts`: 37 passed. `@bs/db`: 50 passed.
- New tests: `discount-engine*.test.ts` (pure engine: stacking, scope, tiers, buy-x-get-y, bundles, audiences, generated codes, nudge), `discounts-engine.int.test.ts` (real database: automatic discounts, per-customer limit and rollback, scope and cap, tiers, free-shipping cap and markets, buy-x-get-y, bundles, new and tagged customers, five codes, shared link, generated codes including two orders racing for one code, nudge, stats, validation), cart and pricing additions, `isolation.int.test.ts` mapping for the new procedures.
- See "Heavy suite" below for the full real-database runs.

## NOT verified
- **The admin screens were not looked at in a browser.** Typecheck, lint and build pass and the data behind them is tested, but the new forms (kind cards, pickers, tiers, audience, code panel, Performance card) have not been clicked through. The local dev stack was started from this worktree (web on 3000, admin on 5180, dev Postgres on 54330 migrated to 0103) but signing in needed the dev owner password, which was not entered; the storefront cart changes were also not seen in a browser.
- The e2e suite (`e2e/`, CI on `main` only) was not run; no selector it uses was changed.
- Nothing was pushed, so CI has not run.
- Product-page JS budget: the product page only gained a server-side filter; no client code was added to it. The budget check was not run.

## Not built (plan sections 4 and 8)
- Auto-adding the free-gift product to the cart (the gift is free once the shopper adds it and the spend is met).
- The discount name on the shopper's thank-you page and order emails (they show the total).
- A minimum item count field in the admin form (the engine supports it).
- Prepaid and payment-method discounts, abandoned-cart codes, bank offers, gift cards (parked or out of scope).

## Docs updated
- [x] `docs/ARCHITECTURE.md` section 22, migrations 0101 to 0103, ADR summary, "Last verified" bumped
- [x] ADR-045 written and indexed
- [x] `docs/DISCOUNTS-PLAN.md` section 9
- [ ] `DEPLOYMENT.md` / RUNBOOK not needed (no env var, service, port or pipeline change)
- [x] `progress.md` "In flight" line (remove when merged)

## Follow-ups and open questions
- Merge needs the owner's go-ahead (production deploys from `main`). Migrations 0101 to 0103 run on deploy and are expand-only.
- Ask whether auto-adding the free gift is wanted next, and whether discounts should be gated by plan.
- After merge: set the Branch line above to the PR and commit, remove the "In flight" line, delete the branch and the `bsec-discounts` worktree (section 5 of AGENTS.md).

## Definition of done
Not done: heavy-suite result and browser check are listed above as they stand; the change is unmerged.
