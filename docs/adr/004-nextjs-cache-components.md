# ADR-004: Next.js Cache Components for the storefront

- **Status:** Accepted
- **Date:** 2026-09-28
- **Plan reference:** PLAN §2, §10, §11.6, §12

## Context
Storefront pages are mostly shared (catalog, content, theme) with small per-visitor holes (cart badge, stock, delivery ETA, account). A 2-CPU server must serve many stores with LCP < 2 s on mid-range Android.

## Decision
Next.js 16 App Router with `cacheComponents: true`. Cached data uses `'use cache'` + `cacheTag`; request-time parts sit inside `<Suspense>` with skeletons; every route has `loading.tsx`. Cloudflare CDN caches in front.

**Invariant:** every cache tag starts with the tenant, `t:{tenantId}:…`, built with `tenantTag()` from `@bs/domain`. The ESLint rule `bs/tenant-cache-tag` rejects `cacheTag` / `revalidateTag` / `updateTag` calls without it. The invalidation matrix is PLAN §11.6. Merchant edits use read-your-writes (`updateTag`); storefront reads use stale-while-revalidate.

The Store API is mounted inside the same Next app at `/api` (Hono + oRPC) to avoid another container on the small VPS.

## Consequences
- One cross-tenant cache key mistake would leak content, hence the lint rule and helper.
- Next 16 has breaking changes vs training data; read `node_modules/next/dist/docs` before using an API.
- Self-hosted cache is per-instance until the Valkey cache handler (later stage).

## Alternatives considered
- **Fully dynamic SSR:** too much CPU per request on 2 vCPU.
- **Static export per store:** impossible with thousands of products and live stock.
