# ADR-051: Store redirects: a tenant table answered from the storefront gate

- **Status:** Accepted
- **Date:** 2026-11-22
- **Plan reference:** `docs/STOREFRONT-AUDIT-FIXES-PLAN.md` phase 3 (extends ADR-002, ADR-004, ADR-040)

## Context
Stores migrated from Shopify (and stores that rename a product, page or collection) have old addresses that now 404. Only blog posts had redirects (`blog_slug_redirects`). A merchant had no way to keep an old URL working, so each migration needed a developer. The storefront gate (`middleware.ts`) already calls `/api/storefront/status/evaluate` for every request and caches the market prefixes per process for 30 seconds.

## Decision
1. **One tenant table `tenant_redirects`** (`tenantTable()` + forced RLS, rule 1): `from_path` (normalised: leading slash, no trailing slash, no query, case-insensitive), `to_path` (a path on the store or an `https://` URL), `status_code` (301, 302, 307 or 308; default 308), `source` (`manual`, `import`, `auto`), who and when. Unique on `(tenant_id, from_path)`.
2. **Answered at the gate, not in a page.** The evaluate route receives the request path and returns `redirect: { to, status, prefix }` when the store has a matching row. The route keeps each store's redirects in memory for 30 seconds per process (the same trade-off as market prefixes: a new redirect answers within half a minute). The middleware turns it into a real HTTP redirect before any page renders, keeps the query string, and puts the visitor's market prefix back on a relative target. GET and HEAD only.
3. **Permission `content.write`** (rule 4), audit row for every change (rule 6), cache invalidation after commit (rule 13 style).
4. **Guards:** a source may not be `/`, an API or asset path (`/api/`, `/_next/`), or a path the store needs to work (`/cart`, `/checkout`, `/account`, `/orders`, `/o/`, `/policies/`... see `RESERVED_REDIRECT_PREFIXES`); a target equal to its source, or one that makes a loop within 5 hops, is refused; at most 5,000 redirects per store (the in-memory map stays small).
5. **Automatic redirects** (`source = auto`): when a product, collection, category or page slug changes, the old address is recorded in the same transaction, unless the old slug is taken again.
6. **Bulk upload** takes up to 500 rows per call (`from,to[,status]` CSV in the admin) and reports each row's outcome.

## Consequences
- New table and migration `0120`, five `admin.redirects.*` procedures (mapped in the isolation suite), an admin screen, a public lookup read by the evaluate route.
- A redirect can hide a live page (the merchant's choice: retiring a product). The list shows it.
- Redirects are per host, not per market: the path is matched without the market prefix and the prefix is re-applied.
- A delay of up to 30 seconds per process before a new or removed redirect takes effect.

## Alternatives considered
- **Next.js `redirects()` in `next.config`:** static, built at deploy time; cannot be per tenant.
- **A database lookup in the middleware:** the Edge-style middleware has no database; the evaluate route already exists for exactly this.
- **Redirect inside the 404 page:** 200 with a meta refresh under Cache Components, not a real redirect for crawlers (seen on `/products` during the audit fixes).
- **Reuse `blog_slug_redirects`:** tied to a post by foreign key; the new need is any path.
