# Sidebar: stop opening groups on hover

- **Date:** 2026-10-07
- **Agent:** claude
- **Branch:** `fix/sidebar-no-hover-open`
- **Area:** apps/admin
- **Type:** fix

## Summary
The smoke test on `main` is down to 1 failing case of 13 (`the demo store shows real products, orders, customers and discounts`): clicking the "Customers" link timed out because another group's menu button kept intercepting the pointer. Cause: Store Admin sidebar groups opened on hover (`onMouseEnter`) and the previously open group animated closed (220 ms), so links moved under the pointer and a click landed on a different group's button, which in turn opened and closed groups again. This is a real usability bug, not test drift.

Fix: removed hover-to-open from the expanded sidebar and restored a plain click toggle (`apps/admin/src/components/app-shell.tsx`). The collapsed icon rail still shows its flyout through the tooltip, so that behaviour is unchanged. Supersedes the previous click-only-opens workaround from the earlier fix.

## Verification
- `@bs/admin` typecheck and lint clean; admin tests 72 passed.
- Not verified locally: the e2e suite (needs the staging stack); it runs in the smoke-test job on `main`.
