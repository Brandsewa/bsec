# Task: Returns and exchanges (manual review model)

You are working in the `bsec` monorepo (pnpm + Turborepo, TypeScript, React 19, Tailwind 4, TanStack Router/Query, oRPC, Drizzle, Next.js storefront, Postgres with row level security). bsec is a multi-tenant commerce SaaS for Indian D2C stores. A mistake can leak one store's data to another, expose a shopper's private photos, or break a live store, so follow the rules exactly.

## What the owner decided
Returns are handled **manually**. The customer files a return or exchange request from their order page, with photos. The store admin reviews and verifies it, then **manually** offers an exchange or refunds the money (outside the system), and **records** what they did. A Settings section controls the rules. No automatic gateway refunds, no store credit, no restocking or shipping fees, no return labels, no courier integration.

## Read first, in this order
1. `AGENTS.md`: the rule book. Sections 2, 4, 5 and 6 apply in full.
2. `docs/ORDERS-SECTIONS-OVERVIEW.md`: shared rules, and **section 4 "Look and feel", which is mandatory** for every admin screen.
3. `docs/ORDERS-RETURNS-PLAN.md`: **your spec.** Every section matters; section 3.3 (photo upload) and section 7 (acceptance criteria) are the parts reviewers check hardest.
4. `docs/ORDERS-SETTINGS-PLAN.md`: section 3 (navigation), section 5 (Settings > Returns) and section 6 (data shape and defaults).
5. `docs/admin-ui-standards.md` and `apps/admin/components.json`: the owner's design system (shadcn `base-mira` on Base UI, shared kit). Copy patterns from `apps/admin/src/routes/_store/orders.tsx`.
6. The code you will change (read it before editing): `packages/domain/src/orders/manual-lifecycle.ts`, `orders/return-state-machine.ts`, `packages/db/src/schema/shipping.ts` (returns, return_items), `packages/db/src/schema/payments.ts` (refunds), `packages/contracts/src/admin.ts` (returns), `apps/admin/src/routes/_store/returns.tsx`, `apps/web/src/app/o/[token]/page.tsx`, `apps/web/src/components/orders/ReturnRequestForm.tsx`, `packages/domain/src/media/storage.ts`, `media-services.ts`.
7. `docs/ARCHITECTURE.md` and the newest files in `docs/changes/`.

If any of these files is missing from your working tree, **stop and tell me**; do not guess.

`Storify/` (if you see it) is another project's code. **Never copy code from it, never import it, never stage it.** Stage files by path; never use `git add -A`.

## Rules of engagement
- First step: `git fetch`, then a **new worktree and branch** from the latest `origin/main` (with the plan docs and the "Orders Phase 1" work merged in; ask me if they are not there): `feat/returns-manual`. If `git status` is not clean, stop and tell me instead of stashing or discarding anything.
- Add one line to "In flight" in `progress.md` before you start; remove it when done.
- Keep everything **local**: commit on your branch, do **not** push, and never push to or merge into `main` (a push to `main` that passes CI deploys to production). Never force-push, never `--no-verify`.
- Do not touch Razorpay or Shiprocket. No new dependencies without saying why in the change record.
- Commit trailer: `Co-Authored-By: Antigravity <noreply@google.com>`. One concern per commit.
- **Do not implement GST credit notes.** It is an open compliance question (plan decision D2). Record the refund and show "credit note not issued" as plan section 4 says; raise it in your report.

## Build in this order, one commit group each

### 1. Admin Returns page rebuild (no new data yet)
Replace the card list in `apps/admin/src/routes/_store/returns.tsx` with the shared kit: `PageHeader`, four `MetricCard`s (Needs review, Awaiting item, To refund or exchange, Resolved last 30 days), `ScrollTabs`, `TableToolbar` (search by return number, order number, customer email or name), URL state, `DataTable` with mobile cards, `Pagination`, `pendingComponent`, empty and error states. Extend `admin.returns.list` (search, status, limit, offset, `total`; SQL paging with an `id` tie-break) and add `admin.returns.stats`. Add the review **sheet** (`components/ui/sheet.tsx`) with customer, order, items, reason, timeline and internal note. Replace every `window.confirm` with `ConfirmDialog` or a form dialog. Add `audit_logs` rows to `actOnReturn` and every return mutation. Tests: filters, search, paging, stats on a seeded set, permission refusal, tenant isolation.

### 2. Manual refund and exchange recording, status ladder, data
Follow plan section 3.5 exactly. Expand migration only (`docs/migrations.md`): the new `returns` columns (requested resolution, customer comment, exchange request, decision message, instructions sent at, refund method, refund reference, refund amount, refunded at, exchange note, exchange order id) and, if you also want the ledger entry, `refunds.intent_id` nullable plus `method` and `reference`. **Never drop or rename an existing column.** Keep every existing table on `tenantTable()` plus `forceRlsSql`. Status ladder: `requested -> approved | rejected | cancelled`; `approved -> received` (keep `picked_up` allowed but unused in the UI); `received -> refunded | replaced`; `refunded | replaced -> closed`; `approved -> refunded | replaced` directly with a mandatory note. Admin actions: Approve (as Refund or Exchange, message and instructions), Reject (message required), Mark received (restock tickbox), **Record refund** (amount default the paid share, editable, capped at what was paid and not already refunded; method and reference required; **only records, moves no money**; works for COD orders and orders with no payment intent), **Record exchange** (note, optional new order number), Close. Recording a refund needs `orders.refund`; the others `orders.write`. Every transition writes `audit_logs` and an `order_events` row (customer-visible only when the message is for the customer). Remove the `RETURN_WINDOW_DAYS` constant in favour of the setting in step 3.

