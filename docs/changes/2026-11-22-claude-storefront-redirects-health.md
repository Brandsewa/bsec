# Store redirects, canonical domain, link health (phases 3 and 4 of the storefront audit fixes)

- **Date:** 2026-11-22
- **Agent:** claude
- **Branch:** `feat/storefront-redirects-health` (stacked on `fix/storefront-audit-fixes`, PR 313; not merged yet)
- **Area:** db, domain, contracts, web, admin, docs
- **Type:** feature
- **Supersedes:** none (continues `docs/changes/2026-11-21-claude-storefront-audit-fixes.md`)

## Summary
Merchants can now keep old addresses working (Settings > Redirects, with CSV upload), a store with several of its own domains answers on one, and SEO health lists links in menus and pages that lead nowhere. Plan: `docs/STOREFRONT-AUDIT-FIXES-PLAN.md` sections 9 and 10.

## What changed
- **Redirects (ADR-051):** migration `0120_store_redirects` (tenant table, forced RLS), `packages/domain/src/redirects/` (pure rules and service), five `admin.redirects.*` procedures (`content.write`, audited, mapped in the isolation suite), Settings > Redirects (add, search, delete, CSV up to 500 rows). The middleware sends the request path to the evaluate route (`bs_path`), which answers from a 30 second per-process copy and returns the target with the market prefix; the middleware issues the real redirect and keeps the query string. Changing a product, collection or category slug adds an automatic redirect in the same transaction.
- **One address per store:** a request on a secondary custom domain redirects (308) to the primary custom domain (`domains/canonical.ts`). The platform address is never redirected. Settings > Domains suggests connecting the www or bare twin.
- **Link health:** `admin.seo.links` and a card on SEO health: broken internal links, links to the preview address, old Shopify checkout links, a www address that is not connected.
- **Menus and pages:** menu links to the preview address are saved as paths; a custom page without an SEO description uses the first real sentence of its copy.
- No new env var or queue.

## Decisions and trade-offs
- Redirect lookups ride on the existing per-request evaluate call (the middleware has no database) with a 30 second per-process cache: a new redirect can take up to half a minute elsewhere than the process that saved it.
- Guards: reserved paths (cart, checkout, account, api and similar), loops and chains over five hops, targets with any scheme but http(s), 5,000 per store.
- The link check is on demand and read-only, and does not crawl.
- `www`: we redirect and advise; we never touch a merchant's DNS or Cloudflare.

## Verification
- Ran: `pnpm typecheck` pass (before the last two small edits; the touched packages were typechecked individually after), `pnpm lint` 0 errors, `pnpm docs:check` ok; domain unit tests for redirect rules (10), canonical host (4), link rules (8), meta description and page copy (12); admin CSV parser (3) and www twin (2).
- Real database (shared test Postgres, serial): `redirects.int.test.ts` 16 pass (service, permissions, isolation, loops, import, automatic redirects, link health, menu tidy); `isolation.int.test.ts` 1922 pass before `seo.links` was added to it.
- By hand on the local seeded demo store: `/old-tee?utm=1` redirected 301 to the product with the query kept, an outside target redirected, an unknown path stayed 404.
- NOT verified: the Redirects, SEO health and Domains screens in a browser (sign-in on the local admin did not keep a session here; the screens are typechecked and linted only), the canonical-host redirect against a real second domain, the full heavy suite, e2e, any live store.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (storefront paragraph, migration 0120)
- [x] ADR-051
- [x] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md` (in-flight)

## Follow-ups and open questions
- Owner decisions still open: Cloudflare email obfuscation, mojibake repair.
- Not built: starter H1 hint, banner amount check in SEO health, richer product schema, import alt column.

## Definition of done
Gate partly run (see Verification); no secrets or generated files in the diff.
