# Parked plan: go-live hardening for online payments

- **Date:** 2026-11-03
- **Agent:** claude
- **Branch:** `docs/go-live-hardening-plan` (not merged yet)
- **Area:** docs
- **Type:** docs
- **Supersedes:** none

## Summary
The owner asked for a plan covering the four areas that matter most once online payments go live (backups and recovery, monitoring, abuse protection, account security), and asked to park it and be reminded of the pending items later. This adds `docs/GO-LIVE-HARDENING-PLAN.md`. No code, config or infrastructure changed.

## What changed
- New `docs/GO-LIVE-HARDENING-PLAN.md`: audit of current state, Phase 1 blockers before the first live payment, Phase 2 for the first month, pending-list table, acceptance criteria, risks, owner decisions, costs.

## Decisions and trade-offs
- Parked, not claimed: no line was added to "In flight" in `progress.md` because nobody is building it yet.
- The audit was read from docs and code, not run. Items needing a live check are marked *confirm* in the plan.
- Found while auditing: `infra/coolify/RUNBOOK.md` section 9 says uptime is not set up, but `infra/uptime/README.md` says it is live. RUNBOOK section 5 and `infra/runbooks/INCIDENT.md` disagree on whether platform is behind Cloudflare Access. Both are listed as plan items; the existing docs were not edited here.

## Verification
- Ran: nothing. `pnpm docs:check` has not been run on this branch.
- NOT verified: every state claim in the plan's section 1 comes from reading files, not from the live system.

## Docs updated
- [ ] `docs/ARCHITECTURE.md` not needed (no structure change)
- [ ] ADR not needed (no decision made, only a plan)
- [ ] `DEPLOYMENT.md` / RUNBOOK not needed yet
- [ ] `progress.md` not changed (parked plan, nothing in flight)

## Follow-ups and open questions
- Owner decisions are in plan section 7.
- Pending items are tracked in plan section 4; update that table as work happens.

## Definition of done
Docs-only change; nothing in the gate was run. Run `pnpm docs:check` before pushing.
