# Block widths in a row, stacking on tablet/mobile, and theme layout inputs

- **Date:** 2026-10-26
- **Agent:** claude
- **Branch:** `fix/block-row-widths`
- **Area:** blocks, block-editor
- **Type:** fix
- **Supersedes:** none

## Summary
Three reported problems on a Section > Container > Block + Block page.
1. Two Blocks at 50% plus a column gap overflowed the Container: `BlockView` set `flex: 0 0 <width>` (no shrink), so the second Block was pushed out of the row.
2. On tablet the first Block did not go full width when stacked: the desktop width lived in an inline flex-basis, which ignored the per-device `width`.
3. Theme settings > Layout inputs committed on every keystroke, so `5` became `5px` and clearing the box reset it.

## What changed
- `packages/blocks/src/views.tsx` (`BlockView`): a Block with a width uses `flex: 0 1 auto` and the per-device `width` variable, so siblings shrink to fit. If only the desktop width is set, tablet and mobile default to 100% (mobile follows tablet); an explicit device width wins.
- `packages/block-editor/src/ThemeSettings.tsx`: new `LengthInput` keeps a local draft and commits the cleaned value on blur or Enter (Escape discards); used by the margin/padding, width and Site width fields.
- `packages/blocks/test/block-row-widths.test.tsx`: markup tests for the above.

## Verification
- Rendered the real markup with the real `blocks.css` in a browser: at 1300px two 50% blocks with a 3rem gap measured 576 + 576 inside a 1200 container (no overflow); at 800px with a column direction both were 800 wide.
- blocks and block-editor tests, typecheck, lint, `docs:check`: see PR.
- Not run: the editor UI itself (the input fix is verified by reading, not by typing in the editor), `test:heavy`, e2e, the owner's real page.

## Open questions
- A row that keeps `direction: row` on tablet/mobile with no widths now splits 50/50 (both 100%, shrinking) rather than keeping the desktop 50%/50% by basis; same visual result for equal columns, different for a 30/70 split (set the tablet widths).
