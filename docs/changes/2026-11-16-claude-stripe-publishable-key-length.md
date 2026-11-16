# Stripe publishable key was rejected as too long

- **Date:** 2026-11-16
- **Agent:** claude
- **Branch:** `fix/stripe-publishable-key-length` (not merged yet)
- **Area:** contracts
- **Type:** fix
- **Supersedes:** none (fixes a defect in `2026-11-15-claude-embedded-checkout-build.md`)

## Summary
Saving a Stripe publishable key in Store Admin, Settings, Payments failed with "Too big: expected string to have <=100 characters (keyId)". The `paymentProviders.saveCredentials` contract capped `keyId` at 100 characters, which suits a Razorpay key id but not a Stripe publishable key (about 107 characters or more). The store could therefore never switch on the card fields in the checkout (ADR-048).

## What changed
- `packages/contracts/src/admin.ts`: `saveCredentials` `keyId` allows up to 300 characters.
- `packages/contracts/test/contracts.test.ts`: a test with a 109-character key (accepted) and a 301-character one (rejected).

## Decisions and trade-offs
- 300 matches the existing `keySecret` cap on the same input; the domain still checks the `pk_test_` or `pk_live_` prefix and that the mode matches the secret key. Nothing is stored differently.
- Why my earlier tests missed it: they called the domain function directly with short fake keys and never went through the contract.

## Verification
- Ran: contracts unit tests (15 pass, including the new one).
- NOT verified: saving the key in the running admin against a real store (the owner re-tests after deploy).

## Docs updated
- [x] No architecture, ADR or deployment change (a limit on an input field).

## Follow-ups and open questions
- Owner: after the deploy, paste the publishable key again and save; then reload the checkout.

## Definition of done
Gate parts run locally are listed under Verification; the rest runs in CI. No secrets or generated files in the diff.
