# Website builder, round two: theme follows everywhere, feature grid, header drawer, pricing data, blog widget

- **Date:** 2026-11-05
- **Agent:** claude
- **Branch:** `feat/website-builder-round2` (not merged yet)
- **Area:** blocks, block-editor, domain, platform, web
- **Type:** feature
- **Supersedes:** none

## Summary
The Super Admin page builder follows the theme settings across all sections and widgets, and gains the changes listed below.

## What changed
- Theme tab: the Layout, Fonts, Colours, Corners, Buttons and Icons sections sit as accordions directly under the announcement bar (no extra title or note).
- Theme now reaches the existing sections and widgets: heading and body sizes per device (the website's own headings, which used fixed sizes, and the store widgets through `--bs-*`), fonts and weights, corners, button settings and icon settings. Only settings that were set are applied.
- Feature grid: an icon above each heading (icon picker); on phones each card folds to its title with a drop-down icon. Settings like the FAQ: icon side and shape (plus or arrow), icon size, row height, one open at a time, first open.
- Pricing table: the website now shows what Super Admin > Plans holds: the badge, the line under the name and the card lines (before, only limit-derived lines and a fixed "Popular" on Growth). The editor shows the same live plans instead of a placeholder (`previewPlatformSiteRenderData`).
- Header: the phone menu is a drawer sliding in from the left, the menu button sits before the logo; new Layout option: logo left with the menu beside it, logo left with the menu in the middle, or logo in the middle with the menu on the left.
- Blog posts widget (the store's Blog showcase, grid or slider on every device) is available on website pages. The website FAQ section is replaced by the store's FAQ accordion; saved pages that use the old one still render, and the Home starter uses the new one.

## Verification
Unit tests (blocks 276, block-editor 28), typecheck, lint, docs:check, web build with blank `DATABASE_URL_RW`. The real-database tests were not run locally (Docker was not running); CI runs them. NOT verified in a browser: the drawer, the accordion, the header layouts, the theme sizes on a page and the plans on the live site.

## Notes
- "Logo in the middle, menu on the right" is built as menu on the left: the buttons already sit on the right.
