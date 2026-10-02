# M1 build guide · Tenant isolation proven

**Audience:** an AI coding agent (Google Antigravity) picking up this repo cold. Read this whole
document before writing code. It is self-contained but references the repo's own source of truth
(`docs/PLAN.html`) throughout — when this guide and `PLAN.html` conflict, `PLAN.html` wins and you
should flag the conflict rather than silently pick one.

**Repo:** `github.com/Brandsewa/bsec` (branch `main`). **Do not push directly to `main`** — open a
PR; CI (`.github/workflows/ci.yml`) runs typecheck/lint/test/build against a real Postgres 18
service container, then (on `main` only) builds images and deploys to production. M1 is large
enough that it should land as a sequence of reviewed PRs, not one giant push.

**Milestone owner context:** M0 (this repo's current state) is done and deployed — a working
monorepo, empty schema-less Postgres roles, Docker images, CI/CD, and `bcom.si` live in
production showing only a placeholder. M1 is the first milestone that makes the platform actually
multi-tenant. Nothing built in M1 is customer-facing yet (no products, no checkout) — M1's job is
purely to prove that tenant A cannot touch tenant B's data through any code path, and to give every
later milestone (M2+) a `TenantContext` and a permission system to build on.

---

## 1. What "done" means (exit criteria — copy from PLAN.html §13)

> Store A cannot read or write store B through any procedure (generated suite); pooled-connection
> test without SET LOCAL returns zero rows, not an error; host resolution and membership checks
> pass; customer session cannot call admin procedures.

Concretely, before you call M1 done, all of these must be true and demonstrated (not just coded):

1. A generated test suite exercises **every** oRPC procedure that exists at the end of M1 with two
   seeded tenants and asserts tenant A's session/host cannot read or mutate tenant B's rows.
2. An integration test opens a pooled connection, does **not** run `SET LOCAL app.tenant_id`, and
   queries a tenant table — it must return **zero rows**, not throw an error. (This is already
   proven for a scratch probe table in `packages/db/test/roles.int.test.ts` — M1 must prove it for
   the real tables it creates.)
3. Host → tenant resolution works: hitting the web app with `Host: <slug>.bcom.si` (or a mapped
   custom domain) resolves the correct `tenantId` and nothing else.
4. Membership-based resolution works for the admin app: a staff session can only act on stores
   they have an active membership for, checked against `X-Store-Id`, never trusted from the client
   otherwise.
5. A customer session (Better Auth customer instance, cookie `__Host-cust`) cannot call any
   `admin.*` or `platform.*` procedure — attempting to returns 403, not a silent no-op.

## 2. Read these first

- `docs/PLAN.html` — sections **4 (Tenancy and security model)**, **5.1/5.3/5.4 (Platform,
  Identity, Store settings schema)**, **11 (API, events, commerce correctness — oRPC router shape,
  state machines you'll stub for later, cache tag convention)**, **13 (M1 exit criteria, already
  quoted above)**. Do not re-derive tenancy design from scratch — it's fully specified there.
- `docs/adr/002-tenant-isolation-rls.md` — why RLS-with-`nullif` over app-level filtering.
- `docs/migrations.md` — the expand/contract rule; M1 adds ~15 tables, follow it for every one.
- `packages/db/src/tenant-table.ts` — the M0 **stub** you are completing. Read its doc comment; it
  says exactly what's missing (composite FKs, the `tenants` FK, tenant-first index helpers).
- `packages/db/src/index.ts` — `withTenant()` is a stub that currently throws
  `"withTenant() is implemented in M1"`. That's your primary deliverable's entry point.
- `packages/domain/src/context.ts` — `TenantContext`/`Actor` types are already declared for you to
  build the resolver against. Don't change their shape without a strong reason; downstream M2+ code
  (not written yet, but planned) assumes this exact shape.
- `packages/auth/src/index.ts` — permission list and role scaffolding already exist (M0 stub, no
  Better Auth wiring yet). `STORE_PERMISSIONS`, `PLATFORM_ROLES`, `hasPermission()` are real and
  should be reused, not redefined.
- `packages/contracts/src/index.ts` — oRPC contract pattern (`oc.route(...).output(...)`) — follow
  this exact style for every new contract you add (`admin.*`, `platform.*`, `public.*`).
- `packages/db/test/roles.int.test.ts` — the existing RLS/FORCE RLS proof against a real container
  Postgres. M1's isolation suite extends this pattern to real tables instead of a throwaway probe.

## 3. Scope: exactly what to build

### 3.1 Schema (Drizzle, `packages/db/src/schema/`)

Currently `packages/db/src/schema/index.ts` is nearly empty (M0 only needed `_platform_meta` for
the roles proof). Split the schema into files matching PLAN §5's grouping, re-exported from
`schema/index.ts`:

```
packages/db/src/schema/
  platform.ts     -- tenants, organizations, domains, plans, feature_flags,
                     tenant_feature_overrides   (PLAN §5.1 — only the M1 subset, see below)
  identity.ts      -- users, memberships, roles, staff_invitations, audit_logs
                     (+ Better Auth's own tables: sessions, accounts, verifications — see §3.3)
  settings.ts       -- store_settings only (the minimum M2 will need; don't build all of §5.4 yet)
  index.ts          -- re-exports all of the above
```

**M1 does NOT need the full §5.1–5.4 table list** — most of those (plans, subscriptions,
usage_counters, quota_*, apps/app_rollouts, theme_templates, block_definitions, everything in
5.2 Signup/onboarding, most of 5.4 Store settings) belongs to later milestones (M2, M8, M9). Build
only what M1's exit criteria require:

| Table | Why M1 needs it | RLS? |
|---|---|---|
| `tenants` | Root of isolation — every tenant table's `tenant_id` points here | No RLS (platform-only reads; not a `tenantTable()`) |
| `organizations` | `tenants.organization_id` FK target; keep minimal (name, owner) | No RLS |
| `domains` | Host resolver needs `hostname → tenant_id` lookups | No RLS (platform-managed) |
| `feature_flags` + `tenant_feature_overrides` | PLAN explicitly lists this in M1 scope | `tenant_feature_overrides` is a `tenantTable()` |
| `users` | Global staff identity (Better Auth) | No RLS — global table, not tenant-scoped |
| `memberships` | Staff ↔ store, the thing `X-Store-Id` checks against | `tenantTable()` |
| `roles` | System roles seeded per store + custom roles | `tenantTable()` |
| `staff_invitations` | Needed to actually create a second membership for isolation tests | `tenantTable()` |
| `audit_logs` | Every mutation this milestone adds should write one (cheap now, expensive to retrofit) | `tenantTable()` |
| `store_settings` | Bare minimum row per tenant so there's something real (not `_platform_meta`) to prove isolation against, and M2 needs it day one anyway | `tenantTable()` |

Everything else in PLAN §5 is **out of scope for M1** — do not build `catalog`, `orders`,
`customers`, `content`, `marketing`, or `system` tables yet. If you find yourself wanting one to
"make the isolation suite more realistic," don't; add another `store_settings`-shaped scratch
table instead, or use `tenant_feature_overrides`/`memberships`, which are already real and
sufficient to prove RLS end to end.

Every tenant table must:
- Be declared through `tenantTable()` (extend it first — see §3.2).
- Have `id uuid primary key default uuidv7()` (there is no native `uuidv7()` in Postgres 18 —
  check whether the M0 scaffold already has a helper/extension for this; if not, either add a SQL
  function via migration or use `gen_random_uuid()` as a documented stopgap and file it as a
  follow-up, but do not silently deviate from PLAN's uuid**v7** requirement without noting it in
  `progress.md`).
- Have `created_at`, `updated_at timestamptz` (per PLAN §5 conventions note).
- Use composite `(tenant_id, x_id)` foreign keys for any reference to another tenant table (see
  §3.2 — this is the biggest actual gap in the M0 stub).
- Have indexes starting with `tenant_id`.
- Unique constraints scoped per tenant, e.g. `unique(tenant_id, slug)` — never a bare
  `unique(slug)` on a tenant table.

### 3.2 Complete `tenantTable()` (packages/db/src/tenant-table.ts)

The M0 stub gives you: the `tenant_id` column, RLS enabled, and the `nullif()` policy. Its doc
comment lists exactly what's missing. Add:

1. **The FK to `tenants`.** `tenant_id` should reference `tenants.id`. Decide (and document in an
   ADR-style comment, or a new ADR if it's non-trivial) whether this is `on delete restrict` (safer
   default — tenant deletion is a whole workflow in M9, not a cascade) or `on delete cascade`.
   Recommendation: `restrict`. Tenant deletion is explicitly a multi-step audited workflow later
   (PLAN §5.10 `tenant_deletions`), not a DB-level cascade.
2. **Composite FK helper** for references between tenant tables, e.g. `memberships.user_id` is
   fine as a plain FK (users is global), but anything referencing another *tenant* table (e.g. a
   future `order_items.variant_id`) must be `foreign key (tenant_id, variant_id) references
   variants (tenant_id, id)` so a row can never be inserted pointing into another tenant's row even
   if the FK target's `id` happens to collide conceptually. Add a small helper function
   (`tenantForeignKey()` or similar) that Drizzle table defs can call for this pattern, since
   Drizzle's own FK helpers don't have a "composite FK to another tenantTable" shorthand.
3. **`forceRlsSql()` is already correct and complete — reuse it as-is.** Every migration that
   creates a tenant table must call it (drizzle-kit only emits `ENABLE ROW LEVEL SECURITY`, not
   `FORCE`). The isolation suite (§3.5) must assert `relforcerowsecurity = true` for every name in
   `tenantTableNames` — that set-tracking mechanism already exists in the stub; use it, don't
   reinvent it.

### 3.3 `withTenant()` and the connection/role story (packages/db/src/index.ts)

Replace the stub:

```ts
export async function withTenant<T>(db: Db, tenantId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`); // SET LOCAL via set_config(..., true)
    return fn(tx);
  });
}
```

Match exactly what `roles.int.test.ts` already proves works (`select set_config('app.tenant_id',
$1, true)` inside a transaction, read back as `''` after commit on the same pooled connection —
that's *why* the policy uses `nullif()`). Do not use raw `SET LOCAL app.tenant_id = '...'` string
interpolation — always parameterize through `set_config()` to avoid SQL injection via a
maliciously-shaped tenant id (even though tenant ids are server-generated UUIDs, don't rely on
that as the only defense).

**Role usage is already fixed by M0 and must not change:** `web`/`worker` connect as `app_rw`
(NOBYPASSRLS), `platform` connects as `app_platform` (BYPASSRLS). `withTenant()` is only meaningful
on an `app_rw` connection — calling it on the platform container's `app_platform` connection is
harmless (RLS doesn't apply to that role) but also pointless; platform procedures should use plain
`db` queries with an explicit `tenant_id` filter, not `withTenant()`, and should always write
`platform_audit_logs` per PLAN §4's checklist. If you need a `platform_audit_logs` table for that,
it's PLAN §5.1 scope, not strictly required by M1's exit criteria — add it only if a platform
procedure you build in M1 actually needs to write to it (e.g. if you build any `platform.*`
procedure at all this milestone; if you don't, skip it and leave a note in `progress.md`).

### 3.4 Host resolver + TenantContext (packages/domain/)

Build in `packages/domain/src/`:

- **`resolveHostToTenant(host: string): Promise<{ tenantId: string; storeStatus: StoreStatus } | null>`**
  — looks up `domains` by `hostname` (case-insensitive; `hostname` is `citext` per PLAN §5.1),
  requires `status = 'active'`, joins `tenants` for status. PLAN §4 specifies a **cached host→tenant
  map, 60s + tag revalidation** — implement the cache (an in-process LRU/Map is fine for M1's
  single-instance deployment; don't build a distributed cache yet, that's a later-milestone
  concern per PLAN §14's upgrade stages) and a way to invalidate it when a domain's status changes
  (a cache tag, or just a short TTL — document which you picked and why).
- **`buildTenantContext(...)`** — assembles the `TenantContext` type already declared in
  `packages/domain/src/context.ts`: `{ tenantId, storeStatus, actor, roles, requestId }`. Two entry
  paths, both PLAN §4-mandated:
  - **Storefront (web app):** tenant *only* from `Host` header via the resolver above. Never from
    a client-supplied tenant id, query param, or body field.
  - **Admin (admin app via platform or web's admin routes — check current routing, this may live
    in `apps/web`'s admin routes or be proxied to `apps/platform`, confirm from `apps/admin`'s
    existing route structure under `apps/admin/src/routes/_store`): tenant from **session
    membership + `X-Store-Id` header, cross-checked** — the header alone is never trusted; the
    session's memberships must contain that store id with `status = 'active'`, or the request is
    rejected.
- `requestId` should reuse the `x-request-id` propagation already wired in M0 (`pino` logs already
  carry it per `progress.md`) — don't build a second request-id mechanism.

### 3.5 Better Auth: staff + customer instances (packages/auth/)

One package, two configured instances, per PLAN §4:

- **Staff instance**: backs the global `users` table + Better Auth's own `sessions`, `accounts`,
  `verifications` tables (add these to `schema/identity.ts`, following Better Auth's Drizzle
  adapter schema requirements — check the installed Better Auth version's docs for the exact
  column set it expects, don't guess). Cookie prefixed `bs-staff` (constant already exported from
  `packages/auth/src/index.ts` as `STAFF_COOKIE_PREFIX` — reuse it, don't hardcode a new string).
  A staff user's *authorization* (what stores/permissions they have) comes from `memberships` +
  `roles`, checked per-request — Better Auth only proves *authentication* (who they are), not
  which store they can touch.
- **Customer instance**: per-store, not global. Cookie `__Host-cust` (constant
  `CUSTOMER_COOKIE`, already exported — reuse it). PLAN §5.6 defines `customer_sessions` as
  tenant-scoped — **this table is technically catalog/customer scope (PLAN §5.6), which is nominally
  M2+**, but the customer Better Auth instance needs *some* session table to function. Two options:
  build the minimal `customer_sessions` table now as part of M1 (recommended — it's small, and the
  exit criterion "customer session cannot call admin procedures" is untestable without a real
  customer session), or stub the customer instance with an in-memory/test-only session store for
  M1's isolation suite and defer the real table to M2. **Recommendation: build the minimal table
  now** — it's low cost and directly required by exit criterion #5. Keep it minimal: just what
  Better Auth's session table needs, not the full customer profile (`customers` table with
  `total_spent`, `tags`, etc. — that's M2/M4 scope).
- Wire `hasPermission()` (already exported from `packages/auth/src/index.ts`) into the admin
  procedure-authorization path — don't reimplement permission checking inline in routers.

### 3.6 oRPC routers: `admin.*` and `platform.*` skeletons (packages/contracts/, apps/platform/, apps/web/ or apps/admin/)

M0 only has `storeContract.system.health` and `platformContract.system.health`. M1 needs enough
real procedures to make the isolation suite meaningful, per the contract pattern already
established in `packages/contracts/src/index.ts` (`oc.route(...).output(...)`, grouped by
namespace). Minimum viable set for M1 (don't build product/order/catalog procedures — that's M2+):

- `admin.memberships.list` / `admin.memberships.invite` — exercises `memberships` +
  `staff_invitations` + the `X-Store-Id` check.
- `admin.settings.get` / `admin.settings.update` — exercises `store_settings`, a real read+write
  through `withTenant()`.
- `admin.featureFlags.list` — exercises `tenant_feature_overrides` read.
- `platform.tenants.list` / `platform.tenants.get` — exercises the `app_platform` BYPASSRLS path
  reading across tenants (this is the procedure your isolation suite uses to prove BYPASSRLS
  genuinely sees everything, contrasted against `admin.*` seeing only its own tenant).

Every `admin.*` procedure must run its DB work through `withTenant()`. Every `platform.*`
procedure must require `platform_staff` (checked via the staff Better Auth session +
`platform_staff` table lookup — you'll need a minimal `platform_staff` table; PLAN §5.1 defines it
fully, but M1 only needs `user_id`, `role`, `is_active`). PLAN §6 says platform routes need MFA —
**MFA enforcement itself is out of scope for M1** (it's part of the fuller Super Admin build in
M9), but leave a clear `// TODO(M9): enforce MFA` marker rather than silently building it in or
silently forgetting it.

