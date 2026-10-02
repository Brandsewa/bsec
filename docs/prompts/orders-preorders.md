# Task: Pre-orders (simple "ships on" model)

You are working in the `bsec` monorepo (pnpm + Turborepo, TypeScript, React 19, Tailwind 4, TanStack Router/Query, oRPC, Drizzle, Next.js storefront, Postgres with row level security). bsec is a multi-tenant commerce SaaS for Indian D2C stores. A mistake can oversell stock, mis-price an order, or leak one store's data to another, so follow the rules exactly.

## What the owner decided
A pre-order is a **normal order for a normal product at a normal price**, with a **dispatch date** ("ships on"). The customer is told the date and is notified if it changes and shortly before it. **No deposits, no balance collection, no waitlist, no quota system, no pre-order-only pricing.** Payment is whatever the store already takes (COD today). The admin sees these orders on a Pre-orders page and cannot ship them before the date unless they explicitly release them early.

## Read first, in this order
1. `AGENTS.md`: the rule book. Sections 2, 4, 5 and 6 apply in full.
2. `docs/ORDERS-SECTIONS-OVERVIEW.md`: shared rules, and **section 4 "Look and feel", which is mandatory** for every admin screen.
3. `docs/ORDERS-PREORDERS-PLAN.md`: **your spec.** Section 3 (design), section 5 (not built) and section 6 (acceptance criteria) are what reviewers check.
4. `docs/ORDERS-SETTINGS-PLAN.md`: section 4.5 (the Pre-orders settings section) and section 6 (data shape and defaults).
5. `docs/admin-ui-standards.md` and `apps/admin/components.json`: the owner's design system (shadcn `base-mira` on Base UI, shared kit). Copy patterns from `apps/admin/src/routes/_store/orders.tsx`.
6. The code you will change (read it before editing): `packages/db/src/schema/catalog.ts` (variants) and `orders.ts`, `packages/domain/src/orders/checkout.ts`, `orders/manual-lifecycle.ts`, `orders/fulfillment-state-machine.ts`, `packages/domain/src/admin/orders.ts`, `packages/domain/src/catalog/inventory-reservations.ts`, `packages/domain/src/jobs.ts` and `packages/db/src/queues.ts`, `apps/admin/src/routes/_store/orders.tsx`, `orders_.$orderId.tsx`, `products/$id.tsx`, `products/new.tsx`, the storefront product page `apps/web/src/app/products/[slug]/`, `cart/`, `checkout/`, and the order confirmation and order view pages.
7. `docs/ARCHITECTURE.md` and the newest files in `docs/changes/`.

If any of these files is missing from your working tree, **stop and tell me**; do not guess.

`Storify/` (if you see it) is another project's code. **Never copy code from it, never import it, never stage it.** Stage files by path; never use `git add -A`.

## Rules of engagement
- First step: `git fetch`, then a **new worktree and branch** from the latest `origin/main` (with the plan docs and the "Orders Phase 1" work merged in; ask me if they are not there): `feat/preorders-simple`. If `git status` is not clean, stop and tell me instead of stashing or discarding anything.
- Add one line to "In flight" in `progress.md` before you start; remove it when done.
- Keep everything **local**: commit on your branch, do **not** push, and never push to or merge into `main` (a push to `main` that passes CI deploys to production). Never force-push, never `--no-verify`.
- Do not touch Razorpay or Shiprocket. No new dependencies without saying why in the change record.
- Commit trailer: `Co-Authored-By: Antigravity <noreply@google.com>`. One concern per commit.

## Build in this order, one commit group each

### 1. Data (expand-only migration, `docs/migrations.md`)
`variants`: `preorder_enabled boolean not null default false`, `preorder_ships_on date`, `preorder_message text`. `order_items`: `ships_on date` (snapshot at order time). `orders`: `ships_on date` (the latest line date; null when none). Index `(tenant_id, ships_on)` on `orders` where `ships_on is not null`. No new table, so RLS is inherited; do not drop or rename any column. Update the Drizzle schema and the seed or demo data if it lists variant columns.

### 2. Checkout and pricing (server decides, never the client)
In `orders/checkout.ts`: a variant with `preorder_enabled` is sellable at zero stock (like `allow_backorder` while the flag is on) **at its normal price**. Snapshot `ships_on` on each such line and set `orders.ships_on` to the latest line date. The server recomputes everything; a client claiming a pre-order on a variant that is not enabled is refused. Mixed carts: the whole order ships as one parcel on the **latest** date, and the checkout says so in plain words. A variant with the flag off and zero stock still cannot be bought. Concurrency: two simultaneous checkouts must not oversell a **limited** variant that is not pre-order (existing behaviour must not regress; add a test). Stock for a pre-order line is committed when the goods are received, not at order time (plan rule 8); follow the plan's wording and do not invent a quota.

