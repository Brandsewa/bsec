# Cheap fixes from the Antigravity security audit

- **Date:** 2026-11-20
- **Agent:** claude
- **Branch:** `fix/security-audit-cheap-fixes` (not merged yet)
- **Area:** web, docs
- **Type:** fix
- **Supersedes:** none

## Summary
Antigravity audited the repo (report: SEC-001 to SEC-009). Each finding was checked against the code first; this change fixes the confirmed, cheap ones that the owner approved. The rest are left for the owner (see follow-ups).

## What changed
- **SEC-005:** new `apps/web/src/server/csv.ts`. Free-text cells in the finance export that start with `=`, `+`, `-`, `@`, tab or CR get a leading `'`. Amount columns use `quoteCsv` (quoting only) so negative amounts stay numbers. `api.ts` imports the helpers.
- **SEC-008:** `next` 16.4.3 to 16.4.5 in `apps/web/package.json` and the lockfile. `hono` 4.13.16 and `@hono/node-server` 2.1.6 were already on `main`. `pnpm audit --prod`: no known vulnerabilities.
- **Gate fix, not from the audit:** `@bs/platform` typecheck failed on a clean `main` in my worktree (`activateHome` missing from the Super Admin pages handler, added to the shared pages contract by the homepage-versions work). `packages/contracts/src/index.ts` now leaves `activateHome` out of `sitePagesContract`, since homepage versions are store-admin only. `@bs/contracts`, `@bs/platform`, `@bs/superadmin`, `@bs/content-admin` typecheck clean. CI on `main` was green for #296, so this may show only with a fresh install; the fix is correct either way.

## Decisions and trade-offs
- **Webhooks that fail their signature are still stored (owner decision D17, 2026-11-20: keep storing).** The audit finding SEC-003 suggested a 401 and no storage; the owner chose to keep the current behaviour, which a 24-hour purge already bounds. The route and its tests are unchanged.
- Overlap found late: the internal audit in `docs/audit/` (A2-05, A3-04, A4-02) already covers SEC-001, SEC-002 and SEC-003, and `main` already has per-IP and per-phone limits on place-order and pay. The external report was written against an older checkout.
- `@next/eslint-plugin-next` stays at 16.4.3 (lint tooling, not shipped, not flagged by audit).

## Verification
- Ran in the worktree: `pnpm --filter @bs/web typecheck` pass; `pnpm --filter @bs/web lint` 0 errors (6 existing warnings); `pnpm --filter @bs/web build` pass on next 16.4.5; `pnpm docs:check` ok; `pnpm audit --prod` no known vulnerabilities.
- `vitest run` in `apps/web`: 39 files, 282 tests pass on two reruns. One earlier full run showed 3 failures that did not repeat and that I did not identify; main alone passed 272/272. Treat as a possible flake and watch CI.
- New tests: `apps/web/test/csv.test.ts`.
- NOT run: `@bs/domain` heavy tests (no domain code changed), e2e (CI only), a real webhook or export against a running app.

## Docs updated
- [x] `docs/ARCHITECTURE.md`: not needed
- [x] ADR: not needed
- [x] `DEPLOYMENT.md`: not changed, `TRUST_CLOUDFLARE` is already documented on `main` (audit A2-05)
- [x] `progress.md` (in flight)

## Follow-ups and open questions
- **SEC-001:** decide whether to set `TRUST_CLOUDFLARE=true`. Needs the Cloudflare-only 80/443 firewall rule first, and a look at the real `X-Forwarded-For` the app receives (needs an owner-approved live request).
- **SEC-002:** per-IP limit and Turnstile on `place-order`; also check whether unpaid COD reservations are released.
- **SEC-004 / SEC-007:** judged low or deliberate; not changed.
- **SEC-006:** make `hashConsentIp` throw in production without a key.
- **SEC-009:** scan git history before making the repo private; `infra/` docs still name the production host and a Cloudflare R2 endpoint.

## Definition of done
Gate subset above passed; full `gate:quick` not run locally, CI will run it.
