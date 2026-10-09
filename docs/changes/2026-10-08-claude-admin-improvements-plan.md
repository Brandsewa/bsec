# Plan: Super Admin and Store Admin improvements (hand-off to Antigravity)

- **Date:** 2026-10-08
- **Agent:** claude
- **Branch:** `docs/admin-improvements-plan` (not merged yet)
- **Area:** docs
- **Type:** docs
- **Supersedes:** none

## Summary
The owner listed bugs and improvements for Super Admin (storage connections, quota tiers with pricing, Integrations hub) and Store Admin (order archive/delete, returns page, product image upload failure, themes and pages cleanup on Puck, Shopify-style navigation with filter menus). This change records a phased implementation plan with acceptance criteria so Antigravity can build and Claude can verify.

## What changed
- `docs/ADMIN-IMPROVEMENTS-PLAN.md`: six phases, design, contracts, tests, acceptance criteria, owner-decision defaults, verification protocol.
- `docs/prompts/admin-improvements.md`: the hand-off prompt for the builder.
- No code, schema or behaviour changed.

## Decisions and trade-offs
- Findings from reading the code that shape the plan: the "failed to fetch" upload error is a thrown browser `fetch` against a presigned R2 URL (CORS or unsignable header, to be confirmed by reproducing), the upload code is duplicated, and the storefront never reads the `menus` table.
- 2026-10-08 update: SMS and WhatsApp use Zoho CPaaS (set up, not enrolled); Razorpay and Stripe enablement added to Phase 4 (AGENTS.md rule 14 lifted for this scope, test mode only); order delete is archive-first and the bulk bar must show Archive.
- Owner-decision defaults are listed in plan section 11 (order delete policy, tier price meaning, SMS/WhatsApp scope, local storage in production, providers, payments card).
- ADR numbers reserved for the builder: 023 (storage and integrations), 024 (order archive vs delete), 025 (quota tiers), 026 (page hierarchy, menus, filters).

## Verification
- Ran: none (docs only). `pnpm docs:check` run on this branch, result below.
- NOT verified: every statement marked *(from code)* was read, not executed; the root cause of the upload failure is a hypothesis until reproduced.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed (no structure change)
- [ ] ADR: not needed (ADRs are assigned to the build phases)
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [ ] `progress.md`: not needed (no milestone changed; builders add their own in-flight lines)
