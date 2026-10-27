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

## Owner decision applied: wrap new widget drops in Section > Container
Decided 2026-10-27: store widgets dropped on the page itself arrive inside Section > Container (new drops only, existing pages untouched), and the widgets do not get a Style tab each (the wrapping Section / Container carries it).
- `packages/block-editor/src/wrap-on-drop.ts`: `WRAP_ON_DROP` (MultiCard, ProductShowcase, ProductCarousel, ProductGrid, CollectionGrid, CollectionShowcase, BlogPosts, BlogShowcase, Testimonials, Reviews, ReviewsMarquee, FAQ, FaqSection, Gallery, Newsletter, UspStrip) and the pure `wrapDroppedWidget`.
- `BlockEditor.tsx`: Puck's `onAction` sees an `insert` into the page's own zone (`root:default-zone`) and, through a small `PuckBridge` (`useGetPuck`) inside Puck, replaces the dropped widget with Section > Container > widget. Moves, duplicates and drops into an existing Section / Container are not touched. The replacement is not a separate undo step.
- Left unwrapped on purpose: Hero, Hero slider, Image banner, Call to action (full-bleed designs), the announcement bar, site header / footer, layout and content elements, and the page-specific blocks (product, cart, collection, blog). Say if any of these should wrap too.
- Verified in the real editor (throwaway page): inserting MultiCard at the page root produced Section > Container > MultiCard; an existing top-level FAQ block stayed as it was; Hero stayed unwrapped. The dispatch used Puck's `insert` action (what a drawer drop sends); a physical drag could not be driven by the test tooling, so the pointer-drag itself was not exercised.

## Findings that needed an owner decision
1. **Section / Container / Block defaults are already zero.** In a fresh page, on desktop and on a phone canvas, Section and Container measure 0 padding, 0 margin, full width; nothing adds padding by itself. The legacy `paddingY` class (`bsb-py-*`) on Section/Container is overridden to 0 by the `.brx-resp` rules, so it no longer has any effect. Extra spacing seen on a page therefore comes from the element's own Style tab, the theme's Layout settings, or a widget (above).
2. **Only 9 of 48 blocks have the Content / Style tabs** (Section, Container, Block, Heading, Text, Image, Video, Button, RichText: the ones that spread `bricksLayoutSchema`). The pre-made widgets (Hero, Hero slider, Multi card, Product showcase, Blog slider, FAQ, Image banner, Testimonials, ...) have their own fields and no Style tab, margin, padding, background or responsive overrides.
3. **Widgets are not wrapped on drop.** A widget dropped on the page root is a top-level block; it is not placed in a Section + Container. Widgets draw their own vertical padding (`bsb-py-lg` etc.) and their own column, independent of the theme's Layout settings (site width, section/container defaults).
   Direction chosen by the owner: (a) wrap-on-drop for new drops (above); (b) no Style tab per widget; (c) the widgets' own `bsb-w` column is neutralised inside a Section / Container (above) and can be removed once old pages are migrated.

## Verification
- Mounted the real `BlockEditor` in a throwaway Vite page (not committed): 30/70 Blocks measured 360/840 at 1200; selecting a Block draws its box in place; a default Container on a 375px canvas is a column with full-width children (was a row at 188px each); a row Container with only desktop widths stays a row at 188 / 188 on a phone.
- Rendered each pre-made widget inside Section > Container and at the top level with the real `blocks.css` at 375px: inside, side padding 0 and full width; top level still 16px.
- blocks 261 and block-editor 23 tests, typecheck, lint, `docs:check`: see PR. Not run: `test:heavy`, e2e, tablet in the real editor, the owner's page.

## Open questions
- Should any of the left-out widgets (Hero slider, Image banner, Call to action, Hero) also wrap on drop?
- The owner's extra mobile padding was not reproduced on a fresh page; if it persists, which element (Section, Container, a widget) and what its Style tab shows for mobile padding.
