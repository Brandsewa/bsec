# Customers: phase by phase implementation plan

Builder: Antigravity. Verifier: Claude. Read first: `AGENTS.md`, [CUSTOMERS-SECTION-FINDINGS.md](CUSTOMERS-SECTION-FINDINGS.md) (what and why), [CUSTOMERS-SEGMENTS-PLAN.md](CUSTOMERS-SEGMENTS-PLAN.md) (the segments design), `docs/admin-ui-standards.md`, and the lessons in `docs/prompts/catalog-revision.md` (they apply to every phase here).

**Owner decisions (2026-10-03).** Store credit and loyalty points are **out of scope: build nothing for them** (no tables, tabs, settings, columns). Segments: at most **20 per store**. Guest customers at checkout, stats computed from orders, one consent record with history, CSV import, and delete-means-anonymise are all confirmed.

**Rules for every phase.** One branch per phase (`feat/customers-phase-N`), one change record each in `docs/changes/`, the gate in `AGENTS.md` section 4 including `pnpm --filter @bs/domain test:heavy`, every new admin procedure mapped in `packages/domain/test/isolation.int.test.ts`, every mutation audited, permissions in the domain service (`customers.read`, `customers.write`), migrations append-only with a `_journal.json` entry and `forceRlsSql` on new tenant tables, `docs/ARCHITECTURE.md` updated (the `docs:check` script enforces the migrations and API tables). Read back after commit, never inside the transaction (a getter opens its own transaction). Cache invalidation after commit. Stop and ask the owner before building anything not listed.

Phase order is strict: **0 then 1 then 2.** Segments must not start until Phase 0a passes its tests.

---

## Phase 0: foundations (3 steps, 3 commits)

### 0a. Truthful customer metrics
**Problem.** `customers.orders_count`, `total_spent`, `last_order_at` change only when an admin creates an order and marks it paid (`packages/domain/src/admin/orders.ts`, manual "paid" branch). Storefront checkout, COD delivery, online capture, cancellations and refunds never update them.

**Build.**
1. New `packages/domain/src/customers/metrics.ts`: one SQL fragment builder, `customerMetricsSql(tenantId)`, a lateral subquery over `orders` returning per customer: `orders_count`, `total_spent` (paise, net of refunds), `average_order_value`, `first_order_at`, `last_order_at`, `returns_count`. **Counted order rule** (read `packages/domain/src/orders/state-machine.ts` and `docs/changes/` first, and document the exact rule in the file header): an order counts when its payment is captured (`payment_status` paid or partially refunded) or it is COD and collected (`cod_collected`); cancelled and failed orders never count; refunds subtract the refunded amount from spend; a fully refunded order does not count toward the order count. Match customers to orders by `orders.customer_id`, and for guests by email (see 0b).
2. The list, detail, search sort (`spent_*`, `orders_*`), the "Repeat" filter and every later segment read **this** fragment, never the cached columns. Keep the cached columns (`orders_count`, `total_spent`, `last_order_at`) as a refreshed copy used only to make sorting fast: a pg-boss job `customers.refresh_metrics` recomputes a customer's cached row (enqueue it in the transaction that changes an order's payment or fulfillment state, per rule 13) and a nightly sweep repairs drift. Stop writing those columns in `admin/orders.ts`; the job owns them.
3. Backfill: one idempotent migration step or one-off job that recomputes every customer once.

**Tests (real database).** Storefront COD order placed (not counted), delivered (counted), partially refunded (spend reduced), cancelled (not counted), online captured; admin-created paid order; two customers in two stores (isolation); metrics equal between list and detail; the nightly sweep repairs a deliberately wrong cached row.

**Done when.** The Orders and Spend columns, the Repeat filter and the spend sort are correct for storefront orders.

### 0b. Guest customers
**Build.**
1. Migration: `customers.is_guest boolean not null default false`. A guest has an email (or phone), no password hash and `email_verified = false`. The existing unique `(tenant_id, email)` stays.
2. Checkout (`packages/domain/src/orders/checkout.ts`): after the order is created, in the same transaction, upsert the customer by email (then by phone); set `orders.customer_id` to it when the shopper is not logged in. A logged-in shopper keeps their own row. Never overwrite the name or phone of an existing account row with guest input; fill them only when empty.
3. Claim: registration (`customers/auth.ts`) and OTP login (`customers/otp.ts`) with an email or phone that has a guest row **attach to that row**, clear `is_guest`, keep the history. No duplicate customers; no leak of a guest's orders to someone who has not verified the email or phone (verification still gates the account; an unverified registration must not show guest orders until verified).
4. Backfill job (idempotent): create guest customers from existing orders by email and set `orders.customer_id`; report counts.
5. Admin list shows a **Guest** badge and a Guests tab (Phase 1).

