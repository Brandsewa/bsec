# M1: Tenant Isolation Proven Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement multi-tenant isolation across database schema, RLS policies, Better Auth instances, host/membership context resolution, oRPC routers, and prove complete isolation with a generated test suite and pooled-connection tests.

**Architecture:** 
- **DB Layer:** Postgres 18 RLS with `nullif(current_setting('app.tenant_id', true), '')::uuid`, composite `(tenant_id, x_id)` FKs, and `withTenant()` transaction wrapper.
- **Domain/Auth Layer:** Host-to-tenant cached resolver (storefront) and Better Auth staff session + `X-Store-Id` membership validation (admin), feeding a validated `TenantContext`. Dual Better Auth instances (`bs-staff` and `__Host-cust`).
- **API & Verification:** oRPC routers (`admin.*` in web, `platform.*` in platform) with authorization middleware, verified by a generated isolation test suite that enumerates all procedures and tests cross-tenant boundaries.

**Tech Stack:** TypeScript 6.0.3, Drizzle ORM 0.45.3, PostgreSQL 18, Better Auth 1.7.6, oRPC 1.15.4, Zod 4.6.5, Vitest 5.0.2, Hono, Turborepo.

---

## PR / Phase Breakdown

Per `docs/M1-BUILD-GUIDE.md` §7, M1 is executed across 5 PR-sized chunks:
1. **Phase 1 (PR 1): Schema Foundation & `tenantTable()` Completion**
2. **Phase 2 (PR 2): `withTenant()` Transaction Wrapper & Host Resolver with Caching**
3. **Phase 3 (PR 3): Better Auth Dual-Instance (Staff & Customer) & Context Assembler**
4. **Phase 4 (PR 4): oRPC Contracts, Handlers & Authorization Middleware**
5. **Phase 5 (PR 5): Generated Isolation Suite & Complete RLS Proof**

---

## Phase 1: Schema Foundation & `tenantTable()` Completion

### Task 1: Complete `tenantTable()` helper with Composite FK and `tenants` reference

**Files:**
- Modify: `packages/db/src/tenant-table.ts`
- Modify: `packages/db/test/tenant-table.test.ts`

- [ ] **Step 1: Write unit tests for new `tenantTable()` capabilities**
  Verify that:
  - `tenantTable` accepts foreign key references to `tenants.id` on delete restrict.
  - A composite foreign key helper `tenantForeignKey()` creates a foreign key constraint referencing `(tenant_id, id)` on the target tenant table.
  - `tenantTableNames` collects all registered tenant tables.

- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @bs/db test tenant-table.test.ts`
  Expected: FAIL with missing helper / types.

- [ ] **Step 3: Implement composite FK helper and table definitions**
  Update `packages/db/src/tenant-table.ts`:
  - Add `tenantForeignKey(...)` helper function using Drizzle `foreignKey()`.
  - Ensure `tenant_id` references `tenants.id` with `onDelete: "restrict"`.
  - Maintain tracking in `tenantTableNames: Set<string>`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `pnpm --filter @bs/db test tenant-table.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**
  Run: `git add packages/db/src/tenant-table.ts packages/db/test/tenant-table.test.ts && git commit -m "feat(db): complete tenantTable helper with composite FK support"`

---

### Task 2: Implement Platform, Identity, and Settings Schema

**Files:**
- Create: `packages/db/src/schema/platform.ts`
- Create: `packages/db/src/schema/identity.ts`
- Create: `packages/db/src/schema/settings.ts`
- Modify: `packages/db/src/schema/index.ts`
- Test: `packages/db/test/schema.test.ts`

- [ ] **Step 1: Write test for schema definitions**
  Create `packages/db/test/schema.test.ts` verifying all tables are exported and configured:
  - `tenants`, `organizations`, `domains`, `feature_flags`, `tenant_feature_overrides`, `platform_staff`.
  - `users`, `sessions`, `accounts`, `verifications`, `memberships`, `roles`, `staff_invitations`, `audit_logs`, `customer_sessions`.
  - `store_settings`.
  - All tenant tables are registered in `tenantTableNames`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @bs/db test schema.test.ts`
  Expected: FAIL (modules not found).

- [ ] **Step 3: Implement schema modules**
  - In `platform.ts`: Define `tenants` (root of isolation), `organizations`, `domains`, `feature_flags`, `tenant_feature_overrides` (`tenantTable`), `platform_staff`.
  - In `identity.ts`: Define `users`, Better Auth staff tables (`sessions`, `accounts`, `verifications`), `memberships` (`tenantTable`), `roles` (`tenantTable`), `staff_invitations` (`tenantTable`), `audit_logs` (`tenantTable`), and `customer_sessions` (`tenantTable`).
  - In `settings.ts`: Define `store_settings` (`tenantTable`).
  - In `index.ts`: Re-export all schema objects.

- [ ] **Step 4: Run test to verify it passes**
  Run: `pnpm --filter @bs/db test schema.test.ts && pnpm typecheck`
  Expected: PASS

- [ ] **Step 5: Commit**
  Run: `git add packages/db/src/schema/ packages/db/test/schema.test.ts && git commit -m "feat(db): add platform, identity, and settings schema for M1"`

---

### Task 3: Migrations & `uuidv7()` SQL Function

**Files:**
- Create: `packages/db/migrations/0002_uuidv7.sql`
- Create: `packages/db/migrations/0003_m1_tables.sql`
- Modify: `packages/db/migrations/meta/_journal.json`

- [ ] **Step 1: Generate Drizzle migration and custom SQL**
  - Create `0002_uuidv7.sql` with PL/pgSQL `uuidv7()` function.
  - Run `drizzle-kit generate` or draft `0003_m1_tables.sql` containing all table definitions plus `forceRlsSql()` calls for every `tenantTable`.
  - Verify migration journal records entries.

- [ ] **Step 2: Verify migration scripts pass syntax and dry-run check**
  Run: `pnpm --filter @bs/db typecheck && pnpm --filter @bs/db lint`
  Expected: PASS

- [ ] **Step 3: Commit Phase 1 (PR 1)**
  Run: `git commit -m "feat(db): add M1 migrations with uuidv7 and FORCE RLS"`

---

## Phase 2: `withTenant()` & Host Resolver with Caching

### Task 4: Implement `withTenant()` Transaction Wrapper

**Files:**
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/test/with-tenant.test.ts`

