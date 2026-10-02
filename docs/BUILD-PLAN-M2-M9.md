# Build plan: M2 → M9 (post-tenant-isolation milestones)

**Audience:** an AI coding agent (Google Antigravity) building this repo phase by phase. Build
**one milestone at a time, in order** — do not start M3 work while M2 is still open, even if it
looks convenient (e.g. don't add storefront routes while still on M2). Each milestone below is
sized to hand over as its own prompt/session. When you finish a milestone, stop and report; a
human + Claude verification pass checks it against that milestone's exit criteria (the same
protocol used for M1 — see `docs/M1-BUILD-GUIDE.md` §7) before the next one starts.

**Source of truth:** `docs/PLAN.html`. This document is a build-order companion to it, not a
replacement — it tells you *what to build when* and *what to leave out*, but the schema shapes,
table columns, and detailed flows always come from `PLAN.html` itself. Section references below
(e.g. "PLAN §5.5") point at `docs/PLAN.html`'s own numbered headings — search for the matching
`<h2>`/`<h3>` text or the section's `id=` anchor.

**Repo conventions, already established — do not relitigate these:**
- `tenantTable()` (`packages/db/src/tenant-table.ts`) for every tenant-scoped table. It gives you
  `tenant_id`, FORCE RLS with the `nullif()` policy, and the `tenantForeignKey()` helper for
  composite `(tenant_id, x_id)` FKs. Every migration creating a tenant table must include
  `forceRlsSql(tableName)`.
- `withTenant(db, tenantId, fn)` (`packages/db/src/index.ts`) for every tenant-scoped DB
  operation — opens a transaction, calls `set_config('app.tenant_id', $1, true)`.
- `buildTenantContext()` (`packages/domain/src/context.ts`) already resolves tenant for both the
  storefront (host-based) and admin (membership + `X-Store-Id`) paths, and returns `permissions`.
  Use `assertPermission(ctx, needed)` or the `requirePermission()` oRPC middleware
  (`apps/web/src/server/api.ts`) to gate every admin procedure — this is now the established
  pattern, don't reinvent authorization per-procedure.
- oRPC contracts live in `packages/contracts/src/{admin,platform,storefront}.ts` (or a new file
  per namespace — follow the existing `admin.ts`/`platform.ts` split), procedures follow the
  `oc.route(...).output(...)` style already established.
- Domain services live in `packages/domain/src/*-services.ts`, take `(rt, ctx, input)`, and do
  their DB work through `withTenant()`.
- **Every milestone's isolation-relevant new tables/procedures must be covered by the isolation
  suite pattern** (`packages/domain/test/isolation.int.test.ts`) — it enumerates procedures
  dynamically off the contract objects, so adding a new contract entry gets you isolation coverage
  for free *if* the procedure actually goes through `requireAdmin`/`requirePermission`. Don't
  bypass that middleware chain for a new procedure "just this once."
