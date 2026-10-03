# Customer segments: manual and automatic

Builder: Antigravity. Verifier: Claude. Depends on Phase 0 of [CUSTOMERS-SECTION-FINDINGS.md](CUSTOMERS-SECTION-FINDINGS.md) (truthful customer stats, guest customers, one consent record). Storify has no segments (only tags and a loyalty tier), so this is designed from industry practice (Shopify segments, Klaviyo lists and segments), not copied.

## 1. Model

A **segment** is a named group of customers, of one of two kinds:

| Kind | Who is in it | How it is stored | When it updates |
|---|---|---|---|
| **Manual** | Exactly the customers the owner added | Rows in `customer_segment_members` | When the owner adds or removes |
| **Automatic** | Everyone matching a saved set of conditions | A validated JSON rule set on the segment; **no membership rows** | Always current: evaluated live as a query |

Why live evaluation for automatic segments: a stored member list goes stale the moment an order lands, and the owner would have to trust a job. A saved query is always right, and a store has thousands, not millions, of customers. Counts shown in lists are cached (`member_count`, `counted_at`) and refreshed by a pg-boss job and a "Refresh" button, with an "as of" time, so the segments page never runs one query per segment on load.

A customer can be in many segments. Segments never change a customer's data; they only group.

## 2. Schema (expand-only migrations; next free numbers)

All tables use `tenantTable()`, `forceRlsSql`, composite tenant foreign keys (rule 1).

`customer_segments`: `id`, `name` (unique per tenant, case-insensitive), `description`, `kind` (`manual` or `automatic`, check constraint), `rules` jsonb null (required for automatic, null for manual, check constraint), `is_preset` boolean (created from a template; editable, deletable), `member_count` int, `counted_at` timestamptz, `created_by`, `created_at`, `updated_at`. Index `(tenant_id, kind)`.

`customer_segment_members`: `id`, `segment_id`, `customer_id`, `added_by`, `added_at`; unique `(tenant_id, segment_id, customer_id)`; composite foreign keys to the segment and the customer with `on delete cascade`. Only manual segments have rows (enforced in the service; a trigger or check is not needed).

Grants: `app_rw` and `app_platform` as the other tenant tables. Add the tables to `docs/ARCHITECTURE.md` section 7 (the `docs:check` script requires it).

## 3. Rule set (automatic segments)

```json
{ "match": "all", "conditions": [ { "field": "total_spent", "op": "gte", "value": 500000 }, ... ] }
```

`match` is `all` (AND) or `any` (OR); no nesting in v1 (a flat list is what owners can reason about). Maximum 10 conditions.

**Fields, operators, value types** (this whitelist is the whole language; anything else is rejected by the Zod schema):

| Field | Meaning | Operators | Value |
|---|---|---|---|
| `orders_count` | Counted orders (Phase 0 rule) | eq, gte, lte | integer |
| `total_spent` | Lifetime spend, paise | gte, lte, between | integer (UI shows rupees) |
| `average_order_value` | Spend / orders, paise | gte, lte | integer |
| `last_order_at` | Days since the last order | within_days, older_than_days, never | integer |
| `first_order_at` | Days since the first order | within_days, older_than_days | integer |
| `created_at` | Customer joined | within_days, older_than_days, between_dates | integer or two dates |
| `marketing_state` | Consent state (Phase 0c) | is, is_not | subscribed, unsubscribed, not_subscribed |
| `tags` | Customer tags | has, has_not | text |
| `is_guest` | Has no account | is | boolean |
| `state` | State of the default address | is, is_not, in | state codes |
| `pincode` | Default address pincode | starts_with, is | text |
| `bought_product` | Bought a product | has, has_not | product id |
| `bought_collection` | Bought from a collection | has, has_not | collection id |
| `returned` | Has a return request | has, has_not | none |
| `abandoned_checkout` | Left a checkout in the last N days | within_days | integer |
| `in_segment` | Is in another segment | is, is_not | segment id (no cycles; an automatic segment may not reference itself, directly or through others; depth 1 only) |

Rules and tags are compiled to **parameterised SQL** by one function in `packages/domain` (`segments/compile.ts`) from the whitelist; the client never sends SQL or column names; values are bound parameters; unknown fields or operators fail validation. The compiled query runs inside `withTenant` so RLS applies, with a statement timeout (5 s) for previews. Metric fields read the Phase 0 truthful metrics, never the stale cached columns.