### 3. Product editor and storefront
Admin product editor, per variant: a **Pre-order** switch, a **Ships on** date (must be in the future when enabling), and a message (max 200 characters). **There is no `switch` component in the kit yet**: add it with the shadcn CLI (see overview section 4 for the gotchas) and use it everywhere. Storefront: a badge "Pre-order, ships on 20 Oct 2026" and the message on the product page; the add-to-cart button reads **Pre-order**; the line note in the cart and checkout; a summary line "Ships on or after <date>"; the confirmation page and order view show it. A date in the past with the flag still on shows **"Ships soon"** instead of a stale date, and the admin product list flags "pre-order date passed". Every storefront page keeps its `loading.tsx`.

### 4. Admin: Pre-orders page, order badge, ship hold
New route `apps/admin/src/routes/_store/preorders.tsx` in the Orders sidebar group (permission `orders.read`): a filtered view of orders with `ships_on is not null`, built on the shared kit exactly like `orders.tsx`. Default sort **ships on ascending, then placed ascending**. Tabs: All, Waiting (date in the future), Ready to ship (date reached, not shipped), Shipped, Cancelled. Four stat cards: Pre-orders open, Ready to ship, Due in the next 14 days, Overdue (date passed, not shipped), computed on the server in their own boundary. Columns: Order, Customer, Items (pre-order lines marked), Ships on, Payment, Fulfillment, Total. Row and bulk actions: View order, **Change ship date** (dialog: new date and a reason shown to the customer, bulk-capable), **Release now**; Export CSV. Ineligible rows are skipped and reported. In **All orders**, show a small "Pre-order, ships 20 Oct" tag in the Products cell; on the order detail show a banner above Items. **The hold:** while `ships_on` is in the future, "Mark shipped" and "Create fulfillment" are disabled with the reason "Pre-order ships on 20 Oct" (in the UI and refused by the server), and **Release now** lifts it (permission `orders.write`, audited).

### 5. Change date, reminders, notifications
**Change ship date** updates every unshipped order that carries the line, in one transaction, writes one `order_events` row per order, and enqueues one "Your ship date changed" notification per order through pg-boss **after commit** (rule 13). Shipped and cancelled orders are untouched. A daily job notifies each customer **2 days before** `ships_on` ("Your pre-order ships soon") and is **idempotent per order**: record the reminder as an order event and skip if present (test by running the job twice). Add the queue names in `packages/db/src/queues.ts`. Email delivery is not live yet: record the intent in the timeline and send when delivery is enabled.

### 6. Settings
Add the **Pre-orders** section to Settings > Orders per ORDERS-SETTINGS-PLAN 4.5: show "Ships soon" after the date (default on), remind N days before (default 2, 0 turns it off), notify on date change (default on), default message (max 200). If Settings > Orders does not exist yet, build only the section scaffolding you need in the same pattern as the other settings pages and tell me. Settings must be **read by the code** (storefront label, the reminder job, the notification); no setting without behaviour.

## Non-negotiables (these fail review)
- RLS intact; migrations append-only and expand-only; no `eslint-disable`; `pendingComponent` on every admin route and `loading.tsx` on every storefront page.
- Domain functions call `assertPermission` (`orders.write` for changes and release, `orders.read` for list and stats); every mutation writes `audit_logs`; money is integer paise; business logic stays in `packages/domain`.
- Prices and totals come from the server; the client's claims are never trusted (rule 12). A pre-order never changes a price.
- Side effects (emails) happen after commit through pg-boss; nothing is sent inline in a request.
- New admin UI uses the shared kit and `base-mira` components only: no native `<select>`, no `window.confirm`, no hand-rolled tables; Base UI uses the `render` prop, not `asChild`.
- **Do not build** deposits, pay-later, balances, waitlists, sale limits, partial shipments or vendor features. No deposit or balance UI may exist (absent, not disabled).
- Report honestly. Failing or skipped tests are stated with output. Never claim "verified" for something you did not run.

## Definition of done
1. Gate passes, **one package at a time**: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`, then `pnpm --filter @bs/contracts test`, `pnpm --filter @bs/domain test:fast`, `pnpm --filter @bs/domain test:heavy`, `pnpm --filter @bs/admin test`, `pnpm --filter @bs/web test`.
2. Every acceptance criterion in `docs/ORDERS-PREORDERS-PLAN.md` section 6 is checked off in your change record with how you verified it.
3. You ran the flow in a real browser: enable a pre-order variant with a future date, buy it as a shopper (check the badge, cart, checkout and confirmation text), confirm the admin sees it on Pre-orders and All orders, confirm shipping is blocked, change the date and see the timeline event, release it early and ship it, and confirm a normal order is unaffected (desktop and 375 px). State what you did not verify.
4. Docs: `docs/ARCHITECTURE.md` updated (tables, routes, jobs, settings; bump "Last verified"); a change record `YYYY-MM-DD-antigravity-preorders-simple.md` from `TEMPLATE.md`.
5. Hand back: the commits, test results, anything you could not verify, and any question for the owner. Claude will verify against the acceptance criteria before this is called done.
