# Failover and resilience plan (docs only)

- **Date:** 2026-11-01
- **Agent:** claude
- **Branch:** `docs/failover-plan` (merged in #185, 510ce88)
- **Area:** infra, docs
- **Type:** docs
- **Supersedes:** none

## Summary
The owner asked how to keep the site up if the single Hostinger VPS fails, using Cloudflare, and what to learn from Shopify's pod architecture. This adds a parked plan, `docs/FAILOVER-PLAN.md`, with an audit of what already exists and a phased list of work for later. No code, config or infrastructure was changed.

## What changed
- New `docs/FAILOVER-PLAN.md`: current-state audit, Phase A (no new server) and Phase B (standby behind a Cloudflare load balancer), failover procedure, acceptance criteria, security checklist, costs, risks.
- This change record.

## Decisions and trade-offs
- The owner will not build the standby now. The plan is for later.
- Recommended replication is pgBackRest WAL to R2 (also gives point-in-time recovery); promotion stays manual to avoid split-brain.
- Audit found rate limiting and tenant quotas already done; the real gaps are backup freshness (24 h), no restore drill, no database timeouts, and unresolved access and firewall items.
- No ADR yet: one is needed when the replication option in plan section 4.3 is chosen.

## Verification
- Ran: `pnpm docs:check` ok; nothing else executed.
- Read only: `DEPLOYMENT.md`, `infra/coolify/RUNBOOK.md`, `infra/backups/*`, `infra/runbooks/INCIDENT.md`, `infra/loadtest/CAPACITY-POLICY.md`, `infra/uptime/README.md`, `packages/domain/src/system/rate-limit.ts`, plus a repo grep for database timeouts.
- NOT verified: Cloudflare Load Balancing price and plan limits; whether a load balancer can be the Cloudflare for SaaS fallback origin; whether platform and Super Admin are actually behind Cloudflare Access (two docs disagree); anything on the live Cloudflare or Hostinger accounts.

## Docs updated
- [x] `docs/FAILOVER-PLAN.md` added
- [ ] `docs/ARCHITECTURE.md`: not needed (no structure change)
- [ ] ADR: not needed yet
- [ ] `DEPLOYMENT.md` / RUNBOOK: not changed; conflict noted in the plan
- [ ] `progress.md`: not touched

## Follow-ups and open questions
- Owner: confirm RPO/RTO targets, standby provider and budget when starting.
- Owner: is `platform.bcom.si` behind Cloudflare Access today?
- Optional: add a "parked" line to `progress.md` known gaps.

## Definition of done
Docs-only change. Needs `pnpm docs:check`, then a branch and commit by the owner's say-so. No secrets in the diff.