### 3.7 Feature flags with per-store overrides

`feature_flags` (global catalog: `key`, `default_on`, `rules jsonb`, `kill_switch`) +
`tenant_feature_overrides` (`tenant_id`, `key`, `enabled`, `set_by`, `reason` — a `tenantTable()`).
Effective value = override if present, else `rules` evaluation, else `default_on`. Build the
resolution function (`isFeatureEnabled(tenantId, key)`) in `packages/domain/`, not duplicated in
each app. You do not need the "rules" evaluation to be sophisticated for M1 (no plan/tier targeting
yet — that needs `plans`/`tenant_size_tiers`, which are M2/M8 scope) — `default_on` +
tenant-specific override is enough to satisfy PLAN's M1 line item.

## 4. The generated isolation test suite (the actual exit-criteria deliverable)

This is the most important artifact of M1 and the one PLAN calls out by name: **"generated from
the router list so every new procedure is covered automatically."** Do not hand-write a fixed list
of isolation tests that will silently go stale as M2+ adds procedures. Build a small test generator
that:

1. Introspects the oRPC contract objects (`storeContract`, `adminContract`, `platformContract` —
   whatever the final export shape is) to enumerate every procedure.
2. For each `admin.*` procedure, seeds **two tenants** (A and B) with a staff user who has an
   active membership on tenant A only, and asserts:
   - Calling with `X-Store-Id: A` succeeds and only touches A's rows.
   - Calling with `X-Store-Id: B` (same session, no membership on B) is rejected — 403, not a
     silent empty result.
   - Directly querying tenant B's data through tenant A's transaction context (bypassing the
     procedure layer, straight through `withTenant(db, tenantA, ...)`, trying to read a row seeded
     under tenant B) returns zero rows, proving RLS itself, not just the procedure-layer check.