- Money is `bigint` paise, `currency char(3)`. IDs are `uuid` (uuidv7 per the M1 migration
  `0002_uuidv7.sql` — reuse that generator, don't invent a new one).
- Every new table needs `id`, `created_at`, `updated_at`; tenant tables get RLS + tenant-first
  indexes + per-tenant unique constraints, exactly as M1 established.

**Testing bar, unchanged from M1:** integration tests run against real Postgres 18 (Testcontainers
or `TEST_DATABASE_URL_SUPERUSER`, the pattern in `packages/db/test/roles.int.test.ts` and
`packages/domain/test/isolation.int.test.ts`). Don't mock the database for anything claiming to
prove tenant isolation, a state machine transition, or a concurrency guarantee — those need to be
real. Unit tests (pure functions: pricing math, GST calc, permission checks) can and should be
mocked/pure — that's normal and fine, just don't let a "real Postgres" claim be secretly a mock.

---

## M2 · Merchant manages catalog (~3 weeks)

**Exit criterion (PLAN §13):** merchant creates and edits products with variants, images and
stock, sets branding and theme, and publishes a home page.

### Scope
- **Catalog schema** (PLAN §5.5): `products`, `product_options`, `variants`, `product_media`,
  `categories`, `product_categories`, `collections`, `collection_products`, `brands`,
  `inventory_levels`, `inventory_movements`, `media`. All `tenantTable()`, all with the composite
  FK pattern for cross-references (e.g. `variants.product_id` → `(tenant_id, product_id)` on
  `products`). `products.search_vector tsvector` with a GIN index (full-text search groundwork for
  M3, don't wire the search *route* yet, just the column + index + trigger/generated column).
  - **`inventory_reservations` is NOT M2 scope** — it belongs with the checkout guarded-update
    logic (PLAN §11.3), which is M4. M2 only needs `inventory_levels` (on_hand/reserved/available)
    and `inventory_movements` (the ledger) so stock can be *set and viewed*, not *reserved during
    checkout* (there's no checkout yet).
- **R2 uploads + Cloudflare Images** for product/media uploads: presigned PUT, mime + size checks,
  image re-encode through Cloudflare Images per PLAN §4's security checklist. `media` table tracks
  `storage_key`, `cf_image_id`, dimensions.
- **CSV import/export** for products — PLAN §5.5/§8 admin table calls this out explicitly for M2.
  Keep the column mapping simple (title, slug, price, sku, stock, category) — don't build a
  generic field-mapping UI, that's over-engineering for V1.
- **Branding** (PLAN §8.1): `brand_settings` table, Settings → Branding admin screen — logo
  (light/dark), favicon (generate the icon set: 16/32/180/192/512px + web manifest), social share
  image, typography (curated Google Fonts list, self-hosted from R2 — never load fonts from
  Google at storefront runtime), color scheme with WCAG AA contrast check, shape (radius, button
  style). Live preview + publish-with-rollback (a `version` column, same pattern as `themes`).
- **Theme tokens + block registry v1** (PLAN §5.9, §9, §12): `themes` (tokens jsonb, not code),
  `pages` + `page_versions` (blocks as `jsonb` document, `{blocks:[{id,type,version,props}]}`),
  `menus`. Block registry: start with the home-page block set PLAN §10 lists (Hero, Banner,
  ProductGrid, CollectionGrid, ProductCarousel, Testimonials, Reviews, RichText, FAQ, Gallery,
  Newsletter, USP strip) — each block type needs a versioned JSON schema (ADR-009, already
  written — read it) validated on save *and* on render, never raw HTML except sanitized rich text.
- **Store Admin: Products, Inventory, Online Store → Theme/Pages/Menus** screens (PLAN §8's admin
  table — only these rows, not the whole table). Use the Supabase-derived design system already
  ported in `packages/ui` from M0 (PageContainer/PageSection/etc.) — port additional pieces
  (FilterBar, MetricCard, data table) only when a screen actually needs them, per PLAN §12's
  "porting scope" note.

### Explicitly NOT M2
- Storefront rendering of any of this (M3). Products/collections/themes are admin-authored and
  admin-previewed only in M2 — no public storefront route reads them yet.
- Checkout, cart, orders, customers (M3/M4).
- Discounts, reviews, blog, redirects, announcement bars (M2's admin table row list doesn't
  include these — they're M5's "marketing and engagement" scope or later).
- SEO settings beyond what's needed for the block/page schema to have a `seo jsonb` field
  reserved — the actual SEO *feature* (title templates, JSON-LD, sitemap) is M3 (PLAN §8.3).
- Full app library, Puck visual editor — both explicitly "Later" in PLAN.

---

## M3 · Storefront sells the catalog (~3 weeks)

**Exit criterion:** a store on its subdomain shows home, collection, product, cart and checkout
UI; Lighthouse mobile ≥ 90 on product page recorded as baseline.

### Scope
- **Storefront routes** (PLAN §10's table): `/`, `/products/[slug]`, `/collections/[slug]`,
  `/categories/[slug]`, `/search`, `/cart`, `/pages/[slug]`, `/blog` + `/blog/[slug]`,
  `/policies/[type]`, `/sitemap.xml`, `/robots.txt`. **`/checkout` UI ships in M3 but does not
  process real payments** — PLAN's M3 exit criterion says "checkout UI," and M4 is explicitly
  "payment works." Build the checkout *page* (contact → address → shipping rate → payment method
  selection UI) but stub the actual place-order/payment-capture backend, or gate it behind a
  feature flag, since PLAN §11.3's inventory reservation and PLAN §11.2's number sequences
  (real M4 scope) are what make placing a real order safe under concurrency.
- **Cache Components + invalidation matrix** (PLAN §11.6, ADR-004): every cache tag starts with
  `t:{tenantId}:...` — the M0 lint rule `bs/tenant-cache-tag` already enforces the prefix, reuse
  it, don't add a second mechanism. Wire the actual tag set (product, collection, page, theme,
  nav, seo) and the revalidation table PLAN §11.6 specifies exactly (e.g. price change →
  product+collections+categories tags, not just the product tag).
- **Postgres search**: FTS + trigram on `products.search_vector` (already indexed in M2) +
  `search_queries` logging table (PLAN §5.8) for analytics/zero-result tracking. No Typesense —
  that's explicitly a later-milestone scale-out (PLAN §14 upgrade stages).
- **Store status modes** (PLAN §8.2): `live`, `coming_soon`, `maintenance`, `password` — the
  `store_status` table + the request-order-of-operations PLAN §10 specifies (resolve tenant →
  platform suspension check → store status mode → SEO headers → page). New stores default to
  `coming_soon` (PLAN §8.2's note) — but M2 didn't build a signup flow yet (that's M8), so for M3
  just make sure the mode-check logic and the four rendered states work; wiring "new store starts
  in coming_soon" into a signup flow happens in M8.
- **V0 SEO** (PLAN §8.3, the non-"Later" rows only): indexing on/off switch with `noindex` +
  `X-Robots-Tag` + `robots.txt Disallow: /`, classic SEO (title template, OG, canonical, sitemap,
  breadcrumbs, 404 monitor), structured data (JSON-LD: Organization, WebSite, Product,
  BreadcrumbList, FAQPage, Article, LocalBusiness, ItemList), AEO's FAQ block + answer summary, GEO
  AI-crawler allow/block switches in robots.txt. **Skip** (PLAN marks these "Later"): Search
  Console/Bing API integration, IndexNow, `llms.txt`, SEO score checklist.

### Explicitly NOT M3
- Real payment capture, real order placement with number sequences/reservations (M4).
- Customer accounts (M4's scope per PLAN §13, though the schema groundwork — `customers` table —
  can be created in M3 if the checkout UI needs to reference it structurally; if you do this,
  keep it schema-only, no login/session flow yet).
- Abandoned-cart recovery, discounts (M5).
- Custom domains (M8) — the storefront in M3 only needs to resolve `*.{platform-domain}`
  subdomains via the `domains` table already built in M1; `bcom.si` itself stays on the M0/M1
  placeholder until the real cutover at M6.

---

## M4 · Payment works (~3 weeks)

**Exit criterion:** Razorpay test and COD orders complete end to end; duplicate checkout
submits, duplicate webhooks and retried jobs each produce exactly one order, one payment and one
stock change; invalid transitions are rejected.

This is the highest-correctness-risk milestone so far — read PLAN §11.1–11.4 closely, more than
once, before writing code.

### Scope
- **Order/payment schema** (PLAN §5.7): `carts`, `cart_items`, `orders`, `order_items`,
  `order_events`, `order_notes`, `payment_intents`, `payment_attempts`, `refunds`, `action_tokens`.
  (`fulfillments`/`returns`/`invoices` are M5.) All composite-FK'd to `tenant_id` per the
  established pattern.
- **State machines** (PLAN §11.1): implement `transitionOrder(ctx, id, event)` — a single function
  that is the *only* way order/payment status columns change. It checks the allowed-transitions
  table PLAN §11.1 gives verbatim, writes an `order_events` row, and rejects everything else.
  **Every valid and invalid transition needs a unit test** — PLAN calls this out explicitly, and
  it's cheap to do exhaustively (the transition table is finite and small).
- **Number sequences** (PLAN §11.2): `number_sequences` table, single
  `UPDATE ... SET next_value = next_value + 1 ... RETURNING` in the same transaction as order
  creation. PLAN gives you the exact concurrency proof to replicate: 20 parallel clients, 1,000
  orders, 1,000 unique numbers, no gaps — write that as a real concurrency test against Postgres,
  not a unit test of the SQL string.
- **Inventory reservation** (PLAN §11.3): the guarded `UPDATE ... WHERE on_hand - reserved >= $qty
  RETURNING id` pattern, exactly as PLAN's pseudocode shows, plus `inventory_reservations` table
  (deferred from M2). Replicate PLAN's proof: 500 concurrent attempts against stock of 100 →
  exactly 100 reservations, never oversold. Expiry job (pg-boss) releases `active` reservations
  past `expires_at`, idempotently.
- **Webhook inbox** (PLAN §11.4): `webhook_inbox` table with
  `unique(provider, event_id)` — **not** unique on `event_id` alone (PLAN explicitly flags this as
  a tested bug: a Shiprocket event id can collide with a Razorpay one). Receive → verify signature
  → sanitize (strip card data/CVV/auth headers/secrets — PLAN §4's checklist) → insert with
  `on conflict (provider, event_id) do nothing` → reply 200 immediately → enqueue processing →
  worker processes idempotently.
- **Payment provider interface** (PLAN §11.5): the `PaymentProvider` interface PLAN gives verbatim
  (`createIntent`/`authorize`/`capture`/`cancel`/`refund`/`verifyWebhook`/`getPayment`/
  `reconcile`). Implement `RazorpayProvider` (per-store encrypted keys in `tenant_secrets`, AES-
  256-GCM, PLAN §4's checklist — keys never returned to the browser after save) and `CODProvider`
  (fee, limits, confirmation link via `action_tokens`). ADR-008 already documents why this is an
  adapter interface — read it before implementing.
- **Idempotency keys**: `idempotency_keys` table (PLAN §5.10), 24h retention, keyed
  `(tenant_id, key, route)`. The checkout place-order endpoint must use this — PLAN's exit
  criterion explicitly requires duplicate checkout submits to produce exactly one order.
- **Customer accounts, minimal**: OTP login (primary for India per PLAN §9), orders list/detail,
  addresses, wishlist; guest checkout. This is the "Store customer dashboard" (PLAN §9) — you do
  not need every row of that table in M4 (Profile/security/Communication/Privacy screens can wait
  or be minimal), but login + orders + addresses + guest checkout are load-bearing for "Razorpay
  test and COD orders complete end to end."

### Explicitly NOT M4
- Fulfillment/shipping (Shiprocket integration, tracking, GST invoices) — M5.
- Discounts — M5 admin table row, though `orders.discount_total` as a column can exist now even
  if nothing populates it yet (don't build the discount *engine* in M4).
- Returns — M5.
- The full customer dashboard (Privacy/data-export/DPDP request flow) — can defer to M5+ if it
  doesn't block the exit criterion.

### Concurrency tests required (PLAN §15, repeat here because M4 is where most of them apply)
100 simultaneous checkouts; simultaneous reservations on the last unit; simultaneous coupon
redemption (stub if discounts don't exist yet — or defer this specific one to M5 when discounts
land); simultaneous invoice allocation (defer to M5 with invoices); duplicate payment/order/
webhook requests; duplicate jobs; refund retries. Everything that's in-scope for M4's own tables
must be tested at M4; things that depend on M5 tables get tested when M5 adds them.

---

## M5 · Fulfillment works (~3 weeks)

**Exit criterion:** on staging, an order is shipped via Shiprocket with an invoice, tracked,
delivered, returned and refunded; emails sent at each step.

*(Staging VPS: PLAN's exit criterion says "on staging" — if the staging VPS still doesn't exist
by M5, per PLAN §14's "separate small VPS, deliberately deferred" note from M0/M1, flag this
explicitly rather than silently testing only against production. Setting up staging is not M5's
job, but M5's exit criterion depends on it existing — surface the conflict.)*

### Scope
- **Fulfillment schema** (PLAN §5.7 remainder): `fulfillments`, `fulfillment_items`,
  `tracking_events`, `returns` (+ `return_items`), `invoices`.
- **Fulfillment state machine** (PLAN §11.1): same `transitionX(ctx, id, event)` pattern as orders
  — `pending → label_created → picked_up → in_transit → out_for_delivery → delivered`,
  `in_transit/out_for_delivery → rto → rto_delivered`, cancellation only before `label_created`.
  Same for the **return state machine**:
  `requested → approved|rejected → picked_up → received → refunded|replaced → closed`.
  Cross-entity guards from PLAN §11.1 ("an order cannot be cancelled once any fulfillment is past
  `label_created`", etc.) — write these as real integration tests, not just as comments.
- **Shipping interface + Shiprocket**: mirror the `PaymentProvider` adapter pattern (ADR-008) for
  shipping — an interface with rates/serviceability/create-shipment/label/tracking-webhooks/RTO,
  implemented by a `ShiprocketProvider`. `shipping_zones`, `shipping_rates`, `locations` (from
  M0's store-settings scope, PLAN §5.4) get exercised for real here.
- **GST invoices + credit notes** (PLAN §15's "GST scope for V1" note — read it, and get it
  reviewed as PLAN says, before M6): `invoices` table, `number_sequences` kind=invoice scoped per
  financial year, `tax_settings`/`tax_classes` (from M0 scope, now used for real). Only the
  documented V1 cases: tax-inclusive/exclusive, HSN, exempt items, B2C/B2B with GSTIN, place of
  supply (CGST+SGST vs IGST), discounts reducing taxable value, shipping tax treatment, rounding,
  invoice/credit-note numbering per FY, cancellations. Anything outside that list gets marked
  unsupported in the admin — don't silently guess at edge cases PLAN doesn't cover.
- **Transactional emails via events** — the pg-boss domain-event queues PLAN §11 lists
  (`order.paid`, `fulfillment.created`, `fulfillment.delivered`, `return.requested`,
  `refund.processed`, etc.) drive email sends. `email_log` table (PLAN §5.10) tracks what was
  sent. Use Resend (or whatever provider PLAN/the codebase's env vars already assume — check
  existing env var names before assuming) with the kill-switch pattern PLAN §11.7 specifies
  (Resend off → emails queue and retry, doesn't take down checkout).
- **Abandoned-cart recovery**: reads `carts.status = 'abandoned'` (schema already exists from M3),
  a scheduled job sends recovery emails, `carts.recovery_sent_at`/`recovered_at` tracked.
- **Discounts** (PLAN §5.8, deferred from M4): `discounts`, `discount_redemptions`. Percent,
  fixed, free shipping, BXGY; usage limits; combinable flag. Wire the concurrency test PLAN §15
  calls out: simultaneous coupon redemption against a usage limit.
- **Customers and discounts admin screens** (PLAN §8's table rows for these).
- **Orders admin**: the fuller version — saved views (unfulfilled, unpaid, COD to confirm, RTO),
  draft orders, pay links, cancel, refund, notes, timeline — all listed under PLAN §8's Orders row.

### Explicitly NOT M5
- Custom domains, self-service signup, billing/plans (M8).
- Super Admin dashboard beyond what M1's minimal `platform.tenants.list/get` already has (M9).
- Full customer dashboard privacy/export flow if not already done in M4 — fine to bring in now if
  convenient, but not a blocker for M5's exit criterion.

---

## M6 · Store #1 live on the new platform (~2–3 weeks)

**Exit criterion:** real catalog, customers, historical orders and media on the platform; real
orders flowing for 2 weeks with no data or payment incidents.

PLAN explicitly moves the minimum-hardening bar into this milestone (moved from the old M7 slot):
**backup restore drill passed with RPO/RTO measured** (the M0 drill already did a first pass —
this milestone's version needs to be against *real production data volume*, not M0's near-empty
database), isolation and concurrency suites green (should already be true from M1-M5, re-verify
after the migration lands real data), Sentry and uptime alerts on, security review of auth/
checkout/webhooks, payload sanitization verified.

### Scope
- **Migration script and cutover** — follow PLAN §16 verbatim, it's already a numbered runbook:
  1. Freeze the current live store's data (there isn't a "current app" running anymore in this
     repo's timeline — the old `bsecom`/`Bs Ecommerce` single-store app was already decommissioned
     during M0's `bcom.si` cutover, per `progress.md`. **Check with the human/Claude side before
     starting this milestone** whether there's still a real source dataset to migrate, or whether
     "store #1" is now just this platform's own first real tenant created fresh through the M8
     signup flow — PLAN §16 assumes the former, but the actual M0 history may have made that moot.
     This is exactly the kind of guide/reality mismatch `docs/M1-BUILD-GUIDE.md` §6 tells you to
     flag rather than silently resolve.**
  2. If there is real legacy data: map the old schema's ~19 tables into the new one under tenant
     #1, move files to R2, migrate admin accounts to `memberships` (bcrypt hash compat via a
     custom Better Auth hasher if seamless login matters), preserve order numbers/product slugs,
     add redirects for changed URL patterns.
  3. Dry run on staging, compare row counts and totals, enable areas behind feature flags, cut
     over `bcom.si` with TXT pre-validation (PLAN §8's domain flow) so SSL is ready before DNS
     moves — no downtime.
- **Feature-flagged rollout**: every new area (catalog, checkout, fulfillment) should be behind a
  flag from `tenant_feature_overrides` (already built in M1) so any part can be reverted without a
  deploy, per PLAN's explicit "behind feature flags so any area can fall back" instruction.
- **Hardening checklist** (the moved-up M7 items, listed above) — treat each as a real,
  demonstrated task with evidence, the same standard M0's `progress.md` entries hold themselves
  to, not a checkbox ticked from reading the code.

### Explicitly NOT M6
- Load testing, noisy-neighbour testing, capacity numbers — that's M7 (even though the *hardening
  checklist* moved to M6, the *load/capacity* testing stayed at M7 per PLAN's phase table).
- Self-service signup — M8.

---

## M7 · Production hardening (~2 weeks)

**Exit criterion:** load, noisy-neighbour and concurrency tests pass; capacity policy written;
second restore drill passed.

### Scope
- **k6 load test on staging** — replaces PLAN §14's capacity hypothesis (50–150 small stores) with
  a real number from actual measurement.
- **Noisy-neighbour test** (PLAN §13's own phrasing): store A runs a 10k-product import and heavy
  traffic while store B checks out; B's p95 must stay within target. This is the single most
  direct proof that tenant isolation (M1) actually holds under real resource contention, not just
  data-correctness contention — treat it as seriously as the M1 isolation suite.
- **Concurrency tests at scale** (PLAN §15) — the M4/M5 concurrency tests, re-run at higher
  concurrency/volume than their original milestone's proof-of-concept scale.
- **Per-tenant rate limits and job concurrency tuned** — PLAN §14's quota table (uncached
  storefront requests/min, admin/API requests/min, background job concurrency) gets real
  enforcement now, even though the `quota_definitions` schema itself is M8/M9 scope (PLAN §5.1)
  — you may need to build a minimal version of that table here if M8 hasn't landed yet; check
  build order and coordinate rather than guessing, since M7 comes before M8 in PLAN's numbering
  but *depends conceptually* on quota infrastructure PLAN describes under the Super Admin section
  (§6.1). If M8's quota schema doesn't exist yet when you reach M7, build the minimal subset M7
  needs (rate-limit thresholds per tier) and leave a note for M8 to formalize it — don't block M7
  waiting for M8.
- **Monitoring thresholds and alerts** (PLAN §14's signal table: CPU/RAM/DB connections/uncached
  p95/job lag/per-store load share, each with a warning and scale-trigger threshold).
- **Incident, rollback and tenant-restore runbooks** — written documentation, following the style
  of `infra/coolify/RUNBOOK.md` (real, verified, not aspirational).
- **Second restore drill** — building on M6's real-data drill, ideally exercising an actual
  incident-response runbook end to end.

### Explicitly NOT M7
- Any new merchant-facing feature. This milestone is pure hardening — resist scope creep toward
  "while I'm in here, let me also build X."

---

## M8 · Self-service SaaS (~4 weeks)

**Exit criterion:** a stranger signs up, gets a live store, connects a custom domain and starts a
paid plan without help; quota limits block admin creation but never checkout.

### Scope
- **One-page marketing site + signup flow** (PLAN §7, given as an exact page-section list and a
  6-step signup pipeline — follow both verbatim). `signup_leads`, `slug_reservations`,
  `reserved_slugs` (PLAN §5.2). Abuse controls: Cloudflare Turnstile, rate limits, disposable-email
  blocklist, max 3 trial stores per user. Target: signup → live storefront in under 60s of server
  time — this is a real, measurable exit bar, test it as one.
- **Provisioning**: the single-transaction-plus-jobs provisioning flow PLAN §7 lays out exactly
  (tenant, domain, membership, roles, store_settings, tax_settings, policies-from-templates,
  theme, home page, menus, default location, India flat shipping, COD payment method,
  onboarding_progress, trialing subscription — then async jobs for welcome email / sample products
  / platform notify).
- **Templates and setup checklist**: `theme_templates` (PLAN §5.1), `onboarding_progress` (PLAN
  §5.2) driving the Store Admin → Home setup checklist (PLAN §8's Home row).
- **Plans, trial, Razorpay Subscriptions for merchant billing**: `plans`, `subscriptions`,
  `platform_invoices` (PLAN §5.1). This is platform billing merchants for *using* the SaaS —
  don't confuse it with the merchant's own Razorpay integration for *their* customers (that's
  M4's `RazorpayProvider`, a completely separate credential/flow).
- **Size tiers and quotas** (PLAN §6.1): `quota_definitions`, `tenant_size_tiers`,
  `tenant_quota_overrides`, `quota_events`. Effective limit = override → tier → plan, exactly as
  PLAN specifies. The quota table PLAN §6.1 gives (products/staff/storage/orders/emails/rate-
  limits/domains/apps/exports/job-concurrency per XS/S/M/L tier) is the real starting data to
  seed. **Hard rule from PLAN, don't violate it**: quotas never block checkout, only admin-side
  creation.
- **Custom domains** (PLAN §8's domain-connection-flow state machine:
  `requested → awaiting_dns → verifying → ssl_pending → active`, plus the `prevalidate_txt` path
  for a domain that's live elsewhere during migration — exactly the mechanism M0/M1's own
  `bcom.si` cutover manually simulated, now built as a real feature). This is where
  ADR-007 (Cloudflare for SaaS) actually gets implemented — read it now if you skipped it earlier
  as "not yet relevant."

### Explicitly NOT M8
- Super Admin dashboard UI (M9) — M8 needs the *data* (plans, quotas, tenant lifecycle states) to
  exist and be enforced, but the admin *screens* to manage them platform-side are M9.
- The full app library (PLAN §6.2 "Later") — M8 only needs the V1 feature-flag-based rollout
  mechanism, already built in M1 (`feature_flags` + `tenant_feature_overrides`).

---

## M9 · SaaS launch (~3 weeks)

**Exit criterion:** platform team runs the business from Super Admin; every privileged action is
audited; incident procedures and capacity policy published; public launch.

### Scope
- **Super Admin screens** (PLAN §6's full table): Overview, Tenants list/detail, Create tenant,
  Domains, Plans and billing, Signups funnel, Templates and blocks, Support sessions, System,
  Quotas and tiers, Features, Platform staff, Audit log. Every mutation through the `platform`
  oRPC router (BYPASSRLS, `app_platform` role — already isolated to `apps/platform` since M0) and
  every mutation writes `platform_audit_logs` (PLAN §4's checklist item, and §5.1's table) — this
  is the milestone where that table, stubbed-but-unused since M1, becomes load-bearing.
- **MFA enforcement on platform routes** — M1 left a `// TODO(M9): enforce MFA` marker
  specifically for this. Find it and implement it now.
- **Support sessions / impersonation** (PLAN §6.3): time-boxed, reason-logged, consent-gated
  (owner-approved / standing-consent / emergency), read-only by default with a second confirmation
  for write access, a fixed on-screen banner, full audit trail, 60-minute sessions extendable
  once. Never signs in as the merchant's actual account — a separate short-lived session carrying
  `support_session_id`.
- **Tenant lifecycle + deletion workflow** (PLAN §6.4): the full state table
  (provisioning/trial/active/past_due/suspended/archived/deletion_requested→deleted) with the
  storefront/checkout/admin/domains/billing behavior PLAN specifies per state. Deletion is the
  long-running `tenant_deletions` workflow (requested → export → billing stopped → domains
  disconnected → media scheduled → DB purged → verified → deleted) — **never a synchronous
  DELETE**, PLAN is explicit about this.
- **Full store export** (`exports` table, already scoped in M1's schema list as platform-adjacent
  — implement the actual export job now).
- **Legal**: merchant terms, DPA, subprocessor list, DPDP handling — documentation, not code, but
  real documents, not placeholders. GST cases reviewed with an accountant (PLAN §15 flags this
  explicitly as a pre-launch requirement, not optional).

### Explicitly NOT M9
- Anything in PLAN's "After V1" list (WhatsApp notifications, Puck visual editor, full app
  library, advanced SEO, Postgres-on-its-own-server, finance ledger/Route/POS, Expo apps) — all
  explicitly post-V1.

---

## After V1 (ordered by expected demand, per PLAN §13 — not scheduled, build only if/when asked)
1. WhatsApp notifications and COD confirmation over WhatsApp
2. Puck visual editor on the stable block registry
3. Full app library (PLAN §6.2) if merchants actually ask for installable modules
4. Advanced SEO: SEO score, Search Console/IndexNow, `llms.txt`
5. Move Postgres to its own server; second app instance with Valkey; Typesense projection
6. Finance ledger, Razorpay Route, multi-location transfers, POS; Expo apps

---

## Definition of done for V1 (PLAN §13, copied verbatim — the bar for the whole program, not one milestone)
- Tenant isolation suite passes; manual penetration test cannot cross stores; BYPASSRLS
  credentials exist only in the platform container.
- Store #1 migrated without regressions and running real orders; a second store with a different
  domain, theme and catalog is live.
- Self-signup to live store works unaided.
- Store admins cannot reach platform routes; support access is time-boxed and audited.
- Restore drill met RPO ≤ 15 min and RTO ≤ 2 h in the last 30 days; per-store export verified.
- Concurrency, noisy-neighbour and load tests documented; quotas and rate limits stop a noisy
  store.
- Separate staging, rollback procedure and incident runbook in place.

---

## Process reminders (same protocol as M1, don't relax it for later milestones)
- One milestone per handoff. Report what changed with concrete evidence (test output, curl
  results against a real running instance) — not a prose summary of intent.
- ADR any non-trivial decision not already pinned by PLAN or an existing ADR.
- Update `progress.md` only with verified, evidenced entries — the human/Claude review pass, not
  the executing agent, is who marks a milestone's exit criteria as met.
- When PLAN, this document, or the actual repo state disagree, stop and flag it — don't silently
  pick a resolution. M6's migration-source-data question above is a concrete example of exactly
  this kind of thing to expect.
- Every PR gets verified against real Postgres before merge — the M1 experience (a mocked
  isolation suite passed review's *first* draft-report but not the actual code-reading pass) is
  the reason this bar exists. Expect the same scrutiny on every milestone, not just M1.
