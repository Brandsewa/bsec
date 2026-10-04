# Plans: Pre-orders, Returns, Quotes, Abandoned checkouts

- **Date:** 2026-10-02
- **Agent:** claude
- **Branch:** `chore/repo-guardrails` (not merged yet; docs only, nothing committed)
- **Area:** docs, admin, domain, contracts
- **Type:** docs
- **Supersedes:** none

## Summary
Follow-up to `2026-10-02-claude-orders-all-orders-plan.md`. Maps the other four Orders sections of the owner's Storify site against bsec and writes a hand-off plan for each, plus an overview with the sidebar grouping and the build order. No application code changed.

## What changed
- New: `docs/ORDERS-SECTIONS-OVERVIEW.md`, `ORDERS-RETURNS-PLAN.md`, `ORDERS-ABANDONED-CHECKOUTS-PLAN.md`, `ORDERS-QUOTES-PLAN.md`, `ORDERS-PREORDERS-PLAN.md`.

## Revision (same day, after the owner's answers)
- Pre-orders rewritten as a simple dated normal order (ships-on date, notification, no deposits).
- Returns rewritten as a manual model: customer portal request with photo upload, Settings > Returns, admin records a manual refund or exchange.
- Quotes rewritten as a lean industry model (request, then convert to an order with an audited price), optional and last.
- Decisions the owner delegated were recorded in the All orders and Abandoned plans.
- `Storify/` added to `.git/info/exclude` (local only).

## Decisions and trade-offs
- Order of work: All orders Phase 1, sidebar group, Abandoned checkouts (read-only), Returns UI, Quotes lead inbox; Pre-orders last because it needs online payment, which is not live.
- Quotes and Pre-orders are new features in bsec, so each is split into a safe first phase and a gated second phase.
- Every send-mail button must be disabled with a stated reason until platform email is live.

## Verification
- Ran: `pnpm docs:check` (result in the hand-off message).
- Read, not run: all Storify claims come from its source; the demo's list pages for these four sections were not opened (the demo has no data for them). All bsec claims come from reading the code.
- NOT verified: nothing in bsec was run or changed.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed (no structure change)
- [ ] ADR: not needed now (Quotes Phase B and Pre-orders Phase B each need one when started)
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [ ] `progress.md`: not updated; no in-flight claim because no code work started

## Follow-ups and open questions
- Findings in bsec: `carts.recovered_at` is never written and no cart is ever marked converted; the returns page uses `window.confirm`; `actOnReturn` writes no `audit_logs`; the return window is hard-coded to 7 days; refunds may need a GST credit note (verify).
- Owner decisions are listed in each plan (Abandoned D1 to D6, Returns D1 to D6, Quotes D1 to D6, Pre-orders D1 to D6).
- `Storify/` is untracked inside the repo and must not be committed.

## Definition of done
Docs only: no secrets, no generated files, no unrelated edits.

## Addendum (settings and styling)
- New `docs/ORDERS-SETTINGS-PLAN.md`: Settings > Orders and Settings > Returns, adapted from Storify's Order Settings page (prefix, tax, shipping, commission, returns window and fees). Tax, shipping and COD are not duplicated (they already have pages); commission and withdrawal are dropped (marketplace only).
- Found a defect: Settings > General has an "Order number prefix" that checkout ignores (hard-coded `ORD-` and 5 digits in `orders/checkout.ts` and `createAdminDraftOrder`). The settings plan makes fixing it step 1.
- Overview section 4 now makes the owner's design system mandatory (`docs/admin-ui-standards.md`, shadcn `base-mira` on Base UI, shared kit) and notes there is no `switch` component yet. Each plan links to it.