- [ ] **Step 1: Write test for `withTenant()`**
  Create `packages/db/test/with-tenant.test.ts` verifying that `withTenant(db, tenantId, fn)`:
  - Invokes `set_config('app.tenant_id', tenantId, true)` inside a transaction.
  - Successfully passes the transaction handle `tx` to `fn`.
  - Propagates errors and rolls back on exception.

- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @bs/db test with-tenant.test.ts`
  Expected: FAIL with "withTenant() is implemented in M1".

- [ ] **Step 3: Implement `withTenant()`**
  Replace stub in `packages/db/src/index.ts`:
  ```ts
  export async function withTenant<T>(
    db: Db,
    tenantId: string,
    fn: (tx: Db) => Promise<T>
  ): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      return fn(tx);
    });
  }
  ```

- [ ] **Step 4: Run test to verify it passes**
  Run: `pnpm --filter @bs/db test with-tenant.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**
  Run: `git add packages/db/src/index.ts packages/db/test/with-tenant.test.ts && git commit -m "feat(db): implement withTenant parameterized transaction wrapper"`

---

### Task 5: Host Resolver with In-Memory Caching & Invalidation

**Files:**
- Create: `packages/domain/src/host-resolver.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `packages/domain/test/host-resolver.test.ts`

- [ ] **Step 1: Write test for host resolution and cache behavior**
  Create `packages/domain/test/host-resolver.test.ts` verifying:
  - Resolves active hostname to `{ tenantId, storeStatus }`.
  - Caches resolution result for 60 seconds.
  - Cache hit bypasses database query.
  - Invalidation helper clears cached entry.
  - Inactive/unknown domains return `null`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @bs/domain test host-resolver.test.ts`
  Expected: FAIL (module not found).

- [ ] **Step 3: Implement `resolveHostToTenant()` and cache**
  In `packages/domain/src/host-resolver.ts`:
  - Query `domains` joining `tenants` for active status.
  - Implement 60s TTL LRU/Map cache.
  - Export `invalidateHostCache(host?: string)`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `pnpm --filter @bs/domain test host-resolver.test.ts`
  Expected: PASS

- [ ] **Step 5: Feature flag resolver `isFeatureEnabled()`**
  Implement `packages/domain/src/features.ts`:
  - Check `tenant_feature_overrides` first (inside `withTenant` or direct query).
  - Fall back to `feature_flags.default_on`.
  - Add unit test in `packages/domain/test/features.test.ts`.

- [ ] **Step 6: Commit Phase 2 (PR 2)**
  Run: `git add packages/domain/ && git commit -m "feat(domain): add host resolver with caching and feature flag service"`

---

## Phase 3: Better Auth Dual-Instance & TenantContext Builder

### Task 6: Configure Staff & Customer Better Auth Instances

**Files:**
- Modify: `packages/auth/src/index.ts`
- Create: `packages/auth/src/staff.ts`
- Create: `packages/auth/src/customer.ts`
- Create: `packages/auth/test/auth.test.ts`

- [ ] **Step 1: Write test for auth configurations**
  Verify:
  - Staff instance uses `bs-staff` cookie prefix and global user/session tables.
  - Customer instance uses `__Host-cust` cookie and tenant customer session table.
  - Cookie names, options, and schemas adhere to PLAN §4.

- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @bs/auth test auth.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement `createStaffAuth` and `createCustomerAuth`**
  - Implement Better Auth configuration factory using Drizzle adapter.
  - Export instances and session verification helpers.

- [ ] **Step 4: Run test to verify it passes**
  Run: `pnpm --filter @bs/auth test auth.test.ts`
  Expected: PASS

---

### Task 7: Build `buildTenantContext()` for Storefront and Admin

