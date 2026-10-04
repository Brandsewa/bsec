# Remaining Settings delivery plan

- **Date:** 2026-10-04
- **Agent:** codex
- **Branch:** `codex/settings-rebuild-plan` (not merged yet)
- **Area:** docs, admin, domain, contracts, db
- **Type:** docs
- **Supersedes:** none

## Summary
Added the phased execution plan for every Settings feature remaining after the Phase 0/1 shell, Overview and Store Details foundation. It turns the requested features into independently buildable phases with dependencies, safety boundaries, acceptance criteria and owner decisions.

## What changed
- Added `docs/SETTINGS-REBUILD-REMAINING-PHASES.md` covering permissions/users/activity, branding/storefront/domains, checkout/accounts/orders/returns, payments/billing, shipping/GST, notifications/policies/privacy, storage/maintenance and final hardening.

## Decisions and trade-offs
- Provider, legal, tax/shipping scope and role-delegation choices remain explicit owner decisions rather than defaults chosen by a builder.
- Billing stays separate from shopper payments, storage remains platform-owned, and unimplemented gateways/channels stay absent or explicitly unavailable.
- Dependent phases are intentionally sequential to avoid parallel edits to Settings navigation, authorization and shared data models.

## Verification
- Ran: `node scripts/check-docs.mjs` and `git diff --check` after this documentation change.
- Read: Settings rebuild plan/schema/prompt, current branch history and latest change-record list.
- NOT verified: no application code, migrations or UI were changed/run.

## Docs updated
- [ ] `docs/ARCHITECTURE.md` — not needed; no structure changed.
- [ ] ADR — not needed for planning; Phase 2 requires a permission-model ADR before implementation.
- [ ] `DEPLOYMENT.md` / RUNBOOK — not needed.
- [x] `progress.md` — existing Settings planning claim remains active.

## Follow-ups and open questions
- Verify/merge the Phase 0/1 builder result before assigning Phase 2.
- Resolve the owner decisions in section 11 before their respective implementation phases.

## Definition of done
Docs only: no production, secrets, generated files or application code changed.
