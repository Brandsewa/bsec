# Cheap fixes from the Antigravity security audit

- **Date:** 2026-11-20
- **Agent:** claude
- **Branch:** `fix/security-audit-cheap-fixes` (not merged yet)
- **Area:** web, docs
- **Type:** fix
- **Supersedes:** none

## Summary
Antigravity audited the repo (report: SEC-001 to SEC-009). Each finding was checked against the code first; this change fixes the ones that were confirmed and cheap. The rest are left for the owner (see follow-ups).

## What changed
- **SEC-003:** `apps/web/src/app/api/webhooks/[provider]/route.ts` now answers 401 `Invalid webhook signature` for an unsigned or forged event, after the per-IP rate limit, and no longer writes `webhook_inbox` or enqueues a job. Valid events are untouched. `receiveWebhook` and the inbox processor are unchanged.
- **SEC-005:** new `apps/web/src/server/csv.ts`. Free-text cells in the finance export that start with `=`, `+`, `-`, `@`, tab or CR get a leading `'`. Amount columns use `quoteCsv` (quoting only) so negative amounts stay numbers. `api.ts` imports the helpers.
- **SEC-008:** `next` 16.4.3 to 16.4.5 in `apps/web/package.json` and the lockfile. `hono` 4.13.16 and `@hono/node-server` 2.1.6 were already on `main`. `pnpm audit --prod`: no known vulnerabilities.
- **Gate fix, not from the audit:** `@bs/platform` typecheck failed on a clean `main` in my worktree (`activateHome` missing from the Super Admin pages handler, added to the shared pages contract by the homepage-versions work). `packages/contracts/src/index.ts` now leaves `activateHome` out of `sitePagesContract`, since homepage versions are store-admin only. `@bs/contracts`, `@bs/platform`, `@bs/superadmin`, `@bs/content-admin` typecheck clean. CI on `main` was green for #296, so this may show only with a fresh install; the fix is correct either way.
- **SEC-001 (docs only):** `DEPLOYMENT.md` documents `TRUST_CLOUDFLARE` and the warning not to enable it before the origin firewall is Cloudflare-only.

## Decisions and trade-offs
- 401 instead of 200 for bad signatures: providers retry on non-2xx, which is correct for a forged or misconfigured event, and a store with a wrong secret now sees failures at the provider instead of silent "received".
- `@next/eslint-plugin-next` stays at 16.4.3 (lint tooling, not shipped, not flagged by audit).

## Verification
- Ran in the worktree: `pnpm --filter @bs/web typecheck` pass; `pnpm --filter @bs/web lint` 0 errors (6 existing warnings); `pnpm --filter @bs/web build` pass on next 16.4.5; `pnpm docs:check` ok; `pnpm audit --prod` no known vulnerabilities.
- `vitest run` in `apps/web`: 39 files, 282 tests pass on two reruns. One earlier full run showed 3 failures that did not repeat and that I did not identify; main alone passed 272/272. Treat as a possible flake and watch CI.
- New tests: `apps/web/test/csv.test.ts`; `webhook-route.test.ts` rewritten so forged, unsigned and unknown-provider events get 401 and `receiveWebhook` is not called.
- NOT run: `@bs/domain` heavy tests (no domain code changed), e2e (CI only), a real webhook or export against a running app.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (web webhook line)
- [x] ADR: not needed
- [x] `DEPLOYMENT.md` (`TRUST_CLOUDFLARE`)
- [x] `progress.md` (in flight)

## Follow-ups and open questions
- **SEC-001:** decide whether to set `TRUST_CLOUDFLARE=true`. Needs the Cloudflare-only 80/443 firewall rule first, and a look at the real `X-Forwarded-For` the app receives (needs an owner-approved live request).
- **SEC-002:** per-IP limit and Turnstile on `place-order`; also check whether unpaid COD reservations are released.
- **SEC-004 / SEC-007:** judged low or deliberate; not changed.
- **SEC-006:** make `hashConsentIp` throw in production without a key.
- **SEC-009:** scan git history before making the repo private; `infra/` docs still name the production host and a Cloudflare R2 endpoint.

## Definition of done
Gate subset above passed; full `gate:quick` not run locally, CI will run it.