**Tests.** Guest checkout creates one customer; a second guest checkout with the same email reuses it; two stores with the same email do not mix; registration claims the guest and keeps the orders; an unverified claimant cannot read guest orders; a logged-in checkout does not create a second row; the backfill is idempotent.

### 0c. One consent record with history
**Build.**
1. Migration: on `customers` add `marketing_state text not null default 'not_subscribed'` (check: `subscribed`, `unsubscribed`, `not_subscribed`, `invalid`), `marketing_source text`, `marketing_updated_at timestamptz`. New tenant table `customer_consent_events` (`id`, `customer_id`, `channel` default `email`, `state`, `source`, `actor_type`, `actor_id`, `ip`, `at`), composite FK to customers, RLS forced, index `(tenant_id, customer_id, at)`.
2. One domain function `setMarketingConsent(rt, ctx|system, customerId, state, source)` in `packages/domain/src/customers/consent.ts`; it is the only writer. It updates the customer, appends an event, keeps `accepts_marketing` equal to `state === 'subscribed'` (compatibility) and writes an audit row when the actor is staff. Sources: `checkout`, `storefront_form`, `account_page`, `admin`, `import`, `unsubscribe_link`.
3. Route everything through it: the newsletter form (`storefront/newsletter.ts`; it also creates or finds the customer, a guest if needed, and keeps `newsletter_subscribers` in step), the unsubscribe link (`customers/unsubscribe.ts`), the account profile switch (`customers/profile.ts`), the admin create and edit screens, and the checkout tick-box (must be **unticked by default**; DPDP consent has to be an affirmative act).
4. Backfill: existing `accepts_marketing = true` rows become `subscribed` with source `legacy`; existing `newsletter_subscribers` rows are linked to customers and given the same treatment; unsubscribed rows become `unsubscribed`.

**Tests.** Every entry point writes one event and the right state; unsubscribing through the link on a guest works; `accepts_marketing` never disagrees with `marketing_state`; history is ordered; cross-store isolation of events; the checkout tick-box default.

**Phase 0 gate.** All three steps merged, heavy suite green, Claude verifies before Phase 1 starts.

---

## Phase 1: list, detail, import, delete (3 steps)

### 1A. Customers list
Rebuild `apps/admin/src/routes/_store/customers.tsx` on the kit (`docs/admin-ui-standards.md`; copy the structure of the Orders page: URL state with `useUrlTableState`, stats in their own boundary, `ScrollTabs`, `TableToolbar`, `DataTable`).
- **Stats strip** (own query, own Suspense boundary, `MetricCard`): Total customers, New this month, Repeat customers, Marketing subscribers, Total spend, Average order value. Contract `customers.stats`, domain `getAdminCustomerStats` using the 0a fragment.
- **Tabs:** All, Customers (has an account), Guests, Blocked.
- **Columns:** Customer (name, email, Guest badge), Orders, Spent, Last order, Marketing state badge (subscribed, unsubscribed, not subscribed, invalid), Tags (first two, +N), Joined. Mobile (375 px): name, email and spent only; the rest behind the optional-columns control the page already has.
- **Filters:** Tag (options from **all** tags in the store, `customers.tags` contract returning distinct tags, not the tags on the current page), Marketing state, Location (state, from the default address), Joined range, Repeat. A **Segment** filter arrives in Phase 2 (reserve the URL param `segment`).
- **Bulk actions** (skip ineligible rows, report "N done, M skipped, first issue: ..."): Add tag, Remove tag, Set status (active or blocked), Export selected, Delete (uses the 1C rules). Row actions: Open, Block or Unblock, Delete.
- **Export** the whole filtered list as a CSV through the existing bulk-progress UI, columns including Marketing state and Consent updated; a "Subscribed only" checkbox on by default.
- Empty and error states, retry, `pendingComponent`.
**Tests.** Domain: each filter and sort against seeded customers (guest, blocked, refunded); real-DB isolation. Component tests in a router for tabs, filters and bulk reporting. Run it in a browser at 375 px and desktop and say what you could not run.

