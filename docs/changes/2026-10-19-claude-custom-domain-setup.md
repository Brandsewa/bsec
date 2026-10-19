# Make custom domains usable: sweep job, register-on-retry, clearer DNS instructions

- **Date:** 2026-10-19
- **Agent:** claude
- **Branch:** `feat/custom-domain-setup` (not merged yet)
- **Area:** domain, db, worker, admin, docs
- **Type:** feature
- **Supersedes:** none

## Summary
Custom domains were coded but unusable: nothing polled Cloudflare, a domain saved before credentials existed could never be registered, and merchants saw no DNS records until the provider was configured. This change fixes those three gaps and documents the owner-side Cloudflare and Traefik setup.

## What changed
- `domains.sweep` pg-boss job (every 5 minutes, worker): `sweepPendingCustomDomains` in `packages/domain/src/domains/service.ts` refreshes every custom domain still waiting on DNS or SSL. It does nothing while Cloudflare is unconfigured.
- `verifyDomainWithDb`: a custom domain with no provider id is registered on its next check once credentials exist, so merchants do not delete and re-add. The onboarding step update now runs inside `withTenant`.
- Admin Domains page (`apps/admin/src/routes/_store/settings/domains.tsx`): DNS records and "Check status" show even before platform setup, with a "Waiting for platform setup" note; guide text explains subdomain versus bare domain and the `www` fallback.
- `DEPLOYMENT.md`: Cloudflare for SaaS setup, token scope, and the Traefik catch-all labels custom hostnames need. ADR-017 and ARCHITECTURE updated.
- New queue `domains.sweep` in `packages/db/src/queues.ts`. No migration, no new env vars.

## Decisions and trade-offs
- TXT pre-validation stays opt-in: the app only shows Cloudflare's ownership TXT, not the `_acme-challenge` certificate TXT, so making TXT the default would leave merchants without a record they need.
- Free Cloudflare plan is sufficient (100 hostnames included, then USD 0.10 each per month).
- The Traefik catch-all matches any host; unknown hosts reach the web app, which already shows its not-found page for unresolved hosts.

## Verification
- Ran: `pnpm --filter @bs/domain typecheck` pass; `pnpm --filter @bs/admin typecheck` pass; `vitest run test/domains-settings.test.tsx` 6 pass; `pnpm --filter @bs/domain exec vitest run test/custom-domains.int.test.ts --no-file-parallelism` 13 pass (real Postgres, two new tests).
- NOT verified: anything against real Cloudflare or Traefik; the Admin page in a browser; the worker job running live. Full gate is listed below if run.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (queues, schedules)
- [x] ADR-017 update note
- [x] `DEPLOYMENT.md`
- [x] `progress.md`

## Follow-ups and open questions
- Owner must do the Cloudflare steps and the Traefik label change, then test with one real subdomain (for example `store.brandsewa.com`). Remove that row and re-add it if it was saved before credentials existed, or just press Check status.
- A DNS lookup that tells the merchant which record is missing or wrong is not built yet.

## Definition of done
Gate status is recorded in the PR description. No secrets or generated files in the diff.