### 3. Settings > Returns and the per-product Returnable switch
Add the **Returns** item to `components/settings/settings-nav.ts` and the route `/settings/returns` using `SettingsPageFrame`, `SettingsSection`, `Field`, `useUnsavedGuard`. Fields and ranges exactly as ORDERS-SETTINGS-PLAN section 5 and ORDERS-RETURNS-PLAN section 3.1: accept requests, allow exchanges, window days (default 7, 1 to 90), reasons list (max 12), photos required per reason, instructions, policy text. Store in `store_settings.return_settings` (versioned jsonb, parsed with defaults equal to today's behaviour: an existing store behaves exactly as before, including a 7-day window). `settings.write`, audited with a before and after diff. Add `products.returnable boolean not null default true` with a switch in the product editor; non-returnable lines are not offered and are refused by the server. **There is no `switch` component in the kit yet**: add it with the shadcn CLI (see overview section 4 for the gotchas) and use it everywhere. Add a **Reset to defaults** button only if you can test it.

### 4. Customer portal: request, exchange choice, tracker, cancel
On `/o/[token]` and `/account/orders/[id]` (each page keeps its `loading.tsx`): a **Request a return or exchange** button only when returns are on, the order is delivered, inside the window and a returnable item remains. Form: items and quantities, reason from settings, **Refund or Exchange** (Exchange only if enabled, with a free-text "what would you like instead"), comment, photos, the policy text. Submitting creates the return, emails the store through pg-boss **after commit**, and shows the return number. A tracker under the order shows Requested, Approved (with the store's instructions) or Rejected (with its message), Received, Refunded or Exchange arranged, Closed. The customer can **cancel** while `requested` (add the `cancelled` status). The server must enforce every rule (window, enabled flags, returnable, quantities, one open return per line); the form is only a convenience. Email delivery is not live yet: record the intent in the timeline and send when delivery is enabled.

### 5. Photo upload (new public write surface: the highest-risk part)
Implement plan section 3.3 in full; every item there is mandatory:
- Only with a valid order action token, or the signed-in customer who owns the order; rate limited per order and per IP.
- Presigned PUT to R2 under `tenants/<tenantId>/returns/<orderId>/<uuid>`; the client uploads directly; a **finalize** call verifies the object (exists, size, content type) and creates the `media` record; a photo is not attachable before it is finalized.
- Max 5 photos per request, 5 MB each, `image/jpeg`, `image/png`, `image/webp` only. **No SVG, HTML or GIF.** Verify the real type by **magic bytes** on finalize, not just the header.
- Objects are **private**: no public URL, ever. The admin sees them through short-lived signed GET URLs. Strip EXIF (GPS) on finalize, or never serve the original; say which in your change record.
- A daily pg-boss job deletes unattached uploads older than 24 hours.
- If `media/storage.ts` only supports public objects, add a private prefix; **do not loosen the existing rules**.
- Store the media ids in `returns.photos` (the column exists and is unused today). Show a gallery in the review sheet.
- Tests (real database, and a faked clock for cleanup): oversize, wrong type, wrong magic bytes, SVG, a 6th photo, another order's token, an unfinalized upload, expired URL, cross-tenant access, and rate limiting are all refused.

### 6. Notifications and exports
Enqueue after commit: new request (to the store), approved, rejected, refund recorded, exchange arranged (to the customer). CSV export of the current filtered list from the Returns page.

## Non-negotiables (these fail review)
- RLS on every tenant table; composite tenant foreign keys; migrations append-only and expand-only; no `eslint-disable`; `pendingComponent` on every admin route and `loading.tsx` on every storefront page.
- Domain functions call `assertPermission`; every mutation writes `audit_logs`; money is integer paise; business logic stays in `packages/domain`; apps only parse input, call a service and shape output.
- Nothing in this feature moves money. Recording a refund is a record, never a payment.
- Photos are private and never logged, put in URLs shown to others, or included in test snapshots.
- New admin UI uses the shared kit and `base-mira` components only: no native `<select>`, no `window.confirm`, no hand-rolled tables; Base UI uses the `render` prop, not `asChild`.
- A setting or button with no behaviour behind it is a bug. Do not ship placeholders; leave it out or disable it with a stated reason.
- Report honestly. Failing or skipped tests are stated with output. Never claim "verified" for something you did not run.

## Definition of done
1. Gate passes, **one package at a time**: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`, then `pnpm --filter @bs/contracts test`, `pnpm --filter @bs/domain test:fast`, `pnpm --filter @bs/domain test:heavy`, `pnpm --filter @bs/admin test`, `pnpm --filter @bs/web test`.
2. Every acceptance criterion in `docs/ORDERS-RETURNS-PLAN.md` section 7 is checked off in your change record with how you verified it.
3. You ran the whole flow in a real browser: enable returns in Settings, place and deliver a test order, file a request with photos from the customer page (desktop and 375 px), review it in the admin, approve as exchange and as refund, record each, close; confirm the customer sees each status and message; confirm another store's admin cannot see the photos. State what you did not verify.
4. Docs: `docs/ARCHITECTURE.md` updated (tables, routes, jobs, settings, storage prefix; bump "Last verified"); an ADR if you changed how private media is stored; a change record `YYYY-MM-DD-antigravity-returns-manual.md` from `TEMPLATE.md`.
5. Hand back: the commits, test results, anything you could not verify, and your question about credit notes. Claude will verify against the acceptance criteria before this is called done.
