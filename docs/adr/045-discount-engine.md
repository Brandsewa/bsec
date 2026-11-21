# ADR-045: Discount engine: classes, stacking and a pure evaluator

- **Status:** Accepted
- **Date:** 2026-11-07
- **Plan reference:** `docs/DISCOUNTS-PLAN.md` (rules 1, 4, 6, 12; extends ADR-040)

## Context
Discounts support percent, fixed and free-shipping codes on the whole order. Product scope and buy X get Y are refused at checkout, automatic discounts and per-customer limits are stored but never enforced, and `combinable` is ignored. Merchants want the four standard types (amount off products, buy X get Y, amount off order, free shipping) plus tiers, caps, free gifts and customer rules.

## Decision
- **Classes:** every discount has a class (`product`, `order`, `shipping`), a method (`code` or `automatic`) and a typed, versioned `rules` object validated by a Zod schema in `packages/contracts`.
- **One pure evaluator** (`packages/domain/src/discounts/engine.ts`): takes the priced cart lines, shipping, customer facts and the candidate discounts; returns applications (discount, class, amount, target lines). No database access. The cart, checkout and draft orders all call it, so the price a shopper sees is the price charged (rule 12).
- **Stacking:** at most one order discount and one shipping discount, plus product discounts on different lines, each only when it opts in to combining with the other class. Up to 5 codes per cart. When two non-combinable discounts compete the one worth more to the shopper wins. Automatic discounts are evaluated on every cart load.
- **Currency:** fixed amounts apply only in the store's base currency; in another currency they are refused with a reason. Percent and free shipping apply in every market.
- **Sale items** are included unless a discount sets `excludeOnSale`.
- **Recording:** each applied discount is stored in `order_discount_applications` (tenant table) so orders, invoices, refunds and reports read it from the order, not from redemption counters.
- **Redemption** (total, per customer, single-use code) runs in the order transaction with guarded updates.
- **Schema change is expand, migrate, contract** (rule 10): new columns and tables first, backfill, old `type` values and `combinable` read until a later release.
- **Conditions** (`payment_method`, `market`, `sales_channel`) exist in the rules shape so a prepaid discount can be added when online checkout is live, with no further schema change.

## Consequences
- One place to test every money rule; real-database tests cover limits and concurrency.
- The cart load does one extra indexed read for automatic discounts.
- Existing `percent`, `fixed` and `free_shipping` rows keep working through the backfill.
- Product-page JS budget is untouched: coupon filtering stays server-side.

## Alternatives considered
- Keep per-type branches inside `evaluateDiscount`: rejected, stacking and tiers would multiply the branches and cart and checkout would drift apart.
- Gate advanced types by SaaS plan: deferred by the owner; can be added as a plan flag later.
- Per-market fixed amounts: rejected for now (more merchant setup); base currency only.