### 1B. Customer detail and edit
Rebuild `apps/admin/src/routes/_store/customers_.$customerId.tsx` as a two-column page like the Product form (sticky header with name, status badge, Save, Back, unsaved-changes guard).
- Header tiles: Orders, Lifetime value, Average order value, Last order, Customer since.
- **Left:** Profile card (name, phone, email: editable only for a guest or an unverified account; changing it clears `email_verified` and is audited), Addresses card (staff can add, edit, delete, set default; reuse `customers/addresses.ts` with admin permission checks), Orders card (full history, status chips, link to each order, filter by status), Activity timeline (orders, returns, quotes, reviews, abandoned checkouts, consent changes, in time order, from existing tables; no new table).
- **Right rail:** Status (Active, Blocked; a blocked customer cannot log in or check out, with a neutral message; staff see why), Marketing card (current state, source, date, history from `customer_consent_events`, a switch that calls `setMarketingConsent` with source `admin` and a confirm dialog), Tags (chips, autocomplete from the store's tags, add and remove), **Notes timeline** (new table `customer_notes`: `id`, `customer_id`, `author_id`, `body` max 1000, `created_at`; RLS; staff add, author or owner delete; replaces the single `note` text, which is migrated as the first note), Segments card (Phase 2 placeholder, hidden until then).
- New contracts and domain functions: `customers.update`, `customers.setStatus`, `customers.tags.set`, `customers.notes.list/add/delete`, `customers.activity`, `customers.consent.set`; address mutations by staff. Each checks `customers.write`, writes `audit_logs`, never reads back inside its transaction.
**Tests.** Real DB: each mutation, permission refusal (read-only staff), audit rows, blocked customer cannot log in or check out, activity ordering, cross-store isolation for every new procedure, note migration. Component tests for the form dirty state. Browser check at 375 px.

### 1C. Import and delete
- **Import CSV** (button in the list header). Domain `previewCustomerImport` then `commitCustomerImport` (background job for more than 500 rows). Columns: name, email, phone, tags, `marketing_consent` (only a value of `yes`, `subscribed` or `true` subscribes, source `import`; blank or anything else is not subscribed; the dialog says the owner is responsible for having proof of consent). Dry run report: rows ok, duplicates inside the file, existing customers updated (name and tags only, never overwrite consent downward or upward without the file saying so), invalid emails, with a downloadable error CSV. Cap 10,000 rows. Phone normalised to the stored format.
- **Delete.** A customer with no orders is hard-deleted (addresses, wishlist, sessions, notes, consent events, segment memberships cascade). A customer with orders is **anonymised**: name, email, phone replaced with a placeholder (`deleted-<shortid>@invalid`), consent set to unsubscribed, password and sessions destroyed, addresses and notes deleted, `deleted_at` set, orders kept unchanged for accounts and tax. The confirm dialog says which will happen. Audited. Bulk delete uses the same function and reports per row.
**Tests.** Import dry run versus commit parity, duplicate handling, consent only when stated, 10,001 rows refused, isolation; delete both paths, orders still render with the anonymised customer, sessions destroyed.

**Phase 1 gate.** Heavy suite green; Claude verifies in a browser before Phase 2.

---

## Phase 2: segments (4 steps)
Follow [CUSTOMERS-SEGMENTS-PLAN.md](CUSTOMERS-SEGMENTS-PLAN.md) exactly, with the **20 segment limit**.
- **2A.** Migrations (`customer_segments`, `customer_segment_members`), schema, the Zod rule schema, and the rule compiler `segments/compile.ts` with hostile-input tests (unknown field, SQL in a value, 11 conditions, a cycle). No UI yet.
- **2B.** Domain services, contracts, handlers, isolation-suite entries, audit rows, the count refresh job `segments.refresh_counts` (every 6 hours) and the 20 limit.
- **2C.** Admin UI: Segments list, the create and edit form (manual members, automatic condition builder with live preview), segment detail with members table and export (subscribed only by default), presets.
- **2D.** Integration: the Segment filter and Add to segment bulk action on the Customers list, the Segments card on the customer detail, docs and change record.
**Tests and gate** as the segments plan section 8 and 8b.

---

## Not in this work
Store credit, loyalty points and tiers, duplicate merge, a customers settings page, SMS consent, sending any email to a segment, vendor or staff-scoped customer views. Raise them as questions; do not build them.

## Definition of done per phase
Gate passes with the heavy suite counts pasted; change record written with what was run and what was not (browser checks named); `docs/ARCHITECTURE.md` and `progress.md` updated; no unrelated edits; honest status. Claude verifies against these criteria before the next phase starts.
