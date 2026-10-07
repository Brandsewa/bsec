# E2E selectors updated for the redesigned dashboards

- **Date:** 2026-10-07
- **Agent:** claude
- **Branch:** `fix/e2e-redesign-selectors`
- **Area:** e2e
- **Type:** test

## Summary
The first full pipeline run on `main` after the design-system overhaul passed typecheck, lint, build, unit tests, heavy tests and the image builds, but the staging smoke test (Playwright e2e) failed with 5 of 12 tests, so production was not deployed. The failures are selector drift from deliberate UI changes, not application bugs:
- Store Admin sidebar links are grouped (Orders, Catalog, Sell, ...) and one group is open at a time, so "Orders", "Products", "Customers", "Discounts" and "Inventory" are not visible links until their group is opened; "Orders" is now the group button and its first link is "All orders".
- "Sign out" (Store Admin) and "Sign Out" (Super Admin) moved from top-level buttons into the user menus ("User account menu", "Staff account menu").
- The signed-in email is only shown inside the user menu.
- The Super Admin "wrong password is refused" failure was a cascade (login rate limit after the earlier failed sign-out test), not a separate regression.

Updated `e2e/admin.spec.ts` (helpers `gotoNav`, `signOutViaMenu`) and `e2e/superadmin.spec.ts` accordingly.

## Verification
- Not run locally: the e2e suite needs the staging compose stack. The proof is the smoke-test job of the next CI run on `main` (it runs only on pushes to `main`).
- Gate: `pnpm docs:check` ok; no application code changed.
