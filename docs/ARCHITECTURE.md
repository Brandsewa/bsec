# bsec architecture map

> **Living document.** This is the index any engineer or AI agent reads first to find out what bsec is, where each thing lives and how the parts connect. Rules for keeping it current are in [section 0](#0-how-to-use-and-maintain-this-document). Rules for *changing the code* are in [`AGENTS.md`](../AGENTS.md). What changed and when is in [`docs/changes/`](changes/README.md). Roadmap and milestone status is in [`progress.md`](../progress.md).

| | |
|---|---|
| Last verified against | branch `feat/settings-rebuild-phase-0-1` (Settings rebuild Phases 0-1), 2026-10-04 |
| Verified how | files read from the working tree; `pnpm docs:check` for the mechanical parts. Facts marked *(from code)* were read, not run. |
| Owner | whoever changes the area (see the update triggers in section 0) |

---

## 0. How to use and maintain this document

**Reading it.** Start at section 1 to know what the product is, section 3 for the file map, then jump to the section for the area you are touching. Every section names the real file paths so you can open the source next.

**Keeping it current.** A change is not done until the docs match (Definition of Done, `AGENTS.md` section 7). Update this file in the **same commit** when you:

| You changed | Update section |
|---|---|
| Added, removed or renamed an app or package | 3 (repo map) and 4 (topology, if it runs) |
| Added a migration or table | 7 (data model) |
| Added or removed an oRPC procedure, REST route or page | 8 (API surface) and 9 (UI routes) |
| Added a block type or theme page | 10 (blocks and themes) |
| Added a queue, job or schedule | 11 (jobs) |
| Added a permission, role or auth flow | 12 (auth) |
| Added an env var or deploy step | 14 (config) and `DEPLOYMENT.md` |
| Added a test layer or changed a gate | 15 (testing) |
| Made an architectural decision | write an ADR, then section 16 |

Then bump the "Last verified against" commit above. `pnpm docs:check` (also run in CI) fails if an app/package, ADR or migration exists on disk but is missing from the docs.

**What this file is not.** It is not a changelog (use `docs/changes/`), not the roadmap (`progress.md`), not the product plan (`docs/PLAN.html`), and not a place for secrets.

---

## 1. What bsec is

**bsec** ("Bs Commerce platform") is a **multi-tenant SaaS for Indian D2C stores**, run by Brand Sewa. A store is a *row of data* (a tenant), never a new server: many stores share one codebase, one Postgres 18 database and one small VPS.

Three kinds of users:

| User | Surface | App |
|---|---|---|
| **Shopper** (store customer) | the storefront on the store's host, plus a customer account area | `apps/web` |
| **Merchant** (store owner/staff) | store admin at `admin.<root>` | `apps/admin` (UI), API in `apps/web` |
| **Platform staff** (Brand Sewa) | Super Admin at `superadmin.<root>` | `apps/superadmin` (UI), API in `apps/platform` |

Production root domain is `bcom.si` (web, `admin.`, `platform.`, `superadmin.`, `media.` for R2 images). Stores live at `<slug>.bcom.si` or a custom domain. First real store: **Taste of Hills** (`tasteofhills.bcom.si`).

**Sources of truth, in order:** `docs/PLAN.html` v2.0 (product and architecture plan, 17 sections), `docs/adr/` (decisions), then this file, then `progress.md` (status). If they disagree, the ADR wins over this file, and the code wins over everything, so fix the doc.

> **Not this repo:** `AI Projects/bsecom 2026` ("taste-of-hills", an older single-store Next.js app) is a legacy project. Platform work belongs here.

**Stage (2026-10-01):** M0 to M9 and M10 (theme editor) built and deployed. Cash on delivery works end to end; **online payment (Razorpay), courier (Shiprocket) and transactional email delivery are not live** (credentials deferred by decision). See `progress.md` for the exact matrix.

---

## 2. System at a glance

```
                       Cloudflare (DNS, TLS, R2 media.bcom.si, Turnstile)
                                          |
                                  Coolify / Traefik (single VPS)
        +--------------+----------------+----------------+----------------+
        |              |                |                |                |
   bsec-web       bsec-platform    bsec-worker      bsec-admin     bsec-superadmin
   Next.js 16     Hono + oRPC      pg-boss          nginx + SPA    nginx + SPA
   :3000          :4000            consumers :4100  :8080          :8081
   app_rw (+saas) app_platform     app_rw (+saas)   (no DB)        (no DB)
        |              |                |
        +------+-------+----------------+
               v
        PostgreSQL 18  (RLS on every tenant table; pg-boss schema `pgboss`)
               ^
        bsec-migrate (one-shot before each deploy, app_owner)
```

- **bsec-web** serves the storefront (server-rendered, Cache Components), the marketing/signup pages, the customer account, and the **Store API** (oRPC at `/api/rpc`, REST-ish routes under `/api/storefront`, Better Auth at `/api/auth`, webhooks at `/api/webhooks`).
- **bsec-admin** is a static SPA that talks to the Store API on `<root>` with cookies shared across `.bcom.si` (ADR-014 admin auth).
- **bsec-platform** is the only service holding `BYPASSRLS` credentials. The Super Admin SPA talks to it. Its session cookie is host-only.
- **bsec-worker** runs side effects (email, reservation expiry, sweeps) after a business transaction commits, via pg-boss (transactional outbox, ADR-006).
- There is **no staging server**: CI starts an ephemeral compose stack from the freshly built images, smoke-tests it, tears it down, then deploys production.

---

## 3. Repository map

pnpm workspace + Turborepo. Node `24.15`, pnpm `10.34.5`, TypeScript 6, ESLint 10, Vitest 5. Workspaces: `apps/*`, `packages/*`, `e2e`.

### Apps

| Path | Package | Stack | Purpose | DB role |
|---|---|---|---|---|
| `apps/web` | `@bs/web` | Next.js 16 (Cache Components), React 19 | Storefront, marketing and `/signup`, customer account, Store API at `/api` | `app_rw` (+ `app_saas`) |
| `apps/platform` | `@bs/platform` | Hono + oRPC, Better Auth (platform) | Platform/Super Admin API, MFA, support sessions, tenant lifecycle | `app_platform` |
| `apps/admin` | `@bs/admin` | Vite, React 19, TanStack Router (file routes), shadcn on Base UI | Store admin SPA, plus `/platform` and `/support` shells | none (HTTP only) |
| `apps/superadmin` | `@bs/superadmin` | Vite, React 19 | Platform staff SPA | none (HTTP only) |
| `apps/worker` | `@bs/worker` | Node, pg-boss | Queue consumers, schedules, `/health` | `app_rw` (+ `app_saas`) |

### Packages

| Path | Package | What it holds |
|---|---|---|
| `packages/db` | `@bs/db` | Drizzle schema (`src/schema/*`), `tenantTable()` helper, migrations (`migrations/`), role bootstrap and migrate scripts (`src/scripts`), queue registry (`src/queues.ts`) |
| `packages/domain` | `@bs/domain` | **All business logic.** Services per area (catalog, orders, returns, return-photos, return-settings, order-settings, preorders, quotes, customers, themes, saas, platform, system), `TenantContext`, `withTenant` runtime, cache tags and invalidation, job handlers (`jobs.ts`), logger |
| `packages/contracts` | `@bs/contracts` | oRPC contracts + Zod schemas: `admin.ts`, `storefront.ts`, `platform.ts`, `index.ts` (`storeContract`, `platformContract`) |
| `packages/auth` | `@bs/auth` | Better Auth configs (`staff.ts`, `platform.ts`, `customer.ts`), `STORE_PERMISSIONS`, `PLATFORM_ROLES`, system roles |
| `packages/blocks` | `@bs/blocks` | Versioned block registry (Zod schemas + views), document validation, sanitiser, tree renderer, theme page templates, `--bs-*` theme variables |
| `packages/block-editor` | `@bs/block-editor` | Puck-based visual editor config, theme settings panel, media field, preview. Lazy-loaded by the admin; never shipped to shoppers |
| `packages/payments` | `@bs/payments` | Provider adapter (ADR-008): `cod`, `razorpay`, `mock`; secret encryption helper |
| `packages/shipping` | `@bs/shipping` | Provider adapter: `manual`, `shiprocket` (Shiprocket is never called yet) |
| `packages/ui` | `@bs/ui` | Admin design system: tokens (`styles/tokens.css`), page layout, patterns (data-table, filter bar, metric card), skeletons |
| `packages/config` | `@bs/config` | Shared tsconfig, ESLint factory `defineBsConfig` (with `bs/*` rules), esbuild bundler, Vitest config, Tailwind base |

### Everything else

| Path | Purpose |
|---|---|
| `docs/` | `ARCHITECTURE.md` (this), `PLAN.html`, `adr/`, `changes/` (change log), `runbooks/`, `audit/`, `superpowers/` (milestone plans/specs), `admin-ui-standards.md`, `BUILD-PLAN-M2-M9.md`, `AUTH-OVERHAUL-PLAN.md`, `FAST-LOCAL-TESTS.md`, `migrations.md`, `M1-BUILD-GUIDE.md`, `M8-FIXES-PROGRESS.md` |
| `infra/` | `docker/` (one Dockerfile per app + nginx confs), `coolify/RUNBOOK.md` (real UUIDs and config), `backups/`, `loadtest/` (k6 scripts), `monitoring/`, `runbooks/`, `uptime/` |
| `e2e/` | Playwright: `admin.spec.ts`, `superadmin.spec.ts` (run in CI against the ephemeral stack) |
| `scripts/` | `extract-plan.cjs`, `check-docs.mjs` (docs freshness check) |
| `.github/workflows/ci.yml` | The only pipeline: gates (incl. `secret-scan`), images, staging smoke test, production deploy |
| `.github/` (other) | `dependabot.yml` (weekly updates), `CODEOWNERS`, `PULL_REQUEST_TEMPLATE.md`; `.gitleaks.toml` at the root configures the secret scan; `.claude/settings.json` denies agents reading `.env*`/keys and asks before force-push, `reset --hard`, `--no-verify` |
| `docker-compose.yml`, `docker-compose.staging.yml`, `docker-compose.test-db.yml` | local stack, CI ephemeral stack, test database |
| `DEPLOYMENT.md` | Env vars per service, DB role table, operator tools, wildcard routing |
| `progress.md` | Milestone status board and known gaps |

Git: `main` is production (every push to `main` that passes CI **deploys**). Feature work happens on branches, often in sibling git worktrees (`bsec`, `bsec-m8fix`, `bsec-m9` next to each other under `bs-commerce-platform/`).

---

## 4. Runtime topology, roles and deploy

### Database roles (ADR-002; `packages/db/src/sql/roles.ts`, `saas-grants.ts`)

| Role | Used by | Capability |
|---|---|---|
| `app_owner` | `bsec-migrate` only | Owns all tables, runs migrations. Never used at runtime |
| `app_rw` | web, worker | DML only, `NOBYPASSRLS`. Subject to RLS |
| `app_saas` | web, worker (second pool, optional) | Member of `app_rw` + write on a few platform-owned tables, for signup, billing webhook and trial sweep only. Disabled when `DATABASE_URL_SAAS` is unset |
| `app_platform` | platform only | DML only, **`BYPASSRLS`** |

### CI/CD (`.github/workflows/ci.yml`)

```
PR or push -> check-fast (typecheck, lint, build, test:fast) + check-heavy (test:heavy on real Postgres 18)
             + secret-scan (Gitleaks CLI over full history, config .gitleaks.toml; images wait for it)
push to main -> images (web, platform, worker, admin, superadmin, migrate -> ghcr.io/brandsewa/bsec-*)
             -> staging-smoke-test (ephemeral compose, /health checks, Playwright e2e)
             -> deploy production (Coolify: run bsec-migrate, then deploy the app UUIDs)
```

Gotcha that already bit once: a new Coolify app must also be added to `APP_UUIDS` in `ci.yml`, or its image is built but never redeployed (Super Admin, 2026-10-01). Coolify UUIDs and the resource table live in `infra/coolify/RUNBOOK.md`.

### Local development

`docker compose up --build` runs everything; or `docker compose up -d postgres migrate` and run apps with `pnpm --filter @bs/web dev` (3000), `@bs/admin dev` (5173), `@bs/superadmin dev` (5174), `@bs/platform dev` (4000), `@bs/worker dev`. See `README.md`.

---

## 5. Request and data flows

**Storefront page (`apps/web`).** Request hits `src/middleware.ts` -> it calls `/api/storefront/status/evaluate?host=` (store status: live / coming_soon / maintenance / password, unknown host 404, suspended) -> page renders with `"use cache"` loaders in `src/server/cached-storefront.ts`, each tagged with `tenantTag(...)` -> domain read services run inside `withTenant` (sets `app.tenant_id` for RLS) -> blocks render through `@bs/blocks` `renderBlockTree`. Host to tenant lookup is `packages/domain/src/host-resolver.ts`, cached in memory for 60 s (so a suspend can take up to 60 s to reach shoppers).

**Admin write (`apps/admin` -> `apps/web`).** SPA calls the oRPC client (`apps/admin/src/lib/orpc.ts`) with the session cookie and an `X-Store-Id` header -> `apps/web/src/server/api.ts` (Hono app mounted at `/api`) builds a `TenantContext` (membership, roles, permissions) -> handler calls a `@bs/domain` service -> service checks `assertPermission`, runs in `withTenant`, writes audit row, enqueues jobs in the same transaction, calls `revalidateTag` for affected tenant tags (`cache-invalidation.ts`).

**Platform action (`apps/superadmin` -> `apps/platform`).** Better Auth session + MFA (`/api/platform/mfa/complete`) -> `apps/platform/src/app.ts` oRPC router (`platformContract`) -> role guard (`assertRoleAtLeast`) -> domain `platform-services` / `platform/*` with the `BYPASSRLS` pool -> `platform_audit_logs` row. Every platform mutation must be audited (`apps/platform/test/audit-coverage.int.test.ts` enforces it).

**Checkout (COD today).** `/checkout` -> `POST /api/storefront/checkout/place-order` -> `orders/checkout.ts` (prices recomputed server-side from the store's own shipping rates and discounts, stock reserved via `inventory_reservations`, order + payment intent in one transaction, idempotency key) -> `order.created` job -> emails. Online payment (Razorpay) builds on `payment_intents`/`payment_attempts`/webhook inbox but is **not live**.

**Background work.** Business code enqueues pg-boss jobs *inside* its transaction; `apps/worker` consumes them (`packages/domain/src/jobs.ts`). See section 11.

---

## 6. Tenancy and security model

Read ADR-002 before touching anything here. The invariants:

1. **Every tenant table is declared with `tenantTable()`** (`packages/db/src/tenant-table.ts`): adds `tenant_id`, enables RLS and the `tenant_isolation` policy using `nullif(current_setting('app.tenant_id', true), '')::uuid`. The migration for the table must also run `forceRlsSql(name)` (drizzle-kit cannot emit `FORCE ROW LEVEL SECURITY`); the isolation suite asserts `relforcerowsecurity` for every tenant table.
2. **Composite foreign keys** between tenant tables (`tenantForeignKey`: `(tenant_id, col) -> (tenant_id, id)`) so a row can never reference another tenant's row.
3. **Only `packages/db` and `packages/domain` may import `@bs/db`, `drizzle-orm`, `pg` or `postgres`.** Everything else calls a domain service. Enforced by ESLint (`no-restricted-imports` in `packages/config/eslint/index.js`).
4. **Cache tags are tenant-prefixed**: `tenantTag(ctx, kind, id?)` -> `t:{tenantId}:{kind}[:{id}]`. Kinds: product, collection, category, page, theme, nav, store-shell, seo. Rule `bs/tenant-cache-tag`.
5. **No merchant code runs on our servers** (ADR-010): themes and pages are validated JSON blocks with enumerated props, safe links and allow-listed video hosts. No custom JS/CSS/Liquid.
6. **Secrets**: tenant provider credentials are AES-256-GCM encrypted in `tenant_secrets` (`TENANT_SECRETS_KEY`, alias `ENCRYPTION_KEY`) and never returned to a browser (UI sees set/not-set).
7. **Platform isolation**: platform session cookie is host-only; only `SUPERADMIN_ORIGINS` may call it with credentials; MFA required; support access to a store needs the merchant's consent (`support_sessions`, standing consent).
8. **Quotas and rate limits** (ADR-013, ADR-015): per-tenant quotas, size tiers, `rate_limit_counters`; login failure limiter for admin.
9. Tests that guard this: `packages/domain/test/isolation.int.test.ts` (525+ cases), `storefront-isolation.int.test.ts`, `apps/platform/test/rbac.int.test.ts`, `audit-coverage.int.test.ts`.

---

## 7. Data model

Drizzle schema files in `packages/db/src/schema/` (one Postgres database, `public` schema; pg-boss in `pgboss`). `T` = tenant table (RLS), `P` = platform table (no `tenant_id`).

| File | Tables |
|---|---|
| `tenants.ts` | `organizations` P, `tenants` P |
| `identity.ts` | `users`, `sessions`, `accounts`, `verifications`, `two_factors` (Better Auth, store staff) P; `roles`, `memberships`, `staff_invitations`, `audit_logs`, `customer_sessions` T |
| `catalog.ts` | `media`, `brands`, `locations`, `categories`, `products`, `product_options`, `variants`, `product_media`, `product_categories`, `collections`, `collection_products`, `inventory_levels`, `inventory_movements`, `reviews` T |
| `inventory-reservations.ts` | `inventory_reservations` T |
| `cart.ts` | `carts`, `cart_items` T |
| `customers.ts` | `customers`, `customer_notes`, `customer_addresses`, `customer_consent_events`, `wishlist_items`, `customer_otps` T |
| `orders.ts` | `orders`, `order_items`, `order_events`, `order_notes`, `number_sequences`, `action_tokens` T |
| `payments.ts` | `payment_intents`, `payment_attempts`, `refunds` T |
| `shipping.ts` | `fulfillments`, `fulfillment_items`, `tracking_events`, `returns`, `return_items`, `invoices`, `shipping_zones`, `shipping_rates` T |
| `marketing.ts` | `newsletter_subscribers`, `discounts`, `discount_redemptions` T |
| `content.ts` | `themes`, `pages`, `page_versions`, `menus` T |
| `branding.ts` | `brand_settings` T |
| `settings.ts` | `store_settings` (including `return_settings` JSONB, `auto_publish_reviews`), `store_status`, `seo_settings` T |
| `search.ts` | `search_queries` T |
| `system.ts` | `webhook_inbox`, `idempotency_keys`, `email_log` |
| `tenant-secrets.ts` | `tenant_secrets` T |
| `platform.ts` | `domains`, `feature_flags`, `tenant_feature_overrides`, `platform_staff`, `platform_staff_invitations`, `support_sessions`, `tenant_deletions`, `tenant_notes`, `export_files` |
| `quotas.ts` | `rate_limit_counters`, `quota_definitions`, `tenant_size_tiers`, `tenant_quota_overrides`, `quota_events`, `tenant_active_jobs` |
| `saas.ts` | `plans`, `subscriptions`, `platform_invoices`, `platform_audit_logs`, `theme_templates`, `signup_leads`, `slug_reservations`, `reserved_slugs`, `onboarding_progress`, `tenant_owner_invites`, `exports` |
| `quotes.ts` | `quote_requests` T |
| `index.ts` | `_platform_meta` |

(Exact tenant/platform split per table: check the declaration, `tenantTable(` vs `pgTable(`. Column details: read the schema file.)

### Migrations (`packages/db/migrations/`, run only by `app_owner`)

| # | File | Adds |
|---|---|---|
| 0000 | `init` | base |
| 0001 | `extensions` | citext, pg_trgm |
| 0002 | `uuidv7` | uuid v7 function |
| 0003 | `m1_tables` | tenants, identity, RLS base |
| 0004 | `m2_tables` | catalog |
| 0005 | `m3_storefront` | cart, settings, content, branding |
| 0006 | `m4_payment_orders` | orders, payments |
| 0007 | `m5_fulfillment` | fulfillment, returns, invoices |
| 0008 | `m6_feature_flags` | feature flags |
| 0009 | `m7_rate_limits` | rate limit counters |
| 0010 | `m7_shipping_zones` | zones and rates |
| 0011 | `m75_membership_self_read` | membership self-read policy |
| 0012 | `m8_saas_platform` | plans, subscriptions, signups, quotas |
| 0013 | `m8_security_hardening` | hardening |
| 0014 | `m9_superadmin_saas` | super admin tables |
| 0015 | `m10_theme_library` | `theme_templates` draft/published, launch theme "Essential Commerce" |
| 0016 | `m10_theme_pages` | theme pages |
| 0017 | `platform_email` | `platform_email_settings` and email log (auth overhaul, phase A) |
| 0018 | `customer_auth` | `customers.phone` nullable, so customers can register with email + password |
| 0019 | `domain_bcom_si` | platform domain gobs.cloud -> bcom.si: rewrites platform `domains` hostnames and the default sender |
| 0020 | `preorders` | preorder flags on variants, ships_on on variants/orders/order_items, preorder_released_at |
| 0021 | `order_tags` | orders.tags text[] array for categorization and filtering |
| 0022 | `quotes` | products.price_on_request, quote_requests table with RLS and number sequences |
| 0023 | `returns` | returns & return_items resolution columns, product returnable flag, store returnSettings |
| 0024 | `catalog_indexing` | collections.indexable boolean for SEO indexing controls |
| 0025 | `categories_active_featured` | categories.is_active and is_featured columns |
| 0026 | `reviews` | reviews table with RLS, ratings check constraint, store_settings.auto_publish_reviews |
| 0027 | `product_categories_primary` | product_categories.is_primary column with unique index per product |
| 0028 | `customers_phase0` | customers is_guest, marketing consent fields, and customer_consent_events table |
| 0029 | `customers_phase1` | customer_notes table (staff notes timeline); migrates the single customers.note into the first note |

How to write one (expand, migrate, contract; `forceRlsSql`): `docs/migrations.md`. **Never edit an applied migration.** Latest on disk: `0029` (the docs check keeps this list honest).

---

## 8. API surface

Contracts are the single source of truth (`packages/contracts`); handlers are in `apps/web/src/server/api.ts` (store) and `apps/platform/src/app.ts` (platform). oRPC served as RPC (`/api/rpc/*`, `/rpc/*` on platform) and OpenAPI.

**`storeContract`** (`@bs/contracts`, mounted in web at `/api`)
- `system.health`
- `storefront.*`: `search`, `searchSuggestions`, `cart.{get,addItem,updateItem,removeItem,clear,estimateShipping}`, `newsletter.subscribe`, `status.verifyPassword`
- `admin.*` (membership + `X-Store-Id`): `support`, `me`, `payments` (Razorpay credentials), `memberships`/`roles`/`invitations`, `settings`, `settingsOverview`, `orderSettings` (`get`, `update`), `returnSettings` (`get`, `update`), `featureFlags`, `products` (+ `variants`, media attach/detach), `categories`, `collections`, `brands`, `locations`, `reviews`, `inventory`, `media` (R2 presigned upload), `branding`, `themes` (`get`, `update`, `library`, `preview`, `activate`), `pages` (`list`, `get`, `versions`, `blockData`, `create`, `update`, `saveDraft`, `publish`, `rollback`), `menus`, `orders` (list, stats, get, createDraft, notes, cancel, refund, fulfillment, invoice, confirm, advance), `abandonedCheckouts` (stats, list), `returns` (stats, list, get, act), `customers` (list, stats, tags, get, create, update, orders, activity, consent, addresses, notes, status, set tags, import preview/commit, delete), `discounts`, `shipping`, `storefront` (status), `onboarding`, `billing`, `domains`

**Non-oRPC routes in web** (`apps/web/src/app/api/`): `storefront/cart/*`, `storefront/checkout/place-order`, `storefront/customer/*` (OTP request/verify, profile, addresses, logout), `storefront/orders/[token]/return` (+ `/photo`, `/photo/finalize`, `/cancel`), `storefront/reviews` (GET list, POST create), `storefront/address/[token]`, `storefront/unsubscribe/[token]`, `storefront/search/suggestions`, `storefront/status/evaluate`, `webhooks/[provider]`, `webhooks/platform-billing`, `health`, and the catch-all `[[...route]]` that mounts the Hono app (Better Auth at `/api/auth/*`, oRPC).

**`platformContract`** (`apps/platform`): `system` (health, data, retryJob, retryWebhook), `overview`, `tenants` (list/detail/create-for-client/suspend/restore/archive/plan/trial/ownership/notes/bulk ops/schedule deletion), `domains`, `plans`, `signups`, `templates` (theme templates: create, edit in Puck, publish, hide), `support`, `quotas`, `features`, `staff`, `audit`. Plain HTTP: `/api/auth/*`, `/api/platform/me`, `/api/platform/mfa/complete`, `/api/platform/staff/accept-invitation`, `/api/platform/exports/:id/download`, `/health`.

Procedure-level detail: open the contract file; do not duplicate it here.

---

## 9. UI route maps

**Storefront (`apps/web/src/app`)**: `/` (home), `/products/[slug]`, `/collections/[slug]`, `/categories/[slug]`, `/search`, `/cart`, `/checkout`, `/orders/[token]/thank-you`, `/o/[token]` (guest order view + return request), `/cod/[token]`, `/account` (+ `orders/[id]`, `addresses`, `profile`), `/address/[token]`, `/unsubscribe/[token]`, `/pages/[slug]`, `/policies/[type]`, `/blog`, `/blog/[slug]`, `/signup` (marketing host only), `robots.txt`, `sitemap.xml`. Every `page.tsx` needs a sibling `loading.tsx` (`bs/route-pending`).

**Store admin (`apps/admin/src/routes`, TanStack file routes; `routeTree.gen.ts` is generated, not committed)**: `login`, `accept-invite`, `_store/` (dashboard `index`, `orders` + `orders_.$orderId` + `orders_.new`, `products` (+ `new`, `$id`), `categories` (+ `categories_.new`, `categories_.$id`), `collections` (+ `collections_.new`, `collections_.$id`), `brands`, `locations` (+ `locations_.new`, `locations_.$id`), `reviews`, `inventory`, `customers` (+ detail), `discounts` (+ `new`), `returns`, `abandoned-checkouts`, `online-store/{theme, theme-library, pages, menus}`, `settings/{index (Overview), store-details, orders, returns, branding, payments, shipping, storefront, support, taxes, team}`), `_editor/online-store/{editor/$pageId, theme-settings}` (Puck), `platform` and `support` shells. UI conventions: `docs/admin-ui-standards.md`.

**Super Admin (`apps/superadmin/src/pages`)**: Overview, TenantsList, TenantDetail, TenantCreate, Signups, Plans, Quotas, Features, Domains, Support, System, Staff, AuditLog, Templates, TemplateEditor, Login, AcceptInvitation.

---

## 10. Blocks and themes

`@bs/blocks` is a **versioned block registry** (ADR-009): page documents are JSON; each block has a Zod schema and a view; validation is recursive (depth 6, 300 blocks), props are enumerated, links and video hosts are allow-listed (ADR-010). The storefront renders trees with `renderBlockTree`, products/collections/media resolved server-side in the same `"use cache"` scope as the page. The editor (Puck, ADR-018) lives in `packages/block-editor`, lazy-loaded by the admin; shoppers never download it.

Block types in `packages/blocks/src/registry.ts`: content (Hero, Banner, ProductGrid, CollectionGrid, ProductCarousel, Testimonials, Reviews, RichText, FAQ, Gallery, Newsletter, UspStrip), layout (Section, Container, Grid, FlexRow, FlexColumn, Spacer, Divider), atoms (Heading, Text, Image, Video, Button, Icon, Link, CallToAction), theme chrome (SiteHeader, SiteFooter, ProductDetail, CollectionListing).

Theme flow: platform staff build `theme_templates` (draft + published snapshot, home/collection/product/header/footer pages + tokens) in Super Admin. A store *activates* a template: tokens and pages are **copied** into the store's own rows (templates are never edited by stores; re-applying replaces customisations and adds a page version, so it can be rolled back). The storefront applies a theme's tokens once the store opts in (`source: "theme"`); otherwise built-in layouts and Branding apply. Theme CSS variables are `--bs-*` (`theme-vars.ts`). Domain code: `packages/domain/src/themes/`. Cache tags `page:<slug>` and `theme` are invalidated on publish and rollback.

**Adding a block:** schema + view in `packages/blocks`, register it, add editor config in `packages/block-editor/src/config.tsx`, add tests (`packages/blocks/test`), bump the block version if the schema changes shape, update this section.

---

## 11. Jobs and queues

`packages/db/src/queues.ts` is the queue registry (created by the migrate step, so runtime roles never need DDL). Handlers and schedules: `packages/domain/src/jobs.ts`, started by `apps/worker`.

Queues: `system.ping`, `order.created`, `order.paid`, `order.cod_confirmed`, `order.cancelled`, `reservation.expiry`, `webhook.process`, `idempotency.cleanup`, `fulfillment.created`, `fulfillment.delivered`, `fulfillment.rto`, `return.requested`, `refund.processed`, `cart.abandoned`, `cart.recovery_sweep`, `subscription.trial_expiry_sweep`, `order.preorder_date_changed`, `order.preorder_reminder_sweep`, `order.return_photo_cleanup`, `customers.refresh_metrics`, `customers.import` (CSV imports over 500 rows).

Schedules: `reservation.expiry` every minute, `idempotency.cleanup` every 15 min, `cart.recovery_sweep` and `subscription.trial_expiry_sweep` hourly, `order.preorder_reminder_sweep` daily (06:00), `order.return_photo_cleanup` daily (03:00). Email handlers currently send placeholder text (no provider configured; see `progress.md`). Tenant deletion runs in the platform service on a timer (`DELETION_SWEEP_INTERVAL_MS`).

**Return photos (customer evidence).** Presign and finalize run under the order link token (`resolveOrderIdFromToken`), keys are `tenants/<tenantId>/returns/<orderId>/<mediaId>.<jpg|png|webp>`, finalize looks the real object up in storage and checks its magic bytes (fails closed). Photos live in a **separate private R2 bucket** (`R2_PRIVATE_BUCKET_NAME`, never the public media bucket); the admin reads them through 15-minute signed URLs; with no private bucket configured the portal does not ask for photos. `order.return_photo_cleanup` (daily) deletes finalized-but-unattached photos older than 24 hours per tenant under RLS and keeps the record if the file cannot be deleted; store deletion (`platform/deletion-steps.ts`) removes photos from both buckets. Objects uploaded but never finalized need a bucket lifecycle rule (see `DEPLOYMENT.md`).

**Adding a queue:** add to `QUEUES` and `QUEUE_NAMES`, add the handler in `jobs.ts`, add a test in `queue-consumers.int.test.ts`, and enqueue inside the business transaction.

---

## 12. Auth and permissions

| Actor | Mechanism | Where |
|---|---|---|
| Store staff / owner | Better Auth email+password, session cookie shared across `.<root>`, `X-Store-Id` selects the store, membership + role gives permissions | `packages/auth/src/staff.ts`, web `/api/auth`, ADR-014 |
| Platform staff | Better Auth + TOTP 2FA, host-only cookie, roles `platform_owner` > `platform_admin` > `platform_support` | `packages/auth/src/platform.ts`, `apps/platform` |
| Shopper | Phone OTP -> server-side `customer_sessions` row (hashed token, httpOnly cookie). OTP codes are never returned over HTTP | `packages/domain/src/customers/{otp,session}.ts`, ADR-012 |
| Guests | Signed action tokens (`/o/`, `/cod/`, `/address/`, `/unsubscribe/`) | `orders/actions.ts`, `action_tokens` |

Store permissions (`STORE_PERMISSIONS`): `products.read/write`, `orders.read/write/refund`, `customers.read/write`, `discounts.write`, `content.write`, `theme.publish`, `settings.write`, `staff.manage`, `analytics.read`, `exports.run`. System roles: `store_owner`, `store_admin`. Support sessions get read permissions plus a restricted write set (`context.ts`). Enforce with `assertPermission(ctx, "...")` in the **domain service**, not only in the route.

In flight: an auth overhaul (forgot/reset password, customer password sign-in, platform ZeptoMail email) is planned in `docs/AUTH-OVERHAUL-PLAN.md`, being built on branch `feat/auth-email-overhaul`.

---

## 13. Caching

- Storefront reads use Cache Components: `"use cache"` + `cacheTag(tenantTag(...))` in `apps/web/src/server/cached-storefront.ts`. **No second hand-rolled cache on top** (the file header explains why).
- Writes call the invalidation helpers in `packages/domain/src/cache-invalidation.ts` (typed `CacheChange` events such as `product_updated`, `theme_or_brand_published`). Add a new event there instead of calling `revalidateTag` ad hoc.
- Known quirk: `revalidateTag(..., "max")` serves one stale load after publish.
- Host to tenant map: in-memory, 60 s TTL (`host-resolver.ts`, `invalidateHostCache`).

---

## 14. Configuration

Full per-service env var list, with what breaks when each is missing: **`DEPLOYMENT.md`**. Example local values: `.env.example`. Key groups: DB URLs per role, `BETTER_AUTH_URL`/`BETTER_AUTH_SECRET` (web and platform use *different* secrets), `TENANT_SECRETS_KEY`, R2 (`R2_*`, `R2_PUBLIC_URL`), Turnstile, Cloudflare custom-domain keys, Razorpay platform billing keys, `PLATFORM_DOMAIN`/`ADMIN_HOST`/`MARKETING_HOST`, `SUPERADMIN_ORIGINS`, Sentry DSN. Never commit `.env*` (only `.env.example`).

---

## 15. Testing and quality gates

| Layer | Command | Notes |
|---|---|---|
| Typecheck | `pnpm typecheck` | per package `tsc` |
| Lint | `pnpm lint` | includes `bs/*` rules and the DB import ban |
| Build | `pnpm build` | turbo; web, admin, superadmin, platform, worker, db |
| Unit | `pnpm test:fast` | excludes `*.int.test.ts` |
| Integration | `pnpm test:heavy` | real Postgres 18 via Testcontainers or `TEST_DATABASE_URL_SUPERUSER`; needs Docker |
| Browser e2e | `e2e/` (Playwright) | runs in CI against the ephemeral stack |
| Docs | `pnpm docs:check` | structure vs docs (this file, ADR index, change fragments) |

Run integration and package suites **one package at a time** (`pnpm --filter @bs/domain test:heavy`); running them in parallel against one database causes collision and timeout flakes. Platform suites need `--no-file-parallelism`. See `docs/FAST-LOCAL-TESTS.md`. Test counts drift; read them from CI, not from docs.

Guard tests worth knowing: isolation suites (tenant leakage), `audit-coverage` (every platform mutation audited), `perf-budget` (web), launch-theme JSON must match `launch-template.ts`.

---

## 16. Decisions (ADRs)

Index and statuses: [`docs/adr/README.md`](adr/README.md). Summary of what each fixes in place: 001 modular monolith, 002 RLS isolation, 003 Postgres is the source of truth, 004 Cache Components, 005 oRPC, 006 pg-boss, 007 Cloudflare for SaaS, 008 payment adapter, 009 versioned block registry, 010 no merchant code, 011 feature flags and fallbacks, 012 customer sessions, 013 quotas and rate limits, 014 admin auth (and a separate 014 on platform billing separation, see gaps), 015 quota hierarchy, 016 provisioning atomicity, 017 custom domain adapter, 018 visual theme editor. New architectural decisions need an ADR **before** the code.

---

## 17. Known gaps in this documentation and the repo

Keep this list honest; remove an item when fixed.

- Two ADRs are numbered 014 (`014-admin-auth-and-api-access.md`, `014-platform-billing-separation.md`). Not renumbered because other docs link to them; the next ADR is **019**.
- ADR for M9 decisions is still to be written (`progress.md`).
- `progress.md` and `DEPLOYMENT.md` contain test counts and dates that go stale; prefer CI.
- Procedure-level API docs are the contract files themselves; there is no generated OpenAPI doc checked in.
- This file lists tables and routes by name, not columns. Columns live in `packages/db/src/schema/*`.

---

## 18. Glossary

| Term | Meaning |
|---|---|
| Tenant / store | One merchant's store; a row in `tenants`. Every tenant table carries its `tenant_id` |
| `withTenant` | Domain runtime helper that opens a transaction and sets `app.tenant_id` so RLS applies |
| RLS | Postgres row-level security; the isolation boundary |
| Platform staff / Super Admin | Brand Sewa operators who manage stores, plans, themes, support |
| Support session | Time-boxed staff access to a store admin, needing merchant consent |
| Block / theme template | JSON page building blocks; platform-authored theme a store can activate |
| COD | Cash on delivery (the only working payment method today) |
| Coolify | Self-hosted PaaS that runs the containers on the VPS |
| Antigravity | Google's agentic IDE, used as one of the coding agents (see `AGENTS.md`) |
