# Task: Orders Phase 1 (order numbering fix, All orders upgrades, Orders sidebar group)

You are working in the `bsec` monorepo (pnpm + Turborepo, TypeScript, React 19, Tailwind 4, TanStack Router/Query, oRPC, Drizzle, Postgres with row level security). bsec is a multi-tenant commerce SaaS for Indian D2C stores. A mistake can leak one store's data to another or break a live store, so follow the rules exactly.

## Read first, in this order
1. `AGENTS.md`: the rule book. Sections 2 (hard rules), 4 (verification gate), 5 (git and release safety) and 6 (multi-agent protocol) apply in full.
2. `docs/ORDERS-SECTIONS-OVERVIEW.md`: the index, the shared rules, and **section 4 "Look and feel", which is mandatory**.
3. `docs/ORDERS-SETTINGS-PLAN.md`: section 2.1 (the order prefix defect) and section 4.1 (Order numbers) and section 7 step 1.
4. `docs/ORDERS-ALL-ORDERS-PLAN.md`: section 4.1 (Phase 1 gaps G1 to G6), section 5 (build order) and section 8 (acceptance criteria).
5. `docs/admin-ui-standards.md` and `apps/admin/components.json`: the owner's design system (shadcn `base-mira` on Base UI, shared kit). Copy patterns from `apps/admin/src/routes/_store/orders.tsx`.
6. `docs/ARCHITECTURE.md` (to find files) and the newest files in `docs/changes/`.

If any of those files is missing from your working tree, **stop and tell me**; do not guess.

`Storify/` (if you see it) is a reference codebase from another project. **Never copy code from it, never import it, never stage it.** Stage files by path; never use `git add -A`.

## Rules of engagement
- First step: `git fetch`, then create a **new worktree and branch** from the latest `origin/main` plus the plan docs (ask me if the docs are not on `origin/main` yet): `feat/orders-phase1`. If `git status` is not clean, stop and tell me instead of stashing or discarding anything.
- Add one line to "In flight" in `progress.md` (agent, branch, area, date) before you start.
- Keep everything **local**: commit on your branch, do **not** push, and never push to or merge into `main` (a push to `main` that passes CI deploys to production). Never force-push, never `--no-verify`.
- Do not touch Razorpay or Shiprocket. Do not add dependencies unless a plan says so.
- Commit trailer: `Co-Authored-By: Antigravity <noreply@google.com>`. One concern per commit, imperative subject (`fix(orders): ...`, `feat(admin): ...`).

## Do these, in this order, one commit group each

### Step 0: make the order number settings actually apply (defect fix)
Settings > General has an "Order number prefix" that checkout ignores: `packages/domain/src/orders/checkout.ts` and `createAdminDraftOrder` in `packages/domain/src/admin/orders.ts` hard-code `ORD-` and 5 digits.
- Read prefix, digits and next number from the store's settings and the `number_sequences` row (see ORDERS-SETTINGS-PLAN 4.1). Remove the hard-coded values from both paths.
- Add the contract, domain service (`assertPermission(ctx, "settings.write")`, audited with a before and after diff) and the **Settings > Orders** page with only the **Order numbers** section (prefix, digits, next number that can only be raised, live preview). Add the "Orders" item to `components/settings/settings-nav.ts`. Make the General page's prefix field read-only with a link to the new page (one editor for one value).
- Existing orders are never renumbered. Defaults for a store with no saved settings must equal today's behaviour.
- Tests (real database, `startTestDb`): a changed prefix applies to the next order from checkout and from admin create-order; lowering the next number below the highest issued is refused; two concurrent orders never share a number; another tenant's sequence is untouched.

### Step 1: All orders Phase 1 (ORDERS-ALL-ORDERS-PLAN section 4.1 and 5)
Open and Archived tabs; a Channel filter on `orders.source` (admin-created orders get `source = 'admin'`); the five-card stats strip (Total orders, Open, Paid, Total revenue, Average order value) from a new `admin.orders.stats` query in its own boundary; a Products column ("first item +N more", no per-row queries); carrier and tracking number in the Mark shipped dialog; updated, skipped and failed counts in the bulk summary. **Do not implement Delete order, Send invoice, Import, or custom line items.**

### Step 2: Orders sidebar group (ORDERS-SECTIONS-OVERVIEW section 2)
In `apps/admin/src/routes/_store.tsx` replace the single Orders item and the Returns item with an **Orders** group holding **All orders** and **Returns** now. Add the others only when their pages exist. Keep each item's permission.

## Non-negotiables (these fail review)
- Every tenant table via `tenantTable()` plus `forceRlsSql`; migrations append-only and expand-only; no `eslint-disable`; every admin route has `pendingComponent`.
- Domain functions call `assertPermission`; mutations write `audit_logs`; money is integer paise; business logic stays in `packages/domain`.
- New UI uses the shared kit and `base-mira` components only. No native `<select>`, no `window.confirm`, no hand-rolled tables. Base UI uses the `render` prop, not `asChild`.
- A setting or button with no behaviour behind it is a bug. Do not ship placeholders; leave it out or disable it with a stated reason.
- Report honestly. Failing or skipped tests are stated with output. Never claim "verified" for something you did not run.

## Definition of done
1. Gate passes: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`, then `pnpm --filter @bs/contracts test`, `pnpm --filter @bs/domain test:fast`, `pnpm --filter @bs/domain test:heavy`, `pnpm --filter @bs/admin test`, **one package at a time** (parallel runs against one database cause flakes).
2. Every acceptance criterion in ORDERS-ALL-ORDERS-PLAN section 8 and ORDERS-SETTINGS-PLAN section 8 that applies to steps 0 to 2 is checked off in your change record, with how you checked it.
3. You opened the Orders list and the new Settings > Orders page in a real browser at desktop width and 375 px, and exercised tabs, filters, sorting, paging, bulk actions, the ship dialog, the prefix change (create an order afterwards and read its number). State what you did not verify.
4. Docs: `docs/ARCHITECTURE.md` updated (contract, domain and route lines; bump "Last verified"); a change record in `docs/changes/` named `YYYY-MM-DD-antigravity-orders-phase1.md` from `TEMPLATE.md`; remove your "In flight" line when done.
5. Hand back: list the commits, the test results, and any question for the owner. I will have Claude verify against the acceptance criteria before this is called done.
