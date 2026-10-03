# Finance: double-entry ledger, expenses, reports

Hand-off plan for the **Finance** admin section, derived from the Storify reference app (`Storify/` in this repo). Any agent can build this; the verifier checks each acceptance criterion against the code and runs the gate. Read [`AGENTS.md`](../AGENTS.md) and [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) first; follow [`docs/admin-ui-standards.md`](admin-ui-standards.md) for every screen.

**Architectural decision required first:** write **ADR-020 (store finance ledger)** before Phase 0 code, per `AGENTS.md` §2 and §16. An outline is in §4/D1–D10 of this plan; the ADR records it properly.

**Coordination before you start (2026-10-03):** `progress.md` "In flight" has Antigravity on `feat/customers-phase-0` with **uncommitted edits in the `bsec` worktree** to `packages/domain/src/jobs.ts`, `packages/db/src/queues.ts`, `packages/db/migrations/meta/_journal.json`, `packages/domain/src/orders/checkout.ts` and `progress.md`. This feature touches three of those files (queues, jobs, checkout) and takes migration number **0029** (after their 0028). Build on your own branch/worktree, rebase after their merge lands, and do not edit their files in the shared worktree.

## 0. What this plan delivers

1. **The accounting engine** in `packages/domain` (`src/finance/`): an append-only, double-entry `ledger_entries` table and a posting layer that turns money events into balanced, idempotent entries — fire-and-forget for order-time events, strict for hand-entered ones.
2. **Automatic postings** from the money events that exist in bsec today: a COD order whose payment is collected, a refund being recorded (returns or order refund), a cancellation/return restocking cost. Rules for gateway captures and courier label costs are built but stay dormant until Razorpay/Shiprocket are live (rule 14: do not wire those providers).
3. **Manual money**: expenses (with recurring copies, settle/unsettle, receipt upload) and balance adjustments — the only two things a merchant types straight into the books.
4. **A Finance section in the store admin**: Overview (P&L for a period, cash position, who owes whom, anomaly banner), Expenses workbench, Reports (tax summary, CSV exports, month-end close), all on the shared UI kit with URL state.
5. **A daily reconcile job** (pg-boss) that replays recent money events through the same rules — which is also the historical backfill, because every posting is idempotent.

Nothing here moves money. No gateway is called. The section is the store's books: a record of what happened and what is owed.

## 1. Reference: what Storify does, and what we keep

Storify's finance module (`Storify/lib/finance/`, `Storify/models/*`, `Storify/app/[locale]/admin/finance/`) is a double-entry accounting system for a **marketplace**: a 24-account fixed chart of accounts, entries written by pure "posting rules" with deterministic idempotency keys, two books (`own` store vs `marketplace`), fiscal-period close, expenses with receipts/recurrence/settlements, reports computed purely as ledger groupings, a stateless reconcile cron, and a vendor payout/commission-invoice engine on top.

### 1.1 Keep (these are the load-bearing ideas)

| Idea | Where in Storify | Why it matters |
|---|---|---|
| Append-only entries; one positive amount, a debit account and a credit account | `models/ledger-entry.model.ts` | Corrections are reverse postings, never edits; the trial balance is free |
| Deterministic idempotency key: `kind:sourceId:purpose[:part]`, unique index | `ledger.ts` `postingKey`, unique on `key` | Makes fire-and-forget writes, replays and backfill all safe (`ON CONFLICT DO NOTHING` in Postgres) |
| Posting never fails the caller (orders keep existing even if entries fail); `strict` mode only for hand-entered records | `ledger.ts` `postLedgerEntries` | An order a shopper paid for must exist even if its entries could not be written |
| Pure posting rules: documents in, entries out; no DB reads/writes | `postings.ts` header | Live path and replay run identical code; testable without a database |
| Period close shifts, never locks: an entry dated into a closed month lands at `closedThrough + 1s` with a note; close stores a P&L snapshot; reopen newest-first only | `ledger.ts` `applyPeriodClose`, `models/fiscal-period.model.ts`, `api/admin/finance/periods` | Closed figures stay as filed; late money is still recorded |
| Exact-sum allocation with the biggest share absorbing rounding | `postings.ts` `allocate` | Partial splits must sum back to the total or the trial balance breaks |
| Expense edit = reverse old revision + post new; delete = reverse; settle = separate postings; revision rides in the key | `postings.ts` `expensePostings`, `expense-ledger.ts` `healExpenseLedger` | The ledger stays append-only while the expense record is editable |
| Recurring expenses: template + generated copies, unique (template, date), catch-up capped per tick | `recurring-expenses.ts`, `recurring-schedule.ts` | Rent every month without dupes or unbounded catch-up |
| Reports are groupings of the ledger, never summed across currencies | `reports.ts` | P&L, cash position, tax summary, anomalies, cost coverage all read one table |
| Stateless reconcile: recent pass (3 days) + rotating 30-day deep sweep, budget-checked between documents | `ledger-reconcile.ts`, `app/api/cron/finance/route.ts` | Self-healing books with no cursor table; first run over all history = backfill |
| Anomaly detection: negative cash/liability/receivable balances flagged, not silently accepted | `reports.ts` `findLedgerAnomalies` | A wrong rule shows itself as an impossible balance |
| CSV with BOM, RFC 4180 quoting, truncation signalled in filename *and* a final row | `lib/finance/csv.ts` | Accountant-friendly exports that don't lie |

