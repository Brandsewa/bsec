# Orders: Abandoned checkouts

Hand-off plan for Antigravity. Verifier: Claude. Read [ORDERS-SECTIONS-OVERVIEW.md](ORDERS-SECTIONS-OVERVIEW.md) first (shared rules, nav, what not to copy).

**Styling (mandatory):** build every screen with the owner's design system: `docs/admin-ui-standards.md`, the shadcn `base-mira` (Base UI) components in `apps/admin/src/components/ui`, and the shared kit. See section 4 of [ORDERS-SECTIONS-OVERVIEW.md](ORDERS-SECTIONS-OVERVIEW.md). Do not hand-roll tables, selects, dialogs or form controls.

**Settings for this feature** live in Settings > Orders, specified in [ORDERS-SETTINGS-PLAN.md](ORDERS-SETTINGS-PLAN.md) section 4.4.

## 0. Goal

Give the store admin an **Abandoned checkouts** page: shoppers who started checkout and left, whether they came back, and a way to nudge them. Storify has the page; bsec has the data and a background sweep but **no admin screen and no way to tell whether a shopper came back**.

## 1. What Storify does (read from code; `Storify/components/admin/abandoned-checkouts-data-table.tsx`, `lib/orders/abandoned-checkouts.ts`, `abandoned-checkout-list.ts`, `models/abandoned-checkout.model.ts`)

The live demo list was empty, so every behaviour below comes from the code.

### 1.1 Page

| Element | Behaviour |
|---|---|
| Stats strip (5) | **Abandoned** (all), **Open** (not recovered), **Recovered**, **Emails sent**, **Potential revenue** (sum of totals of open ones). Own query, own Suspense boundary. |
| Tabs | All, Open, Recovered. |
| Search | Customer name, email, phone, or any product name in the cart. |
| Filter | Email status: All, Not sent, Sent, Failed, No email. |
| Sort | Abandoned date (default, newest first), Total, Email status, Recovery status. |
| Columns | **Customer** (name or "Guest", email or phone under it); **Products** (first item two words + "+N more", links to the product); **Abandoned** (date and relative age); **Total**; **Email** (badge, plus "2 of 3" when a ladder exists, or "Unsubscribed"); **Recovery** (Not recovered / Recovered). |
| Row click | None. |
| Row menu | **Payment timeline** (only if the gateway recorded attempts; opens a dialog of created / failed / succeeded / cancelled with the gateway message); **Send recovery email** (disabled if no email or already recovered); **Copy recovery link** (disabled if none); **Open checkout** (opens the link). |
| Toolbar | **Detect now**: marks idle checkouts as abandoned (default 10 minutes) and toasts "N abandoned checkouts marked". |
| Send outcomes | "Recovery email sent", "queued, delivery is being retried", "Not sent, the shopper has not confirmed their subscription", "Not sent, the shopper unsubscribed", "could not be sent". |
| Empty state | "Abandoned checkouts will show here after a customer starts checkout and leaves before payment." |

### 1.2 Rules behind it

- A started checkout idle for **10 minutes** is abandoned. Only checkouts that have items, and a started and abandoned timestamp, are listed.
- **Recovery ladder:** up to three scheduled emails (delays in minutes after abandonment, set in store settings). The schedule is **written once when the checkout is marked abandoned** so changing settings later never re-sends what already went. A sweep **claims** each rung before sending so two overlapping runs cannot both send. Checkouts older than **7 days** are never mailed (stops a flood when the feature is first switched on). If a shopper abandons a second time, the ladder resets, but an unsubscribe is never undone.
- Every email carries an **unsubscribe** link; it stops the ladder and records the shopper's preference on their customer record.
- **Recovery is recorded, not derived:** `recoveredTotal` and `recoveredVia` (`email_1`..`email_3`, `link`, `pay_link`, `organic`), because afterwards the cart is an order and the rungs have moved on.
- Records delete themselves after **90 days**.
- The email goes through the outbox with retry; the row shows `queued` until the outbox knows the result.
- Storify's list loads two collections into memory and pages there. **Do not copy that**; page in SQL.

## 2. What bsec has (verified by reading the code)

- `carts` (`packages/db/src/schema/cart.ts`): `status` (`active`, `abandoned`, `converted`, `expired` per the comment), `email`, `phone`, `shipping_address`, `last_activity_at`, `recovered_at`, `recovery_sent_at`. `cart_items` hold `unit_price_snapshot` and quantity.
- `sweepAbandonedCarts` (`packages/domain/src/system/abandoned-carts.ts`), run per tenant from `jobs.ts`: marks `active` carts idle for **60 minutes** as `abandoned`, enqueues `cart.abandoned`, whose consumer sends **one** email (`abandoned_cart_recovery`) when the cart has an email and `recovery_sent_at` is null.
- `orders.cart_id` exists, so an order can be linked to the cart it came from.
- Customer unsubscribe exists (`packages/domain/src/customers/unsubscribe.ts`).

### 2.1 Gaps and defects found

| # | Finding |
|---|---|
| F1 | **No admin page, no list or stats API, no nav entry.** |
| F2 | **`carts.recovered_at` is never written anywhere.** Nothing sets a cart `converted` either (no match for either in `packages/domain/src`). So "Recovered" cannot be answered today. |
| F3 | The sweep abandons **any** idle cart, including carts that never reached checkout. Storify's page is about *checkouts*. Decide what the page lists (D1). |
| F4 | No recovery ladder: one email, no schedule, no claim step, no delivery status on the cart. |
| F5 | No recovery link: there is no endpoint that restores an abandoned cart from its token. |
| F6 | Email delivery is not live (platform email service pending), so any send action must be disabled with a reason for now. |
| F7 | No customer name on a cart; the only name source is `shipping_address.fullName` when present. |

