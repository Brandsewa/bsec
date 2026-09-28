# Bs Commerce platform (bsec)

Multi-tenant commerce platform for Indian D2C stores. Source of truth: [`docs/PLAN.html`](docs/PLAN.html) (v2.0). Decisions: [`docs/adr/`](docs/adr/). Status: [`progress.md`](progress.md).

## Layout
```
apps/web        Next.js 16 (Cache Components): storefront, marketing, Store API at /api   → app_rw
apps/platform   Hono + oRPC Platform API (separate container)                          → app_platform
apps/admin      Vite + React 19 + TanStack Router SPA: store admin + /platform shells
apps/worker     pg-boss consumers                                                       → app_rw
packages/db         Drizzle schema, migrations, roles, tenantTable(), migrate/bootstrap scripts
packages/contracts  oRPC + Zod contracts
packages/domain     domain services, TenantContext, tenantTag(), logger, job runtime
packages/auth       Better Auth configs (M1), permission map
packages/ui         admin design system: tokens, page layout, components, skeletons
packages/config     tsconfig, ESLint (incl. bs/* rules), esbuild bundler, Vitest
infra/          Dockerfiles, Coolify runbook, backups
```

## Rules the tooling enforces
- `@bs/db` (and DB drivers) can only be imported from `packages/db` and `packages/domain`.
- Cache tags must be tenant-prefixed: `tenantTag(ctx, …)` or `` `t:${tenantId}:…` `` (`bs/tenant-cache-tag`).
- Every admin route declares `pendingComponent`; every storefront `page.tsx` has a sibling `loading.tsx` (`bs/route-pending`).
- Migrations run only as `app_owner`; web/worker use `app_rw`; only platform uses `app_platform`.

## Local development
Requirements: Node 24.15, pnpm 10.34.5 (`corepack enable`), Docker.

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test   # db integration tests start postgres:18 via Testcontainers
docker compose up --build                  # postgres 18 + migrate + web, platform, worker, admin
```
Ports: web http://localhost:3000 · platform http://localhost:4000 · worker health http://localhost:4100/health · admin http://localhost:8080.

Running apps outside Docker (hot reload) against the compose database:
```bash
docker compose up -d postgres migrate
cp .env.example .env    # then export the URLs, e.g. with dotenv-cli or your shell
pnpm --filter @bs/web dev      # :3000
pnpm --filter @bs/admin dev    # :5173
pnpm --filter @bs/platform dev # :4000
pnpm --filter @bs/worker dev
```

## Deploy
GitHub Actions: typecheck → lint → test → build → images to `ghcr.io/brandsewa/bsec-*` → Coolify webhook (staging, then production with approval). See [`infra/coolify/RUNBOOK.md`](infra/coolify/RUNBOOK.md).
