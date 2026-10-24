# Change: Categorized Global Colors Palette & Circular Swatch Popover

- **Date:** 2026-10-24
- **Agent:** antigravity
- **Branch:** feat/theme-builder-layout
- **Area:** visual page builder
- **Type:** feature

## Summary
Optimized the Global Colors system across the Theme Builder and Block Editor with reference to Bricks Builder best practices:
1. **New 15-Key Categorized Global Color Architecture**:
   - **Presets**: Forest, Ocean, Sunset, Mono, Midnight expanded to full 15-key palettes with legacy aliases.
   - **Site Background**: Overall canvas / site background (`siteBackground`, `--bs-site-bg`, `--bs-bg`, `--color-background`).
   - **Brand Palette**: Primary (`primary`), Secondary (`secondary`), Accent 1 (`accent1`), Accent 2 (`accent2`).
   - **Light Scheme**: Heading (`lightHeading`), Text (`lightText`), Button (`lightButton`), Button Text (`lightButtonText`), Backgrounds (`lightBackground`).
   - **Dark Scheme**: Heading (`darkHeading`), Text (`darkText`), Button Background (`darkButton`), Button Text (`darkButtonText`), Backgrounds (`darkBackground`).
   - Full backward compatibility with `--bs-*` and `--color-*` variables so no existing storefront elements or templates break.
2. **Bricks-Style Circular Color Swatches & Refined Popover**:
   - Replaced raw native `<input type="color">` square inputs with clean circular swatches featuring an inset ring and transparent checkerboard fallback.
   - Popover rendered using `createPortal(..., document.body)` with `position: fixed` and `z-index: 999999`, resolving parent stacking context traps caused by accordion fade animations.
   - In Theme Settings: removed popovers entirely, using `ThemeColorRow` (direct circular swatch triggering native OS picker, hex code input, and description hint laid out cleanly *below* the inputs).
   - In Widget Style popovers: kept the curated **Site Palette** (5 colors: Site Background, Primary, Secondary, Accent 1, Accent 2) and removed redundant preset duplicate schemes.
   - Added **Text Color Scheme Pairing** in the popover (`lightHeading`, `lightText`, `darkHeading`, `darkText`) with automated contrast recommendation badges (`Readable on this color`).
   - Added companion `Text Color` field under Background in `BricksLayoutFields.tsx` and wired `textColor` to `backgroundSchema`, `--brx-d-c`, `--brx-t-c`, and `--brx-m-c` in `blocks.css`.
3. **Universal Integration**:
   - Added `ThemeColorsContext` in `packages/block-editor/src/context.tsx` and wrapped around the editor canvas in `BlockEditor.tsx`.
   - Wired `ColorPickerSwatch` across Theme Settings (all color fields and button color fields), `BricksLayoutFields.tsx` (background color, text color, border color, shadow color), `config.tsx` (all widget color fields), and `GeneralPanel.tsx` (announcement bar colors).

## Verification
- `pnpm --filter @bs/blocks test:fast`: 22 test files, 248 tests passed (including text color pairing and responsive layout styles).
- `pnpm --filter @bs/block-editor test:fast`: 2 test files, 18 tests passed.
- `pnpm typecheck`: Turbo typecheck across all 15 packages passed with 0 errors.
- `pnpm --filter @bs/admin build`: Vite build completed cleanly in 6.57s.
- `pnpm docs:check`: ok.

## Definition of done
- [x] Code follows AGENTS.md rules.
- [x] Tests added and verified.
- [x] Clean typecheck and build gates.
- [x] Change record committed.
