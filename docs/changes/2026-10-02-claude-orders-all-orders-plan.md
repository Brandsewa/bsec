# Plan: All orders parity with the Storify reference

- **Date:** 2026-10-02
- **Agent:** claude
- **Branch:** `chore/repo-guardrails` (not merged yet; docs only, nothing committed)
- **Area:** docs, admin, domain, contracts
- **Type:** docs
- **Supersedes:** none

## Summary
The owner wants the store admin's Orders area grouped and behaving like their other site (Storify). This adds a hand-off plan for Antigravity covering the All orders list, Create order and the order detail actions, based on a button-by-button read of Storify's code and its live admin. No application code changed.

## What changed
- New `docs/ORDERS-ALL-ORDERS-PLAN.md`: Storify behaviour, what bsec already has, the gaps, a Phase 1 build order with acceptance criteria, and decisions D1 to D7 the owner must answer before the Create order phase.

## Decisions and trade-offs
- bsec's list is already ahead of Storify (URL state, column picker, chips, bulk runner), so the plan is gap-only, not a rebuild.
- Delete order is deliberately excluded (gapless numbers and GST invoices).
- Create order parity is gated on owner decisions (GST vs flat tax, shipping override, manual payment path, order tags migration).

## Verification
- Ran: `pnpm docs:check` (result below).
- Exercised by hand: browsed Storify's admin orders list and create screen on the owner's demo site; saving an order failed on stock (no stock or location exists there), so the Storify detail page was read from code only.
- NOT verified: nothing in bsec was run or changed; claims about bsec come from reading the code.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed (no structure change)
- [ ] ADR: not needed
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [ ] `progress.md`: not updated; no in-flight claim added because no code work started

## Follow-ups and open questions
- Owner: answer D1 to D7 in the plan.
- Bugs noticed: draft-order `payLink` built from the tenant UUID; `createAdminDraftOrder` writes no `audit_logs` and reserves no stock.
- `Storify/` is untracked inside the repo and must not be committed.
- Pre-orders, Returns, Quotes and Abandoned checkouts still to be mapped.

## Definition of done
Docs only: no secrets, no generated files, no unrelated edits.
