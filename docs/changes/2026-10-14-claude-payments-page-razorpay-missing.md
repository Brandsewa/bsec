# Payments settings page failed to load, hiding the Razorpay gateway card

- **Date:** 2026-10-14
- **Agent:** claude
- **Branch:** `fix/jobs-errors-confirm`
- **Area:** domain, docs
- **Type:** fix
- **Supersedes:** none

## Summary
Owner report: Razorpay is enabled on the platform but does not show in store admin Settings > Payments. Reproduced on the local real stack: the page shows "Could not load payment methods" and nothing below it, because `admin.paymentMethods.list` returned 500 (output validation failed). For a store that has never saved a Razorpay row, `getTenantPaymentMethods` synthesizes a Razorpay catalogue entry with id `00000000-0000-0000-0000-000000000001`, which is not a valid UUID for the contract (`z.string().uuid()`). The whole page errored, so the Razorpay gateway card (a separate query) was never reached. Fixed by using a valid sentinel UUID (`00000000-0000-4000-8000-000000000001`; nothing reads the id).

## Tests
- `packages/domain/test/payment-methods-catalogue.int.test.ts` (real Postgres): a new store's list parses against `PaymentMethodItem`. Fails with "Invalid UUID" before the fix, passes after.

## Verification
- Reproduced locally (staging stack, seeded owner): 500 on `paymentMethods/list`; platform row `razorpay` enabled. Not re-run in a browser after the fix: the stack runs the previous image.

## Docs updated
- [x] `docs/MEDIA-LIBRARY-PLAN.md`: Phase 5 logged as deferred.

## Follow-ups
- `orders.ts` also uses a non-v4 sentinel id for a missing location; not checked against its contract.
