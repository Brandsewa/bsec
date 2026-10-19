# "Discourage search engines" switch on Storefront settings

- **Date:** 2026-10-19
- **Agent:** claude
- **Branch:** `feat/hide-from-search-engines` (not merged yet)
- **Area:** contracts, domain, admin
- **Type:** feature
- **Supersedes:** none

## Summary
Indexing was already controlled by store mode: a store in Coming soon or Password mode sends `Disallow: /` in robots.txt, a robots meta tag and an `X-Robots-Tag: noindex, nofollow` header, and new stores start in Coming soon. What was missing was a switch (like WordPress's "Discourage search engines") for a live store: the `seo_settings.indexing_enabled` flag existed and was honoured everywhere, but no screen or API could change it.

## What changed
- Settings -> Storefront has a new "Search engines" card with a switch. It sets `seo_settings.indexing_enabled` (inverted), so robots.txt, the meta tag and the header all follow it.
- `admin.storefront.getStatus` returns and `updateStatus` accepts `hideFromSearchEngines` (`packages/contracts/src/admin.ts`, `packages/domain/src/storefront/lifecycle.ts`). The change is written in the same transaction as the other status fields and appears in the `store_status.update` audit diff. No migration; no new procedure, so no isolation-suite mapping.
- Real-database test in `packages/domain/test/storefront-status.int.test.ts`.

## Decisions and trade-offs
- The password protected mode already covers "let admins see the front end": it is hidden from crawlers and visitors need the password. No new password feature was built.
- Not built: a shareable preview link. The `bypass_token_hash` column and `preview_token` query handling exist in the evaluator but nothing creates a token, and the staff-session bypass is never fed a session by the storefront callers (the admin login cookie belongs to the admin origin). Use Password mode for now.
- The switch is a request to crawlers, not access control; the card says so.

## Verification
- Ran: `pnpm typecheck` pass; `storefront-status.int.test.ts` and `storefront-lifecycle.test.ts` 33 pass (real Postgres); lint and docs:check below if run.
- NOT verified: the Admin card in a browser; a live crawl.

## Docs updated
- [ ] `docs/ARCHITECTURE.md` not needed (no structure, route, table, job or env change)
- [ ] ADR not needed
- [ ] `DEPLOYMENT.md` not needed
- [x] `progress.md` (in flight)

## Follow-ups and open questions
- Decide whether to build a preview link (token) for Coming soon stores, and fix the staff bypass.
- Stores reachable on both the platform subdomain and a custom domain are indexable on both unless canonical URLs point at the primary domain; not checked here.

## Definition of done
Gate status is in the PR description. No secrets or generated files in the diff.
