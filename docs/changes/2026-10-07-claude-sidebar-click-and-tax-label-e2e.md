# Sidebar group click bug and tax label in e2e

- **Date:** 2026-10-07
- **Agent:** claude
- **Branch:** `fix/sidebar-click-e2e-tax`
- **Area:** apps/admin, e2e
- **Type:** fix

## Summary
After the e2e selector update, the staging smoke test on `main` went from 5 failing to 2 failing (11 passed). Remaining causes:
- **Real UI bug (Store Admin sidebar):** a group opens when the pointer hovers it and the click handler *toggled* it, so a mouse user clicking a closed group saw it open on hover and close again on the click. The click now only opens the group (`apps/admin/src/components/app-shell.tsx`); opening another group closes the previous one.
- **Test drift:** the Taxes settings field was relabelled from "Your state (place of supply)" to "Place of supply state"; `e2e/admin.spec.ts` updated.

## Verification
- `@bs/admin` typecheck and lint clean; admin tests 72 passed. The e2e suite itself is only run by the smoke-test job on `main` (needs the staging stack), so it is not verified locally.
