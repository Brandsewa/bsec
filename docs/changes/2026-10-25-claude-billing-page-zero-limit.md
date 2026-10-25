# Plan and billing failed to load for stores on the restricted tier

- **Date:** 2026-10-25
- **Agent:** claude
- **Branch:** `fix/billing-page-zero-limit`
- **Area:** domain
- **Type:** fix
- **Supersedes:** none

## Summary
A store whose trial ended unpaid is moved to the restricted (XS) size tier, which allows 0 custom domains. The Plan and billing usage math divided by that limit (0 / 0 = NaN), the response failed the API contract's number check, and the owner saw "Something went wrong", on the one page that tells them to pay. Existing bug (any lapsed-trial store), exposed by testing with the trial off.

## What changed
- `percentUsed` is 0 (or 100 when something is used) for a limit of 0.
- Test: a store on the XS tier loads Plan and billing and its response passes the `PlanAndBillingView` contract. The test fails without the fix.

- Tooling: `scripts/test-affected.mjs` (the pre-push gate from the CI-speed PR) ran `vitest --changed` from the repository root, where the web app's `@/` alias and JSX transform are not configured, so the gate failed for any change that touched files the web tests import (and for the root package itself). It now runs each changed package's own vitest (`pnpm --filter "...[origin/main]" --filter "!bsec" exec vitest ... --changed origin/main --passWithNoTests`). Needed to push at all; no hook was skipped.

## Decisions and trade-offs
- The earlier "Billing problem: <reason>" wrapper did not show because this failure happens in the contract's output validation, after the handler returns.

## Verification
- Ran: typecheck; `platform-billing-cashfree` (13 pass, including the new one; it fails with the fix removed).
- NOT verified: in the browser on the owner's store.

## Docs updated
- [x] none needed

## Follow-ups and open questions
- None.

## Definition of done
Pending CI.
