# Sentry set up: four projects, DSNs in Coolify and GitHub, alerts and rate limits

- **Date:** 2026-11-25
- **Agent:** claude
- **Branch:** `docs/sentry-setup`  (not merged yet)
- **Area:** infra, docs
- **Type:** infra
- **Supersedes:** none

## Summary
Sentry error tracking, wired in code since the start but off without a DSN, is now configured. The owner signed in to Sentry and created the organisation `brand-sewa` in the **US** region; Claude created the projects and wired the DSNs. The apps start reporting after their next restart, which the merge of this PR (a normal `main` deploy) provides.

## What changed (outside the repo)
- Sentry: projects `bsec-web` (Next.js), `bsec-platform` (Node), `bsec-worker` (Node) and `bsec-admin` (React, shared by the store admin and Super Admin, owner decision 2026-11-25). Each client key is rate-limited to 300 errors per hour. Default alert rule per project: email on high priority issues.
- Coolify: variable `SENTRY_DSN` added to `bsec-web`, `bsec-platform` and `bsec-worker` (saved, applied at their next restart).
- GitHub: repository secret `VITE_SENTRY_DSN` set to the `bsec-admin` DSN; used by CI as a build argument for the admin and Super Admin images.

## What changed (in this PR, docs only)
- `DEPLOYMENT.md` new section "Error tracking (Sentry)"; `infra/coolify/RUNBOOK.md` section 9 and the admin row; `progress.md`; `docs/FAILOVER-PLAN.md`. No DSN values are in the repo.

## Decisions and trade-offs
- One project for both SPAs: works with today's CI (one secret feeds both builds). Split later with one secret per app if tenant-admin and staff errors need separate triage.
- Rate limit 300 per hour per key instead of relying on the monthly quota alone.
- Sentry is already a listed subprocessor (`docs/legal/subprocessors.md`, Global / US), so no legal change.

## Verification
- Ran: one test event per project sent straight to its DSN endpoint, each accepted (HTTP 200) and listed in Sentry (`BSEC-WEB-1`, `BSEC-PLATFORM-1`, `BSEC-WORKER-1`, `BSEC-ADMIN-1`); the four rate limits read back as 300 per 1 hour; the default alert rules and their email action seen in Monitors > Alerts; `pnpm docs:check`.
- Not verified: an error captured by a running app after the deploy (the SDK path itself), the alert email arriving, whether the free-tier quota is enough in production, storefront browser errors (not instrumented), SPA source maps (not uploaded).

## Docs updated
- [x] `DEPLOYMENT.md`, `infra/coolify/RUNBOOK.md`, `progress.md`, `docs/FAILOVER-PLAN.md`
- [x] ADR and ARCHITECTURE: not needed

## Follow-ups and open questions
- After the deploy: one real captured error per app type (admin: throw from the console; servers need the owner's yes for a one-off check), and confirm the alert email.
- Decide whether to add browser-side Sentry for the storefront, SPA source maps and release tags (code changes).
- Resolve the four setup-test issues in Sentry.

## Definition of done
Docs check passes, no secrets or DSNs in the diff. Open: PR, CI, merge cleanup.
