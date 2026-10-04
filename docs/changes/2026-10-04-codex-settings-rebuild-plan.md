# Settings rebuild product plan

- **Date:** 2026-10-04
- **Agent:** codex
- **Branch:** `codex/settings-rebuild-plan` (not merged yet)
- **Area:** docs, admin, domain, contracts
- **Type:** docs
- **Supersedes:** none

## Summary
Added a detailed, implementation-ready product plan for rebuilding Store Admin Settings from the current section-based workspace into a grouped, permission-aware operating console. The plan refines the owner's initial feature list against current bsec constraints and documented Shopify/FluentCart patterns without proposing unsupported or unsafe controls.

## What changed
- Added `docs/SETTINGS-REBUILD-PLAN.md` with target information architecture, section specifications, tenant/security rules, implementation phases, acceptance criteria and owner decisions.
- Added the required in-flight claim in `progress.md`.

## Decisions and trade-offs
- Merchant plan/billing views are distinct from customer payment gateways under ADR-014.
- Storage is usage visibility only; merchant-selectable storage providers and bucket credentials would violate platform-operated tenant isolation.
- Gateway and notification controls are only exposed when their server behaviour and queued delivery exist; Razorpay, Shiprocket, SMS and WhatsApp remain gated by current owner decisions.
- A permission-model ADR is required before replacing the broad `settings.write` capability.

## Verification
- Ran: `git fetch` successfully before planning; `node scripts/check-docs.mjs` (`docs:check ok`); `git diff --check` (pass).
- Read: current settings routes/components, settings schema/domain services, ADR-014/017/019, `ORDERS-SETTINGS-PLAN.md`, `docs/admin-ui-standards.md`, current platform plan/billing implementation and official Shopify/FluentCart documentation.
- NOT verified: no application code changed or UI was run; this is a documentation-only planning change.

## Docs updated
- [ ] `docs/ARCHITECTURE.md` — not needed; no structure changed.
- [ ] ADR — not written; Phase 0 must write one for the granular merchant permission model.
- [ ] `DEPLOYMENT.md` / RUNBOOK — not needed.
- [x] `progress.md` — in-flight plan claim added.

## Follow-ups and open questions
- Resolve the eight owner decisions in `docs/SETTINGS-REBUILD-PLAN.md` section 7 before implementation starts.
- Review the existing `ORDERS-SETTINGS-PLAN.md` during Phase 0 so active order/return work retains one canonical settings route.

## Definition of done
Docs only: no production, secrets, generated files or application code changed.