### 1.2 Drop (and why)

| Dropped | Why |
|---|---|
| `own` vs `marketplace` **books**, `vendor_payable`, `commission_receivable`, payouts, commission invoices, vendor finance pages | bsec tenants are **single-vendor D2C stores**; there is no vendor concept to split revenue with. The `book` column is still created (default `'own'`) so a future marketplace does not need a migration of history |
| Store credit postings (`store_credit_payable`, goodwill/expiry) | Owner decision 2026-10-02: no store credit in bsec (returns plan D3, customers plan) |
| Multi-currency FX columns (`baseCurrency`, `fxRate`) and per-currency switches | Every bsec store is INR (`store_settings.currency`, orders default `INR`). The `currency` column stays on entries so reports keep grouping by it; v1 assumes one currency per store |
| POS channel cash-account rules | bsec has no POS channel |
| Duty (`duty_payable`), customs decompositions | No import duty in bsec orders |
| Boost/subscription income accounts and platform-payment postings | SaaS billing is **platform** money (`platform_invoices`), not store money; keep it out of the store's books |
| Chargeback/dispute postings | Needs a gateway; build with Razorpay, not before |
| Multi-vendor `book`/`scope` toggles in the expense UI | Single book; the API always uses `own` |
| Inventory **transfer** write-offs | bsec has no inventory transfers |
| Commission reprojection | No commissions |

## 2. What bsec has (verified 2026-10-03, from code)

- **Money is `bigint` paise** everywhere (`orders.subtotal/grandTotal`, `refunds.amount`, `variants.cost_price`). All finance amounts must be paise `bigint` too — no floats, ever. Storify's `quantizeToCurrency` becomes **integer paise arithmetic**; `allocate()` must split integers with the remainder on the biggest share and sum back exactly.
- `orders` (`packages/db/src/schema/orders.ts`): clean money columns — `subtotal`, `discountTotal`, `shippingTotal`, `taxTotal`, `grandTotal`, `codFee` — plus `status`, `paymentStatus`, `placedAt`, `cancelledAt`. Per-item GST is already split: `order_items.cgst/sgst/igst/taxRateBps`. **No cost snapshot on order lines** (gap F3).
- `variants.costPrice` exists (`packages/db/src/schema/catalog.ts:228`, nullable) — the COGS source.
- `payment_intents` / `payment_attempts` / `refunds` (`schema/payments.ts`): refunds carry `method` (`upi|bank_transfer|cash|original_payment_method|other`), `reference`, nullable `intentId` (returns work, 2026-10-02) — enough to record manual refunds and to pick the cash account they came out of.
- Returns record **manual** refunds capped at what was paid (`orders/return-state-machine.ts`, `docs/ORDERS-RETURNS-PLAN.md`); COD is collected when an order is marked delivered (`orders/manual-lifecycle.ts`); manual orders can be created with "Payment received" (D4, `docs/ORDERS-ALL-ORDERS-PLAN.md`).
- `invoices` (GST invoice records, `schema/shipping.ts:219`) and `number_sequences` (gapless per-tenant numbering) exist; invoice PDFs do not (out of scope here).
- **Private media pattern exists**: return photos use a private R2 bucket, presigned PUT, finalize with magic-byte check, 15-minute signed GETs (`packages/domain/src/media/`, ARCHITECTURE §11 "Return photos"). Expense receipts reuse exactly this.
- Jobs: queue registry `packages/db/src/queues.ts` + handlers `packages/domain/src/jobs.ts` (ADR-006); daily schedules already exist (preorder reminder 06:00, return-photo cleanup 03:00).
- Permissions `STORE_PERMISSIONS` (`packages/auth/src/index.ts`) — **no finance permission yet** (gap F1). `analytics.read` and `exports.run` exist.
- Admin kit: `DataTable`, `MetricCard`, `ScrollTabs`, `ConfirmDialog`, URL state, `pendingComponent` (`docs/admin-ui-standards.md`).
- Audit: rule 6 — store mutations that change money write `audit_logs`.
- **No finance tables anywhere** (`docs/ARCHITECTURE.md` §7); latest migration on disk is `0027` in docs, `0028_customers_phase0.sql` uncommitted in the tree → finance takes **0029**.

### 2.1 Gaps this plan closes

| # | Finding |
|---|---|
| F1 | No finance permission; today any `store_admin` could see books. Add `finance.read` / `finance.write` to `STORE_PERMISSIONS` and enforce with `assertPermission` in every domain service. |
| F2 | No ledger; the dashboard has no P&L, cash position or "who owes whom". |
| F3 | `order_items` has no cost snapshot, so COGS would read today's `variants.cost_price` and silently rewrite history when a cost is edited. |
| F4 | Refunds and COD collections leave no accounting trace; the merchant cannot answer "where did the money go". |
| F5 | No place to record rent, ads, salaries, software — the expenses a GST filing needs. |
| F6 | No GST-oriented tax summary (CGST/SGST/IGST per period) although every order item already carries the split. |
| F7 | No month-end close, so figures can drift under a report someone already filed. |
| F8 | No receipts storage for expense evidence. |
| F9 | No reconciliation/self-healing, so a missed posting stays missing forever. |

