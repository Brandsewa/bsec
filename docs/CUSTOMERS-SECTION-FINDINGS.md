# Customers section: Storify map, bsec gap analysis, upgrade plan

Source: the Storify code in `Storify/` (behaviour reference only, never copied) read on 2026-10-03, compared with what bsec has today. Verifier: Claude. Builder: Antigravity. Segments have their own plan: [CUSTOMERS-SEGMENTS-PLAN.md](CUSTOMERS-SEGMENTS-PLAN.md).

## 1. What Storify's Customers section is

**Data (`models/customer-profile.model.ts`).** One `CustomerProfile` per shopper, separate from the login `User`. Guests are real rows (`isGuest`, email or phone on the profile, claimed when they later register). Fields: loyalty (`loyaltyPoints`, `lifetimePoints`, `loyaltyTier` bronze/silver/gold/platinum computed from lifetime points), a cached `stats` block (`totalOrders`, `totalSpent`, `averageOrderValue`, `lastOrderDate`, reviews, wishlist), `tags[]`, one `notes` text (2000 chars), `acquisitionSource`, one shipping address, `lastActiveAt`, preferences (currency, language, categories, sizes), and a full **marketing consent record per channel** (email and SMS): state (`subscribed`, `pending`, `unsubscribed`, `not_subscribed`, `invalid`, `redacted`), opt-in level, source, IP, confirmed-at, plus a capped consent history and an unsubscribe token for the link in every marketing email. There is **no segment concept**; the only grouping is tags and the tier.

**List (`customers-list-view.tsx`, `customers-data-table.tsx`, `lib/customers/customer-list.ts`).**
- Stats strip (5): total customers, active accounts, VIP (gold and platinum), total spend, average spend per customer. Loaded in its own boundary.
- Tabs: All, Active, Inactive, Banned, Guest. Filters: Tier, Email subscription (the six consent states), Tag (options built only from the tags on the current page). Search: name or email, across the account and the guest identity. Sort: name, email, status, any profile field.
- Columns: Customer (avatar, name, email), Account badge, Email subscription badge with relative date, Loyalty tier, Orders, Spent, Last active, Points and Tags (wide screens only).
- Bulk actions: set active, set inactive, set banned, delete. Row actions: view, edit, delete. Export: the rows on screen as CSV. **Import: a disabled stub.**
- Server notes worth keeping as ideas: admins and staff are excluded from the list; the user join happens after the page is cut; scoped staff see only customers of orders they can see; a vendor view shows vendor-scoped stats and hides CRM fields.

**Detail (`customer-detail-shell.tsx` and tabs).** Header card (avatar, status, tier, points, stat tiles). Tabs: **Profile** (basic info, account status, segmentation card with acquisition source and comma-separated tags, communication preferences with the consent state, history and per-event switches, shipping address), **Orders** (order history table), **Activity** (recent reviews, timeline of account dates), **Loyalty** (points and tier editor, summary), **Store credit** (balances per currency, ledger, "Give credit" dialog with amount, optional expiry and note), **Notes** (one text box, and the delete "Danger zone"). One Save button for the whole form with an unsaved-changes guard. Create page mirrors the Profile tab.

**Satellites.** Store credit is a real ledger (accounts plus issue, redeem and expire transactions, holds at checkout, refund-to-credit, expiry cron, shopper page and emails). Unsubscribe and marketing confirmation routes. Guest-to-account claim and a profile merge helper. Customer-facing account area (dashboard, notifications, quotes, store credit).

## 2. What bsec has today

- **Schema** (`packages/db/src/schema/customers.ts`): `customers` (email, phone, name, verified flags, password hash, `accepts_marketing` boolean with a consent timestamp, `tags[]`, one `note`, cached `total_spent`, `orders_count`, `last_order_at`, `status`, `deleted_at`), `customer_addresses` (full address book), `wishlist_items`, OTPs and sessions. Separate `newsletter_subscribers` table keyed by email. No guests (no row without an email), no consent states or history, no loyalty, no store credit, no segments.
- **Admin** (`apps/admin/src/routes/_store/customers.tsx`, `customers_.$customerId.tsx`; `packages/domain/src/admin/customers.ts`): **list, get, create only.** List has search, tag, repeat-buyers, marketing yes/no, joined-date range, eight sorts, URL state, export, bulk-progress UI. Detail is read-only: recent orders, saved addresses, contact, purchase summary, note. **No edit, no delete, no tag editing, no status change, no notes timeline, no consent history, no stats cards.** Permissions `customers.read` and `customers.write` exist.
- **Storefront side:** registration, email verify, OTP login, password reset, profile and address book, order history, unsubscribe token, newsletter.

## 3. Findings in bsec that block good CRM features

1. **Customer stats are almost never updated.** `orders_count`, `total_spent` and `last_order_at` change in exactly one place: an admin-created order marked paid (`packages/domain/src/admin/orders.ts`, around the manual "paid" branch). Storefront COD checkout, COD delivery, online payment capture, cancellations and refunds never touch them. So the Orders and Spend columns, the "Repeat" filter and the "Highest spend" sort are wrong for real stores, and any segment built on them would be wrong.
2. **Guest shoppers are invisible.** Checkout stores the email on the order and `customer_id` only when logged in; no customer row is created. A store that allows guest checkout (the live default is COD) has a customer list that misses most buyers.
3. **Consent is two unrelated records.** `customers.accepts_marketing` and `newsletter_subscribers` can disagree, and neither records source, unsubscribe, or history. India's DPDP Act expects provable consent, so this matters before any email goes out.
4. **No way to fix a customer.** An owner cannot correct a typo in a phone number, tag a VIP, block an abusive buyer or delete a record.

