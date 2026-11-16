# Platform audit A5 to A15: first pass, with fixes

- **Date:** 2026-11-16
- **Agent:** claude
- **Branch:** `test/platform-audit-phase-3-7` (merged in #281, bf36ece)
- **Area:** web, platform, blocks, domain, db, ci, docs
- **Type:** fix (audit findings with tests)
- **Supersedes:** none

## Summary
First pass over audit sections A5 to A15, as the owner asked ("proceed with all, log crucial decisions and tell me at the end"). It found one High (stored XSS through structured-data scripts), three Medium (open redirect, customer erasure leaving personal data, missing indexes and security headers) and several Low items, and fixed all of them with tests. Everything that needs a decision is in `docs/audit/2026-11-DECISIONS.md`.

## What changed
- **A8-01** 14 storefront pages and components now render structured data through the escaping `JsonLd` component; a test also fails if any file writes `JSON.stringify` into a script by hand again (`apps/web/test/json-ld-escaping.test.tsx`).
- **A7-02** `publicUrl` never leaves the shopper-facing origin; the market selector refuses control characters (`request-origin.test.ts`).
- **A8-02** `isSafeHref` (block and menu links) refuses control characters and backslashes (`packages/blocks/test/safe-href.test.ts`).
- **A7-01** security headers: `next.config.ts` (nosniff, referrer policy, permissions policy, HSTS), Hono `secureHeaders` on the platform API, HSTS and permissions policy in both nginx configs.
- **A5-01** platform API request body cap (6 MB, 11 MB on the media upload route) enforced while streaming.
- **A6-01** wider log redaction, case-sensitive header names included (`logger-redaction.test.ts`).
- **A10-01** `scripts/check-migrations-immutable.mjs` and `packages/db/migrations/checksums.json`, run by `pnpm docs:check`.
- **A10-02** migration `0114_hot_path_indexes` (seven indexes, indexes only) and the matching Drizzle schema declarations.
- **A12-01** customer erasure: no email in the kept audit row, sign-in codes deleted, raw consent IPs cleared (`customers-phase1.int.test.ts`).
- **A11-01** all 23 GitHub Actions references pinned to commit SHAs.
- **A15-01** 20 merged branches removed from "In flight" in `progress.md`.
- Docs: findings `docs/audit/2026-11-A5-A15-findings.md`, decisions `docs/audit/2026-11-DECISIONS.md`, summary and plan status updated, `docs/ARCHITECTURE.md` migration table (0114).

## Decisions and trade-offs
- **Headers without CSP.** Only headers that cannot break a page were added. The admin page editor frames the storefront and checkout loads several third-party scripts, so a CSP and `frame-ancestors` need a staged report-only rollout checked in a browser (decision D2).
- **HSTS without `includeSubDomains` or preload.** Stores live on many subdomains and custom domains; Cloudflare serves them over HTTPS, and browsers ignore the header over plain http (local development).
- **Migration lock, not history rewriting.** Eight migrations show more than one commit, all within days of creation; whether any changed after reaching production cannot be told here, so the guard protects from now on.
- **Indexes through a hand-written migration.** Drizzle snapshots stopped at 0003, so the migration, journal entry and schema declarations were written by hand like every migration since.
- **Erasure is only partly extended.** Orders, carts, mail log, newsletter, form submissions and quote requests keep personal data; periods are a legal decision (D4).

## Verification
- Ran: the new and changed tests above, each also shown to fail without its fix where that was possible (redirect, JSON-LD, redaction capital-letter case, migration guard); `pnpm --filter @bs/blocks test` 285 pass; `@bs/platform` `app.test.ts` 5 pass; `customers-phase1` 26 pass; migration 0114 applied by the db tests and the seven indexes confirmed in the migrated database. Whole repository: typecheck and lint pass (0 errors); `@bs/web` fast 269, `@bs/domain` fast 764, `@bs/platform` fast 7, `@bs/blocks` 285 pass; the full `@bs/domain` heavy suite 3,091 passed in 161 of 162 files, and the one file that did not report, `rate-limiting.int.test.ts`, lost its worker to a Windows native crash (exit code 3221226505, the third time in this session, each time in a different or the same file and passing alone).
- Exercised by hand: nothing in a browser. The new headers were not seen on a running site, and the structured-data fix was tested by rendering, not on a live page.
- NOT verified: headers on production behind Cloudflare and Traefik; a CSP of any kind; the checkout and admin editor with the new headers; sections' "not checked" lists in the findings file.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (migration table: 0114)
- [ ] ADR: not needed
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md` (stale in-flight lines)

## Follow-ups and open questions
All in `docs/audit/2026-11-DECISIONS.md` (D1 to D18).

## Definition of done
- [x] Code follows section 2 and 3; tests added.
- [x] Docs updated where a trigger applied.
- [x] No secrets or generated files in the diff.
- [x] Honest status: see Verification and the "not checked" lists.
- [x] After merge: record updated, branch and worktree removed.
