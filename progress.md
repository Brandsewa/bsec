# Progress

Source of truth: `docs/PLAN.html` v2.0. Items are ticked only after verification; the evidence is noted next to each.

## Current milestone: M0 · Platform boots

**Plan exit criterion:** push to main deploys web, platform, admin and worker to staging then production; a migration runs; a backup is restored into a scratch database.
**Status:** code-side scaffold done and verified locally (2026-09-28). **M0 is not done yet**: the infra items below need the VPSs, the GitHub repo push, and accounts.

### Repo and tooling
- [x] Turborepo + pnpm workspace, Node 24.15, TypeScript 6.0.3 strict, exact version pins. `pnpm install` is clean.
- [x] apps: `web`, `platform`, `admin`, `worker`. packages: `db`, `contracts`, `domain`, `auth`, `ui`, `config`.
- [x] `pnpm typecheck` passes for all 10 packages.
- [x] `pnpm lint` passes for all 10 packages.
- [x] `pnpm test` passes: 36 tests, including the PG 18 integration suite via Testcontainers.
- [x] `pnpm build` passes (web, admin, platform, worker, db bundles).
- [x] Lint rule: `@bs/db` and DB drivers banned outside db/domain. Probe file in apps/web fails with `no-restricted-imports`.
- [x] Lint rule: tenant-prefixed cache tags (`bs/tenant-cache-tag`). RuleTester suite passes, and the probe `cacheTag("products")` fails.
- [x] Lint rule: skeleton on every route (`bs/route-pending`: `pendingComponent` for admin, `loading.tsx` for web). RuleTester suite passes, and the current routes pass it.
- [x] ADR-001 … ADR-010 written (`docs/adr/`).

### Database
- [x] Roles `app_owner` / `app_rw` (NOBYPASSRLS) / `app_platform` (BYPASSRLS), idempotent bootstrap. Verified by roles.int.test and by the compose `migrate` log `roles ok`.
- [x] Drizzle migrations run only as `app_owner` (the script refuses other roles). Tables are owned by app_owner, and app_rw can do DML but no DDL. Verified by integration test.
- [x] Extensions `citext` and `pg_trgm` installed by migration as app_owner (no superuser needed).
- [x] pg-boss schema and queues created at migrate time. Worker runs `migrate:false` as app_rw. Compose log shows the `system.ping` round trip.
- [x] `tenantTable()` stub: `tenant_id`, ENABLE RLS, nullif policy on USING and WITH CHECK, plus `forceRlsSql()`. Unit-tested.
- [x] FORCE RLS + nullif proven on PG 18:
  - the owner sees 0 rows;
  - a pooled connection after SET LOCAL returns 0 rows, not an error;
  - a cross-tenant insert is rejected;
  - BYPASSRLS reads everything.

  Verified by roles.int.test.
- [x] Expand/contract rule documented (`docs/migrations.md`).

### Design system (packages/ui, M0 scope)
- [x] Tokens with Supabase-pattern names and our emerald hue; light default plus dark; Tailwind 4 `@theme` mapping. Apache-2.0 NOTICE included.
- [x] PageContainer, PageBreadcrumbs, PageHeader, PageSection (per-section Suspense), and the Sidebar/AppShell with a mobile drawer.
- [x] Button (loading state), Input, Select, Dialog, Sheet, Table, Form (RHF + FormItemLayout), EmptyState, Toast (Sonner).
- [x] Skeleton, TableSkeleton, FormSkeleton, MetricCardSkeleton, DetailSkeleton; reduced-motion safe; aria-hidden.
- [x] Route template: router defaults `pendingMs 150` / `pendingMinMs 300` and preload on intent, `pendingComponent` on every route, and a static skeleton in `index.html`.
  - Browser: the TableSkeleton rendered during navigation to /orders.
- [x] Mobile: 40 px touch targets, drawer nav, no horizontal overflow at 375 px. Checked in the browser.
- [ ] Storefront `loading.tsx` present on `/`; the per-store theme tokens come in M2/M3. Needs a Playwright throttled-network screenshot check (plan §12 enforcement), which isn't set up yet.

### Containers and local stack
- [x] Dockerfiles: web (Next standalone), platform + worker (single-file esbuild bundles), admin (nginx-unprivileged), migrate (one-shot). All non-root with HEALTHCHECK.
- [x] `docker compose up --build`: postgres 18 → migrate (exit 0) → web, platform, worker, admin all **healthy**.
  - Checked `/api/health`, `/api/system/health` (OpenAPI), `/api/rpc/system/health`, platform `/health` + `/system/health`, worker `/health`, admin `/health` + SPA deep link.
  - `pg_stat_activity` shows web/worker as `app_rw` and platform as `app_platform`.
