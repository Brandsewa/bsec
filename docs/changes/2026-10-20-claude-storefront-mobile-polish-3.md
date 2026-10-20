# Storefront mobile polish 3: cart above the bottom bar, USP cards, sign-in height, radii

- **Date:** 2026-10-20
- **Agent:** claude
- **Branch:** `fix/storefront-mobile-polish-3`  (not merged yet)
- **Area:** web, blocks, ui
- **Type:** fix
- **Supersedes:** none

## Summary
Owner's phone review after PR #101: the cart drawer still hid behind the bottom bar, plus layout refinements.

## What changed
- **Cart drawer above the bottom bar (real cause):** the drawer was drawn inside the sticky header, which forms its own stacking layer, so no z-index could lift it over the bottom bar. `MiniCartDrawer` now renders on `document.body` through a portal (z-index 100); static renders still draw it in place.
- **Highlight cards:** two cards visible on a phone, the rest slide in; the bottom padding of the product block and the space above Customer Reviews are reduced on phones.
- **Header:** the search icon is hidden on phones (the bottom bar has Search).
- **Sign-in:** the store variant of `AuthShell` fills the space between the store header and bottom bar and centres its content (no `min-h-screen`, no extra padding); the account layout no longer forces full screen height.
- **Corners:** checkout panels (`.bs-panel`) and the search popup are less rounded.

## Verification
- Ran: web typecheck, lint, tests (230), blocks (210), ui (45).
- NOT verified in a browser: the portal in a real session (the dev page kept reloading while compiling), the sign-in centring and USP cards on a phone.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`, ADR, `DEPLOYMENT.md`, `progress.md`: not needed

## Definition of done
- [x] Tests pass for the touched packages; CI runs the rest. No secrets or generated files.
