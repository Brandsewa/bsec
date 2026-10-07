# Server hardening checklist and public-repo follow-ups

- **Date:** 2026-10-07
- **Agent:** claude
- **Branch:** `docs/server-hardening-checklist`
- **Area:** docs, infra
- **Type:** docs

## Summary
Recorded the result of a read-only port probe of the production server (SSH, web and the Coolify dashboard/websocket ports are reachable; database ports are closed) and a hardening checklist in `infra/coolify/RUNBOOK.md` section 9, plus a follow-up note in `progress.md`. These are owner actions on the VPS and firewall; nothing on the server was changed.

## Verification
- The probe was a plain TCP connect to a short list of ports from this machine; no requests were sent beyond connecting. `pnpm docs:check` passes. Server state was not changed, so nothing was deployed or tested.
