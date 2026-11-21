# Account, Permissions: show only the store you are working in

- **Date:** 2026-11-21
- **Agent:** claude
- **Branch:** `fix/account-permissions-current-store` (merged in #309, 040fd1ab)
- **Area:** admin, docs
- **Type:** fix
- **Supersedes:** none (refines `2026-11-21-claude-account-tabs-permissions.md`)

## Summary
The Permissions tab listed one block per store the person belongs to. It now shows only the store they are currently working in (the active store). Their access to other stores appears when they switch to that store. Presentation only; nothing about enforcement changed.

## What changed
- `PermissionsTab` takes the active store id (from the `_store` route context) and renders that store only; if the person has no role there it says so.
- Tests: two render tests (other stores and their owners' emails never appear; the view follows a switch; no-role message).

## Verification
- Admin typecheck, lint and the tab's 7 render tests pass. In the browser, a seeded user with roles in two stores saw only Demo Store's role first, then only the second store's role (Editor) after switching the active store. Not verified: CI.
- The account response still carries every store the person belongs to; the filter is client side. Narrowing the API is possible later if the other stores' names should not leave the server at all.

## Docs updated
- [x] This record. `progress.md` In flight line (remove after merge). No architecture change.
