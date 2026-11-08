# Mini cart offers box

- **Date:** 2026-11-08
- **Agent:** claude
- **Branch:** `feat/mini-offers`
- **Area:** `apps/web` (mini cart), `packages/domain` (cart offers list)
- **Type:** feat
- **Supersedes:** none

## Summary
The owner asked for the mini cart's offer notice to be one line ("Offer unlocked: <offer name>"), for the other offers to sit behind a small dropdown arrow so three or more do not stack up, and for the offers and the free-shipping bar to share colours so they read as one section.

## What changed
- `discounts/describe.ts`: `offerHeadline` words any discount in a few words (shared with the product page offers).
- `evaluateCartDiscounts` also returns `offers` (every live automatic offer for everyone, earned ones first); `StorefrontCart.availableOffers` carries it.
- `MiniCartDrawer`: one emerald dashed box with the one-line unlocked offer (a `<details>` arrow lists the others) and the free-shipping bar under a dashed rule. The "You got X free" text is gone.

## Verification
- typecheck, lint 17/17; mini cart tests and `discounts-autoadd.int.test.ts` (15) pass; build ok; product page JS budget test passes.
- Live check after deploy: see below.

## NOT verified
- Not looked at in a browser until the live check.

## Docs updated
- [x] `docs/ARCHITECTURE.md` section 22; no migration, env var or pipeline change