## 3. Design

### 3.1 Chart of accounts (fixed in code, `packages/domain/src/finance/accounts.ts`)

Fixed constants, not rows in a table — a merchant cannot invent accounts (same as Storify). Types: `asset`, `liability`, `income`, `expense`. `debitSign()` = +1 for asset/expense, −1 otherwise.

| Account | Type | Used for in bsec |
|---|---|---|
| `cash_on_hand` | asset | COD notes the courier/owner collected; cash refunds |
| `cash_gateway` | asset | Online payments (dormant until Razorpay; UPI refunds recorded as gateway out) |
| `cash_bank` | asset | Bank-transfer payments/refunds, gateway settlements (via adjustment) |
| `inventory` | asset | Stock at cost (own purchases and COGS reversals) |
| `tax_payable` | liability | GST charged to shoppers, owed onward (CGST+SGST+IGST as one liability; the split is reporting, D6) |
| `accounts_payable` | liability | Unpaid bills (expense recorded, not yet paid) |
| `product_revenue` | income | Merchandise revenue on own sales |
| `shipping_income` | income | Shipping charged + COD fee (D7) |
| `refunds` | income (contra) | Money handed back; typed income so it reduces revenue without inflating expenses |
| `cost_of_goods` | expense | Line-cost snapshots on sale |
| `operating_expense` | expense | Hand-entered expenses (default debit) |
| `processing_fees` | expense | Gateway cut (dormant until Razorpay) |
| `shipping_cost` | expense | Courier label cost (dormant until Shiprocket) |
| `promotions` | expense | Reserved (discounts are already inside `product_revenue` net; a future store-funded-coupon split will need it — D8) |

Deliberately absent vs Storify: `vendor_payable`, `commission_receivable`, `commission_income`, `customer_receivable` (no deposit pre-orders — bsec pre-orders charge nothing early), `duty_payable`, `store_credit_payable`, `boost_income`, `subscription_income`, `chargeback_losses`. `LEDGER_ACCOUNTS` is derived from the map so validation cannot half-accept a new name.

### 3.2 Data model (`packages/db/src/schema/finance.ts`, migration `0029_finance.sql`)

All three are **tenant tables** (`tenantTable()` + `forceRlsSql` in the migration, `docs/migrations.md`; expand-only, no edits to existing tables).

**`ledger_entries`** — the spine.
- `id` uuid v7 pk; `tenant_id`; `date` timestamptz not null (the money-event date, never `created_at`); `book` text not null default `'own'` (reserved, D1); `debit` text not null; `credit` text not null; `amount` bigint not null (paise, check `amount > 0`); `currency` text not null default `'INR'`; `source_kind` text not null (`order | refund | expense | adjustment | shipment`); `source_id` uuid null; `source_ref` text null (human reference: order number, expense description); `key` text not null; `note` text null (≤ 500 chars, check constraint); `created_at`.
- Constraints: check `debit <> credit`. **Unique `(tenant_id, key)`** — the idempotency line.
- Indexes: `(tenant_id, book, date)`, `(tenant_id, debit, date)`, `(tenant_id, credit, date)`, `(tenant_id, source_kind, source_id)`.
- App Corollary of "append-only": no `updated_at`, and no code path ever UPDATEs or DELETEs a row (corrections are reversal entries).

**`expenses`**
- `id`; `tenant_id`; `date` date not null; `category` text not null (enum below); `amount` bigint not null (paise, ≥ 0); `currency` text not null default `'INR'`; `description` text not null (2–300); `payee` text null (≤ 200); `paid_from` text not null default `'bank'` (`bank | cash | gateway | unpaid`); `receipt_media_id` uuid null → FK `(tenant_id, receipt_media_id)` → `media` (private-bucket receipt, §3.7); `settlement` jsonb null (`{paidAt, paidFrom, sequence, settledBy}`); `settlement_sequence` integer not null default 0; `recurring` jsonb null (`{enabled, interval: weekly|monthly|quarterly|yearly, nextDueAt, endsAt}`); `template_id` uuid null (set on generated copies); `note` text (≤ 1000); `revision` integer not null default 0; `debit_account` text null (the account the posting used, **stored not re-derived**, so a later chart change cannot break reversals); `created_by` uuid not null; `updated_by` uuid null; timestamps.
- Categories (fixed enum, `finance/expense-categories.ts`): `premises, people, marketing, software, inventory_purchase, shipping_supplies, bank_fees, professional, equipment, travel, taxes, other`. `inventory_purchase` debits `inventory` (an asset until sold); everything else defaults `operating_expense`.
- Unique **partial** `(tenant_id, template_id, date)` where `template_id is not null` — one copy per template per day. Index `(tenant_id, date desc)`, `(tenant_id, category, date)`.

