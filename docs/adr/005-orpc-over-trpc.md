# ADR-005: oRPC instead of tRPC

- **Status:** Accepted
- **Date:** 2026-09-28
- **Plan reference:** PLAN §2, §11

## Context
The admin SPA, the storefront, a future Expo app and partners all consume the same API. We want end-to-end types in TypeScript **and** a standard OpenAPI document for non-TS clients, from one definition.

## Decision
Contract-first **oRPC** with **Zod** schemas in `packages/contracts`, implemented with `implement(contract)` in the servers, served through **Hono** (`RPCHandler` for typed clients, `OpenAPIHandler` for REST/OpenAPI). Routers: `storefront.*`, `admin.*`, `public.*` (in `web`), `platform.*` (in the `platform` container only). Webhooks are plain Hono routes with signature checks.

## Consequences
- Contracts are importable by clients without importing server code.
- OpenAPI generated at `/api/openapi.json`; PRs run an OpenAPI diff check (PLAN §15).
- Smaller ecosystem than tRPC; we pin versions and check docs (context7) before using new APIs.

## Alternatives considered
- **tRPC:** great TS DX, but OpenAPI is a bolt-on and the mobile/partner story is weaker.
- **Hand-written REST + OpenAPI:** duplicate types, drift risk.
- **GraphQL:** heavier server and caching model than needed.
