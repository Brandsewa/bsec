# Website builder: the store's Theme settings, with Light and Dark colours

- **Date:** 2026-11-05
- **Agent:** claude
- **Branch:** `feat/website-theme-settings` (not merged yet)
- **Area:** blocks, block-editor, web
- **Type:** feature
- **Supersedes:** the quick colour and font settings added in `2026-11-03-claude-website-batch-a.md` (still honoured when no theme tokens are set)

## Summary
The Theme tab of the Super Admin page builder now has the same Layout, Fonts, Colours, Corners, Buttons and Icons sections as the store builder's Theme settings (`ThemeSettingsPanel`), without the colour presets. Colours have Light and Dark tabs with the same fields. The announcement bar stays at the top of the tab.

## What changed
- `ThemeSettingsPanel` takes `hidePresets` and `colorModes`. Dark colours are saved as `tokens.darkColors`.
- `MkTheme` (the block on the Header page that holds the website's settings) now holds `tokens`; the earlier `light`, `dark` and `font` fields stay and apply only when no tokens are set.
- `websiteThemeCss` turns the tokens into CSS scoped to `.mk`: palette (page background, text, surface, buttons, in light and dark mode, only for colours that were set), heading and body fonts and weights, card and button corners, uppercase and outline buttons, button colours, and site width per device. The layout reads the Google Fonts stylesheet for the chosen fonts.

## Decisions and open items
- The website has its own fixed design, so the tokens map onto its palette (`--bg`, `--ink`, `--pri` ...) rather than the store's `--bs-*` variables. Heading sizes, section and container spacing and icon settings can be edited but are not applied to the website pages yet; the editor canvas also does not preview the theme.

## Verification
Unit tests (blocks 272, block-editor 28), typecheck, lint, docs:check, web build with blank `DATABASE_URL_RW`. The real-database platform tests were not run here (Docker was not running); CI runs them. NOT verified in a browser.