**`fiscal_periods`** — one row per closed month; absence of a row = open (a store that never closes carries no state).
- `id`; `tenant_id`; `period_from` date; `period_to` date (inclusive last instant); `label` text (`YYYY-MM`, UTC); `closed_at` timestamptz; `closed_by` uuid; `snapshot` jsonb (`[{currency, income, expenses, net}]` at close time); `note` text (≤ 500).
- Unique `(tenant_id, label)`; index `(tenant_id, period_to desc)`.

**Expand migration on `orders`** (separate expand step, F3): `order_items.cost_price bigint null` — snapshot of the variant's cost at placement. Only new orders carry it; never backfilled (old sales have unknown margin, like Storify's uncosted lines, and the cost-coverage report says so).

### 3.3 Posting engine (`packages/domain/src/finance/ledger.ts`)

Port Storify's `ledger.ts` to Drizzle/Postgres:

- `postingKey(kind, id, ...parts)` → `[kind, id, ...parts].join(":").toLowerCase()`. Derived from the source document and what the entry is *for*, never a timestamp.
- `postLedgerEntries(postings, { strict })`: filter unusable (no key, `amount <= 0`, missing currency, `debit === credit`), apply `applyPeriodClose`, then **`INSERT ... ON CONFLICT (tenant_id, key) DO NOTHING`** as one batch (`insert ... values ... on conflict` multi-row, or `db.insert(...).values(rows).onConflictDoNothing()`). Count only inserted rows. Duplicates are the design working, not errors. `strict` rethrows non-duplicate failures (expenses, adjustments — the person typing must know).
- `applyPeriodClose(posting, closedThrough)`: a posting dated ≤ the newest closed `period_to` is **not refused and not backdated** — it is re-dated `closedThrough + 1s` with note `Dated YYYY-MM-DD, posted after the period close` (caller's note truncated to fit 500). `closedThrough` is cached in-process for 60 s; the close/reopen services invalidate it (same node/process caveat: the worker may hold its own copy for up to 60 s — acceptable, a shifted entry is corrected by the next reconcile pass, D9).
- `getTrialBalance(filter)`: per-account signed sums (SQL `GROUP BY` over a `UNION ALL` of debit-side and credit-side, or two grouped queries). `balanced = |total| < 5 paise`. Run by the reconcile job and logged; not a user-facing gate.
- **`allocate(amountPaise, weights)`**: integer math — proportional floor, distribute the remainder one paise at a time to the biggest weights so shares sum back exactly (Storify gives it all to the single biggest; either is fine, document which). Never floats.

### 3.4 Posting rules v1 (`packages/domain/src/finance/postings.ts`)

Pure functions: loaded documents in, `LedgerPosting[]` out. One decomposition shared by sale and refund, like `decomposeOrder`, but simple — bsec orders already carry the split as columns:

```
merchandise = subtotal − discountTotal
shipping    = shippingTotal (+ codFee, D7)
tax         = taxTotal
grand       = grandTotal          // invariant: merchandise + shipping + tax === grandTotal
```

Verify that invariant holds in `orders/checkout.ts` (it is how checkout computes totals); if a legacy row violates it, book the residual into `product_revenue` and note the entry (never drop the difference).

| Event (trigger in code) | Entries (D / C) | Key |
|---|---|---|
| **Order money collected** — COD marked delivered (`orders/manual-lifecycle.ts`), manual order created "Payment received" (All Orders D4), later: Razorpay capture webhook (dormant) | `cash_on_hand` (COD) or `cash_gateway` (online) / `product_revenue` = merchandise; same cash / `tax_payable` = taxTotal; same cash / `shipping_income` = shippingTotal + codFee; **COGS**: `cost_of_goods` / `inventory` = Σ(`order_items.cost_price` × qty, only lines with a snapshot) | `order:{orderId}:revenue`, `:tax`, `:shipping`, `:cogs` |
| **Refund recorded** — returns `refund` action (`orders/return-state-machine.ts`), order refund (`refunds` insert with status succeeded) | Mirror of the sale, prorated over **what is left** after earlier refunds (port `refundBacks`): `refunds` / cash = merchandise share; `tax_payable` / cash = tax share; shipping share: `shipping_income` / cash. Cash account from `refunds.method`: `cash`→`cash_on_hand`, `bank_transfer`→`cash_bank`, `upi|original_payment_method`→`cash_gateway`, `other`→`cash_on_hand` | `refund:{refundId}:merchandise`, `:tax`, `:shipping` |
| **Restock with cost** — order cancelled (after payment) or return received with restock | `inventory` / `cost_of_goods` = returned/cancelled lines' cost snapshot, capped at the COGS actually posted for that order | `order:{orderId}:cogs-back:{cancel|return-{returnId}}` |
| **Expense created / edited** | `debit_account` (default `operating_expense`; `inventory_purchase`→`inventory`) / `accounts_payable` if `paid_from = unpaid` else the cash map (`cash`→`cash_on_hand`, `gateway`→`cash_gateway`, else `cash_bank`) | `expense:{expenseId}:v:{revision}`; reversal flips sides, key suffix `:reversal`, **dated with the revision it cancels** |
| **Expense settled / unsettled** | `accounts_payable` / cash map of `settlement.paidFrom`, dated `paidAt` | `expense:{expenseId}:settle:{sequence}` (+ `:reversal`) |
| **Adjustment** | Any two distinct accounts, positive amount, reason required; presets: gateway→bank settlement, cash→bank, tax paid to the government (`tax_payable` / `cash_bank`), write off a bad debt/receivable, custom | `adjustment:{adjustmentId}` — the one `strict` poster that throws on refusal |
| *(dormant)* Gateway capture / label cost | `processing_fees` & `shipping_cost` rules written and unit-tested, not wired to any trigger (rule 14) | `order:{id}:processing-fee`, `shipment:{id}:label` |

Everything order-time is fire-and-forget (`…Safely` wrappers log-and-swallow); expenses/adjustments are strict. **Triggers are enqueued via pg-boss inside the business transaction** (rule 13): a `finance.post` job carrying `{kind, id}` whose handler loads the document and posts — the same bridge the reconcile job calls, so live and replay cannot drift (Storify's `post-events.ts` pattern).

### 3.5 Reconcile + backfill (`finance/reconcile.ts`, job `finance.reconcile`)

Port the stateless design: **no cursor table**. One daily job:

1. `runRecurringExpenses(now)` — materialize due copies (catch-up, ≤ 12 per template per tick, unique `(tenant_id, template_id, date)` absorbs races), advance `nextDueAt`, disable past `endsAt`.
2. Recent pass: replay every money event updated in the last 3 days through the posting bridges, 2 000 documents per scan, budget-checked between documents (stop and continue tomorrow).
3. Deep sweep: one rotating 30-day slice per day (`dayNumber % 30`), so a month of runs covers ~2.5 years; the **first run over all history is the backfill** for stores that predate the feature.

Scans (all per-tenant under RLS, ordered, each capped): orders collected (payment received/delivered COD), refunds succeeded, refunds reversed (only if entries exist), cancellations/restocks, expenses (+heal: any stored entry whose key is not the current revision's live set and lacks a `:reversal` twin gets one), adjustments. Because every key is deterministic, overlap writes nothing. Returns `{written, scanned, stoppedEarly}`; log written > 0 at warn so a systematic miss is visible.

### 3.6 Reports (`finance/reports.ts`) — groupings of the ledger, plus two order-table reads

Period resolution (shared helper, URL-driven): named `7d | 30d | 90d | ytd | all` or custom `from`/`to` (end-of-day inclusive, store timezone for day boundaries, UTC instants inside).

| Report | Output |
|---|---|
| **Profit & loss** (`getProfitAndLoss`) | Per currency: income lines (credits − debits on income accounts), expense lines, totals, net; contra `refunds` shown as a negative income line "Refunds". Zero lines dropped. |
| **Cash position** (`getCashPosition(asOf)`) | Balances, not period sums: gateway / bank / on-hand / inventory (assets), tax payable / unpaid bills (liabilities), plus **who owes whom** is in the overview (below). Negative values are anomalies, not displayed as normal. |
| **Tax summary** (`getTaxSummary`) | Two parts: ledger `tax_payable` (collected − refunded = owed onward); and **GST split read from `order_items`** (Σ cgst, sgst, igst by month, orders not cancelled) — the number an Indian CA asks for. Refunds' tax share is prorated (`taxTotal / grandTotal`) and shown as its own line. |
| **Cost coverage** (`getCostCoverage`) | Share of collected revenue whose lines have no `cost_price` snapshot → warning banner "Cost of goods is missing for ₹X (Y%)", never a silent 100 % margin. |
| **Anomalies** (`findLedgerAnomalies`) | Negative cash / negative liability accounts, from computed balances. Rendered as a destructive banner on the overview, with the adjustment dialog one click away. |
| **Trial balance** | For the reconcile log and a debug section in Reports (per-account signed totals + `balanced` flag). |

Overview "Owed" block (v1, no vendors): **You owe** = tax collected (`tax_payable`) + unpaid bills (`accounts_payable`); **Owed to you** = nothing yet (no receivables exist in v1 — section reserved). GMV card reads orders directly (placed, not cancelled — **GMV is not revenue**, keep Storify's wording).

### 3.7 Expenses (domain `finance/expenses.ts`, UI `/finance/expenses`)

- Create/edit/delete/settle exactly on the Storify lifecycle (§1.1): edits that move money bump `revision` and post reversal + new strictly; delete reverses first (nothing is deleted if the reversal fails); settle posts `accounts_payable` down and locks `amount/currency/category/paid_from`; unpaid-bill list = `paid_from = 'unpaid' and settlement is null`.
- Recurring: template row (`recurring.enabled`, interval, `endsAt`) + generated copies (`template_id`, `recurring.enabled = false`). The form previews "Next copy: …" and offers backfill of already-due copies (created ≤ 12 per tick by the daily job). Copies refuse schedule edits.
- **Receipts**: reuse the return-photos private-bucket pattern — presigned PUT to `tenants/<tenantId>/expense-receipts/<uuid>`, finalize verifies magic bytes (pdf/png/jpeg/webp only, ≤ 5 MB), stores a `media` row, `expenses.receipt_media_id` points at it; admin views via 15-minute signed URL through a dedicated authenticated route. No public URLs. Unattached uploads cleaned by the existing daily media sweep pattern (add `finance.receipt_cleanup` to the same job as §3.5 if a separate queue is not justified).
- Totals footer: filtered totals per currency, with the "stock bought is inventory, not cost" caveat for `inventory_purchase`.

### 3.8 Adjustments (UI: dialog on the overview header; API `finance.adjustments`)

Presets fill the debit/credit pair (visible and editable): **Settled gateway to bank** (`cash_gateway` / `cash_bank`), **Cash deposited to bank**, **Tax paid** (`tax_payable` / `cash_bank`), **Write off** (custom pair), **Custom**. Vendor-account pairs do not exist in v1 (no vendor accounts). Reason required (4–500) — it is the note on the entry. Strict posting: a refusal is an error the user sees. List = ledger entries with `source_kind = 'adjustment'`, newest first.

### 3.9 Period close (`/finance/reports`, "Month-end" card)

- Close: pick a **finished** month (closable = last 36 finished months minus closed, newest first). The UI shows the exact snapshot that will be stored (P&L totals per currency, computed live). POST → insert row (unique label; conflict = 409 "already closed"), invalidate the 60 s `closedThrough` cache, audit. Nothing is locked or deleted.
- Reopen: newest closed month only (an older close behind an open one makes "closed through" meaningless); deletes the row; entries already shifted into the open period are **not** moved back (the confirm dialog says so).
- Closed-months table: month, closed at, note, snapshot ("Net at close"). Older months closable via a select with the warning that their figures are recorded as they stand now.

### 3.10 Contracts and API (`packages/contracts` → `apps/web/src/server/api.ts`)

Contracts first (`AGENTS.md` §3): add `financeContract` to `packages/contracts/src/admin.ts` (or a new `finance.ts` re-exported — follow the file's existing organisation), mount under `admin.finance.*`; the admin client types come from the contract.

| Procedure | Notes |
|---|---|
| `finance.overview` | { period, currencies, profitAndLoss, cashPosition, anomalies, taxSummary, gmv, costCoverage } — one call for the overview screen |
| `finance.ledger.list` | Paged, filters: book, account, source kind, date range (drill-down from any report line) |
| `finance.expenses.list` | Paged + search + category/paidFrom filters + per-currency totals + all-time outstanding |
| `finance.expenses.create/update/delete` | `finance.write`; create/delete strict |
| `finance.expenses.settle / unsettle` | `finance.write` |
| `finance.expenses.receipt.presign / finalize` | Mirrors the returns photo endpoints' shape |
| `finance.adjustments.list / create` | `finance.write`; create strict |
| `finance.periods.list / close / reopen` | `finance.write` (close/reopen audited) |
| `finance.currencies` | Distinct entry currencies (drives the adjustment currency selector; trivially `['INR']` today) |

CSV export stays a **plain route**, not oRPC (binary download): `apps/web/src/app/api/admin/finance/export/route.ts` with `?type=ledger|expenses&period=…|from&to`, `assertPermission('exports.run')` (or `finance.read`; D10), BOM + RFC 4180 quoting, hard 20 000-row ceiling signalled in the filename (`-partial-N-of-M`) and a final `TRUNCATED` row.

### 3.11 Admin UI (`apps/admin/src/routes/_store/finance*.tsx`)

Nav group **Finance** (icon: banknote), after Orders. Every route declares `pendingComponent`; shared kit only — `DataTable`, `MetricCard`, `ScrollTabs`, `ConfirmDialog`, `simple-select`, URL state, no `window.confirm`, no native `<select>`.

- **`/finance` (Overview)**: header with period picker (`7d/30d/90d/ytd/all` + custom range, all in the URL like the orders list) and the "Adjust balances" dialog button. Sections: anomaly banner (destructive, first); hero card (Net for the period + Income/Costs with proportional bars); "Where it came from / went" (P&L lines with bars, click → ledger drill-down); "What the business is holding" (gateway / bank / cash in hand / stock at cost — stock excluded from the cash total, shown only if non-zero); "Owed" card (tax collected, unpaid bills; hidden at zero); GMV card with the "counted when the order was placed" caveat; cost-coverage warning when uncosted.
- **`/finance/expenses`**: stats row (this period total, unpaid outstanding all-time), `DataTable` (date, description + payee + schedule badge, category badge, paid-from with settlement status, receipt link, amount), search + category/paidFrom filters, outstanding banner ("₹X recorded but not paid — show them" → `?period=all&paidFrom=unpaid`), create/edit dialog (category select without default, paid-from, receipt upload, repeats section with backfill checkbox and next-copy preview, contextual notes for closed-period booking and stock-is-inventory), settle dialog ("Mark as paid": date bounded by bill date→today, paid-from), delete/unsettle confirms describing the reversal semantics.
- **`/finance/reports`**: period-scoped half (tax summary with visible arithmetic `collected − refunded = owed onward`, GST CGST/SGST/IGST monthly table, ledger + expenses CSV download rows, ledger trial balance) + "Month-end" half (period close panel per §3.9, not affected by the period picker).

### 3.12 Permissions, audit, tests

- `packages/auth/src/index.ts`: add `finance.read`, `finance.write` to `STORE_PERMISSIONS` (both system roles get them automatically — review whether `store_admin` should; default yes, flag to owner in the change record). Enforce `assertPermission(ctx, "finance.write")` **in the domain services** for every mutation and `finance.read` for reads (rule 4). CSV: `exports.run` (D10).
- Audit rows (`audit_logs`) on: expense create/update/delete/settle/unsettle, adjustment create, period close/reopen — money changed, so rule 6 applies. Order-time postings carry the order's own audit trail; they write none of their own.
- Tests (real Postgres, `*.int.test.ts`, one package at a time):
  - `finance-ledger.int.test.ts`: idempotency (same key twice → one row), period-close shift + reopen, trial balance balances, `allocate` sums exactly in paise, RLS: tenant A's entries invisible to tenant B and cross-tenant insert rejected.
  - `finance-postings.int.test.ts`: order collected → expected entries; refund prorated over remaining parts (two partial refunds); refund cannot exceed what is left; restock capped at posted COGS; invariant-residual booking when totals do not sum.
  - `finance-expenses.int.test.ts`: create/edit (revision + reversal)/delete/settle/unsettle ledger state; recurring generation catch-up cap; heal path.
  - `finance-reconcile.int.test.ts`: replay writes nothing on a healthy set; deletes an entry row manually → replay restores it; backfill over pre-feature orders.
  - Queue consumer test in `queue-consumers.int.test.ts` for the new job; audit-coverage style assertions for the new admin procedures; contract/`admin` route tests per repo pattern.
- Pure unit tests for posting rules and `allocate` (no DB), like Storify's.

## 4. Decisions

| # | Decision | Taken |
|---|---|---|
| D1 | **Single book, column reserved** | One book per store (`book` defaults `'own'`, never exposed in v1). Marketplace payouts/commissions are out of scope; the column avoids rewriting history if that ever changes. ADR-020 records this. |
| D2 | **Paise integers, never floats** | All amounts `bigint` paise; `allocate()` distributes integer remainders exactly. |
| D3 | **COGS from a new `order_items.cost_price` snapshot** | Expand migration; only new orders carry it; old sales show in cost-coverage as uncosted. Reading live `variants.cost_price` would rewrite history. |
| D4 | **Tax is one `tax_payable` liability; the GST split is reporting** | CGST/SGST/IGST already live on `order_items`; the tax summary reads them there instead of tripling ledger accounts. CA review can revisit. |
| D5 | **INR-only v1, `currency` column kept** | Reports still group by currency so a future store currency change cannot silently merge sums. |
| D6 | **COD fee counts as `shipping_income`** | It is charged to the shopper and collected with shipping; splitting it into its own account is a report-level refinement, deferred. |
| D7 | **`promotions` account reserved, unused** | bsec discounts are already net in `product_revenue`. If the owner later wants store-funded-coupon accounting (Storify's model), the account exists and the rule is additive under new keys. |
| D8 | **Postings go through pg-boss, not inline** | Rule 13. A `finance.post` job per event, handler shared with the reconcile pass — one code path. |
| D9 | **60 s `closedThrough` cache, accept the race** | A posting that lands in a just-closed month within 60 s is shifted one second late by the reconcile pass; cheaper than a DB round trip on every post. Documented, not hidden. |
| D10 | **CSV export permission = `exports.run`** | It is an export; `finance.read` guards the screens. Owner can overrule. |
| D11 | **No feature flag** | Admin-only surface, no storefront change; permission-gated is enough (ADR-011 fallbacks n/a). |
| D12 | **Credit notes / GST filing exports** | Out of scope (returns plan D2 still open with the CA). The tax summary is the stopgap. |

## 5. Build order (each phase: branch, gate, change record)

1. **Phase 0 — ADR-020 + engine.** ADR-020; schema `finance.ts`; migration `0029_finance` (+ `order_items.cost_price` expand); `accounts.ts`, `postings.ts`, `ledger.ts`; unit + `finance-ledger.int.test.ts`. No UI, no wiring. *(Touches `packages/db`, `packages/domain`, `packages/auth` — none of Antigravity's in-flight files except the migration journal, which is sequential anyway.)*
2. **Phase 1 — wiring.** `finance.post` job + queue registration (`queues.ts`, `jobs.ts` — **coordinate with `feat/customers-phase-0`**); triggers from COD collection, manual "Payment received", refund recording, cancel/restock; reconcile service + `finance.reconcile` schedule; backfill = first deep sweep; tests.
3. **Phase 2 — overview & adjustments.** Contracts, `finance.overview` + adjustments, `/finance` screen, period picker, anomaly banner; audit rows.
4. **Phase 3 — expenses.** CRUD + settle + recurring + receipts (private bucket) + `/finance/expenses`; tests.
5. **Phase 4 — reports & close.** Tax summary (GST split), CSV export route, month-end close panel, ledger drill-down; `docs:check` and `ARCHITECTURE.md` sections 7, 8, 9, 11, 12 updated; `progress.md` status.

## 6. Not built (explicitly)

Marketplace payouts, commission invoices, vendor finance; store credit; multi-currency/FX; Razorpay capture & fee postings (rules dormant), chargebacks; Shiprocket label cost postings (rules dormant); POS; deposit pre-orders / customer receivables; GST credit notes and GSTR filing exports; budgets/forecasts; platform SaaS billing shown in store books; invoice PDFs.

## 7. Acceptance criteria

- [ ] ADR-020 written before Phase 0 code; this plan's deviations recorded in it.
- [ ] `ledger_entries`, `expenses`, `fiscal_periods` are tenant tables (`tenantTable()` + `forceRlsSql` in migration `0029`); the isolation suite covers all three (cross-tenant read = 0 rows, cross-tenant insert rejected, `relforcerowsecurity` asserted).
- [ ] Every posting has a deterministic key, unique per `(tenant_id, key)`; replaying any event twice writes one row (real-DB test).
- [ ] A posting dated inside a closed period lands at `closedThrough + 1 s` with the explanatory note; reopen (newest only) removes the boundary; entries are never moved back (test).
- [ ] All money is paise integers; `allocate` shares always sum exactly to the input (property test with adversarial remainders); no float arithmetic anywhere in `finance/` (review).
- [ ] Collecting a COD order posts revenue + tax + shipping(+COD fee) + COGS entries that sum to `grandTotal`; refunding twice posts only the remaining parts; a refund larger than what is left is refused server-side.
- [ ] Order-time posting failures never fail the order (fire-and-forget, logged); expense/adjustment failures reach the admin (strict, `LEDGER_WRITE_FAILED` semantics documented).
- [ ] Expenses: edit posts reversal + new revision; delete reverses first; settle locks the money fields; recurring generates catch-up copies capped at 12 per template per tick with one copy per (template, date); receipts are private, magic-byte-checked, ≤ 5 MB, pdf/png/jpeg/webp only, served only via short-lived signed URLs to `finance.read` holders.
- [ ] Adjustments require two distinct accounts, a positive amount and a reason; every preset produces the documented debit/credit pair.
- [ ] Reports: P&L, cash position, tax summary (ledger + CGST/SGST/IGST from `order_items`), cost coverage, anomalies, trial balance — all computed from the ledger (GST split from `order_items`), never summing across currencies; overview figures match a seeded scenario exactly (test fixture).
- [ ] Period close stores a P&L snapshot and refuses unfinished months and duplicates; reopen is newest-only and audited.
- [ ] The daily job materializes recurring expenses, runs the recent pass and the rotating deep sweep; deleting a ledger row is repaired by the next pass (test); the job is registered in `QUEUES`/`QUEUE_NAMES` with a consumer test.
- [ ] Permissions: every finance read asserts `finance.read`, every mutation `finance.write` **in the domain service**; CSV requires `exports.run`; a `store_admin` without the permission gets 403 from the API and no Finance nav.
- [ ] Every expense/adjustment/period mutation writes an `audit_logs` row (rule 6).
- [ ] Admin screens follow `docs/admin-ui-standards.md` (shared kit, URL state, `pendingComponent`, no `window.confirm`, no native `<select>`); exercised by hand in the browser and reported honestly.
- [ ] CSV exports carry a BOM, quote per RFC 4180, and signal truncation in filename and final row at 20 000 rows.
- [ ] Gate passes (`pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`, touched packages' tests one at a time); `docs/ARCHITECTURE.md` sections 7, 8, 9, 11, 12 updated; change record in `docs/changes/`; `progress.md` updated.
- [ ] No secrets, no generated files, no unrelated edits; Razorpay/Shiprocket untouched (rule 14).

## 8. Storify reference map (read alongside, in this repo)

| Concern | Files |
|---|---|
| Chart, books, signs | `Storify/lib/finance/accounts.ts` |
| Pure posting rules | `Storify/lib/finance/postings.ts` (bsec uses: `orderPaidPostings`, `refundPostings`, `restockCostPostings`, `expensePostings`/`expenseSettlementPostings` + reversals, `adjustmentPostings` — read for structure, not for marketplace arms) |
| Write path, idempotency, period close, trial balance | `Storify/lib/finance/ledger.ts` |
| Event → postings bridges (loading layer) | `Storify/lib/finance/post-events.ts` |
| Reconcile + deep sweep | `Storify/lib/finance/ledger-reconcile.ts`, `Storify/app/api/cron/finance/route.ts` |
| Reports | `Storify/lib/finance/reports.ts` |
| Expenses, recurrence, receipts | `Storify/lib/finance/expense-ledger.ts`, `recurring-expenses.ts`, `recurring-schedule.ts`, `expense-categories.ts`, `expense-receipts.ts` |
| Periods, CSV | `Storify/lib/finance/months.ts`, `csv.ts` |
| Models (field-by-field) | `Storify/models/ledger-entry.model.ts`, `expense.model.ts`, `fiscal-period.model.ts` |
| UI | `Storify/components/admin/finance/*.tsx`, `Storify/app/[locale]/admin/finance/**` (visual reference only — bsec builds on its own kit) |
