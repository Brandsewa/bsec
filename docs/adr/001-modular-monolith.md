# ADR-001: Modular monolith

- **Status:** Accepted
- **Date:** 2026-09-28
- **Plan reference:** PLAN §2, §3

## Context
One to two developers with AI assistance must run many independent D2C stores on one 2 vCPU / 8 GB VPS. A store is a row of data, never a new server. The team cannot afford to operate distributed systems, and the commerce loop needs transactional consistency (order + stock + payment intent in one transaction).

## Decision
One Turborepo/pnpm monorepo, deployed as a small number of containers that share code and one PostgreSQL database:
- `web` (Next.js: storefront, marketing, Store API at `/api`)
- `platform` (Hono Platform API, separate credentials)
- `admin` (static Vite SPA)
- `worker` (pg-boss consumers)

Business logic lives in `packages/domain` modules (catalog, inventory, orders, …). Module boundaries are enforced in code: route handlers never touch the database; only `packages/db` and `packages/domain` may import `@bs/db` (ESLint `no-restricted-imports`); every domain service takes `ctx: TenantContext` first.

## Consequences
- Single transaction across modules; no distributed sagas for the core loop.
- One deploy pipeline, one database to back up and restore.
- Boundaries are discipline plus lint, not network, so reviews must watch cross-module coupling.
- Scaling path is vertical first, then a second app instance (PLAN §14), without re-architecture.

## Alternatives considered
- **Microservices:** operational cost far above team size; rejected (PLAN §2 "Rejected").
- **One app per store:** per-store servers contradict the "store is a row" goal and the capacity budget.
- **Kubernetes:** unnecessary at this scale; Coolify on one VPS suffices.