**Files:**
- Modify: `packages/domain/src/context.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `packages/domain/test/context.test.ts`

- [ ] **Step 1: Write test for `buildTenantContext()`**
  - Storefront entry path: resolves tenant *only* from `Host` header via host resolver.
  - Admin entry path: resolves tenant from session membership + `X-Store-Id` header; rejects if no active membership.
  - Ensures customer session cannot resolve admin context.

- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @bs/domain test context.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement `buildTenantContext()`**
  Implement storefront and admin context resolution with `requestId` propagation.

- [ ] **Step 4: Run test to verify it passes**
  Run: `pnpm --filter @bs/domain test context.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit Phase 3 (PR 3)**
  Run: `git add packages/auth/ packages/domain/ && git commit -m "feat(auth,domain): configure Better Auth dual instances and TenantContext builder"`

---

## Phase 4: oRPC Contracts, Handlers & Authorization

### Task 8: Define oRPC Contracts

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/admin.ts`
- Create: `packages/contracts/src/platform.ts`
- Test: `packages/contracts/test/contracts.test.ts`

- [ ] **Step 1: Write contracts test**
  Verify schemas for:
  - `admin.memberships.list` and `admin.memberships.invite`.
  - `admin.settings.get` and `admin.settings.update`.
  - `admin.featureFlags.list`.
  - `platform.tenants.list` and `platform.tenants.get`.

- [ ] **Step 2: Implement contracts**
  Create Zod validation schemas and oRPC route contracts using `oc.route(...)`.

- [ ] **Step 3: Run test to verify it passes**
  Run: `pnpm --filter @bs/contracts test`
  Expected: PASS

---

### Task 9: Implement oRPC Handlers & Security Middleware

**Files:**
- Modify: `apps/web/src/server/api.ts`
- Modify: `apps/platform/src/app.ts`
- Test: `apps/web/test/api.test.ts`
- Test: `apps/platform/test/app.test.ts`

- [ ] **Step 1: Implement Admin Router in Web App**
  - Mount `admin.*` routes.
  - Middleware checks:
    - Staff session present.
    - Active membership on `X-Store-Id` store.
    - Customer session returns 403 Forbidden.
    - Runs DB operations through `withTenant(db, ctx.tenantId, ...)`.
- [ ] **Step 2: Implement Platform Router in Platform App**
  - Mount `platform.tenants.*` routes.
  - Middleware checks:
    - `platform_staff` role verified.
    - Non-platform sessions rejected with 403.
    - Exposes BYPASSRLS queries with tenant filters.
- [ ] **Step 3: Test route execution and middleware rejections**
  Run: `pnpm --filter @bs/web test && pnpm --filter @bs/platform test`
  Expected: PASS

- [ ] **Step 4: Commit Phase 4 (PR 4)**
  Run: `git commit -m "feat(contracts,apps): implement admin and platform oRPC procedures with authorization"`

---

## Phase 5: Generated Isolation Suite & Complete RLS Proof

### Task 10: Build Router-Introspecting Isolation Test Suite

**Files:**
- Create: `packages/domain/test/isolation.int.test.ts`

- [ ] **Step 1: Write test generator**
  - Introspect `storeContract.admin` (or `adminContract`) dynamically to enumerate every registered procedure.
  - Seed two tenants: Tenant A and Tenant B.
  - Seed User A with active membership in Tenant A only.
- [ ] **Step 2: Assert isolation invariants on every procedure**
  - Calling with `X-Store-Id: A` succeeds and mutates/reads Tenant A only.
  - Calling with `X-Store-Id: B` using User A's session returns 403 Forbidden.
  - Calling any `admin.*` or `platform.*` with a customer session returns 403.
  - Direct database read via `withTenant(db, tenantA, ...)` querying Tenant B returns 0 rows.
  - Platform procedures require `platform_staff`.

---

### Task 11: Real Tables Pooled-Connection & FORCE RLS Proof

**Files:**
- Modify: `packages/db/test/roles.int.test.ts`

- [ ] **Step 1: Extend pooled connection test to real tables**
  - Open pooled connection as `app_rw`.
  - Query real tenant tables: `memberships`, `store_settings`, `tenant_feature_overrides` without `SET LOCAL`.
  - Assert zero rows returned, no exception thrown.
- [ ] **Step 2: Assert FORCE RLS on all tenant tables**
  - Query `pg_class.relforcerowsecurity` for every table in `tenantTableNames`.
  - Assert every single tenant table has `relforcerowsecurity = true`.
- [ ] **Step 3: Run complete verification suite**
  Run: `pnpm typecheck && pnpm lint && pnpm test`
  Expected: All checks green across all 10 packages.

- [ ] **Step 4: Commit Phase 5 (PR 5)**
  Run: `git commit -m "test(domain,db): add generated isolation suite and verify FORCE RLS on all tenant tables"`

---

## Self-Review Checklist
- [x] **Spec coverage:** All exit criteria in PLAN §13 and M1-BUILD-GUIDE §1 are covered.
- [x] **No placeholders:** Exact paths and specifications provided.
- [x] **Type consistency:** Matches `TenantContext`, `StoreStatus`, `Actor`, and existing M0 exports.