## 4. Domain service (`packages/domain/src/segments/`)

All functions check `assertPermission(ctx, "customers.read")` (reads) or `"customers.write"` (mutations) and write `audit_logs` (`segment.created`, `segment.updated`, `segment.deleted`, `segment.members_added` with count and a capped list of ids, `segment.members_removed`). Cache invalidation, where a storefront surface ever reads a segment, goes through `cache-invalidation.ts` (none in v1: segments are admin only).

- `listSegments`, `getSegment`, `createSegment`, `updateSegment` (changing kind is refused once a manual segment has members or an automatic segment exists: the owner makes a new one), `deleteSegment` (members cascade; refused while another automatic segment references it with `in_segment`, with the name shown).
- `previewSegmentRules(rules)`: returns `{ count, sample: first 10 customers }` without saving; same compiler as saving; rate limited per staff user.
- `listSegmentMembers(segmentId, { search, limit, offset, sort })`: for a manual segment reads the membership table; for an automatic segment runs the compiled query. Same row shape as the customers list.
- `addCustomersToSegment(segmentId, customerIds | emails)` and `removeCustomersFromSegment`: manual segments only; idempotent; returns `{ added, alreadyIn, notFound }`. Cap 5000 per call.
- `refreshSegmentCount(segmentId)` and a pg-boss recurring job `segments.refresh_counts` (every 6 hours, per tenant, enqueued in the business transaction path per rule 13) that updates `member_count` and `counted_at`.
- `getCustomerSegments(customerId)`: manual memberships plus the automatic segments that currently match this customer (one query per automatic segment, capped by the 20-segment limit).
- `createPresetSegments()`: see section 6.

Quota: at most **20 segments per store** (owner decision 2026-10-03; a constant now, a plan quota key later). Creating a 21st is refused with a clear message.

## 5. Contracts and API

Contracts first (`packages/contracts/src/admin.ts`, router `segments`): `list`, `get`, `create`, `update`, `delete`, `preview`, `members.list`, `members.add`, `members.remove`, `refreshCount`, `forCustomer`, `presets.create`. Handlers in `apps/web/src/server/api.ts`. Add every new procedure to the isolation suite map (`packages/domain/test/isolation.int.test.ts`); it fails on any unmapped procedure.

## 6. Admin UI (shared kit only; `docs/admin-ui-standards.md`)

New sidebar item **Segments** under the Customers group, permission `customers.read`. Routes with `pendingComponent` (rule 11): `segments.tsx`, `segments_.new.tsx`, `segments_.$segmentId.tsx`.

**Segments list.** Stat cards: Total segments, Automatic, Manual, Customers in at least one segment is not shown (expensive); keep three cheap cards in their own boundary. `DataTable`: Name (with description under it), Type badge (Automatic, Manual), Customers (cached count with "as of" in a tooltip, Refresh row action), Updated, row actions (Open, Duplicate, Delete with `ConfirmDialog` naming the segment). Tabs All, Automatic, Manual. Empty state offers **Start from a template** (the presets) and **Create segment**.

