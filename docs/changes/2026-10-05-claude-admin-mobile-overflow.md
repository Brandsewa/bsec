# Admin pages no longer scroll sideways on a phone (Finance, Returns, Pre-orders, Quotes, Abandoned checkouts)

- **Date:** 2026-10-05
- **Agent:** claude
- **Branch:** `fix/admin-mobile-overflow` (not merged yet)
- **Area:** ui, admin
- **Type:** fix
- **Supersedes:** none

## Summary
At 375 px the Finance pages and several older pages (Returns 576 px wide, Pre-orders 494, Finance 466, Quotes 450, Finance reports 412, Abandoned checkouts 399, Finance expenses 376) scrolled horizontally. Cause: `PageContainer` and `PageSection` are `grid` without a column template, so their single implicit `auto` column grows to the widest unshrinkable descendant (a row of tabs, a toolbar, a table with nowrap headers) and drags the whole page past the viewport. `grid-cols-1` makes the column `minmax(0, 1fr)`, so wide content scrolls inside its own container instead.

## What changed
- `packages/ui/src/layout/page.tsx`: `grid-cols-1` on `PageContainer` and `PageSection` (shared kit, every admin page).
- The page-local `grid gap-3` wrapper that holds tabs + toolbar + table gets `grid-cols-1` on `returns`, `preorders`, `quotes`, `abandoned-checkouts`, `orders`, `customers`, `discounts`, `segments` (the last four did not overflow with an empty store; changed because they share the structure and would with rows).
- Not changed: the other ~110 `grid gap-N` uses in the admin app (forms and small cards); none overflowed.

## Decisions and trade-offs
Targeted rather than a blanket change to every `grid gap-N`. New admin pages that put a wide table or tab row inside their own `grid` wrapper need `grid-cols-1` too; worth a line in `docs/admin-ui-standards.md` if this recurs.

## Verification
- Ran: `pnpm typecheck` 15/15, `pnpm lint` 15/15, `@bs/admin` tests 53/53, `@bs/ui` tests 6/6.
- Exercised by hand in the browser at 375x812 against a local stack (store with 6 orders): page `scrollWidth` before the change: Returns 576, Pre-orders 494, Finance 466, Quotes 450, Finance reports 412, Abandoned checkouts (not measured before), Finance expenses 376; after: every page measured is 375 (Home, Orders, Returns, Pre-orders, Quotes, Abandoned checkouts, Products, Inventory, Customers, Segments, Discounts, Finance x3, Settings, Pages, Themes, Categories, Collections, Locations, Reviews, Brands). Orders renders as a card list with a scrolling tab strip; Finance Overview cards stack. At 1280x800 Orders, Finance, Expenses, Returns and Customers have no horizontal overflow and the same container width.
- NOT verified: pages that need data I did not create (Returns with real returns, Pre-orders with rows, Quotes with rows); other breakpoints such as 768 px; pages not in the list above (Settings sub-pages, editors).

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed
- [ ] ADR: not needed
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [ ] `progress.md`: the Finance known-gap line (PR #40) mentions the overflow; remove it once this merges
