# Builder canvas widths, tablet/mobile direction, widget padding, and a widget compatibility audit

- **Date:** 2026-10-27
- **Agent:** claude
- **Branch:** `feat/builder-widths-padding-widgets`
- **Area:** blocks (CSS), block-editor (canvas)
- **Type:** fix + audit
- **Supersedes:** none

## Summary
Follow-up to `2026-10-27-claude-editor-block-row.md` (the canvas showed Blocks at equal widths) plus two further findings from measuring the editor on a phone-sized canvas, and an audit of how the older pre-made widgets fit the new Section / Container / Block system.

## What changed
- **Unequal Block widths on the canvas.** `EditorBlock` (`packages/block-editor/src/config.tsx`) emits a small per-Block rule (`blockWidthCss`) that sizes the Block's Puck wrapper per device (desktop width; tablet/mobile 100% unless set, same rule as `BlockView`). A 30% / 70% pair now measures 360 / 840 in a 1200 container, as on the storefront. `display: contents` on the wrapper was tried and rejected: it moves Puck's selection box.
- **Tablet and mobile direction in the editor.** `blocks.css` forced `flex-direction: var(--b-dir) !important` (and the other slot properties) onto the slot. With no direction set the variable is invalid and the property fell to `row`, so a default (column) Container showed its children side by side at half width on a phone canvas. The `!important` is removed; the slot's own inline style already reads these variables with the element's own value as the fallback.
- **Widgets inside a Section or Container.** Every pre-made widget except Hero and Hero slider wraps its content in `.bsb-w` (1rem side padding, a max-width, auto margins). Inside a layout element that stacked on top of the layout's own padding and the theme's site width (16px extra each side on a phone). Inside `.brxe-section` / `.brxe-container`, `.bsb-w` now has no side padding and the `wide` / `full` measures no max-width; `narrow` / `default` keep their reading width. Widgets placed directly on the page (no Section) are unchanged.

## Findings that need an owner decision (not changed)
1. **Section / Container / Block defaults are already zero.** In a fresh page, on desktop and on a phone canvas, Section and Container measure 0 padding, 0 margin, full width; nothing adds padding by itself. The legacy `paddingY` class (`bsb-py-*`) on Section/Container is overridden to 0 by the `.brx-resp` rules, so it no longer has any effect. Extra spacing seen on a page therefore comes from the element's own Style tab, the theme's Layout settings, or a widget (above).
2. **Only 9 of 48 blocks have the Content / Style tabs** (Section, Container, Block, Heading, Text, Image, Video, Button, RichText: the ones that spread `bricksLayoutSchema`). The pre-made widgets (Hero, Hero slider, Multi card, Product showcase, Blog slider, FAQ, Image banner, Testimonials, ...) have their own fields and no Style tab, margin, padding, background or responsive overrides.
3. **Widgets are not wrapped on drop.** A widget dropped on the page root is a top-level block; it is not placed in a Section + Container. Widgets draw their own vertical padding (`bsb-py-lg` etc.) and their own column, independent of the theme's Layout settings (site width, section/container defaults).
   Recommended direction (owner to confirm): (a) wrap-on-drop for store widgets in Section > Container so the theme layout governs width and spacing; (b) keep widgets' own content fields and do not add the Bricks Style tab to each one, because the wrapping Section / Container already carries it; (c) drop the widgets' own `bsb-w` column once (a) is in place. (a) changes every existing page's structure if applied retroactively, so it should apply to newly dropped widgets only.

## Verification
- Mounted the real `BlockEditor` in a throwaway Vite page (not committed): 30/70 Blocks measured 360/840 at 1200; selecting a Block draws its box in place; a default Container on a 375px canvas is a column with full-width children (was a row at 188px each); a row Container with only desktop widths stays a row at 188 / 188 on a phone.
- Rendered each pre-made widget inside Section > Container and at the top level with the real `blocks.css` at 375px: inside, side padding 0 and full width; top level still 16px.
- blocks 261 and block-editor 23 tests, typecheck, lint, `docs:check`: see PR. Not run: `test:heavy`, e2e, tablet in the real editor, the owner's page.

## Open questions
- Confirm finding 3 (wrap-on-drop, no per-widget Style tab) before any widget is changed.
- The owner's extra mobile padding was not reproduced on a fresh page; if it persists, which element (Section, Container, a widget) and what its Style tab shows for mobile padding.
