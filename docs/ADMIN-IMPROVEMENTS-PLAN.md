# Super Admin and Store Admin improvements (storage, quotas, integrations, orders, returns, themes, pages, navigation)

Hand-off plan for Antigravity (GA). Verifier: Claude (checks every item against the acceptance criteria below before it is called done, and runs the gate).

Written 2026-10-08 from the owner's request list and a read of the code at `main` `8eea67f`. Facts marked *(from code)* were read, not run.

## 0. How to use this plan

1. Read `AGENTS.md` (hard rules, section 2) and `docs/ARCHITECTURE.md` first. Then `docs/admin-ui-standards.md` for every admin screen.
2. **One phase = one branch = one PR.** Phases are ordered by dependency (section 2). Do not start phase N+1 until Claude has verified phase N. Claim the phase in `progress.md` "In flight" before you start.
3. Each phase ends with: a change record in `docs/changes/` (`YYYY-MM-DD-antigravity-<slug>.md`), the section 7 "definition of done" checklist, and the gate in `AGENTS.md` section 4 with pasted counts.
4. "Owner decisions" (section 8) have a recommended default. Build the default unless the owner overrides it. Do not block on them, but record which default you used.
5. Stage files by explicit path. Never `git add -A`. Work in your own worktree. Test only on local data (`AGENTS.md` section 6).

## 1. What the owner asked for, and what the code says today

| # | Request | Current state *(from code)* | Phase |
|---|---|---|---|
| SA-1 | Super Admin: manage storage connection (Local, Cloudflare R2, other S3) | Storage is env-only: `R2_*` vars read by `packages/domain/src/media/storage.ts` (`getR2Config`). No UI, no DB config, no Local driver. A hardcoded default account id sits in that file. | 1 |
| SA-2 | Super Admin: add, edit, update, manage quotas and resources, with a price for each tier | `/quotas` is a read-only table over `quota_definitions` (fixed columns `tier_xs/s/m/l`). `/plans` is read-only too. No tier prices anywhere. | 3 |
| SA-3 | Super Admin: new "Integrations" section. Notifications = Email, SMS, WhatsApp cards (SMS and WhatsApp through Zoho CPaaS, set up but not enrolled). Email home = stats on top, tabs below (transactions table, providers as cards; a card opens its settings). Same idea for Storage and Payment. Payment: Super Admin enables Razorpay and Stripe, and enabled providers show in the store's payments section for activation | Only Email exists (`apps/superadmin/src/pages/EmailSettings.tsx`, `/email`, ZeptoMail form + recent deliveries). No SMS or WhatsApp provider code. Store payments page is hard-coded to COD + Razorpay; no Stripe provider; no platform-level gate. | 4 |
| SE-1 | Store Admin: cannot archive or delete orders | There is no archive or delete action. The "Archived" tab is just a filter on terminal statuses (`delivered`, `cancelled`, `returned`) in `packages/domain/src/admin/orders.ts`. No `archived_at` column. | 2 |
| SE-2 | Returns: a single page instead of a drawer | `apps/admin/src/routes/_store/returns.tsx` (1,400 lines) opens details in a `Sheet`. | 2 |
| SE-3 | Cannot add image to products ("failed to fetch") | The browser PUTs the file straight to a presigned R2 URL (`products/$id.tsx` `MediaSection`, and the same code again in `components/page-editor/host.ts`). A thrown `fetch` (not an HTTP status) means the request never completed: almost certainly bucket CORS or an unsignable header (see 3.1.4). Missing keys give a different, friendly error. | 1 |
| SE-4 | Themes page: remove Brand and logo, Theme settings, "Customise ..." section; keep theme cards, 3 per row; use Puck for all of it | `theme-library.tsx` has the buttons and the customise block; `theme.tsx` is a separate Brand and logo screen. Puck already has a Theme tab and a page switcher (`EditorHeader`, `PageVisualEditor`). | 5 |
| SE-5 | Pages: remove the legacy block page editor; table with add-page drawer (name, URL, parent, meta title, meta description, feature image); row actions Edit (drawer) and Customize (Puck) | `online-store/pages.tsx` (994 lines) is the old form-based block editor. `pages` has no parent. | 5 |
| SE-6 | Navigation builder like Shopify: header and footer menus plus Shop filter for the collection grid etc. | `online-store/menus.tsx` edits a menu tree (arrow buttons, no drag). **The storefront never reads the `menus` table**: `SiteHeader` / `SiteFooter` blocks hold their own inline `links` (max 8) in `packages/blocks/src/registry.ts`. The collection page filter bar only has sort + in-stock (`ProductFilterSort.tsx`). | 6 |

Two findings that shape the plan:

- **Upload code is duplicated** (product page and Puck host). Fix it once, in one helper, then reuse it everywhere (3.1.5).
- **Menus are disconnected from the storefront today.** Phase 6 is not just a nicer builder: it must also make the storefront render the menus (6.2).

## 2. Phase order and dependencies

```
Phase 1  Storage connections + upload fix        (SA-1, SE-3)   -- first: images are broken today
Phase 2  Orders archive/delete + Returns page    (SE-1, SE-2)   -- independent, small
Phase 3  Quota tiers manager with pricing        (SA-2)         -- own data model, ADR
Phase 4  Integrations hub, Zoho CPaaS SMS+WhatsApp (not enrolled), Razorpay+Stripe enablement (SA-3)       -- needs Phase 1 (Storage card) and reuses the email service
Phase 5  Themes cleanup + Pages table/drawer     (SE-4, SE-5)   -- needs Phase 1 (feature image upload)
Phase 6  Navigation builder + storefront wiring + filter menus (SE-6) -- needs Phase 5 (page URLs)
```

Phases 2 and 3 do not depend on anything and may be reordered with the owner's priority, but only one phase is in flight at a time.

Migrations: the next free number is `0049`. Each phase states the tables it adds. Follow `docs/migrations.md` (append-only, expand/migrate/contract). Every new tenant table uses `tenantTable()` plus `forceRlsSql()`; every new platform table is documented as platform-scoped (no RLS) with grants limited to the roles named.

## 3. Phase 1: Storage connections (Super Admin) and the image upload fix

### 3.1 Design

**3.1.1 Data.** New platform table `platform_storage_connections` (platform-scoped, no RLS, like `platform_email_settings`). Columns:

- `id` uuid, `name`, `driver` (`local` | `r2` | `s3`), `purpose` (`public_media` | `private_files`), `is_active` boolean, `status` (`untested` | `ok` | `failed`), `last_test_at`, `last_test_error`.
- Non-secret config: `endpoint`, `region`, `bucket`, `public_base_url`, `force_path_style`, `local_dir` (local only), `account_id` (R2 only).
- Secrets: `access_key_id_ciphertext`, `secret_access_key_ciphertext`, `iv`, `key_version`. Encrypted with the same AES-256-GCM helper as `platform_email_settings` / `packages/payments/src/crypto.ts` (`TENANT_SECRETS_KEY`). Returned to the UI only as set / not set plus last 4 of the key id.
- Exactly one active connection per `purpose` (partial unique index `WHERE is_active`).

