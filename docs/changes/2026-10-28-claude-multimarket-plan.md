# Multi-market stores plan (docs only)

- **Date:** 2026-10-28
- **Agent:** claude
- **Branch:** `docs/multimarket-plan` (not merged yet)
- **Area:** docs
- **Type:** docs
- **Supersedes:** none

## Summary
Adds `docs/MULTIMARKET-PLAN.md`: how a store gets one base market plus extra markets (India, USA, Canada first), each with its own currency and prices, catalog, subfolder URL, payment gateway, shipping, returns and cancellation policy, and taxes. It also covers metric and imperial units and detecting the shopper's market from their location. The owner's decisions from 2026-10-28 are recorded in its section 12. v1 is designed for the least compliance burden: the merchant is the seller of record and uses their own gateway accounts, Brand Sewa never holds funds, and the merchant enters all tax rates and policies.

## What changed
- New `docs/MULTIMARKET-PLAN.md` (plan with phases 0, 1, 1B, 2-7, 4B and acceptance criteria).
- No code, migrations, env vars or routes.

## Decisions and trade-offs
- Owner decisions: PayPal for Brand Sewa billing of international merchants; stores can connect Stripe and PayPal (rule 14 to be updated in Phase 0); manual exchange rates; merchant-entered taxes; duties paid by the shopper on delivery; market limits 1/2/5 by plan; subfolder URLs only for launch; compliance handled by the merchant.
- ADR-039 is to be written in Phase 0, not in this change.

## Verification
- Code facts in the plan's section 3 come from reading schema files and grep counts, not a full read.
- `pnpm docs:check` not run (docs-only change, no new app, package, ADR or migration).

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed (no structural change yet)
- [ ] ADR: deferred to Phase 0 (ADR-039)
- [ ] `DEPLOYMENT.md`: not needed
- [ ] `progress.md`: "In flight" line is added when Phase 0 starts

## Follow-ups and open questions
- None open; former questions A-D are answered as decisions 11-14 in the plan.
- Phase 0: confirm PayPal Subscriptions works for an India-registered platform account.

## Definition of done
Docs only: no secrets, no generated files, no unrelated edits. Gate items for code do not apply.
