# Abandoned Checkouts Phase 1 — read-only admin workbench

- **Date:** 2026-10-02
- **Agent:** antigravity
- **Branch:** `feat/orders-abandoned-checkouts` (not merged yet)
- **Area:** contracts, domain, web, admin
- **Type:** feature
- **Supersedes:** none

## Summary
Adds a read-only Abandoned Checkouts workbench to the store admin, following the same pattern as the Quotes page. Merchants can view carts that were abandoned (swept by the existing `cart.recovery_sweep` job), filter by recovery status and email status, search by customer name/email/phone/product, and see 5 KPI metrics. When a previously-abandoned cart is checked out, the cart is marked as "converted" with a `recoveredAt` timestamp.

This is Phase 1 (read-only). Phase 2 (manual recovery email, recovery link copy, settings) is spec'd in `docs/ORDERS-SETTINGS-PLAN.md` §4.4 and deferred until email delivery is live.

## What changed
- **`packages/contracts/src/admin.ts`**: New `AbandonedCheckoutItem` and `AbandonedCheckoutStats` Zod schemas; `abandonedCheckouts` namespace with `stats` (GET) and `list` (GET, paginated with view/search/emailStatus/sort filters).
- **`packages/domain/src/admin/abandoned-checkouts.ts`** (new): `getAdminAbandonedCheckoutStats()` — 5 KPI aggregates (abandoned, open, recovered, emailsSent, potentialRevenue). `listAdminAbandonedCheckouts()` — paginated list with tab filtering, email-status filtering, full-text search (customer name via shipping_address->>'fullName', email, phone, product title via cart_items+products join), sort by date or total. Both gated by `assertPermission(ctx, "orders.read")`.
- **`packages/domain/src/orders/checkout.ts`**: Step 11 now reads the cart row; if status is `"abandoned"`, updates to `status: "converted"` with `recoveredAt: now()`.
- **`packages/domain/src/index.ts`**: Barrel export for the new service.
- **`apps/web/src/server/api.ts`**: Mounted `abandonedCheckouts.stats` and `abandonedCheckouts.list` handlers.
- **`apps/admin/src/routes/_store.tsx`**: Added "Abandoned checkouts" nav item (ShoppingCart icon, `orders.read` permission) in the Orders group.
- **`apps/admin/src/routes/_store/abandoned-checkouts.tsx`** (new): Full workbench page — stats strip (5 MetricCards), ScrollTabs (All/Open/Recovered), TableToolbar with search + SimpleSelect + sort + ColumnsMenu + CSV export, DataTable, Pagination, EmptyState, `pendingComponent` per rule 11. Row actions menu has disabled items (Send recovery email, Copy recovery link) per rule 9 (email not live).

## Decisions and trade-offs
- **No new migration.** The `carts` table already has `status`, `recoveredAt`, `recoverySentAt`, `email`, `phone`, `shippingAddress` columns (added by the M5 storefront migration and the existing sweep job). No schema change needed.
- **Drizzle SQL template quirk.** `${carts.id}` in a correlated subquery renders as just `"id"` (no table qualifier), causing wrong results. Fixed by using raw `"carts"."id"` in the SQL template.
- **Cart total is computed at query time** (SUM of cart_items.quantity × cart_items.unitPrice) rather than stored, because carts don't have a `total` column. This is fine for the admin list query volume.

## Verification
- **Ran:** `pnpm typecheck` — 15/15 pass. `pnpm lint` — pass (3 lint errors in test file fixed: unused imports `and`/`sql`, unused var `cart5Id`). `pnpm build` — 6/6 tasks successful (web compiled, admin built). `pnpm --filter @bs/domain test test/abandoned-checkouts.int.test.ts` — 8/8 integration tests pass (stats accuracy, tab partitioning, email-status filtering, full-text search, sorting, cart conversion on checkout, tenant isolation, permission enforcement).
- **NOT verified:** UI not hand-tested in the browser. The page compiles and builds but visual correctness is unverified.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (sections 8 API surface: added `abandonedCheckouts`; section 9 UI routes: added `abandoned-checkouts`)
- [ ] ADR — not needed (no new architectural decision; uses existing cart schema and patterns)
- [ ] `DEPLOYMENT.md` / RUNBOOK — not needed (no new env vars, services, or ports)
- [x] `progress.md` (in-flight entry added)

## Follow-ups and open questions
- **Phase 2** (manual recovery emails, copy recovery link, abandoned checkout settings): blocked on email delivery being live. Spec in `docs/ORDERS-SETTINGS-PLAN.md` §4.4.
- **Cart total column**: If performance becomes an issue with many abandoned carts, consider adding a materialized `total` column to `carts` and keeping it updated on add/update/remove item.

## Definition of done
- [x] Code follows AGENTS.md section 2 and 3; gate passes (typecheck, lint, build).
- [x] Tests added: 8 real-DB integration tests covering all query paths, cart conversion, isolation, and permissions.
- [x] `docs/ARCHITECTURE.md` updated (sections 8, 9).
- [ ] ADR — not applicable.
- [ ] `DEPLOYMENT.md` — not applicable.
- [x] Change record written (`docs/changes/2026-10-02-antigravity-abandoned-checkouts.md`).
- [x] `progress.md` in-flight entry present.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: typecheck, lint, build, integration tests all verified. UI NOT hand-tested.