`media` gets a nullable `storage_connection_id` (expand). A file is always read through the connection it was written with, so **switching the active connection affects new uploads only and never breaks existing images**. `NULL` means "the environment (`R2_*`) configuration", which keeps production working with zero change on deploy.

**3.1.2 Resolution order** (new `packages/domain/src/media/connection.ts`): active DB connection for the purpose, else the existing env config, else "not configured" (today's friendly error). In-process cache of the resolved config, 60 seconds, cleared on save. No hardcoded account id fallback: remove the literal in `storage.ts` and `uploadToCloudflareImages`.

**3.1.3 Drivers.** One interface `MediaStorageDriver { presignUpload, put, head, delete, publicUrl, presignDownload }`:

- `r2` and `s3`: the existing `@aws-sdk/client-s3` code, parameterised by the connection (R2 = `region: auto`, endpoint `https://<account>.r2.cloudflarestorage.com`; S3 = real region, optional custom endpoint for MinIO / Backblaze / DigitalOcean Spaces / Wasabi, `force_path_style` toggle).
- `local`: files under `local_dir` (default `MEDIA_LOCAL_DIR`, e.g. `./.data/media`). Uploads go **through our server** (no presign). Served by a new route `apps/web/src/app/media/[...key]/route.ts` that: rejects `..` and absolute paths (resolve and verify the result is inside `local_dir`), sets the stored `Content-Type`, `X-Content-Type-Options: nosniff`, `Cache-Control: public, max-age=31536000, immutable` (keys are uuid-based), and **`Content-Security-Policy: default-src 'none'; sandbox`** so an uploaded SVG can never run script on the app origin. The Super Admin card shows a plain warning: "Single server only. Files live on this server's disk, are lost on redeploy unless a persistent volume is mounted, and are not in the R2 backups." Local is for development and trials; production use is allowed but warned.

**3.1.4 Fixing "failed to fetch" (SE-3).** Do these in order and record the evidence in the change record:

1. **Reproduce first.** Run the admin against the production-like R2 config on a local or staging store (not the live store, `AGENTS.md` section 6). Open DevTools: a CORS preflight failure shows as `blocked by CORS policy`; a bad signature shows as an HTTP 403 (which our code reports as "Upload failed (403)", not "failed to fetch"). A literal `TypeError: Failed to fetch` points at CORS or the network.
2. **Likely cause to confirm:** the R2 bucket has no CORS rule for the admin origin (documented in `DEPLOYMENT.md` line 11 but easy to miss). A second suspect: the presigned URL signs `ContentLength` and the browser refuses to set `Content-Length` (it is a forbidden header), so remove it from the client `headers` and from the signed command if the signature fails.
3. **Make it robust instead of relying on bucket CORS.** Add a server-proxied upload as the default path: `POST /api/admin/media/upload` (multipart, `content.write` permission, tenant context, `validateMediaUpload`, magic-byte sniffing so the declared MIME matches the bytes, size cap `MAX_MEDIA_BYTES`, storage quota check `assertStorageQuota`). The server writes through the active driver. Keep direct presigned PUT as an optional optimisation behind the connection setting `direct_browser_upload` (off by default) for large files. This also makes the `local` driver work and removes the CORS setup step for operators.
4. **Connection test button** (Super Admin): put a 1-byte object, head it, delete it, and (R2/S3) report whether a CORS rule for `ADMIN_ORIGINS` / the admin origin exists by calling `GetBucketCors` when permitted. Show the exact error text. This is the diagnostic that would have caught this bug.
5. **One client helper.** `apps/admin/src/lib/upload-media.ts` exports `uploadMedia(file, folder)` used by `products/$id.tsx`, `components/page-editor/host.ts`, brand assets, expense receipts and the new page feature image. It returns `{ id, url }`, shows a specific error (`Storage is not set up`, `File too large`, `Unsupported type`, `Network error: check storage CORS`) and never a bare "Failed to fetch". Delete the duplicated code.

**3.1.5 Call-site inventory.** `publicMediaUrl()` is used in 7 files and reads env synchronously. Replace with a resolver that takes the media row's `storage_connection_id` (pre-load the needed connections once per request or per `"use cache"` scope, not one query per image). List every call site (`rg publicMediaUrl`, `getR2Config`, `createR2Client`, `buildPresigned*`) in the change record and show each one was migrated. Also migrate tenant-deletion media clean-up (`packages/domain/src/platform/deletion-steps.ts`), return photos (`orders/return-photos.ts`, uses the `private_files` connection) and expense receipts.

### 3.2 Contracts and API

`packages/contracts/src/platform.ts`: `platformStorageContract` with `list`, `get`, `create`, `update` (secrets write-only, optional on update), `test`, `activate`, `delete` (refuses when media rows reference it; deactivate instead). Mount in `apps/platform/src/app.ts` with `assertRoleAtLeast` (platform admin or above). Every mutation writes `platform_audit_logs` (`storage_connection.*`) and is added to `apps/platform/test/audit-coverage.int.test.ts` and the RBAC suite.

Store side: `admin.media.upload` (multipart route in `apps/web`), and `admin.media.requestUpload` keeps working but returns `{ method: "PUT" | "POST", ... }` so older clients degrade. Add to `packages/domain/test/isolation.int.test.ts` mapping (heavy job fails otherwise).

### 3.3 Super Admin UI

New page under Integrations (Phase 4 builds the hub; in Phase 1 mount it at `/integrations/storage` and add a temporary nav item "Storage" so Phase 1 ships alone). Shared kit only (`@bs/ui` `DataTable`, `Sheet`, `SimpleSelect`, `ConfirmDialog`, `PageSkeleton`, `pendingComponent`). Connection cards: name, driver badge, purpose, active badge, last test result. "Add connection" opens a drawer with a driver selector that shows only the relevant fields (Local: directory; R2: account id, bucket, keys, public URL; S3: endpoint, region, bucket, keys, path-style, public URL). Secrets use the masked input pattern from `EmailSettings.tsx`. Activate asks for confirmation and states "New uploads use this connection. Existing files keep working."

### 3.4 Tests

- Real-DB: secrets never returned by any procedure; `app_rw` can SELECT the table but not write it (extend `packages/db/test/b2-grants.int.test.ts`); one active per purpose; a `media` row keeps resolving through its original connection after activation of another; cross-tenant isolation unchanged.
- Unit: local driver path traversal (`../`, absolute, encoded `..%2f`, symlink) is rejected; MIME vs magic-byte mismatch rejected; SVG served with the sandbox CSP.
- Driver contract tests run against the local driver and against an S3-compatible fake (e.g. an in-process `s3rver`/MinIO container if already used in CI; otherwise AWS SDK client mocking is acceptable for the S3 request shape only, security behaviour stays real-DB).
- Admin: `uploadMedia` error mapping; product page upload happy path against the local driver.

### 3.5 Acceptance criteria (Claude verifies each)

- [ ] With only the local driver active, a product image uploads, attaches, renders in admin and on the storefront.
- [ ] With an R2 connection active and bucket CORS deliberately missing, the default (server-proxied) path still uploads; the "Test connection" result names CORS as the problem when direct upload is enabled.
- [ ] No `Failed to fetch` string can reach the user from the upload path (grep + test).
- [ ] Production env-only configuration still works unchanged with zero rows in the table (`storage_connection_id = NULL`).
- [ ] Secrets absent from responses, logs, audit rows and snapshots.
- [ ] `publicMediaUrl` call-site inventory complete; no remaining direct `process.env.R2_*` reads outside the env-fallback in `connection.ts`.
- [ ] ADR-023 written (storage connections and integrations hub), `DEPLOYMENT.md` updated (new env `MEDIA_LOCAL_DIR`, CORS note now optional), `.env.example` updated.

## 4. Phase 2: Orders archive/delete and the Returns page

### 4.1 Orders: archive and delete (SE-1)

Orders are financial records (GST invoices, finance ledger, refunds, audit). The default policy, to be confirmed by the owner (section 8, D1): **archive is the normal action; permanent delete is allowed only for orders that never carried money or stock.**

**Data.** Expand migration: `orders.archived_at timestamptz NULL`, `orders.archived_by uuid NULL`; index `(tenant_id, archived_at)`. No existing column is dropped or repurposed.

**Archive / unarchive.**
- Any order in a terminal state (`delivered`, `cancelled`, `returned`) can be archived; open orders cannot (cancel or complete first, with a clear message).
- Archived orders are hidden from the default views and from KPI counts that mean "active", still reachable by direct link and counted in finance/GST reports (never excluded from money totals).
- **Tab semantics change, handle it deliberately:** today "Archived" = terminal statuses. Rename that existing view to **Closed** and make **Archived** mean `archived_at IS NOT NULL`. Update the `view` enum in the contract (add `closed`, keep `archived` with the new meaning), `packages/domain/src/admin/orders.ts`, the saved-view ids in `orders.tsx`, and the e2e selectors in `e2e/admin.spec.ts` in the same change (`AGENTS.md` section 4).
- **The bulk action bar must always show Archive** (owner reported not seeing it when bulk-selecting). The bar in `orders.tsx` (~L554 onward) currently offers only confirm / ship / deliver / export. Add **Archive** next to them in every view except Archived, where it becomes **Unarchive**. The button is enabled whenever at least one order is selected; orders that are not eligible (still open) are skipped with a per-order reason in the result toast ("3 archived, 2 skipped: still open"), never silently, and never by hiding the button. The same Archive / Unarchive item goes in each row's overflow menu. Acceptance includes a test that renders the bar with a mixed selection.
- Permission `orders.write`. Bulk archive/unarchive through the existing `useBulkRunner`. Audit rows `order.archived` / `order.unarchived` in `audit_logs`.

**Delete (permanent).** New permission `orders.delete` in `packages/auth/src/permissions.ts` and `context.ts`, granted to store owner and admin only. A domain service `deleteOrder` deletes only when **all** hold, inside one transaction, otherwise it refuses with a specific reason shown in the UI:
- **the order is already archived** (owner decision 2026-10-08: archive first, then delete). Delete is therefore only offered in the **Archived** view (bulk bar and row menu) and on the detail page of an archived order; the bulk bar shows **Delete** there whenever at least one selected order passes the checks below, and orders that do not pass are skipped with a per-order reason, never hidden. The service re-checks everything, so the UI is a convenience only;
- status is `cancelled`, or the order is an unplaced draft (stock was already restored on cancel; see `docs/changes/2026-10-05-claude-cancel-restores-stock.md`);
- payment status is not `captured`/`paid`/`partially_refunded`/`refunded` (no money moved; COD `cod_pending`/`cod_failed` is fine);
- no invoice issued, no shipment/AWB, no return, no finance ledger entry, no refund row;
- the order is not referenced by an exchange (`returns.exchangeOrderId`).
GA must first map every FK that references `orders` (`rg "orders.id"` in `packages/db/src/schema`) and write the delete so dependent rows (`order_items`, events, notes, reservations) are removed explicitly and the refusal list above covers every table that must not be silently cascaded. The audit row stores order number, total, status and actor only (no customer PII). The UI uses `ConfirmDialog` with the order number typed to confirm. Single and bulk. Cache invalidation after commit via `cache-invalidation.ts` (tenant-prefixed tags).

**Contracts.** `orders.archive`, `orders.unarchive`, `orders.delete` (each takes `ids[]`, max 100, returns per-id result `{ id, ok, reason? }` so bulk shows partial success). Row action menu and bulk bar in `orders.tsx`; detail page `orders_.$orderId.tsx` gets Archive and Delete in its overflow menu. Add to the isolation-suite mapping.

**Tests (real DB).** Archive hides from default list and still appears in finance reports; delete refused for paid / invoiced / shipped / returned / exchange-linked orders and allowed for cancelled unpaid COD; permission check lives in the service (`assertPermission`), not only the route; cross-tenant id returns not-found; audit row written.

### 4.2 Returns: detail as a page (SE-2)

- New route `apps/admin/src/routes/_store/returns_.$returnId.tsx` (flat-route naming as `orders_.$orderId.tsx`), `pendingComponent`, breadcrumb `Returns > R-1042`, deep-linkable, browser Back returns to the list with filters preserved (filters are already in the URL search params, keep that).
- Move the detail body out of the `Sheet` into the page: summary header (status, requested resolution, order link), items with restock info, photo proof gallery, customer comment, timeline, and the action panel. Keep the existing action dialogs (approve, reject, picked up, receive with restock, refund, replace, close) and their domain calls unchanged; only the container changes.
- List rows navigate to the page on click; remove the `Sheet`, its open/close state and now-unused imports. Layout follows `docs/admin-ui-standards.md` (two-column on desktop, stacked at 375 px; actions in a sticky bar on mobile).
- Update e2e selectors if they reference the returns drawer.

### 4.3 Acceptance criteria

- [ ] Archive, unarchive (single and bulk) work; archived orders leave the default list and appear under Archived; Closed tab shows what Archived used to show.
- [ ] Selecting any orders in All / Open / Closed shows an **Archive** button in the bulk bar; in Archived it shows **Unarchive** and, for eligible orders, **Delete**; delete is refused by the service for a non-archived order.
- [ ] Delete is refused with a readable reason for a paid order, an invoiced order and an order with a return; works for a cancelled unpaid COD order; the order number is typed to confirm.
- [ ] `orders.delete` exists and is enforced in the domain service; staff without it see no Delete action and get a forbidden error if they call the API.
- [ ] Money, GST and ledger totals identical before and after archiving a delivered order (test).
- [ ] Returns open on `/returns/<id>`; no `Sheet` left in `returns.tsx`; all seven actions still work end to end; walked at 375 px and desktop.
- [ ] ADR-024 "Order archive vs delete" written; `ARCHITECTURE.md` API surface and UI routes updated.

## 5. Phase 3: Quota tiers manager with pricing (SA-2)

### 5.1 Design

Today tiers are four hard-coded columns, so "add a tier" and "price a tier" are impossible without schema change. Normalise (expand / migrate / contract per `docs/migrations.md`):

- `quota_tiers` (platform, no RLS): `code` (pk, e.g. `XS`), `name`, `description`, `sort`, `is_active`, `price_monthly_paise`, `price_yearly_paise` (bigint, paise like `plans`), `currency` default `INR`, `is_public`.
- `quota_tier_limits`: `(tier_code, quota_key)` pk, `value integer`, FKs to `quota_tiers` and `quota_definitions`.
- Migration `expand`: create both tables, backfill from `quota_definitions.tier_xs/s/m/l` (XS/S/M/L get their current values; prices start at 0 = "unpriced" shown as "Not priced"). Keep the old columns **and keep them in sync** (write-through) until a later release; do not drop them in this phase (rule 10).
- `resolveEffectiveQuota` (`packages/domain/src/system/quotas.ts`) switches to the new tables, same resolution order (ADR-015: override, tier, plan, hard fallback). Tier lookup of an unknown code falls back to XS. `tenant_size_tiers.tier` stays text; deleting or deactivating a tier that tenants use is refused.
- `quota_definitions` becomes editable: `description`, `unit`, `enforcement` (`hard` | `soft` | `notify`). The set of **keys** stays code-defined (each key is enforced by a specific `assert*Quota` call), so the UI can edit limits and metadata of existing keys but cannot invent a key nothing enforces. A new key requires code. State this in the UI help text.
- Inviolable invariants from ADR-015 stay: quotas never block checkout, storefront reads or webhooks (add a test that a tier edited to 0 does not block checkout).
- Pricing semantics (owner decision D2): the tier price is **the price of that resource size**, shown on the tier and available to billing. Wiring it into invoices/subscriptions is out of scope unless the owner says so; the stored price must be ready for it. Do not wire it into Razorpay or Stripe billing.

### 5.2 Contracts and UI

`platformQuotasContract`: `matrix` (tiers x keys), `tiers.create/update/deactivate`, `limits.update` (batch: array of `{ tierCode, quotaKey, value }`), `definitions.update`. Replace the read-only `quotas.list` output only additively (keep it for one release for any caller).

Super Admin `/quotas` becomes "Quotas & Tiers" with two tabs:
1. **Tiers**: cards or table of tiers with name, monthly/yearly price (INR formatted), number of stores on the tier, active toggle; Add/Edit in a drawer; price inputs in rupees converted to paise at the edge (no float math on money).
2. **Limits matrix**: rows = quota keys, columns = tiers; inline-editable cells with dirty tracking and one Save (batch, atomic), validation (integer >= 0 or the existing unlimited sentinel, check what `resolveEffectiveQuota` uses), unit and enforcement shown per row, a diff confirmation before save listing how many stores are affected (`tenant_size_tiers` counts).
Also surface "Assign tier" and per-tenant overrides where they already live on `TenantDetail` (verify; link rather than rebuild).

Every mutation: `assertRoleAtLeast`, `platform_audit_logs` row with before/after, audit-coverage test, no RLS bypass widening (rule 9: only `app_platform` writes).

### 5.3 Tests and acceptance

- [ ] Real-DB: backfill leaves every store's effective quota identical (snapshot before/after for all keys and tiers); editing a limit changes `resolveEffectiveQuota` immediately; adding tier `XL` and assigning a tenant works; deactivating a tier in use is refused; unknown tier falls back safely.
- [ ] Checkout and storefront still succeed with every hard quota at 0 (ADR-015 invariant test).
- [ ] Prices stored as integer paise; displayed with `Intl` INR; round-trip test.
- [ ] Old columns still populated (write-through test) so a rollback of the app version is safe.
- [ ] ADR-025 written (quota tiers normalisation and tier pricing); `ARCHITECTURE.md` data model updated.

## 6. Phase 4: Integrations hub (Notifications, Storage, Payment)

### 6.1 Information architecture (Super Admin)

Replace the "Email (ZeptoMail)" nav item with **Integrations** (Operations group). Routes (all with `pendingComponent`, shared kit):

```
/integrations                         hub: 3 cards -> Notifications, Storage, Payments
/integrations/notifications           3 cards -> Email, SMS, WhatsApp (status badge + 7-day sent/failed on each)
/integrations/notifications/email     STATS row on top; below: tabs [Transactions] [Providers]
/integrations/notifications/sms       same layout
/integrations/notifications/whatsapp  same layout
/integrations/storage                 stats (used bytes, files, by connection) + connection cards (Phase 1 page, re-homed)
/integrations/payments                Razorpay + Stripe cards with enable switch (see 6.4)
```

Keep `/email` as a redirect to `/integrations/notifications/email` for one release (bookmarks, e2e). Update the command palette entries and `Layout.tsx` nav (`docs/admin-ui-standards.md` nav rules) and e2e selectors for the renamed item in `e2e/superadmin.spec.ts`.

**Channel page layout (one reusable component, three channels):**
- **Stats row** (metric cards): sent, failed, skipped for 24 h / 7 d / 30 d (toggle), success rate, plus a small per-day chart (use the `dataviz` conventions; no chart library unless one is already in `apps/superadmin`).
- **Transactions tab**: `DataTable` over the channel log: time, recipient (masked for SMS/WhatsApp: last 4 digits), template, tenant (link), status badge, provider, error. Filters: status, template, tenant, date range; server-side pagination; failed-only quick filter; row opens a detail drawer (never shows message bodies, links or OTPs, matching the existing email log rule).
- **Providers tab**: provider **cards** (logo/icon, name, status: Not configured / Active / Failing, default badge, last test result). Click opens that provider's settings in a `Sheet` (or a sub-route if the form is long). The existing ZeptoMail form is reused as the Email "Zoho ZeptoMail" card, and a generic "Custom SMTP" card reuses the same fields.

Email stats caveat to show in the UI help text: SMTP gives "accepted by provider", not inbox delivery or opens. Bounce/complaint webhooks are a later phase.

### 6.2 Data and services

- Email keeps its tables (`platform_email_settings`, `platform_email_log`); only add the stats query and filters. Do not migrate them in this phase.
- New generic platform tables (platform-scoped, `app_platform` writes; `app_rw` SELECT on config and INSERT on logs, as migration `0017` did for email, documented in the ADR and the grants test):
  - `platform_channel_providers` (`id`, `channel` `sms|whatsapp`, `provider`, `display_name`, non-secret `config` jsonb, secret ciphertext + iv + key_version, `enabled`, `is_default`, `last_test_*`). One default per channel (partial unique index).
  - `platform_message_log` (`id`, `channel`, `tenant_id` nullable, `to_masked`, `template`, `provider`, `status` `sent|failed|skipped`, `provider_message_id`, `error`, `created_at`), 90-day prune added to the existing maintenance pass (same as email).
- Provider adapters behind one interface in `packages/domain/src/system/messaging/` (`MessageChannelAdapter.send/test`), following the adapter pattern of ADR-008 / ADR-017. Sending happens in a pg-boss job after commit (rule 13); the send function enforces a per-recipient rate limit and sanitises provider errors.
- **SMS (Zoho CPaaS, owner decision 2026-10-08):** Zoho CPaaS is the product ZeptoMail now belongs to; it adds SMS, WhatsApp and voice under one console, and the existing ZeptoMail email setup stays as it is. **Build the integration ready but do not enrol**: no Zoho account, credentials or live sending in this work. Provider id `zoho_cpaas`, channel `sms`, India data centre (Zoho lists SMS as available only in the IN DC). The CPaaS product page shows `POST https://cpaas.zoho.com/v1.1/sms` using a `sender_key` and `template_key`, with the key passed in the `Authorization` header. **It does not describe DLT handling, the exact header format or response shapes, and I could not find the API reference.** GA must read Zoho's official docs first (start at `https://www.zoho.com/cpaas/sms-api.html` and `https://www.zoho.com/cpaas/whatsapp-business-api.html`), record the exact request/response shapes and DLT requirements in the change record, and mark anything unconfirmed as unconfirmed. India still requires TRAI DLT for transactional SMS, so the form gets optional DLT fields (entity id, sender/header id, template id per message) if Zoho's docs require them. While not enrolled: the card shows **Not enrolled**; the provider can be saved with empty credentials; **Test send and Enable are disabled** until credentials exist; the adapter is unit-tested against fixtures built from the documented request shape with the HTTP layer faked, and is labelled unverified against the live API.
- **WhatsApp (Zoho CPaaS):** same provider, same "not enrolled" posture. Zoho's WhatsApp Business API takes a `template_key` plus `merge_info` for pre-approved templates (per the CPaaS product page). Model: provider config (API token secret, the WhatsApp sender identifier Zoho issues) and a template map (our template name to Zoho `template_key`, language, variable order). Business-initiated WhatsApp messages need approved templates, so there is no free-text send.
- Channel enablement is **off by default** and nothing changes for existing flows until a channel is enabled and a flow is mapped to it. Phase 4 delivers configuration, test-send, logs and stats; mapping OTP and order notifications to SMS/WhatsApp is a follow-up behind a feature flag (ADR-011) unless the owner asks for it now (D3). Check how customer OTP is delivered today (`packages/domain/src/customers/otp.ts`) and record it in the change record; do not change OTP delivery in this phase.

### 6.3 Contracts

`platformIntegrationsContract`: `overview` (counts and 7-day totals per channel for the hub cards), `channel.stats({ channel, range })`, `channel.transactions({ channel, filters, page })`, `providers.list/create/update/test/setDefault/delete`. Email procedures are re-exported unchanged. All mutations audited and added to the audit-coverage and RBAC suites; secrets write-only.

### 6.3b Storage and Payment cards

- **Storage**: the Phase 1 page, with a stats row (total bytes and files per connection, top tenants by usage, from `media`) above the connection cards.
- **Payment**: provider cards with an enable switch; see 6.4 (part of this phase).

### 6.4 Payments: platform enablement and store activation (Razorpay and Stripe)

Owner decision 2026-10-08: Razorpay and Stripe now; PayPal and shipping later. Super Admin **enables a provider for the platform**; enabled providers then appear in the Store Admin payments section, where each store connects its own account and activates it. `AGENTS.md` rule 14 is amended in this change to say payment providers are in scope for this plan only (update the rule text and `progress.md` "Decisions on record"). **Live-mode credentials are not enrolled in this work**: build and verify in test mode only.

**Data.** New platform table `platform_payment_providers` (platform-scoped, `app_platform` writes, `app_rw` SELECT, documented in the grants test): `provider` pk (`razorpay`, `stripe`), `enabled` boolean default false, `live_mode_allowed` boolean default false (a second switch so no store can go live until the owner flips it), `display_name`, `sort`, `updated_by`, `updated_at`. The platform row holds no secrets; each store's keys stay where ADR-008 puts them (encrypted in `tenant_secrets`, `packages/payments/src/crypto.ts`). The migration seeds Razorpay as enabled if any store already uses it, so nothing changes for existing stores.

**Gating (enforced in the domain service, not only the UI).** Saving keys, activating, creating a payment intent and offering the method at checkout all check `enabled`. Disabling a provider never strands money: a store's saved keys, in-flight intents, webhooks for existing intents and refunds keep working; the method just stops being offered to new customers.

**Super Admin UI** (`/integrations/payments`): cards for Razorpay and Stripe (PayPal shown as "Coming later", disabled) with an Enabled switch, an "Allow live mode" switch, number of stores connected / active, and the webhook URL note. Turning off asks for confirmation and states the effect. Audited (`payment_provider.*`), RBAC, audit-coverage test.

**Store Admin UI** (`settings/payments.tsx`, today hard-coded to COD + Razorpay): cards come from a new `admin.paymentProviders.list` returning only platform-enabled providers plus the store's own state (`not_connected | connected_test | active | live_blocked`). A card opens a drawer: write-only masked key fields, the webhook URL and signing secret to paste into the provider dashboard, mode (test; live only when `live_mode_allowed`), **Test connection**, **Activate / Deactivate**. COD is unchanged. Permission: the existing payment-management permission, checked in the service.

**Providers (`packages/payments`).** Razorpay exists (`providers/razorpay.ts`); keep it and put it behind the same gate. Add `StripeProvider` implementing the ADR-008 `PaymentProvider` interface using **Stripe-hosted Checkout (redirect), not an embedded form**: card data never touches our pages, no third-party script is added to the storefront or CSP, and PCI scope stays minimal. Amounts in the smallest unit (INR paise) recomputed server-side (rule 12); idempotency keys on every create and refund call; webhook verifies the `Stripe-Signature` header with the store's signing secret and a tolerance window, handles duplicate deliveries idempotently (`checkout.session.completed`, `payment_intent.payment_failed`, `charge.refunded`); partial refunds supported. Pin the Stripe API and SDK versions exactly. The webhook route follows the Razorpay webhook pattern (validly signed requests are not rate-limited into failure, ADR-013). Side effects via pg-boss after commit (rule 13).

**Tests.** Real-DB: a disabled provider blocks key save, activate and new intents but a webhook for an existing intent is still processed; store keys isolated per tenant and never returned; live mode blocked until allowed. Provider tests use signed fixture payloads (no network, no real keys); duplicate webhook is a no-op; amount mismatch between webhook and order is rejected. Update the isolation-suite mapping for new `admin.*` procedures.

### 6.5 Acceptance criteria

- [ ] Hub, Notifications and the three channel pages render with real data; Email stats equal a direct SQL count of `platform_email_log` for the same range (test).
- [ ] Email provider card opens the existing settings in a drawer; saving, test-send and deliveries still work exactly as before (existing `platform-mailer` tests unchanged and green).
- [ ] SMS and WhatsApp: can create a provider, secrets masked, "Test" sends through the adapter (adapter HTTP layer faked in tests, request shape asserted), result logged to `platform_message_log`, failures visible in Transactions.
- [ ] No message body, OTP, reset link or full phone number stored or shown anywhere.
- [ ] Payments enablement works end to end (6.4): Super Admin enables Razorpay and Stripe; a store sees only enabled providers; it can save test keys, test the connection and activate; disabling at platform level hides the method from new checkouts without deleting store keys or breaking existing payments; no key ever leaves the server; Stripe webhook signature, duplicate and amount-mismatch tests pass.
- [ ] Zoho CPaaS SMS and WhatsApp: provider cards show "Not enrolled"; Enable and Test send are disabled without credentials; docs-derived request shapes and DLT notes recorded; adapter tested with a faked HTTP layer.
- [ ] Old `/email` URL redirects; nav and command palette updated; e2e selectors updated.
- [ ] ADR-023 extended for the channel provider model; `DEPLOYMENT.md` documents SMS/WhatsApp setup (DLT registration, WABA setup) at the level the Zoho section does.

## 7. Phase 5: Themes cleanup and the Pages table (store admin)

### 7.1 Themes page (SE-4)

`apps/admin/src/routes/_store/online-store/theme-library.tsx`:
- Remove the **Brand and logo** and **Theme settings** header buttons and the whole **"Customise <theme>"** block (theme-settings button and the page tiles). Keep breadcrumbs, title, the theme cards, preview and activate dialogs.
- Theme cards grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` (3 per row on desktop).
- The current theme's card gets a primary **Customize** button that opens the store's home page in the Puck editor (`/online-store/editor/$pageId`). Everything else the removed section offered is reached from inside Puck: its page switcher (header, home, collection, product, cart, footer) and its Theme tab (colours, fonts, buttons). **Verify** both exist and work for a store-owned theme; if the page switcher omits any system page the tiles listed, add it (`pages` option of `EditorHeader` fed by `admin.pages.list`).
- `theme.tsx` (Brand and logo screen) and `_editor/online-store/theme-settings.tsx` are removed: delete the routes, regenerate `routeTree.gen.ts` (not committed, per rules), and add redirects from `/online-store/theme` and `/online-store/theme-settings` to the theme library so bookmarks and e2e do not 404. Logo and store identity already live in **Settings > Branding** (`settings/branding.tsx`, ADR-018: "Branding keeps logo and identity"). Check that `SiteHeader` shows the Branding logo (it currently has `logoText` only); if it does not, add an optional `logoMediaId`/"use brand logo" prop to the block (additive, no version bump, ADR-009) with schema + view + editor config + test, so removing the Brand and logo screen loses nothing.
- Update the sidebar (`app-shell.tsx`) if it links to the removed routes, and the e2e selectors.

### 7.2 Pages (SE-5)

**Remove the legacy editor.** From `online-store/pages.tsx` delete the form-based block editor: `BLOCK_TYPES`, `FieldSpec`, `PageEditor`, `PageEditorLoader`, `BlockFields`, `ScalarInput`, validation helpers and the in-page save/publish/rollback UI. Puck (`/online-store/editor/$pageId`) is the only content editor from now on. Keep the domain services Puck uses (`savePageDraft`, `publishPage`, `rollbackPage`, `blockData`); delete only code that nothing else imports (verify with `rg`; `tsc` and lint must stay clean).

**Page table.** The Pages route becomes a `DataTable` (shared kit, `docs/admin-ui-standards.md`): columns Name, URL (`/pages/...` full path), Parent, Status (Draft / Published), Updated; search; status filter; row count. Top-right **Add page** button. Theme system pages (types `header`, `footer`, `product_template`, `collection_template`, `cart_template`, slugs `template-*`) stay hidden, as today. The home page row is shown with a locked URL.

Row actions (kebab and a visible primary pair on desktop):
- **Edit**: opens a right-hand `Sheet` with the same form as Add.
- **Customize**: navigates to `/online-store/editor/$pageId` (Puck).
- Overflow: Duplicate, Unpublish, Delete (`ConfirmDialog`; refused with a message while the page has children or is referenced by a menu item, or offer to detach).

**Add / Edit drawer fields** (react-hook-form + the existing Zod contract, inline errors, dirty guard `settings-update.tsx` pattern):
1. **Page name** (`title`, required, max 200).
2. **URL** (`slug`): auto-generated from the name until the user edits it; shows the full resulting path (`/pages/<parent-slugs>/<slug>`) live; validated lowercase `a-z0-9-`, unique, not in a reserved list (system routes: `cart`, `checkout`, `account`, `products`, `collections`, `categories`, `search`, `api`, `admin`, `blog`, `policies`, `orders`, `preview`, `signup`, ... take the list from `apps/web/src/app` directory names plus `template-*`). Home slug is locked.
3. **Parent** (searchable `SimpleSelect` of pages, "No parent" first; excludes itself and its descendants).
4. **Meta title** (soft limit 60 with counter) and **Meta description** (soft limit 160 with counter), stored in the existing `pages.seo` JSON as `{ title, description }`; reuse `components/seo-card.tsx` if it fits.
5. **Feature image** (media picker + upload via the Phase 1 `uploadMedia` helper), stored as `seo.imageMediaId` and used as the Open Graph / share image and the page preview thumbnail. Missing or deleted media must render gracefully (no broken image).
6. Status is controlled from Puck's Publish and from the table's Unpublish; creating a page creates a draft with an empty valid document and, on **Save and Customize**, opens Puck straight away.

**Hierarchy (data and URLs).** Expand migration: `pages.parent_id uuid NULL` with a composite tenant foreign key to `pages(tenant_id, id)` (use `tenantForeignKey`, rule 1), index `(tenant_id, parent_id)`. Rules:
- Max depth 3; cycle prevention in the domain service (walk up from the chosen parent; reject if it hits the page); parent must belong to the same tenant (the composite FK enforces it, add a test).
- Slug stays unique per tenant (existing `pages_tenant_slug_uniq`), so a page can never shadow another. The **canonical public URL is `/pages/<ancestor slugs>/<slug>`**. Change the storefront route `apps/web/src/app/pages/[slug]` to a catch-all `[...path]`, resolve by the last segment, verify the full ancestor chain matches, and 308-redirect any other path to the canonical one (no duplicate content). Add a sibling `loading.tsx` (rule 11) and update `sitemap.xml` and `robots` handling, breadcrumbs and canonical tags.
- Cache: invalidating a page also invalidates its descendants' paths (`cache-invalidation.ts`, tenant-prefixed tags only, rule 5). Changing a parent or slug invalidates the page and all descendants.
- Deleting a page with children is refused. Menu items of type `page` store the page id (Phase 6) so they survive slug changes.

**Contracts.** Extend `pages.create` / `pages.update` input and `pages.list` output additively: `parentId`, `seo`, `path`, `childCount`. Handler in `apps/web/src/server/api.ts`; domain in `packages/domain/src/content-services.ts`.

### 7.3 Tests and acceptance

- [ ] Real-DB: parent in another tenant rejected; cycle rejected; depth 4 rejected; duplicate/reserved slug rejected; delete with children refused; `parent_id` self-reference works under RLS; isolation suite mapping updated.
- [ ] Storefront: `/pages/about` and `/pages/company/about` resolve per hierarchy; wrong ancestor path redirects (308) to canonical; unknown path 404; cached page refreshes after a parent change.
- [ ] Admin: table lists pages with correct paths; Add drawer creates a page and shows it immediately; Edit saves SEO and feature image; Customize opens Puck on the right page; walked at 375 px and desktop.
- [ ] No reference to the removed legacy editor remains (`rg "BLOCK_TYPES|BlockFields|PageEditorLoader"` empty); the Themes page shows 3 cards per row and none of the removed controls; old URLs redirect.
- [ ] ADR-026 (page hierarchy and canonical URLs) written; `ARCHITECTURE.md` routes, data model and storefront routes updated.

## 8. Phase 6: Navigation builder (Shopify-style) with filter menus

### 8.1 What "like Shopify" means here

Shopify's Navigation lists menus (Main menu, Footer menu, any custom menu), and the editor adds items by picking a link target from a searchable list, with nesting and drag-to-reorder. Separately, Shopify's **Search & Discovery** app defines **storefront filters** (availability, price, brand, product type, options like size or colour) shown on collection and search pages. This phase delivers both, in our model:

- **Navigation menus** (header, footer, any custom handle): list page + editor.
- **Filter menus** ("Shop filter"): the facets shown on the collection grid, search and category pages.

### 8.2 Make the storefront actually use menus (prerequisite)

`SiteHeader` / `SiteFooter` blocks currently hold inline `links` (`registry.ts` ~L587 to L640) and the `menus` table is never read by the storefront (`apps/web` only references menus in the admin API). Fix, additively (ADR-009, no block version bump):
- Add optional `menuHandle` to `SiteHeader` (default `"header"`) and to each `SiteFooter` column (or one `menuHandle` per column). When set and the menu exists, render its tree (nested items become dropdown / mega-list on desktop and an accordion in the mobile drawer); otherwise fall back to the inline `links`, so existing stores do not change.
- Resolve menus on the server inside `resolvePageRenderData` in the same tenant transaction and `"use cache"` scope as the page, tagged with the existing menu tag (`cache-invalidation.ts` already has a "Menu -> nav" mapping: confirm what consumes it and wire it). Resolve link targets at render time: `page` by id (current path), `collection`/`product`/`category` by id (current slug), so renames never break links; dead targets are skipped, not rendered as broken links.
- Editor: a "Navigation menu" select in the header/footer block panel listing the store's menus, with a link to the Navigation screen.

### 8.3 Navigation screen redesign (`online-store/menus.tsx`)

- **Menus list** (table): Title, Handle, Kind (Navigation / Filter), item count, "Used in" (header, footer, collection grid), Updated. Add menu (drawer: title, handle auto from title, kind). Default menus `header` and `footer` are protected from deletion (as Shopify's main menu) and are created on store provisioning if absent (check `saas/provisioning.ts` / `demo-store.ts`).
- **Editor** (page per menu, `menus_.$handle.tsx`): a tree with **drag-and-drop reorder and nesting** using `@dnd-kit` (new dependency: pin the exact version as the other `package.json` files do, justify in the change record; keyboard-accessible drag handles and the existing up/down buttons kept as the non-pointer path; max depth 3). Unsaved-changes guard; Save is atomic (`menus.update`).
- **Add item drawer** with a link-type picker and searchable resource list: Pages, Collections, Categories, Brands, Products, Blog, Policies, Search, Account / Login, Home, **Custom URL** (validated: `/`, `#`, `https:`, `mailto:`, `tel:` only, ADR-010). Item fields: label, target, open in new tab (only for `https:`). Extend `MenuItem.type` additively (`brand`, `blog`, `policy`, `home`, `search`, `account`) and keep `url` as the resolved fallback.
- Preview strip showing the menu as the header would render it (reuse `BlocksPreview`).

### 8.4 Filter menus (Shop filter)

**Data.** Expand migration on `menus`: `kind text NOT NULL DEFAULT 'navigation'` (`navigation` | `filter`). A filter menu's `items` are filter definitions: `{ id, type: "filter", filter: { kind, label, display, optionName?, collapsed? } }` where `kind` is one of `availability`, `price`, `brand`, `category`, `collection`, `tag`, `option` (variant option such as Size or Colour, by option name), and `display` is `checkbox` | `range` | `swatch`. Validate with a Zod discriminated union in `packages/contracts`; reject anything else (no free-form queries).

**Where it is used.** `CollectionListing` (and the category and search listings) gets an optional `filterMenuHandle` prop (additive, default none = today's sort + in-stock bar). Per-collection override is out of scope for v1 (note as a follow-up).

**Storefront behaviour.** `CollectionListingSection` renders the facets from the filter menu with counts, as a sidebar on desktop and a bottom sheet on mobile; selections are URL search params (`?brand=a,b&price=100-500&size=m&in_stock=1`) so pages stay cacheable, shareable and crawlable (canonical tag ignores filter params; `rel=nofollow` on filter links; cap combinations to protect the cache). Facet counts and filtering run server-side in one tenant transaction using **parameterised Drizzle queries only** (no string-built SQL), inputs bounded (max values per facet, max facets, price range clamped, option names must exist in the menu definition). Performance: single query per facet group with indexes reviewed (`EXPLAIN` evidence in the change record for a store with ~5k products), cached with tenant-prefixed tags, and p95 render budget not worse than today for stores that do not use filters.

**Admin.** In the same Navigation screen the "Kind" decides the editor: a filter menu editor lists available facets (add / remove / reorder / rename / choose display), with the option names and brands the store actually has offered in a picker.

### 8.5 Contracts and tests

Additive changes to `Menu`, `MenuItem`, `menus.create/update` (kind, new item types), `menus.list` output (`kind`, `itemCount`, `usedIn`); new storefront data kind for facets (block-data / listing query). Isolation suite mapping updated for any new `admin.*` procedure.

Tests: real-DB menu CRUD with kind; protected defaults; tree validation (depth, URL scheme, unknown filter kind); `resolvePageRenderData` returns resolved links and skips dead targets; renaming a page slug keeps the menu link correct; storefront filter query returns correct counts and results for each facet kind against seeded data and never leaks another tenant's products; header/footer with no `menuHandle` render exactly as before (snapshot).

### 8.6 Acceptance criteria

- [ ] Editing the `header` menu changes the live storefront header (after cache invalidation); stores with no menu still render their inline links.
- [ ] Drag-and-drop nests and reorders; keyboard path works; save persists; unsaved guard works.
- [ ] A filter menu with availability, price, brand and one option facet filters a collection correctly, with counts, via URL params, on desktop and mobile.
- [ ] No new third-party script on the storefront; no merchant-controlled code (rule 8); URL schemes validated.
- [ ] Walked at 375 px and desktop; Lighthouse/CLS note for a collection page with filters.
- [ ] ADR-026 extended for menus-in-storefront and filter menus; `ARCHITECTURE.md` updated.

## 9. Cross-cutting requirements (every phase)

- **Security (AGENTS.md section 2):** tenant tables via `tenantTable()` + `forceRlsSql`; domain services check permissions; platform mutations audited; secrets encrypted and never returned; no merchant code; cache tags tenant-prefixed; side effects via pg-boss after commit; DB roles unchanged except the documented `app_rw` SELECT grants.
- **API order:** contract in `packages/contracts` first, then handler, domain service, UI. New `admin.*` procedures are added to `packages/domain/test/isolation.int.test.ts` or the heavy job fails.
- **Admin UI standards** (`docs/admin-ui-standards.md`): shared kit, no native `<select>`, no `window.confirm`, no hand-rolled tables, every route has `pendingComponent`, every storefront `page.tsx` has `loading.tsx`, skeletons not spinners, inline field errors, empty states, 375 px layout, keyboard and focus handling, plain-language error text.
- **Best-practice references used:** Cloudflare R2 CORS and presigned URL guidance (CORS must allow the exact admin origin and `PUT`; `Content-Length` is a forbidden browser header); OWASP file-upload cheat sheet (allow-list MIME, verify magic bytes, random server-generated names, size limits, serve user content from a separate origin or with a sandboxing CSP, never execute); OWASP path-traversal guidance for the local driver; NIST/OWASP secrets storage (encrypt at rest, write-only secret fields, rotate by key version); TRAI DLT rules for Indian SMS (registered sender ID and templates); Meta WhatsApp Cloud API template rules; Shopify Navigation and Search & Discovery as the UX reference; WAI-ARIA authoring practices for drag-and-drop alternatives (keyboard reordering) and drawers (focus trap, Escape to close).
- **Migrations:** expand only in these phases (new tables and nullable columns). No drop or rename of a column in the same release that stops using it (`quota_definitions.tier_*` stay until a later contract release; record that follow-up in `progress.md` known gaps).
- **Docs:** `ARCHITECTURE.md` (sections 3, 7, 8, 9, 11, 14 as touched, bump "Last verified"), ADRs, `DEPLOYMENT.md`, `.env.example`, `progress.md`, change record per phase.

## 10. Verification protocol (what Claude will do for each phase)

1. Read the diff against this plan section by section; tick each acceptance criterion with evidence (file, test name, or a run).
2. Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`; run touched packages' tests **one package at a time**, plus `pnpm --filter @bs/domain test:heavy` and the isolation suite; confirm counts match the change record.
3. Run the apps locally and walk each screen at 375 px and desktop; for Phase 1 reproduce the original upload failure and confirm it is gone with R2 CORS removed; for Phase 5 and 6 load the storefront.
4. Send back anything failing with the specific criterion; "done" means verified, not written. A phase that touched labels or nav must show the e2e selectors updated.

## 11. Owner decisions (defaults will be built unless you say otherwise)

| ID | Question | Default used |
|---|---|---|
| D1 | Can a merchant permanently delete orders? | Two steps: **archive first**, then delete from the Archived view. Delete is offered only for archived orders that are cancelled (or draft), unpaid, uninvoiced, unshipped and without returns or ledger entries, by owner/admin, audited. Paid or invoiced orders can never be deleted (GST and ledger integrity). |
| D2 | What does a tier price mean, and is it billed automatically? | Price of that resource size, stored in paise, shown in Super Admin; not wired into invoices or subscriptions in this work. |
| D3 | Should SMS and WhatsApp be mapped to OTP and order notifications now? | No. Setup, logs and stats only (test send stays disabled until credentials exist); flow mapping comes later behind a feature flag. |
| D4 | Local storage allowed in production? | Allowed, with a visible warning, since it is a deliberate choice; R2 stays the recommended default. |
| D5 | Which SMS and WhatsApp provider? | **Zoho CPaaS** (the product ZeptoMail now belongs to) for both. Built and configurable but **not enrolled**: no account, credentials or live sending in this work (section 6.2). |
| D6 | Payments | Razorpay and Stripe only, test mode only. Super Admin enables a provider platform-wide; each store then connects its own keys and activates it (section 6.4). PayPal and shipping are later. The owner lifted AGENTS.md rule 14 for this scope on 2026-10-08; live keys are not enrolled. |

## 12. Out of scope (do not build)

Shipping integrations (Shiprocket or any courier: later, separate plan); PayPal (later); live-mode payment enrolment for any provider; Zoho CPaaS account enrolment and live SMS/WhatsApp sending; wiring SMS/WhatsApp into OTP/order flows; email bounce webhooks and open tracking; copying existing media between storage connections; per-collection filter overrides; moving tenants between quota tiers automatically; billing/invoicing from tier prices; changes to the checkout UI beyond adding the new payment methods to the existing method picker.
