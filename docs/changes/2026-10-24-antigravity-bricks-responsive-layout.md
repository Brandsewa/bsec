# Change: Bricks Responsive Layout System & Per-Device Controls

- **Date:** 2026-10-24
- **Agent:** antigravity
- **Branch:** feat/theme-builder-layout
- **Area:** visual page builder
- **Type:** feature

## Summary

Implemented responsive device styling, per-device sizing (`height`, `width`, `aspectRatio`), and art direction (different image, video, background, and text per screen size) across all elements (`Section`, `Container`, `Block`, `Heading`, `Text`, `Image`, `Video`):

1. **Device Switcher & Synchronization**:
   - Added a responsive device switcher bar (`Desktop` | `Tablet` | `Mobile`) directly beneath the Content/Style tab bar in the builder sidebar.
   - Synchronized the active device state with Puck's viewport controls (1280px Desktop, 768px Tablet, 375px Mobile).

2. **Puck Field Binding & Tree Sync**:
   - In `BricksLayoutFields.tsx`, device overrides are persisted to `responsive[activeDevice]` via `puck.dispatch({ type: "setData", ... })`, updating the full data tree cleanly without corrupting zone indexes or regenerating child IDs.
   - Keyed inspector fields with `key={`${name}_${activeDevice}`}` to ensure fields remount with device-specific values and clear inheritance placeholders when toggling devices.
   - In `sizingField` and `quadField`, empty device inputs display the inherited desktop value in their placeholder (`"500px (inherit)"`).

3. **CSS Variables & Specificity Fixes**:
   - In `bricksElementStyle()`, responsive properties emit CSS variables (`--brx-d-*`, `--brx-t-*`, `--brx-m-*`).
   - In `blocks.css`, media queries at `@media (max-width: 1023px)` and `@media (max-width: 767px)` apply properties with `!important` to reliably override desktop inline styles.

4. **Sizing & Art Direction Across Elements**:
   - **`ImageView` (`.brxe-image`)**:
     - Added container layout styles (`box-sizing: border-box; overflow: hidden`) and inner `<img>` rules (`width: 100%; height: 100%; object-fit: cover`).
     - Supports art direction: setting different image URLs or media library items on tablet and mobile renders `<picture>` with `<source media="(max-width: 1023px)">` and `<source media="(max-width: 767px)">`.
   - **`VideoView` (`.brxe-video`)**:
     - Configured responsive `<source>` tags for custom uploaded videos and responsive embed switches for iframes.
   - **`SectionView`, `ContainerView`, `BlockView`**:
     - Added support for responsive background images via `<picture>`.
     - Connected `<Slot>` to `var(--b-dir)` so flex direction (horizontal on desktop vs vertical on mobile), padding, and margins switch seamlessly.
   - **`HeadingView` and `TextView`**:
     - Added support for responsive text alignment (`--b-ta`) and per-device text overrides.

## Verification

- Added tests in `packages/blocks/test/responsive-settings.test.tsx` verifying:
  - Responsive sizing on `.brxe-image` (`--brx-d-h`, `--brx-m-h`, etc.)
  - Responsive art direction `<picture>` output with `<source media="(max-width: 767px)">`
  - Responsive video sizing and `<source>` overrides
  - Responsive background image rendering on structural containers
- `pnpm --filter @bs/blocks test:fast` passed (22 test files, 238 passed).
- `pnpm --filter @bs/block-editor test:fast` passed (2 test files, 18 passed).
- `pnpm typecheck` passed cleanly monorepo-wide.
- `pnpm --filter @bs/admin build` succeeded without error.

## Definition of Done Checklist

- [x] Code follows section 2 and 3 of AGENTS.md; the gate passes.
- [x] Tests added or updated (responsive image sizing, art direction, video, background).
- [x] `docs/ARCHITECTURE.md` unchanged (no structural or table migrations).
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: Verified via unit test suites, typecheck, and full admin production build.