3. For each `platform.*` procedure, asserts it requires `platform_staff` and — separately — that a
   *non-platform* staff session (even one with memberships) is rejected.
4. Reuses the existing pattern from `packages/db/test/roles.int.test.ts` for the raw
   pooled-connection-without-SET-LOCAL proof (exit criterion #2) — extend it to run against the
   real tables this milestone adds (`memberships`, `tenant_feature_overrides`, `store_settings`),
   not just the throwaway `rls_probe` table that test currently uses.
5. Runs in CI against the real Postgres 18 service container (same pattern `ci.yml` already uses
   for `pnpm test` — no new CI wiring needed unless you add a new package that isn't already in the
   `pnpm test` turbo pipeline).

Where this suite lives is your call (`packages/domain/test/isolation.int.test.ts` is a reasonable
default, following the existing `*.int.test.ts` naming convention already used in
`packages/db/test/`), but it must be part of `pnpm test` so CI enforces it on every PR, not a
manual/optional script.

## 5. What NOT to build in M1

Explicitly out of scope — do not let scope creep in from adjacent PLAN sections:

- Anything from PLAN §5.5–5.10 (catalog, customers beyond the minimal session table, orders,
  marketing, content, system tables like `idempotency_keys`/`webhook_inbox`) — that's M2–M5.
- Signup/onboarding flow, slug reservation, `signup_leads` (PLAN §5.2) — that's M8.
- Plans, billing, subscriptions, usage counters, quotas (PLAN §5.1 remainder) — M8/M9.
- Super Admin UI screens beyond the bare `platform.tenants.list`/`get` procedures needed for the
  isolation suite — the actual dashboard is M9 (PLAN §6).
- Custom domains / Cloudflare for SaaS (ADR-007) — `domains` table exists in M1 only to make the
  host resolver work for `bcom.si`-pattern subdomains; the custom-domain *provisioning flow* is
  M8.
- MFA enforcement on platform routes (leave the TODO marker per §3.6).
- Rate limiting, CSRF tokens, CSP headers — PLAN §4's security checklist lists these but they're
  cross-cutting hardening that PLAN explicitly schedules for M6/M7, not M1. If you have spare time
  after the exit criteria are met, ask before adding — don't silently expand scope.

## 6. Process notes for whoever (human or agent) is executing this

- **Migrations**: follow `docs/migrations.md`'s expand/contract rule for every table. Since this
  is all new tables (no existing production data in any of them), most M1 migrations are pure
  "expand" (create table) with no contract phase needed — but still write them as proper
  numbered Drizzle migrations, not a single hand-rolled SQL dump, so `bsec-migrate`'s existing
  `deploy.ts` flow (PLAN-described, already working in production per `progress.md`) picks them up
  correctly on the next deploy.
- **Every migration that creates a tenant table must include `forceRlsSql(tableName)`** — this is
  the single easiest thing to forget and the isolation suite (§4) is specifically designed to catch
  it if you do (it asserts `relforcerowsecurity` per table), so treat a red isolation suite on this
  point as the safety net it is, not a bug in the test.
- **Verify against a real Postgres 18**, not just types. The whole point of M1 is proven isolation,
  which only means something against a real database with real RLS — `pnpm test` already spins up
  Testcontainers or uses `TEST_DATABASE_URL_SUPERUSER` in CI (see `ci.yml`), use that, don't mock
  the database.
- **Commit ADRs for non-trivial decisions** you make that aren't already pinned by an existing ADR
  or this guide (e.g. the `tenant_id` FK's `on delete` behavior, the host-cache invalidation
  strategy, whether `customer_sessions` lands in M1 or M2). Follow the existing ADR template
  (`docs/adr/template.md`).
- **Update `progress.md`** the same way M0's entries are written: only tick a box after it's
  verified against a real Postgres/real running app, with a note on how it was verified — not
  aspirationally. This repo's own M0 history (`progress.md`) is the model to follow; read a few of
  its entries before writing your first one.
- When this guide, `PLAN.html`, or the current repo state actually disagree with each other (e.g.
  a package doesn't exist where this guide assumes it does, or Better Auth's current version wants
  a different schema shape than assumed above), **stop and note the discrepancy** rather than
  silently improvising a resolution — the human running this handoff (with Claude verifying on the
  infra side) needs to know.

## 7. Handoff / verification protocol

This guide is being handed to Google Antigravity to execute. Once a chunk of M1 work is ready
(recommend PR-sized chunks: schema + `tenantTable()` completion first, then `withTenant()` +
resolver, then Better Auth wiring, then the oRPC procedures, then the isolation suite last since it
depends on everything else existing) — Claude (this session or a continuation of it) will verify
each PR against this guide's exit criteria in §1 before it merges: real Postgres run of the
isolation suite, a manual pooled-connection-without-SET-LOCAL check, and a read of the actual
schema/migrations for the RLS/FORCE RLS/composite-FK requirements in §3.1–3.2. Don't mark
`progress.md` items done from Antigravity's side — leave that verification step to the human +
Claude review pass.
