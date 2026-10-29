# Multi-market: WP-8 documentation close-out

- **Date:** 2026-10-29
- **Agent:** claude
- **Branch:** `docs/multimarket-phase0` (local only; nothing pushed)
- **Area:** docs
- **Type:** docs
- **Supersedes:** none

## Summary
Documents the finished multi-market build: new `docs/ARCHITECTURE.md` section 19 plus pointers in sections 5, 8, 9, 13, 14 and 17; PayPal webhook and Cloudflare visitor-country notes in `DEPLOYMENT.md`; ADR-040 "as built" amendments; `progress.md` milestone M15 with known gaps; status block in `docs/MULTIMARKET-HANDOFF.md`; and `docs/MULTIMARKET-PUSH-CHECKLIST.md`.

## What changed
- `docs/ARCHITECTURE.md`, `DEPLOYMENT.md`, `progress.md`, `docs/adr/040-markets.md`, `docs/MULTIMARKET-HANDOFF.md`, `docs/MULTIMARKET-PLAN.md` (status line), new `docs/MULTIMARKET-PUSH-CHECKLIST.md`.
- Docs notes from the Antigravity change records (WP-1a, WP-3, WP-5, WP-6) are folded into section 19.

## Decisions and trade-offs
- PayPal billing for non-India merchants is recorded as Orders v2 links per cycle, and flagged as not sandbox-verified.

## Verification
`pnpm docs:check` run. Docs only: no code or tests touched. No browser or sandbox verification was done; the gaps are listed in `progress.md` M15 and the checklist.

## Open questions
- Owner to supply PayPal sandbox and Stripe test keys for the sandbox runs, and decide when to push.

## Definition of done
- [x] Docs updated (ARCHITECTURE, DEPLOYMENT, ADR, progress)
- [x] Change record
- [ ] Gate for code: not applicable (docs only)
- [ ] After merge: record PR and commit, remove In flight line, delete branch
