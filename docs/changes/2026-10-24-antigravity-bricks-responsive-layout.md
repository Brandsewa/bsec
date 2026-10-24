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

2. **Recursive Data Updates & Deep Slots**:
   - Fixed `updateTree` in `BricksLayoutFields.tsx` to recursively traverse nested slots and items (`item.props.content`, `item.props[slotName]`, `zones`), enabling device overrides (`direction`, `gap`, `padding`, `sizing`) to save and persist on deeply nested Containers, Blocks, Images, Headings, and Texts.
   - Keyed inspector fields with `key={`${name}_${activeDevice}`}` to ensure fields remount with device-specific values and clear inheritance placeholders when toggling devices.
   - Added input normalization for lengths: typing bare numbers (e.g. `16`, `20`) automatically normalizes to `16px`, `20px` across gap, padding, margin, and sizing inputs.

3. **CSS Variable Isolation & Specificity**:
   - In `blocks.css`, explicitly reset all `--brx-*` variables on `.brx-resp` to `initial`, preventing accidental inheritance of padding, margins, gaps, or directions from parent Sections/Containers down into child Blocks and widgets.
   - In `blocks.css`, media queries at `@media (max-width: 1023px)` and `@media (max-width: 767px)` forward layout variables (`--b-dir`, `--b-gap`, etc.) to inner dropzone wrappers and flex containers with `!important`.
   - On mobile, blocks inside container stack vertically with 100% full width (`flex: 0 0 100% !important; width: 100% !important`).

4. **Sizing, Width, & Art Direction Across Elements**:
   - **`ImageView` (`.brxe-image`)**:
     - Defaults to 100% container width with `display: block; box-sizing: border-box; overflow: hidden`, preventing unwanted side spacing or accidental flex-shrink centering.
     - Supports art direction: setting different image URLs or media library items on tablet and mobile renders `<picture>` with `<source media="(max-width: 1023px)">` and `<source media="(max-width: 767px)">`.
   - **`VideoView` (`.brxe-video`)**:
     - Configured responsive `<source>` tags for custom uploaded videos and responsive embed switches for iframes.
   - **`SectionView`, `ContainerView`, `BlockView`**:
     - Added support for responsive background images via `<picture>`.
     - Connected `<Slot>` to `var(--b-dir)` and `var(--b-gap)` with safe fallbacks so flex direction (horizontal on desktop vs vertical on mobile), gaps, padding, and margins switch seamlessly.
   - **`HeadingView` and `TextView`**:
     - Added support for responsive text alignment (`--b-ta`) and per-device text overrides with 100% width defaults.

## Verification

- Added tests in `packages/blocks/test/responsive-settings.test.tsx` verifying:
  - Responsive sizing on `.brxe-image` (`--brx-d-h`, `--brx-m-h`, etc.)
  - Responsive art direction `<picture>` output with `<source media="(max-width: 767px)">`
  - Responsive video sizing and `<source>` overrides
  - Responsive background image rendering on structural containers
  - Bare number gap normalization (`"24"` -> `"24px"`) and responsive direction / gap propagation
  - Element 100% width defaults on Image and Heading
- `pnpm --filter @bs/blocks test:fast` passed (22 test files, 240 passed).
- `pnpm --filter @bs/block-editor test:fast` passed (2 test files, 18 passed).
- `pnpm typecheck` passed cleanly monorepo-wide.
- `pnpm --filter @bs/admin build` succeeded without error in 6.31s.
- `pnpm docs:check` passed.

## Definition of Done Checklist

- [x] Code follows section 2 and 3 of AGENTS.md; the gate passes.
- [x] Tests added or updated (responsive image sizing, art direction, video, background, gap normalization).
- [x] `docs/ARCHITECTURE.md` unchanged (no structural or table migrations).
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: Verified via unit test suites, typecheck, docs:check, and full admin production build.