## 3. Decisions (the owner delegated these to Claude on 2026-10-02; the recommendations are adopted, so Phase 2 only waits on email delivery going live)

| # | Decision | Recommendation |
|---|---|---|
| D1 | List **carts that reached checkout** (has email/phone and an address) or **every** idle cart? | Checkout-started only, to match Storify and keep it meaningful. Needs a "checkout started" marker (`checkout_started_at`, expand migration) or a rule (has email). |
| D2 | **Idle threshold:** bsec uses 60 minutes, Storify 10. | Make it a per-store setting, default 60. |
| D3 | **Ladder:** how many emails and when? | Three rungs at 1 h, 24 h, 72 h, per-store editable, off by default. |
| D4 | **Consent.** Mailing a shopper who only typed an email at checkout is marketing-adjacent. | Owner or counsel to confirm; the plan assumes an unsubscribe link in every email and respecting `accepts_marketing`/suppression. |
| D5 | **Retention.** Storify keeps 90 days. | 90 days, purged by a job (carts hold personal data). |
| D6 | **Recovery attribution** rung or link or organic. | Adopt Storify's list. |

## 4. Phase 1: read-only page (no migration, can start now)

Scope: list, stats, tabs, search, sorting, "copy link" disabled, no sending. Uses data that exists.

1. **Define recovered without new columns:** a cart is *recovered* when an order exists with `orders.cart_id = carts.id` and `orders.placed_at > carts.last_activity_at` of the abandonment (query with `EXISTS`). **Open** = `status = 'abandoned'` and not recovered. Also fix the checkout path (`orders/checkout.ts`) to set the cart `converted` and, if it was `abandoned`, `recovered_at = now()` (this is a small write in the existing transaction; add a test). Until that ships, use the `EXISTS` rule.
2. **Contract** (`packages/contracts/src/admin.ts`): `admin.abandonedCheckouts.list` (`view`: all | open | recovered, `search`, `emailStatus`, `sort`, `limit`, `offset`) and `admin.abandonedCheckouts.stats`.
3. **Domain** (`packages/domain/src/admin/abandoned-checkouts.ts`, new): `assertPermission(ctx, "orders.read")`; SQL paging (no in-memory merge). Item preview = first item title plus count, one extra query per page, not per row. Total = sum of `unit_price_snapshot * quantity` (money in paise). Email status derived from `recovery_sent_at` (`sent` / `not_sent`) and email presence (`not_applicable` = no email).
4. **Admin UI** (`apps/admin/src/routes/_store/abandoned-checkouts.tsx`): the columns and tabs in 1.1, the five cards, the empty state. Use the same table kit and URL state as `orders.tsx`. Include `pendingComponent`.
5. **Nav:** add the item per the overview.
6. **Row menu in Phase 1:** only "Copy recovery link" and "Open checkout" if F5 is solved; otherwise omit them. Do **not** show a "Send recovery email" button that does nothing.
7. Tests (real DB): tabs partition correctly; recovered detection via `orders.cart_id`; stats match a seeded set; another tenant's carts never appear; permission refusal.

## 5. Phase 2: recovery ladder (after D1 to D6, and after email delivery is live)

- Migration (expand only): per-cart rung rows (`cart_recovery_emails`: cart, step, due_at, claimed_at, sent_at, status `pending|queued|sent|failed|skipped`, dedupe key), `carts.checkout_started_at`, `carts.unsubscribed_at` (or reuse the customer suppression), `carts.recovered_via`, `carts.recovered_total`. Tenant tables with `tenantTable()`, `forceRlsSql`, composite FK (rule 1).
- Store settings for enabled, auto-send, and the schedule; the schedule is copied onto rungs when abandoned.
- Claim-then-send in the `cart.abandoned` consumer; never mail carts older than 7 days; reset the ladder on a second abandonment but keep unsubscribe.
- Unsubscribe link in every email, reusing the existing unsubscribe token flow.
- Recovery link endpoint on the storefront that restores the cart from its token, with a signed token (reuse `action_tokens`).
- Row actions: Send recovery email (with the five outcomes in 1.1), Payment timeline once payment attempts exist.
- "Detect now": a toolbar button that runs the sweep for the current store (rate limited, audited).
- Purge job at 90 days.

## 6. Not built

Discount codes inside recovery emails (Storify has none either); SMS or WhatsApp recovery; a payment timeline until online payment is live.

## 7. Acceptance criteria

Phase 1 is done only when all hold:

- [ ] Route exists, in the Orders nav group, with `pendingComponent`, and an empty state with the Storify wording.
- [ ] Five cards (Abandoned, Open, Recovered, Emails sent, Potential revenue) match a hand-calculated seed; they load independently of the table.
- [ ] Tabs All / Open / Recovered partition correctly; Recovered uses an order linked by `cart_id`.
- [ ] Search matches name, email, phone and product title; sort works on date, total, email status, recovery.
- [ ] Paging is done in SQL; a 10-row page issues a constant number of queries (assert it).
- [ ] Money is paise end to end; a store with zero carts shows zeros, not errors.
- [ ] No "send" button that does nothing; anything unsupported is disabled with a stated reason.
- [ ] `assertPermission(ctx, "orders.read")` in every domain function; RLS test proves tenant isolation.
- [ ] The checkout path marks the cart converted/recovered (or the `EXISTS` rule is used and the gap documented).
- [ ] Gate passes; change record and `ARCHITECTURE.md` updated; UI exercised by hand and reported honestly.
