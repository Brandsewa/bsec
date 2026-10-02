# Uptime docs match the live Better Stack setup

- **Date:** 2026-10-02
- **Agent:** claude
- **Branch:** `docs/uptime-bcom-si` (not merged yet)
- **Area:** infra, docs
- **Type:** docs
- **Supersedes:** none

## Summary
Better Stack is now provisioned with four monitors and a public status page. `infra/uptime/` still said "not provisioned" and a 60 second cadence; it now matches what is live. The `chore/domain-bcom-si` in-flight line is removed since that work merged (PR #3).

## What changed
- `infra/uptime/README.md`: status live, status page link, cadence 3 minutes, Super Admin monitor row.
- `infra/uptime/betterstack.json`: interval 180 s, added the Super Admin monitor.
- `progress.md`: removed the finished in-flight line.

## Decisions and trade-offs
- Cadence is 3 minutes (what was configured); revisit if faster detection matters.
- Super Admin is monitored but kept off the public status page (staff-only tool).

## Verification
- Ran: `pnpm docs:check`.
- Exercised by hand: viewed https://bcom.betteruptime.com/ and the monitor list (all up).
- NOT verified: alert contacts configured on each monitor (not visible to the agent).

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed
- [x] ADR: not needed (docs only)
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md` (in-flight)

## Follow-ups and open questions
- Owner: confirm alert contacts on each monitor.

## Definition of done
Docs only: no code, secrets or generated files in the diff.