- [x] `x-request-id` on every API response. pino JSON logs carry `request_id` (`tenant_id` field present, null until M1).
- [x] APP_VERSION build arg flows into `/health`.

### CI/CD and infra
- [x] GitHub Actions `ci.yml` runs green on `github.com/Brandsewa/bsec` (main).
- [x] Images pushed to GHCR: `ghcr.io/brandsewa/bsec-{web,platform,worker,admin,migrate}`, all set **public** (anonymous `docker pull` verified) so Coolify needs no registry credentials.
- [x] Coolify project **Bs Commerce Platform** created on the existing Brand Sewa VPS (shared with the other 4 projects for now), with a `production` environment.
- [x] `bsec-postgres` (Postgres 18) resource running, internal-only (no public port), database `bsec`.
- [x] Roles bootstrapped for real: `app_owner` / `app_rw` / `app_platform` created via the `bsec-migrate` Docker Image resource's one-shot `deploy.js` entrypoint (bootstrap + migrate in one image, driven entirely through Coolify's UI — no shell/terminal access used for secrets). Verified via container logs (`roles ok` / `migrations ok`) and confirmed live through every app's `/health`.
- [x] Four long-running resources created and deployed as Docker Image resources on `:main`: `bsec-web` (3000), `bsec-platform` (4000), `bsec-worker` (4100), `bsec-admin` (8080, nginx). Each has its own DB credentials only (`app_rw` for web/worker, `app_platform` for platform only).
- [x] **End-to-end verified live** (not just locally) via the auto-generated sslip.io URLs:
  - web `/api/health` → `db.ok:true`, role `app_rw`; storefront `/` → 200.
  - platform `/health` → `db.ok:true`, role `app_platform`.
  - worker logs show it connected, started, and processed the `system.ping` job.
  - admin `/health` → 200; SPA and a deep link (`/orders`) both → 200.
- [ ] Domains: still on Coolify's auto `*.sslip.io` URLs. Real domains (`bscommerce.in` etc.) and Cloudflare for SaaS are not set up yet.
- [ ] Separate staging VPS provisioned. Everything above is on the single existing VPS.
- [ ] GitHub Actions' `deploy-staging` / `deploy-production` jobs are still no-ops (no `COOLIFY_*_WEBHOOK` secrets set) — this session's deploys were done by hand in the Coolify UI, not through the pipeline. Wiring the webhooks is the next step to make `git push` actually deploy.
- [ ] GitHub `production` environment has no required reviewers yet, so the approval gate in `ci.yml` doesn't actually gate anything.
- [ ] pgBackRest + WAL archive to R2 configured (`infra/backups/`, draft, not applied to this Postgres).
- [ ] Backup restored into a scratch database, with RPO/RTO logged.
- [ ] Sentry projects + DSNs set. The code is wired and no-ops without a DSN; not yet verified against a live Sentry.
- [ ] Better Stack log drain + uptime monitors.
- [ ] Coolify healthcheck (the HTTP-request check configured per-resource) fails on this server with "wget: can't connect to remote host: Connection refused" even though the app is listening — its `docker exec`-style check appears to run outside the app container's network namespace. Worked around by leaving Coolify healthchecks **disabled** on all four app resources and verifying liveness via the apps' own `/health` endpoints externally instead. Worth root-causing later (possibly a Coolify/Docker network mode quirk on this host) before relying on Coolify's own rolling-update healthcheck gating.
- [ ] Coolify's "Exposed ports" field was flaky when set through the General page's Internal-access widget (silently reverted to `80` after save+reload for two resources) but reliable when set through the dedicated Networking sidebar page. Every app also now sets `PORT` (and `HOSTNAME` for web) explicitly as an env var as a defensive fix — don't rely on "Exposed ports" alone to determine what port the app binds.

### Notes / decisions this session
- TypeScript pinned to 6.0.3, not 7.0.2: typescript-eslint 8.70 supports `<6.1`.
- Only the 6 M0 packages were created. payments, shipping, storage, email and blocks will be created in their milestones.
- The `migrate` image is a fifth image beyond the four apps. It carries the owner credentials so that no runtime image does.
- Local compose: if host port 5432 is taken, run with `POSTGRES_HOST_PORT=55432`. This machine needed it.

## Next: M1 · Tenant isolation proven
Schema for platform/identity/settings, full `tenantTable()` with composite FKs, `withTenant()`, host resolver, TenantContext, Better Auth staff and customer instances, memberships/roles, feature flags, and the generated isolation suite.