**Create or edit segment (the form).** Full page, two-column like the Product form: sticky header (title, status, Save, Back), unsaved-changes guard.
- Card **Details**: Name (required, unique), Description (optional, 200 chars).
- Card **Type** (radio cards, locked after the first save): *Manual*, "You choose the customers" / *Automatic*, "Customers who match your conditions, always up to date".
- If **Automatic**, card **Conditions**: a "Customers who match [all / any] of these conditions" selector, then one row per condition: field `SimpleSelect` (grouped: Orders and spend, Activity, Marketing, Location, Products, Other), operator `SimpleSelect` (filtered by field), value input of the right type (number, rupee amount, days, date range, tag autocomplete from the store's tags, state select, product and collection pickers), remove button; "Add condition" (max 10). Inline validation per row. Beside or below it, a **live preview** panel: "Matches 142 customers" and the first 10 as a compact list, debounced 500 ms, with a loading and an error state ("Could not preview, try again"); an empty result shows "No customers match yet".
- If **Manual**, card **Members**: search box (name, email, phone) that adds customers one at a time, and a paste box "Add by email" (one per line or comma separated) that reports "12 added, 2 already in, 1 not found (list)". Members table below with remove per row and bulk remove.
- Right rail: **Summary** (type, count, as of), **Use this segment** (links: View customers, Export CSV; "Send email" is shown disabled with the text "Email sending is not set up yet"), **Danger zone** (Delete).

**Segment detail (`$segmentId`).** Same layout in view or edit mode: header with name, type badge, count; tabs **Customers** (a members `DataTable`: Customer, Orders, Spent, Last order, Marketing state, Tags; search, sort, export all as CSV with a consent column; "Marketing: subscribed only" quick toggle), **Conditions** or **Members** (the form cards), **Activity** (audit entries for this segment). Mobile at 375 px: cards stack, the table scrolls inside its card.

**Presets (Start from a template).** Created as ordinary editable automatic segments: *VIP customers* (total spent at least a rupee amount the owner types, default 10,000), *Repeat buyers* (orders at least 2), *New customers* (joined within 30 days), *At risk* (last order older than 90 days and orders at least 1), *Never purchased* (orders = 0), *Marketing subscribers* (marketing state is subscribed), *Abandoned a checkout* (within 14 days).

**Customers list and detail integration.** Customers list gets a **Segment** filter (URL param `segment`), a bulk action **Add to segment** (opens a picker of manual segments, or creates one) and shows no per-row segment column (cost). Customer detail gets a **Segments** card (`forCustomer`): manual memberships with a remove button, and the automatic ones it matches as read-only chips linking to the segment.

## 7. Consent and safety

- Segments are for grouping and export. **No sending exists** (email delivery is not live; rule 14). Anything that will later send to a segment must filter to `marketing_state = subscribed` at send time, not at segment time. The export dialog states this and offers "Subscribed only" on by default.
- A segment never exposes data the viewer cannot already see in Customers; same permission.
- The compiler is the only place SQL is built from rules. Test it with hostile input (unknown field, SQL in a value, 11 conditions, a cycle in `in_segment`).
- Deleting a customer (anonymise or hard delete) removes their manual memberships.

## 8. Tests

Real database (`*.int.test.ts`, `startTestDb`): each field and operator returns the right customers on a seeded store (spend and orders use the Phase 0 metrics; include a guest, a refunded order, a cancelled order); `match: any` versus `all`; manual add, remove, duplicate add, unknown email; `in_segment` including a cycle refused; kind cannot change; delete refused while referenced; cross-store isolation for every procedure (store B cannot list, read, preview into, or add to store A's segment; a segment id from store A used in store B's rule is rejected); statement timeout returns a clean error; audit rows exist. Unit tests for the Zod rule schema and the compiler's output shape. Component tests for the condition builder (field change resets operator and value, max 10, preview debounce). Run `pnpm --filter @bs/domain test:heavy` and report counts.

## 9. Build order

1. Phase 0 of the findings doc (metrics, guest customers, consent record). Do not start segments before 0a, or every number in them is wrong.
2. Migrations, schema, Zod rule schema, compiler with its tests.
3. Domain services and contracts, isolation suite entries.
4. Segments list and the form (manual first, then automatic with preview).
5. Customers list filter, bulk action, detail card, presets, count refresh job.
6. Docs: `docs/ARCHITECTURE.md` (tables, job, routes), change record, `progress.md`.

## 8b. Acceptance criteria

- [ ] An owner can create a manual segment, add customers by search and by pasted emails, and remove them; the report of added, already in and not found is shown.
- [ ] An owner can create an automatic segment with up to 10 conditions, sees a live count and sample before saving, and the saved segment changes membership as orders arrive (test: place and deliver an order, count changes).
- [ ] Every field in the table works and is covered by a real-database test.
- [ ] Segments list, create, detail and the customers integration pass at 375 px and desktop, use the kit only, and every route has `pendingComponent`.
- [ ] No SQL is built from client strings; hostile-input tests pass.
- [ ] Isolation suite maps every new procedure; heavy suite green; counts reported honestly.
- [ ] Export carries a marketing-state column and defaults to subscribed only; no send feature exists.

## 10. Questions for the owner (recommended answer first)

1. **Live automatic segments instead of stored member lists?** Yes (always current, no trust in a job).
2. **Flat conditions only (all or any), no nested groups, in v1?** Yes.
3. **Segments are grouping and export only until email sending is live?** Yes.
4. **Limit per store:** 20 segments (owner decision).
5. **Presets as editable templates, not locked system segments?** Yes.
