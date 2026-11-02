# Activate screen: three plan cards with a billing tab

- **Date:** 2026-11-02
- **Agent:** claude
- **Branch:** `feat/activate-plan-cards` (not merged yet)
- **Area:** admin, docs
- **Type:** feature
- **Supersedes:** none

## Summary
The "Activate <store>" screen (a store that has not paid yet) now shows the public plans as three cards, each with its badge, tagline, price for the chosen period, the first five plan bullets and its own "Pay and open my store" button, under a Monthly / Yearly tab. Before it was one small form with two dropdowns.

## What changed
- `apps/admin/src/components/billing/activate-store.tsx`: plan cards, billing tab (with a "Save N% yearly" badge taken from the plan prices), one pay button per card (it starts the same `admin.planAndBilling.subscribe` call as before). The plan chosen at signup is highlighted and marked "Your pick". Prices follow the server's currency (INR, or USD for PayPal). Cashfree's mobile number field stays above the cards.
- PayPal wording no longer says the plan "renews automatically": PayPal charges one-time Orders today (see follow-ups).
- Merged-PR bookkeeping for #188: Branch line in `2026-11-01-claude-platform-billing-gateways.md`, In flight line replaced.

## Decisions and trade-offs
- A pay button on every card (fewest clicks) rather than select-then-pay.
- Bullets are capped at five per card; the long comparison table stays on the Plan and billing screen.

## Verification
- Ran: `tsc --noEmit` and `eslint` for `@bs/admin` pass.
- NOT verified: the screen in a browser (desktop and 375 px), a real payment through it.

## Docs updated
- [ ] `docs/ARCHITECTURE.md` not needed (no structure change)
- [ ] ADR / `DEPLOYMENT.md` not needed
- [x] `progress.md` In flight line

## Follow-ups and open questions
- PayPal "This seller doesn't accept payments in your currency" in the sandbox: account setup, not code (see the sandbox issues record, issue 3); cause still to be confirmed by the owner.
- PayPal checkout is still the redirect flow with one-time Orders; the JS SDK buttons / Subscriptions plan is not started.

## Definition of done
Not done: browser check, full gate, merge steps.
