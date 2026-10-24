# Change: Responsive Border Radius & Border Controls Across All Elements

- **Date:** 2026-10-24
- **Agent:** antigravity
- **Branch:** feat/theme-builder-layout
- **Area:** visual page builder / styling engine
- **Type:** fix

## Summary
Fixed responsive border radius and border styling across Blocks, Sections, Containers, Images, Videos, Headings, and Texts:
1. **Responsive CSS Variable Architecture for Borders**:
   - Added `--brx-d-rtl`, `--brx-d-rtr`, `--brx-d-rbr`, `--brx-d-rbl` (and tablet/mobile equivalents) for 4-corner border radius.
   - Added `--brx-*-bw` (border-width), `--brx-*-bs` (border-style), `--brx-*-bc` (border-color), and `--brx-*-bsh` (box-shadow).
   - In `blocks.css`, bound `.brx-resp` properties (`border-top-left-radius: var(--b-rtl)`, etc.) with `@media (max-width: 1023px)` (tablet) and `@media (max-width: 767px)` (mobile) `!important` overrides, enabling responsive preview in editor and live storefront.
2. **Bricks-Style Cascade & Normalization in `bricksElementStyle`**:
   - Implemented `getCornerRadius` with fallback to uniform `radius` and automatic Desktop -> Tablet -> Mobile cascade.
   - Normalized all unitless numbers (e.g. `12` -> `12px`, `0` -> `0px`) so browsers never drop invalid CSS.
3. **Editor UI with Linked / Unlinked Corner Radius Controls**:
   - Enhanced `borderField` in `packages/block-editor/src/BricksLayoutFields.tsx`:
     - Inherited placeholder values shown on tablet and mobile (e.g. `16px (inherit)`).
     - Link / Separate toggle button: linked mode edits all 4 corners with 1 input; unlinked mode allows custom TL, TR, BR, BL radii.
     - Auto-normalizes numbers on blur.
   - Enhanced `boxShadowField` with inherited placeholders across devices.
4. **Nested Background Clipping**:
   - Added `borderRadius: "inherit"` to background `<picture>`, `<img>`, and `<video>` tags in `BlockView`, `ContainerView`, `SectionView`, `ImageView`, and `VideoView` to ensure media clips cleanly to rounded borders.

## Verification
- `pnpm --filter @bs/blocks test:fast`: 22 test files, 249 tests passed (including responsive border radius on block, container, and image).
- `pnpm --filter @bs/block-editor test:fast`: 2 test files, 18 tests passed.
- `pnpm typecheck`: 15 packages passed with 0 errors.
- `pnpm --filter @bs/admin build`: Vite build completed cleanly in 6.59s.
- `pnpm docs:check`: ok.

## Definition of done
- [x] Code follows AGENTS.md rules.
- [x] Tests added and verified.
- [x] Clean typecheck and build gates.
- [x] Change record committed.
