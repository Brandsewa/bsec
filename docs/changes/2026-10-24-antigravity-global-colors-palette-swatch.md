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
2. **Bricks-Style Circular Color Swatches**:
   - Replaced raw native `<input type="color">` square inputs with clean circular swatches featuring an inset ring and transparent checkerboard fallback.
   - Custom floating popover showing:
     - Header with Title and "Clear" button.
     - Categorized Global Palette (`Site & Palette`, `Light Scheme`, `Dark Scheme`) with tooltips, active indicator dot, and accessible borders.
     - Custom Color section with circular swatch trigger, native color input, and direct hex editing.
3. **Universal Integration**:
   - Added `ThemeColorsContext` in `packages/block-editor/src/context.tsx` and wrapped around the editor canvas in `BlockEditor.tsx`.
   - Wired `ColorPickerSwatch` across Theme Settings (all color fields and button color fields), `BricksLayoutFields.tsx` (background color, border color, shadow color), `config.tsx` (all widget color fields), and `GeneralPanel.tsx` (announcement bar colors).

## Verification
- `pnpm --filter @bs/blocks test:fast`: 22 test files, 247 tests passed.
- `pnpm --filter @bs/block-editor test:fast`: 2 test files, 18 tests passed.
- `pnpm typecheck`: Turbo typecheck across all 15 packages passed with 0 errors.
- `pnpm --filter @bs/admin build`: Vite build completed cleanly in 5.90s.
- `pnpm docs:check`: ok.

## Definition of done
- [x] Code follows AGENTS.md rules.
- [x] Tests added and verified.
- [x] Clean typecheck and build gates.
- [x] Change record committed.
