# Settings Phases 3-8: owner decisions, master hand-off and builder prompts

- **Date:** 2026-10-04
- **Agent:** claude
- **Branch:** `docs/settings-phases-4-8`
- **Area:** docs, planning
- **Type:** docs
- **Supersedes:** the scope sketches of Phases 4-8 in `SETTINGS-REBUILD-REMAINING-PHASES.md` (prompts win where they differ)

## Summary
The owner accepted the recommended defaults for all ten open questions (recorded in `SETTINGS-PHASES-3-8-HANDOFF.md` §1). Claude wrote a master hand-off for Antigravity plus one detailed builder prompt per phase, each written against an audit of the current code.

## What was added
- `docs/SETTINGS-PHASES-3-8-HANDOFF.md`: decisions, phase map and order, shared engineering standards (repo rules, settings design, testing, lessons from this integration pass, git protocol), cross-phase file rules, the Phase 3 plan summary, the verification protocol.
- `docs/prompts/settings-rebuild-phase-4.md` to `-8.md` (Phase 3's prompt was merged earlier): scope, schema (tables, constraints, indexes, grants, migrations), contracts, behaviour, jobs, UI, tests, acceptance criteria, commit plan, owner questions.
- `SETTINGS-SCHEMA.md` §17 refinements (reuse `customer_consent_events` and `email_log` instead of new tables; no cookie banner; etc.) and `SETTINGS-REBUILD-REMAINING-PHASES.md` §13 pointer.

## Defects in current code found by the audit (assigned to the phase that fixes them, each with a failing-first test)
- Phase 3: `updateStoreStatus` returns before its cache invalidation (unreachable); store password and bypass token verify when the typed value equals the stored hash and use unsalted SHA-256; domains service has no permission check or audit and `domains.list` is unguarded; branding writes no audit row.
- Phase 5: `placeOrder` does not enforce payment-method availability in the domain service and fabricates a provider order id for non-COD; no COD min/max; `billing.getSubscription` has no permission check; self-service `billing.changePlan` is open to any role with `settings.write`.
- Phase 6: hard-coded 18% GST in admin create-order and the invoice fallback; silent "Delhi" place-of-supply fallback; no tax snapshot on storefront orders; no `tax_classes` table behind `products.tax_class_id`; credit notes never issued; GSTIN not validated.
- Phase 7: one hard-coded generic Privacy/Terms/Refund/Shipping text served for every store; emails ignore preferences; raw IPs stored as consent evidence; `email_log` has no retention; no customer data export or request intake.
- Phase 8: store admin procedures have no authorization-matrix or audit-coverage suite; middleware fails open on status lookup errors.

## Verification
Docs only: `pnpm docs:check` ok. The claims about current code were read from the repository on 2026-10-04; nothing here was executed.

## Notes
- Phases are strictly sequential; Claude verifies each before the next starts.
- 5B (Razorpay), 6E and 6F are gated on explicit owner go inside the builder session.
- GST changes ship behind `settings.gst_v2` and need a chartered-accountant review before production enablement.

## Definition of done
- [x] Docs consistent with the repo. [x] No secrets or generated files. [x] progress.md updated.