## 4. Upgrades, in the order to build them

### Phase 0: foundations (required before segments; small to medium)
- **0a. Truthful stats.** Decision: compute metrics from orders, do not trust the cached columns. A SQL view or lateral aggregate over `orders` (counted when the payment is captured, or a COD order is delivered; refunds subtract; cancelled excluded; same rule as the order state machine) gives `orders_count`, `total_spent`, `average_order_value`, `first_order_at`, `last_order_at`, `returns_count` per customer. Keep the cached columns as a nightly-refreshed copy for sorting; a pg-boss job recomputes a customer's row on order events. Test with a real database: storefront COD order, delivered, partially refunded, cancelled.
- **0b. Guest customers.** Checkout upserts a customer by email (or phone) with `is_guest = true` and no password; registering or OTP login with that email claims the row. Needs a migration (`is_guest`, and a rule for unique email already exists). Backfill guests from existing orders (one job, idempotent).
- **0c. One consent record.** Add `marketing_state` (`subscribed`, `unsubscribed`, `not_subscribed`, `invalid`), `marketing_source`, `marketing_updated_at` to `customers` and a `customer_consent_events` table (customer, channel, state, source, at, actor). `accepts_marketing` stays as a derived compatibility column; the newsletter form and the unsubscribe link write through one domain function. SMS can be added later with the same shape.

### Phase 1: list and detail upgrade (medium)
List: stats strip (Total, New this month, Repeat customers, Marketing subscribers, Total spend, Average order value) in its own boundary; tabs All, Customers (with an account), Guests, Blocked; columns Customer, Orders, Spent, Last order, Marketing state badge, Tags, Joined; filters Tag (options from all tags in the store, not the page), Marketing state, Segment (added in the segments plan), Location (state), Joined range, Repeat; bulk actions Add tag, Remove tag, Add to segment, Set status (active, blocked), Export selected, Delete (with the guard below). Server-side export of the whole filtered list as a background job (the current export is client-side paging). **CSV import** (Storify left it disabled): name, email, phone, tags, marketing consent only when the file says the contact opted in, with a dry-run report.

Detail: header with stat tiles; **editable** profile (name, phone, email only when not verified or after re-verification), status (active, blocked: a blocked customer cannot log in; checkout is refused with a neutral message), tags editor (chips, autocomplete from the store's tag set), **notes as a timeline** (author, time, text; better than Storify's single box), consent card with history, addresses CRUD by staff, **orders tab** (full history, filters, link to each order), **activity timeline** (orders, returns, quotes, reviews, abandoned checkouts, logins), and a Segments card (manual memberships and the automatic segments this customer currently matches).

Delete: soft delete only when the customer has orders, and it means **anonymise** (name, email, phone replaced, orders kept for accounts and tax); hard delete only for a customer with no orders. Every action writes `audit_logs`. This is also the DPDP erasure path.

### Phase 2: segments
See [CUSTOMERS-SEGMENTS-PLAN.md](CUSTOMERS-SEGMENTS-PLAN.md).

### Phase 3: optional, ask the owner first
Store credit ledger (useful for the manual returns flow: refund to credit), settings page "Customers" (guest checkout allowed, account login methods, default consent tick-box off, default tags), duplicate merge, loyalty points.

## 5. What not to copy from Storify
Vendor and staff-scoped customer views (bsec has no vendors), loyalty tiers (a points programme is a product decision, not an upgrade), preferences like sizes and currency (no shopper-facing use yet), the wishlist counters, the single-boolean `marketingOptIn` legacy shim, and the `Mixed`-typed fields.

## 6. Owner decisions (recommended answer first)

1. **Create guest customers at checkout?** Yes: the list is empty of most buyers otherwise. Costs a migration and a backfill.
2. **Compute customer stats from orders instead of trusting cached counters?** Yes: it is the only way segments are correct.
3. **One consent record with history now?** Yes, before any email is sent: it is cheap now and impossible to reconstruct later.
4. **Store credit now or later?** Later, after Returns is used in real life.
5. **Loyalty points?** Not now.
6. **Customer import from CSV?** Yes, in Phase 1, consent only when the file proves it.
7. **Delete means anonymise when orders exist?** Yes (DPDP erasure without breaking accounts).

## 7. Acceptance criteria (Phase 0 and 1)
- [ ] A storefront COD order that is delivered raises that customer's orders and spend; a cancelled or refunded order lowers or excludes it; a real-database test per case.
- [ ] A guest checkout creates one guest customer per email; a later registration with that email claims it; no duplicate rows.
- [ ] Consent changes go through one function, write a history row and an audit row, and the newsletter form, unsubscribe link and admin switch all agree.
- [ ] Customers list: stats strip, tabs, filters, bulk actions and export as above; URL carries state; mobile 375px works; kit components only (`docs/admin-ui-standards.md`).
- [ ] Detail: edit, tags, notes timeline, consent history, addresses, orders, activity; permissions `customers.write` checked in the domain service; every mutation audited.
- [ ] Delete anonymises when orders exist and the orders still render.
- [ ] New procedures are mapped in `packages/domain/test/isolation.int.test.ts`; `test:heavy` run and the counts reported.
